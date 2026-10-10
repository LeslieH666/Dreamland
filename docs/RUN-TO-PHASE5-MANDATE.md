# DreamLand 连续开发强制令（Flash 自读，连续执行到 Phase 5 结束）

> 这是给执行 Agent 的**唯一自包含指令**。你只需读本文件即可续跑，无需回翻聊天记录；完整历史裁决见 `docs/refactor-execution-checklist.md`（附 L/M/N/O/P）与 `docs/frontend-backend-separation-plan.md`。
>
> **你的任务**：连续执行「**P2.5 收尾 → Phase 4（Web PWA）→ Phase 5（React Native App）**」，直到 **Phase 5 结束（RN App 首版完成）**。**不逐单元/逐阶段停靠**；在每个 phase 完成时**写里程碑报告但不停止**，继续下一 phase；只在出现本文件 §7 定义的新分叉时才停。

---

## 1. 当前状态（续跑起点）

- HEAD：`3b96b67ad` 之后已有多个 2.5.3 收敛 commit（最新见 `git log`）。
- **oracle**：`0/9 byte-identical`；**messages 0–9 已逐字一致**；消息数 **16**（基线 19–24）；**首分歧 @ message 10**。
- `npm run validate` exit 0（80 suites / 944 tests）；`test:prompt-baseline` 9/9；红线 3 文件累计 diff 空；`openai.js` 43→43、`PromptManager.js` 7→7。

---

## 2. 第一部分：P2.5 收尾（2.5.3 → 2.5.4 → 2.5.5）

### 2.1 当前瓶颈（先解决这一处）

message 10 处：基线是 `[Example Chat]`，服务端却是**历史首条**。已排除：`prompts.has('dialogueExamples')=true`、`messageExamples=2`、`canAffordAll=true`、`populateChatHistoryCore` 正常返回（历史已 6 条）。

**结论**：示例**被插入但未出现在结果**，且历史排在示例之前。下一步**只查**：
1. `ChatCompletion.insert(msg, 'dialogueExamples')` 与 `add(new MessageCollection('chatHistory'), prompts.index('chatHistory'))` 的**索引/插入语义**；
2. `pin_examples:false` 下“先历史后示例”的调用顺序，是否应像浏览器一样由**标记索引**（dialogueExamples=8 < chatHistory=9）决定最终顺序。

诊断方法沿用惯例：在 `populate.js` 分支点临时插桩拿事实（跑完即还原、不入库），不靠猜。

### 2.2 P2.5 剩余清单（严格顺序）

1. **解示例/历史放置语义**（§2.1）→ 跑 oracle，目标消息数回到 19–24 且首分歧后移。
2. **§5 剩余**：`#9` 群卡合并 + **group 卡加载**（当前 group 例 404）；events/cross_line 深度注入复核；**quiet 类型门控复核**。
3. **§6 宏 context**：legacy 引擎；`evaluateMacros` 数据裁决——9 基线不触发则保持 fail-closed 桩（抛 `experimental_macro_engine_unsupported`），触发则用 npm 依赖 `handlebars/moment/seedrandom/droll` 抬升；实验宏引擎恒 fail-closed。
4. **四项服务端接线收尾**：`assertWorldInfoPortable`(`enforcePortability=true`)、`createSeededRandom`、`resolveChatCompletionTokenizerModel`、`configureChatCompletion` 全部被服务端真正调用。
5. **§7 `/api/v1/chats/{id}/generate` 改权威轮次**：复用 `handleChatCompletionGenerate`；`note_text` 缺省回退 `chat_metadata.note_prompt`；`timedWorldInfo` 只写 JSONL 首行；不复制业务逻辑。
6. **§8.5** 更新 `docs/api-v1.openapi.yaml`（标注“权威轮次”）。
7. **2.5.4**：replay oracle 输出 **`9/9 byte-identical`**（硬关口，未达成不算完成）。
8. **2.5.5**：切换收口，写 P2.5 里程碑报告（见 §8），**不停止**，进入 Phase 4。

---

## 3. 第二部分：Phase 4 — Web 前端解耦为 PWA

> 目标：Web UI 变成独立客户端；公网 Web 走 Token，桌面版沿用 Cookie。**不改聊天核心行为**。

1. **Web 端 Token 鉴权**：`DREAMLAND_MODE=server` 时登录流程走 `/api/v1/auth/*` Token（`desktop` 模式沿用 cookie 登录）。Token 存入安全位置，请求带 `Authorization: Bearer`。
2. **PWA**：`public/manifest.json` 已存在，补 service worker（只做离线壳缓存，**不缓存聊天/角色/密钥数据**）。
3. **CSP/CORS 收紧**：`src/server-main.js` 里 `helmet` 的 `contentSecurityPolicy:false` 改为显式策略；CORS 仅允许配置源。
4. **拆分巨型模块**：优先 `public/scripts/chats.js`、`leslie-settings.js`（**行为不变**，只拆分到更小单文件）。
5. **验证**：桌面 cookie 登录与公网 Token 登录两条路径都能完成一次聊天；PWA 可安装；`test:prompt-baseline` 9/9 保持、红线 3 文件零触碰、`validate` 全绿。写 Phase 4 里程碑报告，**不停止**。

