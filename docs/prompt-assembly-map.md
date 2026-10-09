# 提示词组装盘点（Phase 2.5.1 产出）

> **状态**：仅盘点，**零业务代码改动**。本文档是 Phase 2.5.2–2.5.5 的实施依据。
> **红线**：不改 JSONL/聊天核心格式、不改 SillyTavern 浏览器行为；服务端产出必须与浏览器**逐字等价**。
> **验证方式**：所有 file:line 与标识符均由本机对当前 `refactor/execution` 工作树逐条 `grep`/`read` 核实，并对高影响结论做了抽样复核（含一次两方冲突裁决，见 §5.1 注）。未能核实处标注 `UNKNOWN — 需要决策`，不做推测。

---

## 0. 结论速览

| 结论 | 影响 |
| --- | --- |
| 组装分**两个族**：文本补全族（TC，产出**单个字符串**）与聊天补全族（CC，产出**消息数组**） | 2.5.2 必须抽两个函数族 |
| **CC 族的数组顺序不是调用顺序**，而是 `prompt_order` 的**槽位索引**决定的 | 移植必须复刻 `prompt_order` + 迁移逻辑（§4.2） |
| 组装所需**全部设置已持久化在 `<userRoot>/settings.json`** | 服务端读文件即可，无需重建设置状态 |
| 组装所需**内容数据都在用户目录文件里** | 服务端可用同一份文件等价取得 |
| `GENERATE_BEFORE/AFTER_COMBINE_PROMPTS` 树内 **0 订阅者** | 逐字等价不必复刻树内订阅者（第三方除外） |
| **真正卡住移植的是两处 DOM 读取**：待发文本 `$('#send_textarea').val()`、作者注正文 `$('#extension_floating_prompt').val()` | 必须改成显式入参 |
| 组装读的绝大部分状态是**模块级 `let`** 与**页面级 `extension_prompts` 注册表** | 2.5.2 主要成本是解耦闭包与重建注册表 |
| 两个函数族**都不是纯函数**：CC 族会**原地改写调用方传入的 messages 数组** | 抽取时必须显式复制，否则产生难查的副作用 |
| 三个硬外部输入：**World Info 激活**、**宏引擎 `substituteParams`**、**token 计数** | 三者都要在服务端等价实现，否则预算裁剪/内容不同 |
| 群聊是**建立在单角色组装之上的驱动器**，自身不产出提示词文本 | 移植单角色即覆盖群聊 |
| 会话上下文可由 `/api/v1/chats/{id}` 唯一推导 | 无需搬运 UI 状态 |

---

## 1. 顶层流程与调用图

`Generate` 函数体 `public/script.js:4314–5665`（`:5666` 为 `//MARK: Generate() ends`）。
嵌套 helper：`getMessagesTokenCount` :4909、`setPromptString` :5077、`modifyLastPromptLine` :5090、`checkPromptSize` :5155、`getCombinedPrompt` :5194、`finishGenerating` :5391、`onSuccess` :5524、`onError` :5654。

```text
Generate(type, opts, dryRun)                        public/script.js:4314
  │  分散分支（非 switch）：重置计数 → unshallow 角色 → emit GENERATION_STARTED
  │  → abort 装配 → isInstruct/isImpersonate → 斜杠命令门控(读 DOM)
  │  → kobold/horde 门控 → !dryRun 块 → 群聊分支 → quiet 归一化 → 连接门控
  │  → 待发文本读取/清空(读 DOM) → continue → bias → 插入用户消息
  │  → 取角色卡字段 → 深度提示 → 问候刷新 → coreChat
  │  → runGenerationInterceptors(script.js:4614)   ← 页面侧拦截器阶段
  ├─ 群聊 → generateGroupWrapper(...)             public/scripts/group-chats.js:1051
  │      └─ 逐成员 await Generate(generateType, {automatic_trigger, ...params})   :1198（必要时 :1203）
  ├─ …（正则/推理/预算/CFG/强制名/示例/A·N/WI/Persona/系统提示/故事串/注入/越狱/历史）
  ├─ getCombinedPrompt(false)                     script.js:5194 → finalPrompt
  │      ├─ main_api === 'openai' → return ''          :5202-5204
  │      ├─ CFG + bias 注入                            :5209-5241
  │      ├─ combine()                                  :5244-5266
  │      ├─ emit GENERATE_BEFORE_COMBINE_PROMPTS       :5296
  │      └─ emit GENERATE_AFTER_COMBINE_PROMPTS        :5305
  ├─ 后端分派                                      script.js:5312
  │     kobold/horde → inline / getKoboldGenerationData   kai-settings.js:174
  │     textgenerationwebui → getTextGenGenerationData    textgen-settings.js:1883
  │                            → createTextGenGenerationData  textgen-settings.js:1626
  │     novel        → getNovelGenerationData            nai-settings.js:515
  │     openai       → prepareOpenAIMessages({…})        openai.js:1534（调用点 script.js:5347）
  │                      └─ preparePromptsForChatCompletion  openai.js:1359
  │                          └─ populateChatCompletion       openai.js:1177
  │                              ├─ populationInjectionPrompts  :802
  │                              ├─ populateChatHistory         :877
  │                              └─ populateDialogueExamples    :1093
  ├─ emit GENERATE_AFTER_DATA                      script.js:5380
  ├─ if (dryRun) return Promise.resolve()          script.js:5382   ← dryRun 终点
  └─ 发送：sendOpenAIRequest(openai.js:3062) → createGenerationParameters(:2654)
           → POST /api/backends/chat-completions/generate（openai.js:3072）
           （TC 族经 sendStreamingRequest/sendGenerationRequest script.js:5455/5512）
```

`World Info` 调用点在 `script.js:4689`，**两族共用**。

---

## 2. 入口点清单

| 函数 | 位置 | 输入 | 输出 | 备注 |
| --- | --- | --- | --- | --- |
| `Generate(type, opts, dryRun)` | `script.js:4314` | `type`（normal/continue/regenerate/swipe/impersonate/quiet）、`automatic_trigger`、`quiet_prompt`、`force_chid`、`signal`、`skipWIAN`、`depth`、`promptTest*`、`generationPurpose` | 文本结果；副作用：写 `chat`、`chat_metadata.tainted`、发事件 | 巨型闭包 |
| `getCombinedPrompt(isNegative)` | `script.js:5194` | 闭包内 `mesSend`、`combinedStoryString`、`mesExmString`、`generatedPromptCache`、CFG/bias | TC 族**字符串** | OAI 时返回 `''` |
| `combine()` | `script.js:5244` | 同上 | `[combinedStoryString, mesExmString, mesSendString, generatedPromptCache].join('')` → 去 `\r` → 可选 `collapseNewlines` | 逐字等价硬约束 |
| `getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData)` | `world-info.js:892` | 聊天数组（**倒序**）、上下文长度、dryRun、`globalScanData` | `{worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoExamples, worldInfoDepth, anBefore, anAfter, outletEntries}` | 两族共用；`anBefore/anAfter` 在 `world-info.js` 外**无消费者** |
| `checkWorldInfo(chat, maxContext, isDryRun, globalScanData)` | `world-info.js:4597` | 同上 | 含 `allActivatedEntries`（仅此函数返回） | 激活算法主体 |
| `prepareOpenAIMessages({…}, dryRun)` | `openai.js:1534` | 见 §4.1（**无默认值**） | `[chat, counts]`；`chat=chatCompletion.getChat()`，`counts` 为 identifier→tokens | **非纯**：原地改写入参 `messages` |
| `preparePromptsForChatCompletion(prompts, …)` | `openai.js:1359` | 注册表与内容参数 | 填充 `prompts.collection` | 构造 12 内置 + 9 派生 + 未知扩展键 |
| `populateChatCompletion(prompts, chatCompletion, {…})` | `openai.js:1177` | 注册表、容器、`bias/quietPrompt/type/messages/messageExamples` | 有序 `messages` | CC 族真正组装点 |
| `populationInjectionPrompts(messages, prompts, type)` | `openai.js:802` | 输入数组 | **原地**按 depth splice 注入 | 循环 0..10000 × 3 角色 |
| `populateChatHistory(...)` / `populateDialogueExamples(...)` | `openai.js:877` / `:1093` | 历史 / `mes_example` | 追加 | |
| `PromptManager` | `PromptManager.js:300` | 注册表 + `prompt_order` | `getPromptCollection()` → 有序集合 | `render()`(862) 纯 UI |
| `TokenHandler` | `openai.js:3347` | 消息 → token | `counts` | 预算裁剪依据 |
| `generateGroupWrapper(byAutoMode, type, params)` | `group-chats.js:1051` | 群组、成员、params | 逐成员生成 | 内部 `Generate` :1198/:1203 |
| `getGroupDepthPrompts(groupId, characterId)` | `group-chats.js:522` | 群组+成员 | 成员深度提示 | 调用点 `script.js:4512` |
| `getGroupCharacterCardsLazy(groupId, chid)` | `group-chats.js:593` | 群组 | 合并成员卡字段 | 由 `script.js:3393` 调用 |

