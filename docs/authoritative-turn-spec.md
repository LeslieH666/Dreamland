# Phase 2.5.3 服务端权威轮次 `/generate` 接线规范

> 用途：给 Flash 的 2.5.3 提供**接口契约**——`/api/v1/chats/{id}/generate` 从「网关模式」升级为「权威轮次」。只定义输入/输出/职责边界，不规定实现细节。
> 前置：2.5.2 第 3–7 步已完成（`src/prompt-assembly/` 含 world-info / registry / populate / orchestrate）。
> 依据：`docs/prompt-assembly-map.md` §11（数据映射）、`docs/api-v1.openapi.yaml`、附 I/K 裁决。

---

## 1. 目标与边界

- **目标**：`/generate` 服务端组装完整提示词（角色卡 / World Info / Persona / 记忆 / 群聊 / 作者注），经既有模型代理流式返回。
- **边界（按附 I/K 裁决）**：仅 CC 族；仅 legacy 宏引擎（实验引擎服务端命中**抛错**）；`leslie-reality` / `/inject` filter / 向量 / 数据银行 / 多模态图片**不参与**。
- **双轨**：旧浏览器路径（`public/script.js` 直连后端）与 `/model/chat/completions` 网关模式**继续可用**，本次只改 `/api/v1/chats/{id}/generate`。

---

## 2. 请求 / 响应契约（扩展 `/api/v1/chats/{id}/generate`）

请求体新增字段（与契约草案对齐后更新 `docs/api-v1.openapi.yaml`）：

```jsonc
{
  "message": "（可选）新的用户消息，先附到历史再生成",
  "type": "normal",              // normal|continue|swipe|regenerate|impersonate|quiet（缺省 normal）
  "stream": true,                // 缺省 true
  "temperature": 0.7, "max_tokens": 256, "top_p": null,   // 透传给后端
  "random_seed": 1234,           // WI 概率种子（测试用；生产缺省真随机）
  "note_text": "（可选）作者注正文"  // 缺省用 chat_metadata.note_prompt（见 §5 注）
}
```

响应：SSE，`chat.completion.chunk` 序列 + `[DONE]`，`X-Accel-Buffering: no`（沿用 `src/api-v1/sse.js`）。

---

## 3. 编排函数接口（`src/prompt-assembly/orchestrate.js`，第 7 步产物）

```js
/**
 * 组装一次权威轮次的 chat-completion 消息与生成参数。
 * 只做“加载持久化状态 → 重建 registry/context → 调共享纯核心”，不直连模型。
 *
 * @param {object} input
 * @param {object} input.user              // 已鉴权 request.user（含 .directories）
 * @param {string} input.chatId            // /api/v1 不透明 chat id（经 ids.js 解析）
 * @param {'normal'|'continue'|'swipe'|'regenerate'|'impersonate'|'quiet'} [input.type]
 * @param {string} [input.pendingUserText] // 新用户消息（替代 DOM 读取）
 * @param {string} [input.noteText]        // 作者注正文（替代 DOM 读取；缺省用 chat_metadata.note_prompt）
 * @param {number} [input.randomSeed]      // WI 概率 RNG 种子
 * @returns {Promise<{ messages: Array<{role,content,name?}>, counts: object }>}
 */
export async function assembleAuthoritativeTurn(input) { /* … */ }
```

职责边界：
- **只**加载并组装，**不**调模型、**不**写聊天文件（WI 的 `timedWorldInfo` 写回除外，见 §7）。
- 抛出 `ApiError`（`src/api-v1/errors.js`）表达失败，不静默降级。

---

## 4. 数据加载映射（`chatId` → 组装输入）

按盘点 §11 逐项：