---

## 4. 第三部分：Phase 5 — React Native App

> 目标：基于 `/api/v1` 交付首版 iOS/Android 客户端。**依赖 P2.5.5 已完成（服务端 `/generate` 权威轮次可用）**。

1. **脚手架**：`npx create-expo-app@latest apps/mobile --template blank-typescript`（独立 pnpm/npm 边界，不污染根 `src/`/`public/`）。旧 `mobile/android`（WebView）在 `mobile/README.md` 标注停用，暂不删除。
2. **API 客户端 + 领域类型共享层**：对接 `docs/api-v1.openapi.yaml`，生成/手写 typed client；**与 UI 组件彻底解耦**（为后期原生化留分层）。
3. **按功能模块组织**：`auth / chat / characters / memory / moments / voice / settings`。
4. **核心闭环**：登录/注册 → 角色列表 → 聊天（SSE 流式 + 打字机显示）→ TTS 播放 → 记忆/朋友圈只读初版。
5. **SSE + 音频**：SSE 用 `fetch` + `ReadableStream` 解析 `data:` 行（处理 `[DONE]` 与中断续播）；音频用成熟 RN 音频库。
6. **验证**：iOS 模拟器 + Android 模拟器各跑通一次「登录→建角色→发消息→流式回复→TTS」，SSE 无丢字；API 客户端层可独立复用。
7. **后端不得回归**：`npm run validate` 全绿、`test:prompt-baseline` 9/9、红线 3 文件零触碰持续成立。

---

## 5. 已裁决事项（必须遵守，不得重新决策）

- **红线**：`src/endpoints/chats.js`、`src/endpoints/characters.js`、`src/prompt-converters.js` 自 `refactor-base` 以来**零触碰、零 diff**（P4 拆 `public/` 也绝不落进这三文件）。
- **fail-closed 分叉源**（命中即抛错/桩，不静默错）：WI 正则、vectors 强制激活、`WORLDINFO_SCAN_DONE` 监听者、实验宏引擎、未支持 tokenizer provider、`/inject` filter、`leslie-reality` 替换式流水线。
- **设置默认值（方案 A）**：只抬升组装读取的**子集**，服务端「默认值 ← settings.json 覆盖」，浏览器文件零改动，oracle 缺啥补啥。
- **`evaluateMacros`**：数据驱动（见 §2.2.3）。
- **拦截器**：共享编排只留可选 `env.runInterceptors?.()`；**浏览器不传**（防双重执行）；服务端接 memory/reply-style；reality/filter 永不接入。
- **命名/副作用纪律**：注入参数叫 `env`（不叫 `context`）；空选集早退副作用保留；jest 加载是缺失具名导出唯一关口；**openai.js 的下限关卡是浏览器 baseline**。

## 6. 严格执行纪律

- **门槛断言结果，不 grep 信号**：`npm run lint`、`npm run lint --prefix tests`、`npm run test:unit`、`npm run check:repo` 全部 **exit 0**；`test:prompt-baseline` 输出 **`All 9 case(s) are byte-identical`**；`Test Suites: N passed, N total` 且无 `failed`。
- **全绿后才 commit**，每单元一个原子 commit；失守用**独立 commit 修复并如实披露**（不 `--amend` 掩盖）。
- P2.5/P4：每补一块就**跑 oracle 记录首个分歧索引与消息数**。P5：每个功能模块完成就跑「模拟器冒烟 + API 集成用例」。
- 命中 §5 已裁决分叉源按 fail-closed，**无需停下**。

## 7. 唯一停靠条件

出现**本文件与附 L/M/N/O/P 均未覆盖、且有具体证据**的新分叉/新阻塞时，停下并报告证据（lint 清单 / pageerror / oracle 报错 / 模拟器崩溃栈）。否则**一路跑到 Phase 5 结束**。

## 8. 里程碑报告与最终报告

每个 phase 结束时写一份**里程碑报告**（追加到 `docs/roadmap.md`，或独立文件），**不停止**：
- **P2.5 收口报告**：oracle `N/9`、validate 全绿、红线空、导出面守恒、服务端是否已与浏览器逐字一致。
- **Phase 4 报告**：双登录路径可用、PWA 可安装、CSP/CORS 已收紧、模块拆分无回归。
- **Phase 5 报告（最终）**：iOS + Android 各跑通流式聊天 + TTS、SSE 无丢字、API 客户端层可复用、后端 `validate`+baseline 9/9+红线空持续成立、commit 清单、以及“RN App 首版是否已完成”的明确结论。