---

## 3. 文本补全族（TC）组装

`combine()`（`script.js:5244-5266`）：

```js
1. mesSendString = finalMesSend.map(e => `${e.extensionPrompts.join('')}${e.message}`).join('');  // :5246
2. mesSendString = addChatsSeparator(mesSendString);                                              // :5249
3. mesSendString = addChatsPreamble(mesSendString);                                               // :5252
4. combinedPrompt = [combinedStoryString, mesExmString, mesSendString, generatedPromptCache]
                     .join('').replace(/\r/gm, '');                                               // :5254-5259
5. power_user.collapse_newlines ? collapseNewlines(combinedPrompt) : 原样                        // :5261-5263
```

随后：CFG prompt（depth=0 追加末条，按末字符空白决定空格 `:5212-5216`；否则写入该 depth 的 `extensionPrompts` `:5217-5228`）、prompt bias（仅非 instruct/impersonate `:5234-5241`）、两个 combine 事件（`:5296`/`:5305`）。

`getWorldInfoPrompt` 入参 `globalScanData`（`script.js:4680-4687`）：`personaDescription`、`characterDescription`、`characterPersonality`、`characterDepthPrompt`、`scenario`、`creatorNotes`、`trigger`。
WI 的扫描输入：`script.js:4679`
```js
const chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse();
```

### 3.1 TC 族注入顺序（含 CC 族共用前置步骤）

| # | 块 | file:line | 写入目标 |
| --- | --- | --- | --- |
| 1 | `chat[0].mes` 问候宏替换 | `script.js:4528` | `chat`（写） |
| 2 | 角色/群成员深度提示 | `4511-4524` | `extension_prompts[DEPTH_PROMPT\|DEPTH_PROMPT_n]`，`IN_CHAT` |
| 3 | 插入用户消息 | `4486-4496` | `chat`；`noAttachTypes=['regenerate','swipe','impersonate','quiet','continue']`（`:4478-4484`） |
| 4 | `mesExamplesArray = parseMesExamples(...)` | `4670` | 示例块 |
| 5 | **作者注** `setFloatingPrompt` | `4673` / `authors-note.js:324-391` | `extension_prompts['2_floating_prompt']` |
| 6 | 临时 quiet prompt（供 WI 扫描） | `4677`，`:4698` 清空 | `['QUIET_PROMPT']`，`IN_PROMPT` |
| 7 | **World Info** | `4689`（调用） | A：`{{wiBefore}}`/`{{wiAfter}}` `:4773-4776`、深度 `:4730-4735`、outlets `:4736-4740`；B：参数传入 |
| 8 | WI 示例消息 | `4700-4717` | `mesExamplesArray` |
| 9 | `mesExamplesRawArray` 快照 | `4720` | 故事串参数 |
| 10 | instruct 格式示例 | `4722-4724` | `mesExamplesArray` |
| 11 | 深度 WI + outlets | `4729-4740` | `[CUSTOM_WI_DEPTH_ROLE]`(`IN_CHAT`)、`[CUSTOM_WI_OUTLET]`(`NONE`)；`skipWIAN` 跳过 `:4726` |
| 12 | **Persona 描述** | `4746` → `:3188-3210` | `['PERSONA_DESCRIPTION']` 或并入 `['2_floating_prompt']` |
| 13 | 系统提示（非 OAI） | `4748-4759` | 局部 `system` → `{{system}}` |
| 14 | **故事串** | `4762-4785` | `anchorBefore=getExtensionPrompt(BEFORE_PROMPT)` `:4762`、`anchorAfter=getExtensionPrompt(IN_PROMPT)` `:4763`、`renderStoryString` `:4784` |
| 15 | 故事串 as in-chat | `4788-4797` | `['__STORY_STRING__']`（`IN_CHAT`），原串置空 |
| 16 | 去示例 | `4800-4802` | `mesExamplesArray=[]` |
| 17 | **全部 in-chat 扩展提示落地** | `4806-4808` → `doChatInject` `:5692`（调用 `:5711`） | splice 进 `coreChat` |
| 18 | **越狱 / post-history** | `4810-4827` | `coreChat.push`；`continue` 时 `splice(len-1,0,…)` |
| 19 | 历史串 `chat2` | `4834-4878` | `formatMessageHistoryItem` `:4844` |
| 20 | 循环提示（continue） | `4928-4933` | `chat2.shift()` |
| 21-22 | 预留注入位 + 填充 | `4942-4989` | `chatString`、`arrMes` |
| 23 | 用户对齐消息 | `4880-4890`、`4991-4998` | 前置 |
| 24 | `mesSend` 生成 | `5051-5072` | `{message, extensionPrompts}[]` |
| 25 | `modifyLastPromptLine` | `5090-5153` | quiet `:5094-5109`、instruct 行 `:5125-5129`、impersonate 行 `:5132-5138`、强制 `${name2}:` `:5143-5150` |
| 26 | `setPromptString` | `5077-5088` | `mesExmString` |
| 27 | `checkPromptSize` | `5155-5181` | 先裁 `count_exm_add`，再 `mesSend.shift()` |
| 28 | `addChatsPreamble`/`addChatsSeparator` | `6131-6143` | `nai_settings.preamble` / `power_user.context.chat_start` |
| 29 | `combine()` | `5244-5266` | 最终串 |
| 30 | CFG prompt + bias | `5209-5241` | 末条 `mesSend` |

`depth` 参数唯一作用（`:4296` 注释）：抑制斜杠命令门控、抑制插入用户消息与 UI 块、经 `ToolManager.RECURSE_LIMIT` 限制工具递归（`:4533`）；工具结果以 `Generate('normal', {… depth}, dryRun)` 重入（`:5497`、`:5622`）。

### 3.2 `generatedPromptCache` 说明

`generatedPromptCache` 是 `Generate()` 内的**局部变量**（`script.js:5051-5052`），仅 TC 族使用（`:5183-5187`、`:5419`）。
**纠正**：本仓库**不存在** `prepareOpenAIPromptCache` 函数（对 `public/` 全量 grep 无命中）。若上游有此函数，则未包含在本 fork 中 → `UNKNOWN — 需要决策`。

---

## 4. 聊天补全族（CC）组装

### 4.1 `prepareOpenAIMessages` 参数与纯度

签名 `openai.js:1534-1551`：对象解构**无默认值**；`dryRun` 是唯一位置参数。

| 参数 | 去向 |
| --- | --- |
| `charDescription` / `charPersonality` / `scenario` | `systemPrompts` → identifier `charDescription`/`charPersonality`/`scenario`（`:1370-1372`；personality/scenario 先经 `oai_settings.personality_format`/`scenario_format` `:1360-1361`） |
| `worldInfoBefore` / `worldInfoAfter` | `formatWorldInfo()`（`:781`）→ identifier 同名（`:1368-1369`） |
| `bias` | identifier `bias`，**role `assistant`**（`:1377`）；仅在 `bias.trim().length` 时加入（`:1255`） |
| `type` | 驱动 `getPromptCollection(type)` `:1462`、`noGroupNudgeTypes` `:891`、`continue` `:899/:1312`、`impersonate` `:1217`、`getGenerationTokenBudget` `:1565` |
| `quietPrompt` | identifier `quietPrompt`（`:1375`）→ `controlPrompts`（`:1221-1228`） |
| `quietImage` | 若 `isImageInliningSupported()` 则内联（`:1223-1225`） |
| `extensionPrompts` | 全局 `extension_prompts`：`1_memory`/`2_floating_prompt`/`3_vectors`/`4_vectors_data_bank`/`chromadb` + 未知键（`:1381-1458`），并按 depth 再次经 `getExtensionPrompt` 读取（`:848`） |
| `cyclePrompt` | 仅 `type==='continue' && !oai_settings.continue_prefill`（`:899-919`） |
| `systemPromptOverride` / `jailbreakPromptOverride` | 覆盖 `main`/`jailbreak` 内容，除非 `forbid_overrides===true` 或该提示被禁用（`:1488-1505`） |
| `messages` | 聊天历史数组（已含 role/content/name） |
| `messageExamples` | `populateDialogueExamples`（`:1093`） |
| `dryRun` | 早退 `if (!promptManager.activeCharacter && dryRun) return [null, false];`（`:1553`）；并门控 `squashSystemMessages` 与 `promptManager.render`（`:1608`、`:1613`） |