| 组装需要 | 服务端来源 |
|---|---|
| 角色卡 | `ids.js` 解析 `chatId` → `cardName` → `<userRoot>/characters/<cardName>.png`（内嵌卡 JSON） |
| 聊天数组 + `chat_metadata` | `getChatData(filePath)`（`src/endpoints/chats.js:515`），首行 metadata |
| 群组 / 群聊天 | group chat id = `group\0<fileName>` → `group chats/<fileName>.jsonl`；成员来自 `groups/<id>.json` |
| 设置 | `<userRoot>/settings.json`（`power_user`/`oai_settings`/`world_info_settings`/`extension_settings`/`max_context`/`amount_gen`/`main_api`/`swipes`/`username`/`user_avatar`） |
| Persona | `settings.json.power_user.persona_description*` + `user_avatar` + `chat_metadata.persona` |
| 记忆四类文本 | `<root>/leslie/memory/*`，经 `src/leslie-memory/store.js` 现有 API |
| World Info | `<userRoot>/worlds/*.json` + `world_info_settings` + `chat_metadata.world_info` + `timedWorldInfo` |
| 作者注 | `noteText`（显式）或 `chat_metadata.note_prompt`（缺省） |

---

## 5. registry 重建（`extension_prompts` 服务端等价，2.5.3 的核心工作量）

把盘点 §7.2 的注册者按持久化来源重建为 `registry`（`Record<key, ExtensionPromptEntry>`）：

| 浏览器注册者 | 服务端重建来源 |
|---|---|
| `leslie_memory_growth/relationship`（IN_PROMPT） | `LeslieMemoryStore`（growth/relationship 文本） |
| `leslie_memory_events/cross_line`（IN_CHAT depth 4/5） | `LeslieMemoryStore`（events/cross-line 文本） |
| `leslie_reality_time`（IN_PROMPT） | 按 Q3：reality 替换式流水线**延后**；本步先不注入（或仅时间文本，待决） |
| `leslie_reply_style`（IN_PROMPT） | `extension_settings[LESLIE_REPLY_STYLE_SETTINGS_KEY]` |
| `2_floating_prompt`（作者注） | `chat_metadata.note_*` + `noteText` |
| WI→AN 劫持 | `checkWorldInfo` 内完成（第 4 步产物） |
| `1_memory`/`3_vectors`/`4_vectors_data_bank` | **不重建**（上游浏览器扩展/向量，按 Q4 排除） |

> **注**：作者注正文浏览器读的是**实时输入框**（`$('#extension_floating_prompt').val()`），可能异于已持久化的 `note_prompt`。为逐字等价，客户端（含浏览器）应把实时值经 `note_text` 上报；服务端缺省回退到 `chat_metadata.note_prompt`。此差异需在文档与契约里写明。

---

## 6. 宏 context 构建

按 `src/prompt-assembly/macros.js` 的 context 形状，从 §4 加载的状态填充：`name1/name2/characters/groups/selectedGroup/mainApi/powerUser/chatMetadata/getCardFields/helpers/…`。
- 实验宏引擎：服务端命中 `experimental_macro_engine=true` 时**抛 `ApiError`**（附 K），不静默用 legacy。

---

## 7. 模型代理分发（复用既有 handler，不重写）

组装完成后，构造请求体并调用既有 OpenAI 兼容后端：

```js
// src/api-v1/routes/chats.js 内
import { handleChatCompletionGenerate } from '../../endpoints/backends/chat-completions.js';
// body = { messages: assembled.messages, model, temperature, max_tokens, stream, … }
```

- 复用 `handleChatCompletionGenerate`（与 `/model/chat/completions` 同源），**不复制其逻辑**。
- `timedWorldInfo` 写回：组装期间如触发 WI 时间效果，按附 I Q5 **允许**写 `chat_metadata.timedWorldInfo`（只写 JSONL 首行，不动正文）。

---

## 8. 验收（2.5.3 完成标准）

1. `/api/v1/chats/{id}/generate` 组装结果对同一夹具与浏览器**逐字一致**（复用 `test:prompt-baseline` 或等价服务端断言）。
2. SSE 流式 + `X-Accel-Buffering: no` + `[DONE]` 正确。
3. 旧浏览器路径与 `/model/chat/completions` 网关模式不受影响。
4. 红线：`chats.js`/`characters.js`/`prompt-converters.js` diff 为空；`npm run validate` 通过。
5. 契约 `docs/api-v1.openapi.yaml` 已标注“权威轮次”并补充新字段。
