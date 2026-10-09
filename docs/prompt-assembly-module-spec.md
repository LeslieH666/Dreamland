# src/prompt-assembly/ 模块接口规范（Phase 2.5.2 第 1–2 步脚手架）

> 用途：给 Phase 2.5.2 第 1–2 步提供**接口契约**。只定义「目录骨架 / 纯函数签名 / 不变量」，不规定实现细节。
> 依据：`docs/prompt-assembly-map.md`（file:line 均已核实）。标注 **`待源码确认`** 处实现时以源码为准，不做推测。

---

## 1. 目录骨架

```text
src/prompt-assembly/
├─ index.js               # 聚合导出（后续步骤再补）
├─ enums.js               # 共享枚举（本步）
├─ extension-prompts.js   # 第 1 步：getExtensionPrompt 纯核心
└─ macros.js              # 第 2 步：substituteParams 适配层
```

后续步骤（2.5.2 第 4–7 步）再补：`world-info.js`（checkWorldInfo）、`registry.js`（PromptManager 顺序）、`populate.js`（populateChatCompletion）、`orchestrate.js`（prepareOpenAIMessages 薄编排）。

---

## 2. 导入与打包（关键前提，需在 2.5.2 报告说明方案）

共享模块必须满足：
- 纯 ESM，**零 DOM / 零 browser 全局 / import 无副作用**；
- 同时被 `src/`（Node）与 `public/scripts/`（浏览器，经项目既有 webpack 构建）引用。

**建议位置**：`src/prompt-assembly/`（服务端原生家）。浏览器侧引用方式（webpack alias / 相对路径 / 其它）是 2.5.2 的实现决策，**必须在该步报告里说明选型与理由**；无论选哪种，都要保证 `public/` 不改产物行为。

---

## 3. 共享枚举（`enums.js`）

与浏览器语义**逐位一致**（来源 `script.js:511-527`）：

```js
export const ExtensionPromptType = Object.freeze({
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
});

export const ExtensionPromptRole = Object.freeze({
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
});

export const MAX_INJECTION_DEPTH = 10000;
```

`injection_position`（`ABSOLUTE=1` 等）属第 5–6 步（注册表/填充），本步不涉及；`待源码确认` 完整枚举后放入 `enums.js` 或注册表模块。

---

## 4. 第 1 步：`extension-prompts.js`

### 4.1 注册表条目形状

```js
/**
 * @typedef {object} ExtensionPromptEntry
 * @property {string} value
 * @property {number} position   // ExtensionPromptType
 * @property {number} depth
 * @property {number} role       // ExtensionPromptRole
 * @property {boolean} [scan]    // 供 World Info 扫描输入（world-info.js:4607-4612）
 * @property {(text: string) => (Promise<string> | string)} [filter]  // async filter；服务端无 /inject，可不传
 */
```

### 4.2 纯核心签名

```js
/**
 * 选取、字典序排序、逐条 filter、拼接某一 (position, depth) 的扩展提示。
 * 纯函数：只读传入的 registry，返回新字符串，绝不原地改写入参。
 *
 * @param {Record<string, ExtensionPromptEntry>} registry  // 键 = 提示键名
 * @param {number} position
 * @param {number} depth
 * @param {{ separator?: string, role?: number, wrap?: boolean }} [opts]
 * @returns {Promise<string>}   // filter 为 async，故返回 Promise
 */
export async function getExtensionPrompt(registry, position, depth, opts = {}) { /* … */ }

/**
 * 按键名取一条扩展提示（供 World Info 扫描、按名查）。
 * @param {Record<string, ExtensionPromptEntry>} registry
 * @param {string} name
 * @returns {ExtensionPromptEntry | undefined}
 */
export function getExtensionPromptByName(registry, name) { /* … */ }
```

### 4.3 不变量（第 1 步验收依据）

1. **纯**：函数体内**不得**读模块级 `extension_prompts`、不得读 DOM、不得改入参（`registry`/`entry`）。
2. **排序**：同 `position` 且同 `depth` 内按**键名字典序**（`Object.keys(...).sort()`，`script.js:3295`）。
3. **filter**：逐条 `await`，顺序执行；无 filter 视为恒等。
4. **拼接**：`separator` 默认值与浏览器一致（`待源码确认` 当前默认），`wrap` 语义与 `script.js` 一致。
5. 浏览器侧薄适配器负责把当前模块级 `extension_prompts` 组装成 `registry` 传入；服务端侧负责从持久化来源重建 `registry`。两边调用**同一个**纯核心。

---

## 5. 第 2 步：`macros.js`

### 5.1 纯函数签名

```js
/**
 * 替换提示文本中的 {{macro}} 参数。引擎选择与浏览器一致（见不变量 2）。
 * 纯函数：只读传入 context，返回新字符串。
 *
 * @param {string} text
 * @param {object} context
 * @param {string} context.name1
 * @param {string} context.name2
 * @param {object} context.characters
 * @param {object} context.powerUser       // settings.json.power_user（原模块级 power_user）
 * @param {object} context.chatMetadata    // JSONL 首行 chat_metadata
 * @param {object} [context.group]
 * @param {Date}   [context.now]           // 时间类宏的注入时钟；缺省用真实时间（测试注入固定值）
 * @returns {string}
 */
export function substituteParams(text, context) { /* … */ }
```

### 5.2 不变量

1. **实现 = 现有宏引擎的“抬升”**，不是重写：把浏览器里依赖全局 `name1/name2/characters/power_user/chat_metadata/group/时间` 的宏替换逻辑抽成纯函数，全局读全部改为 `context` 读。
2. **引擎选择一致**：根据 `context.powerUser.experimental_macro_engine` 在 `substituteParams` 与 `substituteParamsExtended` 两套间切换（`script.js:2962-2996`），选择结果必须与浏览器相同。
3. 输出对基线夹具（8 用例）与浏览器**逐字一致**（本步门槛）。

---

## 6. 不变量总则（两个模块通用）

- 纯 ESM、无副作用导入；可在 Node 与浏览器同源码运行。
- **绝不原地改写入参**（尤其 `messages` 数组，见盘点 §4.1 的 `shift/reverse` 教训——那是第 6 步的事，本步先立规矩）。
- 不做任何 IO：不读文件、不发请求、不读 `window`/`document`/`process`（除 `enums` 常量）。
- 红线：`src/endpoints/chats.js`、`characters.js`、`prompt-converters.js` 保持零改动。

---

## 7. 验收门槛（第 1–2 步）

- `npm run test:prompt-baseline` 8/8 **逐字一致**。
- `npm run lint` / `npm run test:unit` / `npm run check:repo` 通过。
- `git diff --stat -- src/endpoints/chats.js src/endpoints/characters.js src/prompt-converters.js` 为空。