返回 `:1623` `return [chat, promptManager.tokenHandler.counts];`
- `chat = chatCompletion.getChat()`（`:1616`）→ 扁平 `{role, content, name?, tool_calls?, tool_call_id?, signature?, reasoning?}`（`:4047-4068`），**空 content 消息被丢弃**；
- `counts` 是**活的** counts 对象（`identifier → tokens`，仅顶层集合，`PromptManager.js:1583-1587`），**不是聚合值**（`script.js:5368` 的注释"counts will return false"已过时）；
- 异常（`TokenBudgetExceededError`/`InvalidCharacterNameError` 等）被 catch 吞掉（`:1588-1603`），仍返回**部分** chat。

**纯度：非纯**（2.5.2 必须注意）：
- **原地改写调用方的 `messages` 数组**：`messages.shift()`（`:1312-1313`，continue+continue_prefill 时）；`populationInjectionPrompts` 内 `messages.splice(...)` 与 `messages = messages.reverse()`（`:860`、`:865`，`reverse` 直接作用于调用方数组）。
- 模块级 `openai_messages_count`（`:1621`）。
- `promptManager.error`/`messages`/`tokenUsage`/`overriddenPrompts`/token counts（`PromptManager.js:1569-1592`）。
- DOM：`promptManager.render(false)`（`:1613`，fire-and-forget）。
- `oai_settings` **不被改写**（提示对象经 `new Prompt(prompt)` 复制，`PromptManager.js:1279`）。

### 4.2 数组顺序 = `prompt_order` 槽位索引（**关键纠正**）

**最终扁平数组的顺序不是 `addToChatCompletion(...)` 的书写顺序**，而是由
`ChatCompletion.add(collection, prompts.index(identifier))`（`openai.js:1199`、`:3925-3933`）按**槽位索引**安放；索引为 `-1`/`null` 者 `push` 到尾部；`controlPrompts` 最后 `push`（`:1338`）。

默认槽位（`promptManagerDefaultPromptOrder`，`PromptManager.js:2087-2136`）：

| slot | block | 构造处 | role |
| --- | --- | --- | --- |
| 0 | `main` | `:1205` ← `:1366-1485` | system（role 来自 order entry `:1477`） |
| 1 | `worldInfoBefore` | `:1204` / `:1368` | system |
| 2 | `personaDescription` | `:1210` / `:1425-1426` | system |
| 3 | `charDescription` | `:1207` | system |
| 4 | `charPersonality` | `:1208` | system |
| 5 | `scenario` | `:1209` | system |
| 6 | `enhanceDefinitions` | `:1252` | system |
| 7 | `nsfw`（Auxiliary Prompt） | `systemPrompts=['nsfw','jailbreak']` 循环 `:1247` | system |
| 8 | `worldInfoAfter` | `:1206` | system |
| 9 | `dialogueExamples` | `:1093-1126` | system（`:1107`） |
| 10 | `chatHistory` | `:877-1084` | 输入消息的 user/assistant；`newChatMessage` system 插最前（`:1071`） |
| 11 | `jailbreak` = Post-History Instructions | `:1247`；内容 `:104`/`:1028` | system |
| 12+ | 不在 `prompt_order` 的用户/扩展提示 | 追加到 `prompts.collection`（`:1484`） | `getPromptRole` `:1149-1160`（默认 system） |
| — | `bias` | `:1255`；role `:1377` | **assistant** |
| — | `continueNudge` | `:899-919`，`add(…, -1)` `:1082` → push | system（`:903`）+ 被顶替的末条消息 |
| last | `controlPrompts` | `:1214-1230`，push `:1338` | `impersonate`(`:1216`)、`quietPrompt`(`:1221`)、`continuePrefill`(`:1319`) |

子顺序：
- `main` 相对插入：`injectToMain()`（`:1257-1276`）对 `knownPrompts=['summary','authorsNote','vectorsMemory','vectorsDataBank','smartContext']`（`:1278-1294`）及带 `position` 的扩展提示（`:1297-1299`）执行 `insert(message,'main','start'|'end')`。
- `chatHistory`：`chatPool=[...messages].reverse()`（`:940`）+ `insertAtStart`（`:1063`）⇒ 最终时序为正序；`newChatMessage` 最先（`:1071`）；`groupNudge` 最后（`:1076`）；工具调用与 `tool` 结果成对插最前（`:1043-1050`）。
- `dialogueExamples`：每段示例前插 `oai_settings.new_example_chat_prompt`（`:1100`、`:1120-1123`）。
- `populationInjectionPrompts`（`:802-867`）：按 `depth` 从末尾起算 splice（`injectIdx = i + totalInsertedMessages`，`:859`），角色分组 `system→user→assistant`（`:839`），`injection_order` 降序（`:834`），取值 `getExtensionPrompt(IN_CHAT, i, …)`（`:848`）。
- `power_user.pin_examples` 切换"示例 vs 历史"的调用先后（`:1329-1335`）。
- `squashSystemMessages()`（`:1609`，仅 `oai_settings.squash_system_messages && dryRun === false`）原地合并连续无名 `system` 消息，排除 `newMainChat`/`newChat`/`groupNudge`（`:3850`）。

> **性能与正确性提醒**：`populationInjectionPrompts` 循环 `i = 0 .. getExtensionPromptMaxDepth()`，而后者返回 `MAX_INJECTION_DEPTH = 10000`（`script.js:527`、`:3266-3267`），每个 depth 调 3 次 `getExtensionPrompt` ⇒ **每次组装约 30003 次调用**。服务端应改为**稀疏 depth 集合**实现等价语义。

> **迁移逻辑必须复刻**：`sanitizeServiceSettings`（`PromptManager.js:1010-1014`）、`checkForMissingPrompts`（`:1043-1057`）、`registerPromptManagerMigration`（`:45-75`）。若 `prompt_order` 为空，页面会写入 `promptManagerDefaultPromptOrder`（`character_id=100001`）；服务端不复刻则**同一份 settings.json 会产出不同数组**。

### 4.3 提示词注册表

- 内置集合 `chatCompletionDefaultPrompts`（`PromptManager.js:2001-2081`）：`main`、`nsfw`、`dialogueExamples`(marker)、`jailbreak`、`chatHistory`(marker)、`worldInfoAfter`(marker)、`worldInfoBefore`(marker)、`enhanceDefinitions`、`charDescription`、`charPersonality`、`scenario`、`personaDescription`。
- 每次调用构造（`:1366-1458`）：上述 12 项 + `impersonate`、`quietPrompt`、`groupNudge`、`bias`、`summary`、`authorsNote`、`vectorsMemory`、`vectorsDataBank`、`smartContext`，以及未知扩展键经 `key.replace(/\W/g,'_')` 规范化（`:1452`）。
- 另有 `oai_settings.prompts` 中的用户自定义提示。
- 影响结果的 order-entry 字段：`enabled`（`:1523`、`PromptManager.js:949-951`、`openai.js:1183`）、列表位置（槽位索引）、`injection_position`（`ABSOLUTE=1` ⇒ 转为 in-chat，不进入根数组，`:1190-1193`/`:1240-1245`）、`injection_depth`/`injection_order`/`role`（`:1471-1477`，被 `populationInjectionPrompts` 消费）、`forbid_overrides`（`:1490`/`:1500`）、`injection_trigger`（`shouldTrigger`，`:1549-1553`）。
- 顺序施加函数：**`PromptManager.getPromptCollection(generationType)`**（`PromptManager.js:1516-1541`），遍历 `getPromptOrderForCharacter(this.activeCharacter)`（`:1207-1209`）。

### 4.4 发送与请求体

