# DreamLand 连续开发强制令（Flash 自读，连续执行到 Phase 5 结束）

> 这是给执行 Agent 的**唯一自包含指令**。你只需读本文件即可续跑，无需回翻聊天记录；完整历史裁决见 `docs/refactor-execution-checklist.md`（附 L/M/N/O/P）与 `docs/frontend-backend-separation-plan.md`。
>
> **你的任务**：连续执行「**P2.5 收尾 → Phase 4（Web PWA）→ Phase 5（React Native App）**」，直到 **Phase 5 结束（RN App 首版完成）**。**不逐单元/逐阶段停靠**；在每个 phase 完成时**写里程碑报告但不停止**，继续下一 phase；只在出现本文件 §7 定义的新分叉时才停。

---

## 1. 当前状态（续跑起点）

- HEAD：最新 2.5.3 收敛 commit 见 `git log`（`5cca6c1f3` 及之前 8 个）。
- **oracle 已达 6/9 byte-identical**（solo-normal / continue / quiet / persona-depth / author-note / group-normal）；剩余 `solo-swipe(19)`、`solo-regenerate(23)`、`solo-impersonate(24)` 三例。
- `npm run validate` exit 0（80 suites / 944 tests）；`test:prompt-baseline` 9/9；红线 3 文件累计 diff 空；`openai.js` 43→43、`PromptManager.js` 7→7。

---

## 2. 第一部分：P2.5 收尾（2.5.3 → 2.5.4 → 2.5.5）

### 2.1 已决：剩余 2 例的精确锚定（Lead 裁决，基线已读透）

oracle 已达 **7/9**。两例各差单点，均已从基线 JSON 确证：

- **solo-swipe（关系全零 vs 4/100）**：基线 index 2 关系块为**七维全 `0/100`**，且 swipe 例**没有 events 块**（仅 growth+relationship+reply-style）。证据链已闭环：`calculateRelationship([], state)`=全零（=基线）、`calculateRelationship(mem.events, state)`=4/100（=服务端）、`currentMessageId` 全区间无解。**裁决：这是服务端 memory 事件选择错误——服务端加载了浏览器对 swipe 不会加载的 events**。**批准旁证实验（option a，在 scratch 分支、不写基线）**：临时对 swipe chat 不生成事件、重跑 oracle 确认 19/19 对齐，据此把服务端 memory 事件选择改成与浏览器一致（swipe → 空事件）。**绝不动基线、绝不重录。**
- **solo-regenerate（记忆块位置）**：基线 index 17=记忆块、index 18=`first_mes`（问候）。**确认：记忆块在前、first_mes 在后**。剩余“差一格”是服务端注入索引未计入 regenerate 弹掉的那条 assistant 消息——按此修正索引即可；共享模块的“按类型锚定”通道已就绪，**硬约束：浏览器 9/9 与已提交基线不变**。

**下一步**：先修 regenerate 注入索引（纯服务端），再做 swipe 的旁证实验并修服务端 memory 选择。目标 oracle **9/9**；随后按 §2.2 走完 2.5.4/2.5.5 → Phase 4 → Phase 5 到结束。

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
- **浏览器基线为权威**：剩余三例（swipe/regenerate/impersonate）的 memory 顺序以已提交基线 JSON 为准；独立 dump 弃用（竞态/错误取样）；出现“dump 与基线矛盾”一律信基线。

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