- 组装结果由 `Generate()` 存为 `generate_data.prompt`（`script.js:5365`），随后 `sendOpenAIRequest(type, data.prompt, …)`（`script.js:6236`/`:6272`）。
- POST 目标：`/api/backends/chat-completions/generate`（`openai.js:3072`；服务端路由 `src/endpoints/backends/chat-completions.js:2650`）。
- 请求体由 `createGenerationParameters(settings, model, type, messages, {jsonSchema})`（`openai.js:2654-3051`）构造。
  基础键（`:2760-2785`）：`type`、**`messages`**（唯一承载组装结果的键；仅按 `msg && typeof msg==='object'` 过滤，`:2659`）、`model`、`temperature`、`frequency_penalty`、`presence_penalty`、`top_p`、`max_tokens`、`stream`、`logit_bias`、`stop`、`chat_completion_source`、`n`、`user_name`、`char_name`、`group_names`、`include_reasoning`、`reasoning_effort`、`enable_web_search`、`request_images`、`request_image_resolution`、`request_image_aspect_ratio`、`custom_prompt_post_processing`、`verbosity`。
  条件键：`azure_*`、`tools`/`tool_choice`、`reverse_proxy`/`proxy_password`、`logprobs`、Claude（`top_k`/`use_sysprompt`/`assistant_prefill`）、OpenRouter（`min_p`/`repetition_penalty`/`top_a`/`use_fallback`/`provider`/`quantizations`/`allow_fallbacks`/`middleout`）、`nanogpt_*`、Vertex（`vertexai_*`）、`safe_prompt`、Custom（`custom_url`/`custom_include_body`/`custom_exclude_body`/`custom_include_headers`）、`seed`、`zai_endpoint`/`siliconflow_endpoint`/`minimax_endpoint`/`workers_ai_account_id`/`json_schema`，以及对 o1/o3/o4/gpt-5/Kimi 用 `max_completion_tokens` 替代 `max_tokens`（`:2999-3044`）。
- `messages` 唯一后处理：`^(openai/)?o1` 时把 `role==='system'` **原地**改写为 `'user'`（`:3011-3020`）。
- 服务端按 source 转换：`convertClaudeMessages`/`convertGooglePrompt`/`convertAI21Messages`，配套 `getPromptNames(request) = {charName: body.char_name, userName: body.user_name, groupNames: body.group_names}`（`src/prompt-converters.js:49-58`——**红线文件**）。
- 密钥在服务端解析（`readSecret(request.user.directories, …)`，`chat-completions.js:215`/`:443`）；浏览器仅携带 `reverse_proxy`/`proxy_password`。

---

## 5. World Info

### 5.1 返回值与消费者

`getWorldInfoPrompt`（`world-info.js:892`）内部 `:895` 调 `checkWorldInfo`，`:897` 令 `worldInfoString = worldInfoBefore + worldInfoAfter`，`:902` 发 `WORLD_INFO_ACTIVATED`，返回 `:908-916`：

```js
return {
    worldInfoString,
    worldInfoBefore,
    worldInfoAfter,
    worldInfoExamples: activatedWorldInfo.EMEntries ?? [],
    worldInfoDepth: activatedWorldInfo.WIDepthEntries ?? [],
    anBefore: activatedWorldInfo.ANBeforeEntries ?? [],
    anAfter: activatedWorldInfo.ANAfterEntries ?? [],
    outletEntries: activatedWorldInfo.outletEntries ?? {},
};
```

- `checkWorldInfo` 额外返回 `allActivatedEntries`（`:5162`），用于事件载荷；`getWorldInfoPrompt` **不返回**它。
- `anBefore`/`anAfter` 在 `world-info.js` 之外**无消费者**（`public/`+`src/` 全量 grep 仅命中 typedef 与生产处）；AN 条目实际通过 `:5149-5152` **改写作者注扩展提示**生效。
- 调用方 `script.js:4689` 只解构 `worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoExamples, worldInfoDepth, outletEntries`（丢弃 `anBefore`/`anAfter`）。

> **注（两方冲突裁决）**：`worldInfoCache` **确实存在** —— `world-info.js:882` `export const worldInfoCache = new StructuredCloneMap({ cloneOnGet: true, cloneOnSet: false });`（用于 `:1577-1578`、`:2031`、填充于 `:2053`）。它只是**纯读缓存**，服务端可自行按请求读文件或自建缓存。

### 5.2 激活流水线（步骤 → 行）

| 步骤 | 位置 |
| --- | --- |
| 扫描型扩展提示并入 buffer | `4607-4612`（`context.extensionPrompts[key]?.scan` → `getExtensionPromptByName`） |
| 预算 | `4624` `Math.round(world_info_budget * maxContext / 100) \|\| 1`；上限 `4626-4629` |
| 条目收集/排序 | `4632` → `getSortedEntries()` `4478` |
| 时间效果（sticky/cooldown/delay） | `4633` `WorldInfoTimedEffects`（类 `479`）、`4635` |
| 延迟递归层级 | `4642-4649` |
| 递归步数上限 | `4656` |
| 逐条过滤 | `4667` |
| 概率失败/已激活跳过 | `4671` |
| `disable` | `4675` |
| `triggers` vs `globalScanData.trigger` | `4691-4698` |
| `characterFilter.names` | `4700-4710` |
| `characterFilter.tags`（`getTagKeyForEntity`、`context.tagMap`） | `4712-4726` |
| sticky/cooldown/delay 抑制 | `4731-4745` |
| `delayUntilRecursion` | `4747-4757` |
| `excludeRecursion` | `4759-4762` |
| `@@activate`/`@@dont_activate` | `4764-4772`（`parseDecorators` `4540`、`KNOWN_DECORATORS` `100`） |
| 外部激活 | `4774-4779`；`getExternallyActivated` `410-417`；监听 `1020-1028` |
| `constant` | `4781-4785` |
| 空 `key` | `4791-4794` |
| 待扫描文本 | `4799` `buffer.get(entry, scanState)` → `269-320` |
| 主键匹配 | `4801-4808` |
| 次级/选择键 | `4810-4864`；`world_info_logic={AND_ANY:0,NOT_ALL:1,NOT_ANY:2,AND_ALL:3}` `33-38` |
| `matchKeys`（正则/大小写/整词） | `322-361`；`#transformString` `264-267`；`entry.matchWholeWords ?? world_info_match_whole_words` `347` |
| 新条目排序 | `4882-4888` |
| 包含组 | `4893` `filterByInclusionGroups`(`5269`)、`filterGroupsByScoring`(`5173`)、`filterGroupsByTimedEffects`(`5218`) |
| 概率 | `4909-4935` `Math.random()*100 <= entry.probability` |
| 内容宏替换 | `4938` |
| 预算裁剪 | `4942-4954`（`ignoreBudget` 例外；溢出 toastr `4947`） |
| 递归触发 | `4978-4982` |
| 最小激活数 | `4991-5005`（含 `world_info_min_activations_depth_max`） |
| 下一延迟递归层 | `5010-5014` |
| 递归 buffer 追加 | `5019-5023` |
| 扩展钩子 | `5056` `WORLDINFO_SCAN_DONE`，`5066-5074` 可改写 args |
| 构建：排序 | `5069`，`sortFn=(a,b)=>b.order-a.order`（`88`） |
| 内容正则 | `5071` `getRegexedString(..., regex_placement.WORLD_INFO, …)` |
| 位置分派 | `5075-5140`；`world_info_position` `855-863`（`before` `5083`、`after` `5086`、`EMTop` `5089`、`EMBottom` `5094`、`ANTop` `5099`、`ANBottom` `5102`、`atDepth` `5105-5120`，`DEFAULT_DEPTH=4` `96`、默认 role `SYSTEM`；`outlet` `5125-5135`） |
| 合并 | `5145-5146` |
| **AN 劫持** | `5149-5152`（`shouldWIAddPrompt` 时改写 `extensionPrompts[NOTE_MODULE_NAME]`） |
| 时间效果持久化 | `5155-5157` → `chat_metadata.timedWorldInfo`（`:560-567`） |

事件：`WORLD_INFO_ACTIVATED` `:902`、`WORLDINFO_ENTRIES_LOADED` `:4492`、`WORLDINFO_SCAN_DONE` `:5056`、`WORLDINFO_FORCE_ACTIVATE` 监听 `:1020`。

### 5.3 数据来源

| 项 | 证据 |
| --- | --- |
| 书目文件 | `loadWorldInfo` `2036-2058` → `fetch('/api/worldinfo/get', …)` `2045`；服务端 `src/endpoints/worldinfo.js:27` `path.join(directories.worlds, filename)` |
| 缓存 | `worldInfoCache` `882`，填充 `2053` |
| 全局选择 | `getGlobalLore` `4415-4430`，源自 `selected_world_info`（`:66`，来自 `settings.world_info.globalSelect` `:998`） |
| 角色 lore | `getCharacterLore` `4363-4410`：**`character?.data?.extensions?.world`** `4368`；附加 `world_info.charLore` `4375` |
| 聊天 lore | `getChatLore` `4432-4451`：`chat_metadata['world_info']`（`METADATA_KEY` `:94`） |
| Persona lore | `getPersonaLore` `4452-4475`：`power_user.persona_description_lorebook` |
| 排序策略 | `getSortedEntries` `4478-4523`；`world_info_character_strategy` `4487-4502`；`world_info_insertion_strategy={evenly:0,character_first:1,global_first:2}` `27-31` |
| 设置默认 | `69-82`（`world_info_depth=2`、`min_activations=0`、`budget=25`、`include_names=true`、`recursive=false`、`overflow_alert=false`、`case_sensitive=false`、`match_whole_words=false`、`use_group_scoring=false`、`character_strategy=character_first`、`budget_cap=0`、`max_recursion_steps=0`） |
| 设置读写 | `setWorldInfoSettings` `917-950`（调用 `script.js:8210`）；`getWorldInfoSettings` `795-812`（保存 `script.js:8277`） |
| `character_book` | **不参与扫描**；仅导入路径 `checkEmbeddedWorld` `5579`、`importEmbeddedWorldInfo` `5625-5640`（`convertCharacterBook` `5498`） |
| `maxContext` | `script.js:6087-6105` |

---

## 6. Persona

| 项 | 证据 |
| --- | --- |
| 编排函数 | `addPersonaDescriptionExtensionPrompt()` `script.js:3188`，调用点 `4744` |
| 早退 | `3192`（`persona_description` 为空或 position 为 `NONE`） |
| 先清空 | `3190` `setExtensionPrompt('PERSONA_DESCRIPTION', '', IN_PROMPT, 0)`（`INJECT_TAG='PERSONA_DESCRIPTION'` `:3189`） |
| `TOP_AN`/`BOTTOM_AN` | `3196-3204`：与作者注拼接后**写回 `NOTE_MODULE_NAME`** |
| `AT_DEPTH` | `3207-3209`：`setExtensionPrompt(INJECT_TAG, …, IN_CHAT, persona_description_depth, true, persona_description_role)` |
| `IN_PROMPT`（TC） | `script.js:4768`（`persona` 取自 `3397` `baseChatReplace(power_user.persona_description?.trim())`） |
| `IN_PROMPT`（CC） | `openai.js:1424-1427` 推入 `{role:'system', content: persona_description, identifier:'personaDescription'}`；槽位 `:1210`；跳过名单含 `'PERSONA_DESCRIPTION'`（`:1429-1438`） |

字段（`power-user.js:290-294` 默认值；`personas.js:910-914` 由活动 persona 写入）：
`power_user.persona_description`、`.persona_description_position`、`.persona_description_role`、`.persona_description_depth`、`.persona_description_lorebook`、`power_user.personas[avatarId]`、`power_user.persona_descriptions[avatarId] = {description,title,position,depth,role,lorebook,connections}`。
枚举 `persona_description_positions`（`personas.js:88-98`）：`{IN_PROMPT:0, AFTER_CHAR:1(已废弃), TOP_AN:2, BOTTOM_AN:3, AT_DEPTH:4, NONE:9}`；默认 `DEFAULT_DEPTH=2`、`DEFAULT_ROLE=0`（`:104-105`）。
组合方式：**无语义模板**，直接注入原始字符串（宏替换仅在故事串路径发生）。

`name1` 来源：`script.js:434` 声明，`:8071` 设置，`:8128` 从 `settings.username` 载入；persona 名由 `personas.js:900-902` 推入。
→ 这解答了此前的 `UNKNOWN`：**`name1` = `settings.username` 与 `power_user.personas[user_avatar]` 的组合**，两者都在 settings.json。

**Leslie 身份模块不注入提示词**：`src/leslie-identity/store.js:69-72` 仅维护 `<root>/leslie/identity/{registry.json,history}`；`src/leslie-identity/router.js:28-49` 仅 `GET /`、`POST /story-scope`、`POST /entities/resolve`（挂载 `src/server-startup.js:173`）；无对应 `public/scripts/leslie-*identity*` 文件。persona 名仅作为**文案**出现在记忆提示中（`leslie-memory/index.js:193` → `1499`/`1520`/`1535`）。

---

## 7. 扩展提示与 Leslie 模块

### 7.1 注册机制

- API：`setExtensionPrompt(key, value, position, depth, scan=false, role=SYSTEM, filter=null)`（`script.js:9122`；存储结构 `:9123-9130`）。
- 注册表：模块级 `export let extension_prompts = {}`（`script.js:653`；聊天清空时 `:1628` 重置）。**从不持久化**。
- 枚举：`extension_prompt_types={NONE:-1,IN_PROMPT:0,IN_CHAT:1,BEFORE_PROMPT:2}`（`:511-516`）、`extension_prompt_roles={SYSTEM:0,USER:1,ASSISTANT:2}`（`:521-525`）、`MAX_INJECTION_DEPTH=10000`（`:527`）。
- 排序：同 position/depth 内按**键名字典序**（`Object.keys(extension_prompts).sort()`，`:3295`）。
- **页面侧拦截器阶段**：`manifest.json` 的 `generate_interceptor` → `runGenerationInterceptors`（`extensions.js:2016-2040`，调用 `globalThis[interceptorKey](chat, contextSize, abort, type, generationContext)` `:2030`），由 `script.js:4614` 在 `Generate()` 内触发。声明：`leslie-memory/manifest.json:6`、`leslie-reply-style/manifest.json:6`、`leslie-reality/manifest.json:6`；赋值：`leslie-memory/index.js:1717`、`leslie-reply-style/index.js:64`、`leslie-reality/index.js:439`。

### 7.2 注册者一览

| 模块 | key | position | depth | 文本构造 |
| --- | --- | --- | --- | --- |
| `leslie-memory/index.js:1660` | `leslie_memory_growth` | IN_PROMPT | 0 | `formatGrowthPrompt` `1499-1517` |
| `leslie-memory/index.js:1661` | `leslie_memory_events` | IN_CHAT | `PROMPT_DEPTH=4` | `formatEventsPrompt` `1520-1533` |
| `leslie-memory/index.js:1662` | `leslie_memory_cross_line` | IN_CHAT | 5 | `formatCrossLinePrompt` `1569-1577` |
| `leslie-memory/index.js:1623` | `leslie_memory_relationship` | IN_PROMPT | 0 | `formatRelationshipPrompt` `1535-1545` |
| `leslie-memory/index.js:1605` | `leslie_reality_time` | IN_PROMPT | 0 | `buildRealityTimePrompt`（`leslie-reality-context.js:152-174`） |
| `leslie-reply-style/index.js:57` | `leslie_reply_style` | IN_PROMPT | 0 | `buildLeslieReplyStylePrompt`（`leslie-reply-style.js:82-86`） |
| `extensions/memory/index.js:965` | `1_memory` | `extension_settings.memory.position` | 同左 | 上游记忆扩展 |
| `extensions/vectors/index.js:696/784/854` | `3_vectors`/`4_vectors_data_bank` | settings 指定 | 同左 | 需 embedding 服务 |
| `authors-note.js:352/383` | `2_floating_prompt` | `chat_metadata.note_*` | 同左 | 作者注 |
| `world-info.js:5152` | `NOTE_MODULE_NAME` | 同上 | 同上 | WI→AN 劫持 |
| `slash-commands.js:3824` | `/inject:<id>` | 运行期 | 运行期 | **唯一带 `filter` 的注册者** |

`leslie-memory` 门控（`1592-1601`）：非 quiet 时运行；quiet 仅在 purpose 为 `leslie-story-choices`/`leslie-plot-compass` 时运行。清空：`clearPromptInjection` `422-428`。

### 7.3 不注入提示词的 Leslie 模块

| 模块 | 行为 |
| --- | --- |
| `leslie-moments` | **刻意不注入**：`leslie-moments/memory-context.js:6-8` 原文注释说明"Moment memory remains parallel … until explicitly enabled"；构造器 `buildMomentsPromptContext` `13-30` 仅供未来使用 |
| `leslie-story-choices` | 不 `setExtensionPrompt`；自行 `generateQuietPrompt({quietPrompt: buildStoryChoicePrompt(...), generationPurpose: 'leslie-story-choices'})` `308-320` |
| `leslie-plot-compass` | 同上，purpose `leslie-plot-compass` `560-572` |
| `leslie-reality` | 不注入；拦截器 `abort(true)` 后自行生成整条消息 `374-434` —— 属**替换式流水线** |

### 7.4 消费点（组装期间）

| 通道 | 消费者 | 行 |
| --- | --- | --- |
| TC，`IN_CHAT` | `doChatInject` → `getExtensionPrompt(IN_CHAT, i, separator, role, wrap)` | `script.js:5692-5739`，调用 `5711` |
| TC，`IN_PROMPT`/`BEFORE_PROMPT` | `getExtensionPrompt(BEFORE_PROMPT/IN_PROMPT)` → `storyStringParams.anchorBefore/anchorAfter` | `script.js:4762-4763`、`4776-4777` |
| CC，`IN_CHAT` | `populationInjectionPrompts` → `getExtensionPrompt(IN_CHAT, …)` | `openai.js:802-865`，调用 `848` |
| CC，`IN_PROMPT`/`BEFORE_PROMPT` | `preparePromptsForChatCompletion` 的"非已知扩展提示"循环 | `openai.js:1359`，循环 `1440-1465` |
| 查找 helper | `getExtensionPromptByName` | `script.js:3242-3258` |
| WI 扫描输入 | `checkWorldInfo` 读 `context.extensionPrompts[key]?.scan` | `world-info.js:4607-4612` |

即：**两个文件都在消费** —— `script.js` 拥有 WI 调用、persona、拦截器、TC 消费；`openai.js` 拥有 CC 消费。

---

## 8. 群聊

- 判定 `selected_group && !is_group_generating`（`script.js:4388`）→ `generateGroupWrapper`（`group-chats.js:1051`，模块私有，`script.js:78` 引入）。
- **驱动器**：成员集合/顺序（`activation_strategy`、`disabled_members`、`allow_self_responses`、`leslie_group_orchestrator`、`character.talkativeness`，`:1110-1161`）→ 逐成员 `Generate(generateType, {automatic_trigger, ...params})`（`:1198`，`generateType = ['swipe','impersonate','quiet','continue'].includes(type) ? type : 'normal'` `:1197`），必要时 `Generate('continue', …)`（`:1203`）。
- **自身不产出提示词文本**；群相关文本的间接路径：
  - 合并成员卡 → `getGroupCharacterCardsLazy`（`group-chats.js:593`，由 `script.js:3393` 调用）覆盖 `description/personality/scenario/mesExamples`；
  - 成员深度提示 → `getGroupDepthPrompts`（`group-chats.js:522`，由 `script.js:4512` 调用）写入 `extension_prompts[DEPTH_PROMPT_n]`（`script.js:4517`）；
  - 历史成员名前缀 → `formatMessageHistoryItem`（`script.js:5941`）与 `setOpenAIMessages`（`openai.js:587-599`）。
- 结论：移植单角色即覆盖群聊；额外需要「成员选择/顺序 + 群深度提示 + groupNudge」，输入均来自 `<userRoot>/groups/<id>.json`、`group chats/<id>.jsonl`。

---

## 9. type 差异

| type | 提示词相关差异 | 证据 |
| --- | --- | --- |
| `normal` | 基线 | — |
| `continue` | 继续后缀（`oai_settings.continue_postfix` `:5039-5041`）；`chat2.shift()` `:4928-4933`；越狱用 `splice(len-1,0,…)`；bias 短路（`getBiasStrings` `:5900`）；CC 侧 `messages.shift()`（`openai.js:1312-1313`，仅 `continue_prefill`） | |
| `regenerate` | 先删上一条 AI 消息（`:4445-4450`，含 `MESSAGE_DELETED` `:4449`）；其余块同 normal | |
| `swipe` | **UI 层在调用前**已推进 `swipe_id`（`loadFromSwipeId` `:10339`、`syncSwipeToMes` `:7095`）；`coreChat.pop()`（`:4538`）；块集合同 normal，仅历史差一条 | |
| `impersonate` | `impersonate` 控制提示（`openai.js:1216-1217`）；`noGroupNudgeTypes=['impersonate']`（`openai.js:891`）；`assistant_prefill`（`openai.js:2835`） | |
| `quiet` | 经 `modifyLastPromptLine` 进末条（`:5094-5109`）；`noMultiSwipeTypes=['quiet','impersonate','continue']`（`openai.js:2735`） | |
| promptTest | `dryRun` + `promptTestInclude*` 清空 WI / 扩展提示（`:4690-4695`、`:5356`） | |

`dryRun` 短路点（`script.js`）：`:4348`、`:4372-4386`、`:4388`、`:4437/:4445`、`:4467`、`:4486/:4493`、`:4612`，终点 `:5382`。**不**跳过：`unshallowCharacter`、两个 emit、`setFloatingPrompt`、`getWorldInfoPrompt`、故事串、分派 switch。
CC 侧额外差异：`squashSystemMessages` **仅在 `dryRun === false`** 生效（`openai.js:1608-1610`）——预览与实发**故意不同**，移植需保留。

响应写入（`saveReply` `:6767`）：normal `:6841-6911`；swipe `:6787-6810`（末页重写 `mes/title/gen_*/send_date/extra.*`）→ `item.swipes[swipeId]=item.mes`、`item.swipe_info[swipeId]={send_date,gen_started,gen_finished,extra:structuredClone(item.extra)}`（`:6931-6950`）；初始化 `ensureSwipes` `:6978`；多滑页 `extractMultiSwipes` `:5557` → `:6955-6970`。

---

## 10. 数据依赖 → 服务端可得性

用户根（`src/constants.js:16` 模板，`src/users.js:729` 解析）：`root`、`settings`(`settings.json`，`src/constants.js:9`)、`characters`、`chats`、`groups`、`groupChats`(`group chats`)、`worlds`、`user`、`sysprompt`、`themes`、`instruct`、`context`、`vectors`、`backups`，以及 `<root>/leslie/{memory,moments,identity}`。

**STORED**=同一文件可取；**DERIVED**=可由存储文件重算；**BROWSER-ONLY**=必须移植或改为服务端状态；**UNKNOWN**=需决策。

| 依赖 | 浏览器来源 | 服务端可得性 | 说明 |
| --- | --- | --- | --- |
| `power_user`（instruct/context/sysprompt/persona_description*/collapse_newlines/token_padding/pin_examples/personas/persona_descriptions） | `script.js:101` | **STORED** | `settings.json.power_user`（持久化清单 `script.js:8275-8293`） |
| `oai_settings`（`prompts`、`prompt_order`、`wi_format`、各种 format/prompt 文本、`squash_system_messages`、`chat_completion_source`、模型参数） | `script.js:125` | **STORED** | `settings.json.oai_settings`；服务端已有先例读取（`src/leslie-bridge/model-chat.js:86-101`） |
| `world_info_settings`（含 `world_info.globalSelect`、`charLore`） | `world-info.js:795/69-82` | **STORED** | `settings.json.world_info_settings` |
| `textgenerationwebui_settings` / `kai_settings` / `horde_settings` / `nai_settings` | `script.js:33` 等 | **STORED** | `settings.json` 同名键 |
| `extension_settings`（note/memory/vectors/regex/leslie-reply-style） | `public/scripts/extensions.js:141` | **STORED** | `settings.json.extension_settings` |
| `max_context` / `amount_gen` / `main_api` / `swipes` / `username` / `user_avatar` | 模块级 | **STORED** | `settings.json` 同名键 |
| 角色卡字段 | `characters[this_chid]` | **STORED** | `<userRoot>/characters/<file>.png` 内嵌卡 JSON；经 `getCharacterCardFields`（`script.js:3472`） |
| **角色 lore 绑定** | `character.data.extensions.world`（`world-info.js:4368`） | **STORED** | 注意：**不是** `character_book`（那只是导入路径） |
| 聊天数组（`mes`/`is_user`/`is_system`/`name`/`extra.*`/`swipes`/`swipe_id`/`swipe_info`） | `chat` | **STORED** | `chats/<card>/<file>.jsonl` |
| `chat_metadata`（`note_position/note_depth/note_role`、`system_prompt`/`scenario`/`mes_example` 覆盖、`world_info`、`timedWorldInfo`、`leslie_memory`、`persona`、`tainted`、`integrity`） | 模块级 | **STORED** | JSONL **首行**（写 `script.js:7570`，读 `:7844`） |
| **作者注正文** | `$('#extension_floating_prompt').val()`（`authors-note.js:364`） | **BROWSER-ONLY → 必须改入参** | 持久化字段存在（`chat_metadata.note_prompt`），但当前实现从 DOM 输入框取文本；`shouldWIAddPrompt`/interval 亦在页面重算 |
| **待发用户文本** | `$('#send_textarea').val()`（`script.js:4349`、`:4439`） | **BROWSER-ONLY → 必须改入参** | 服务端需把待发文本作为显式入参 |
| 当前角色/聊天/群组 | `this_chid`/`getCurrentChatId()`/`selected_group` | **DERIVED** | 由 `/api/v1/chats/{id}` 唯一确定（§11） |
| World Info 书目 | `worldInfoCache`（`world-info.js:882`） | **STORED** | `<userRoot>/worlds/<book>.json`；缓存本身 BROWSER-ONLY 但纯读，服务端自建即可 |
| 群组与群聊天 | `groups`/`getGroupChat()` | **STORED** | `groups/<id>.json`、`group chats/<id>.jsonl` |
| Leslie 记忆四类文本（growth/events/cross-line/relationship） | `extension_prompts` | **DERIVED** | 纯读 `<root>/leslie/memory/<id>/*`（`src/leslie-memory/store.js:69-88`；`selectContext` `518-535`、`getRelationship` `537-540`、`selectCrossLineContext` `542+`）；HTTP 端点 `src/leslie-memory/router.js:131/141/151` |
| 记忆相关性查询 | `chat-context.js:192-205` | **STORED** | 取最近 3 条（JSONL） |
| 记忆 token 预算适配 | `leslie-memory/index.js:1547-1559` | **DERIVED** | 需服务端 tokenizer + `contextSize` |
| 记忆身份/绑定/剧情范围 | `leslie-memory/index.js:189-196,251-272` | **STORED** | `chat_metadata.leslie_memory` + `leslie/identity/registry.json` |
| `leslie_reality_time` 文本 | `leslie-reality-context.js:152-174` | **BROWSER-ONLY** | 依赖设备时钟与时区（`new Date()`、`Intl…timeZone`）；`chat_metadata.leslie_world_line` 本身 STORED |
| `leslie_reply_style` 文本 | `leslie-reply-style.js:82-86`；`reply-style/index.js:57` | **STORED** | `extension_settings[LESLIE_REPLY_STYLE_SETTINGS_KEY]` |
| 记忆/剧情引导/罗盘独立生成 | `leslie-story-choices.js:308-320`、`leslie-plot-compass.js:560-572` | **BROWSER-ONLY** | 独立 quiet 生成 + JSON schema |
| Reality 替换式流水线 | `leslie-reality/index.js:374-434` | **UNKNOWN — 需要决策** | `abort(true)` + 自建整条消息 |
| Moments 提示文本（当前未使用） | `leslie-moments/memory-context.js:13-30` | **STORED** | `<root>/leslie/moments/timeline.json` |
| 向量/数据银行注入 | `extension_prompts`（vectors） | **BROWSER-ONLY（当前）** | 需 embedding 服务 |
| `/inject` 运行期提示与 `filter` 闭包 | `extension_prompts`（slash-commands） | **BROWSER-ONLY** | 运行期注册、不持久化；`filter` 是函数（不可序列化） |
| **页面侧拦截器**（`generate_interceptor`） | `extensions.js:2016-2040`，`script.js:4614` | **BROWSER-ONLY** | 服务端需要自己的拦截器阶段，或由客户端把结果随请求上报 |
| `GENERATE_BEFORE/AFTER_COMBINE_PROMPTS` | `eventSource` | **DERIVED（树内 0 订阅者）** | 第三方可能订阅 → 需声明边界 |
| `CHAT_COMPLETION_PROMPT_READY` | `openai.js:1619` | **BROWSER-ONLY（parity 风险）** | 扩展可在发送前改写 `chat` |
| `WORLD_INFO_ACTIVATED` / `WORLDINFO_SCAN_DONE` | `world-info.js:902/5056` | **BROWSER-ONLY** | 生成期无服务端事件总线等价物 |
| `WORLDINFO_FORCE_ACTIVATE` 外部激活 | `world-info.js:1020-1028`、`4774` | **BROWSER-ONLY** | `WorldInfoBuffer.externalActivations` `202` |
| 宏引擎 `substituteParams` / `substituteParamsExtended` | `world-info.js:4803/4938`；`openai.js:886/903/1100/1317/1360-1363`；`PromptManager.js:1282-1286` | **DERIVED（必须移植）** | 两套引擎由 `power_user.experimental_macro_engine` 切换（`script.js:2962-2996`）；输入为 `name1/name2/characters/power_user/chat_metadata/group/时间` |
| 正则引擎 `getRegexedString(WORLD_INFO)` | `world-info.js:5071` | **DERIVED（必须移植）** | 规则在 `settings.json.extension_settings.regex` |
| token 计数（`getTokenCountAsync`/`countTokensOpenAIAsync`） | `world-info.js:4891/4942`；`openai.js:3409`；`tokenizers.js:846` | **DERIVED（服务端已有 TODO 标记）** | 服务端存在 `/api/tokenizers/*`（`src/endpoints/tokenizers.js:739+`）；**逐位等价预算需同款 tokenizer** |
| `getChatCompletionModel()` | `openai.js:1707-1767` | **DERIVED** | 纯函数（全部字段已持久化）；注意 OpenRouter 哨兵 `'OR_Website'`（`openai.js:142`）与 `chat[j].extra.api/model` 门控（`:568`/`:618`） |
| 活跃角色解析 | `PromptManager.js:438`、`openai.js:689-690` | **DERIVED（固定策略）** | 配置 `promptOrder.strategy='global'`、`dummyId=100001`（`openai.js:676-692`）⇒ 恒为 `{id:100001}`，无需浏览器状态 |
| `is_send_press` / `online_status` / `abortController` / `streamingProcessor` / `menu_type` | 模块级 | **BROWSER-ONLY（不参与文本）** | 并发/UI 门控 |
| `promptManager` 单例 + DOM 初始化 | `PromptManager.js:436`、`openai.js:667-713` | **BROWSER-ONLY** | 组装被实现为 UI 组件的副作用；服务端需 headless 版 |
| `promptManager.render` / `getSortableDelay`→`isMobile` | `openai.js:1613`；`PromptManager.js:862-895`；`utils.js:362` | **BROWSER-ONLY** | 与组装无关 |
| `toastr` / `t()` 报错路径 | `openai.js:1590-1602` | **BROWSER-ONLY** | 与组装无关 |
| `ToolManager` 工具注册（闭包 `action`） | `tool-calling.js:247/266-289/400-418`；`openai.js:1304` | **BROWSER-ONLY（仅工具调用）** | `function_calling` 关闭时不影响 |
| `Message.addImage()` 对非 data URL 执行 `fetch` | `openai.js:3551-3560`、`958-986` | **UNKNOWN — 需要决策** | 服务端抓取用户媒体 URL 会改变信任模型 |
| `validateReverseProxy()`（localStorage+Popup） | `openai.js:542-554`，由 `2807` 调用 | **BROWSER-ONLY（发送路径）** | 不在组装路径 |
| `leslie` 回复风格运行期镜像 | `leslie-reasoning-budget.js:84-140`；`leslie-reply-style.js:38-39/95-100` | **BROWSER-ONLY（可镜像）** | 底层值在 `extension_settings`（STORED），需同步调用 `setLeslieReplyStyleRuntimeSettings` |
| `power_user.personas` → `name1` 映射 | `personas.js:900-902`、`script.js:8128` | **STORED** | `settings.json.username` + `power_user.personas[user_avatar]`（此前 UNKNOWN，已解决） |
| `character.tags` / `character.data.alternate_greetings` / `talkativeness` | — | **不参与 `Generate`** | `tags` 仅参与 WI `characterFilter.tags`（`world-info.js:4712-4726`）；`talkativeness` 仅群聊激活（`group-chats.js:1417-1420`） |

---

## 11. 服务端上下文映射（`/api/v1/chats/{id}` → 组装输入）

| 组装需要 | 服务端推导方式 |
| --- | --- |
| 角色卡 | chat id 内含 `cardName`（`src/api-v1/routes/chats.js::resolveChatRef`）→ `<userRoot>/characters/<cardName>.png`；群聊取成员卡并等价实现 `getGroupCharacterCardsLazy` |
| 聊天数组 + `chat_metadata` | `getChatData(<filePath>)`（`src/endpoints/chats.js:515`），首行即 metadata |
| 群组/群聊天 | group chat id = `group\0<fileName>` → `group chats/<fileName>.jsonl`；成员来自 `groups/<groupFile>.json` |
| 设置 | `<userRoot>/settings.json`（`power_user`/`oai_settings`/`world_info_settings`/`extension_settings`/`max_context`/`amount_gen`/`main_api`/`swipes`/`username`/`user_avatar`） |
| Persona | `settings.json.power_user.persona_description*` + `user_avatar` + `chat_metadata.persona` |
| 作者注 | `chat_metadata.note_*`（服务端需自行计算文本，替代 DOM 读取） |
| 记忆四类文本 | `<root>/leslie/memory/*` + `src/leslie-memory/store.js` 现有 API |
| World Info | `<userRoot>/worlds/*.json` + `world_info_settings` + `chat_metadata.world_info` + `timedWorldInfo` |
| 待发用户文本 | `/api/v1` 请求体显式提供（替代 DOM 读取） |
| 提示词顺序 | `oai_settings.prompts` + `prompt_order`（需同时复刻 `sanitizeServiceSettings`/`checkForMissingPrompts`/`registerPromptManagerMigration`） |

---

## 12. 逐字等价的风险点（供 2.5.4 设计断言）

1. **两族产物形态不同**：TC 是**单个字符串**；CC 是**消息数组**。断言分开做（字符串逐字 / 数组逐项含 role）。
2. **CC 顺序来自 `prompt_order` 槽位**，不是调用顺序（§4.2）。默认顺序、`enabled`、`ABSOLUTE` 位置、`injection_*` 都会改变结果。
3. **迁移逻辑**：缺 `prompt_order` 时页面会写入默认序；服务端不复刻会产出不同数组。
4. **空白与换行**：`combine()` 去 `\r`、可选 `collapseNewlines`；`addChatsSeparator`/`addChatsPreamble` 依赖 `power_user.context.chat_start`。必须复用同一实现。
5. **`\s` 边界**：bias/CFG 追加按末字符是否空白决定空格（`:5236`、`:5214`）——最易差一个空格。
6. **字典序排序**：`extension_prompts` 键名字典序（`:3295`）决定同深度先后，键名即语义。
7. **异步 `filter`**：`getExtensionPrompt` 的 `filter` 是 async（`:3270+`）——需保留 `await`。且 `filter` 是**闭包**，服务端无法从数据文件重建。
8. **CC 非纯**：`prepareOpenAIMessages` 原地 `shift`/`reverse` 调用方 `messages`（`openai.js:1312-1313`、`:860/:865`）。移植必须显式复制。
9. **预算裁剪**：`TokenHandler` 计数 + `checkPromptSize`（`:5155`）先裁示例再 `mesSend.shift()`；CC 侧 `reserveBudget`（`openai.js:1230`）。且 tokenizer 必须同款才能逐位一致。
10. **`squashSystemMessages` 仅在实发时生效**（`openai.js:1608-1610`）——预览/实发**故意不同**。
11. **type 分支**（§9）：`swipe/regenerate/continue/impersonate/quiet` 不能共用一条路径。
12. **群聊逐成员驱动**：最终文本由多次生成拼成。
13. **两处 DOM 入参化**（§10）：不改则服务端输入天然不同。
14. **宏引擎**：两套引擎由 `power_user.experimental_macro_engine` 切换，必须与浏览器选同一套。
15. **WI 随机性**：概率判定用 `Math.random()`（`world-info.js:4909-4935`）——逐字等价断言必须**固定随机源或注入种子**。
16. **WI 时间效果**：`chat_metadata.timedWorldInfo` 会被写回（`5155-5157`）——服务端执行会**改动聊天文件**，需明确是否允许。
17. **第三方扩展改写**：`GENERATE_*_COMBINE_PROMPTS`、`CHAT_COMPLETION_PROMPT_READY` 树内无订阅者/由扩展驱动，服务端应声明边界。

---

## 13. 2.5.2 放置位置建议（待裁决）

| 方案 | 做法 | 优点 | 代价 |
| --- | --- | --- | --- |
| **A（建议）** `src/prompt-assembly/` 同构模块 + 两侧薄适配 | 算法写成**只依赖显式入参**的纯模块（入参：character/chat/metadata/settings/wi/extensionPrompts/pendingUserText/noteText/random），`public/script.js` 与 `src/api-v1` 各自组装入参后调用 | 单一事实来源；Node 可直接做夹具断言；不触碰聊天核心文件 | 需把 `script.js` 的模块级读取改为显式入参（属 2.5.2 允许范围） |
| B 先复制到 `src/` 再对齐 | 服务端独立实现后靠夹具对齐 | 改动面小 | **违反"不复制业务逻辑"**，必然漂移；不推荐 |
| C 服务端直接 import `public/scripts/*` | 最大复用 | 复用最彻底 | 这些模块 import `script.js`（巨型 + DOM），服务端无法安全加载；必须先做 A 的解耦 |

**A 的落地顺序建议**：
1. `getExtensionPrompt` 的筛选/排序/拼接（保留 async filter 语义）→ 纯函数；
2. 宏引擎 + tokenizer 的服务端等价实现（两个硬外部输入，先做可早暴露差异）；
3. `checkWorldInfo` 激活算法 → 纯函数（注入随机源与 tokenizer）；
4. TC 族 `combine()` 与第 1–30 步顺序 → 纯函数；
5. CC 族 `sanitizeServiceSettings`/`getPromptCollection`/`preparePromptsForChatCompletion`/`populateChatCompletion` → 纯函数（含稀疏 depth 注入）；
6. 群聊成员选择 + 群深度提示 → 纯函数；
7. 两处 DOM 读取改为入参（`send_textarea` → pendingUserText；`extension_floating_prompt` → noteText）。

**需要裁决的点**：
- **Q1**：接受方案 A（含把 `public/script.js` 组装段改为显式入参的薄调用）？
- **Q2**：范围确认——服务端权威轮次覆盖**全部 `main_api`**（kobold/novel/TGW/openai），还是**仅 chat completions**？两族注入位置不同，直接决定移植面大小。
- **Q3**：**页面侧拦截器**（`generate_interceptor`）与 `extension_prompts` 的 `filter` 闭包：服务端**自行实现拦截器**、还是**由客户端把结果随请求上报**？（后者会削弱"服务端权威"的语义）
- **Q4**：向量/数据银行与 `/inject` 运行期注入**不移植**（服务端只支持持久化来源），可否接受？
- **Q5**：WI 概率随机性与 `timedWorldInfo` 写回：服务端是否允许**改动聊天文件**？断言是否需要可注入随机种子？
- **Q6**：`WORLD_INFO_ACTIVATED` / `GENERATE_*_COMBINE_PROMPTS` / `CHAT_COMPLETION_PROMPT_READY` 在服务端**不复刻**，仅文档化边界，可否接受？
- **Q7**：逐字等价的范围——是否包含 **token 预算裁剪的逐位一致**（需要服务端 tokenizer 与浏览器完全同款），还是只要求"未触发裁剪时逐字一致"？
- **Q8**：`Message.addImage()` 对非 data URL 的 `fetch`：服务端是否代抓？

---

## 14. 本次盘点的验证边界

- **已逐条核实**：§1–§11 全部 file:line 与标识符。
- **抽样二次复核**（高影响结论）：`$('#send_textarea').val()`（`script.js:4349`/`:4439`）、作者注 DOM 读取（`authors-note.js:364`）、`Object.keys(extension_prompts).sort()`（`:3295`）、`coreChat.pop()`（`:4538`）、`dryRun` 终点（`:5382`）、分派 helper 定义、群聊逐成员 `Generate`（`group-chats.js:1198`）、`worldInfoCache` 存在性（`world-info.js:882`）、`getWorldInfoPrompt` 返回 `anBefore/anAfter`（`:908-916`）、`messages.reverse()`（`openai.js:865`）、`promptManagerDefaultPromptOrder` 槽位（`PromptManager.js:2087+`）。
- **未逐行展开（2.5.2 落地时精读）**：`checkWorldInfo` 的键匹配/次级键/包含组/递归细节；`populateChatCompletion` 的 `INJECTION_POSITION` 三分支实现；`ChatCompletion.add/insert` 的具体插入算法。
- **`UNKNOWN — 需要决策`**：`prepareOpenAIPromptCache`（本 fork 不存在）；`outletEntries` 是否需在服务端保留；reality 替换式流水线的完整组成；`getKayraMaxContextTokens()` 是否依赖外部订阅接口（`script.js:6046-6050`）。
- **零代码改动确认**：本次提交仅新增本文件；`git diff` 对 `src/`、`public/`、`tests/`、`package.json` 为空。
