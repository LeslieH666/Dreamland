# Server-Managed Model API Plan (Draft — 未执行)

## 1. 目标

把「AI 模型的 API 配置/密钥」从 Web 端、移动端全部收回，统一为**服务器后台配置的单一模型 API**。所有用户共享运营者（你）在后台配置的一套模型网关，客户端不再有任何模型 API 权限或配置入口。

一句话：**用户只管聊天，模型接哪家、用什么 key，只有后台管理员能定。**

## 2. 现状（模型配置散落在哪）

| 位置 | 现状 | 是否要动 |
|---|---|---|
| Web UI（SillyTavern 前端） | 用户可在「模型连接」里填自己的 API key / endpoint / 模型 | **收回**：移除/隐藏该面板 |
| 移动端 `SettingsScreen.tsx` | 已无模型/密钥配置（只连服务器 API） | 基本不动，仅确认无残留 |
| `/api/v1/secrets` | 服务端密钥库，但按 `request.user.directories` **每用户隔离** | 改成**服务端单一密钥库**（admin-only） |
| `/api/v1/chat/:id/generate` | 读取 `configuration.settings`（该账户的 oai_settings），且接受客户端传 `chat_completion_source` / `model` 覆盖 | 改为**只用服务端配置**，拒绝/白名单化客户端覆盖 |
| 模型适配器 `src/endpoints/backends/chat-completions.js` | 从请求体读 provider 配置 | 改为从**服务端统一配置**读 |
| `/api/v1/ops/gateway` | 已能展示网关状态（只读） | 升级为**可编辑**的模型网关配置入口 |

## 3. 目标架构

```
客户端(Web / 移动端)
   │  只发「聊天消息 + 角色/世界书等业务数据」，不再携带任何模型 API 配置
   ▼
后端 /api/v1/chat/*
   │  从「服务端模型网关配置」读 provider/key/model
   ▼
模型适配器 chat-completions.js → OpenAI / DeepSeek / 火山 等
```

## 4. 改动清单（分层）

### 4.1 服务端核心（单一配置源）
- 新增「服务端模型网关配置」的权威存储：优先复用 `secrets.json`（服务端级）+ `config.yaml` 的模型段，明确**不与任何用户目录绑定**。
- 提供一个 `getServerModelConfig()` 读取入口，供适配器与 `/api/v1` 使用。
- 模型适配器 `chat-completions.js` 从「服务端配置」读 provider/key/model，**不再信任请求体里的 provider 配置**。

### 4.2 API 层（收回权限）
- `/api/v1/chat/:id/generate`：
  - 移除对 `chat_completion_source` / `model` 客户端覆盖的信任；要么忽略，要么仅允许「服务端已配置的模型」白名单。
  - key/endpoint 一律来自服务端配置。
- `/api/v1/secrets`：从「每用户」改为「服务端全局」，且**仅管理员可读写**（复用 `requireOpsAdmin`）。
- 新增/改造 ops 端点，供后台读写模型网关配置（见 4.4）。

### 4.3 Web UI（移除用户侧模型入口）
- 移除/隐藏 SillyTavern 前端的「模型连接 / API key / endpoint / 模型选择」面板。
- 用户界面显示只读状态：「模型由服务器统一提供」（可显示当前模型名）。
- 保留聊天、角色、世界书等**非模型**功能不变。

### 4.4 移动端
- 确认 `SettingsScreen` 无模型/密钥配置（已无），若后续新增任何模型相关 UI 一律走服务端。

### 4.5 运营面板 `/ops`
- 新增「模型网关」配置区：
  - 选择供应商（OpenAI / DeepSeek / 火山 等）
  - 填 endpoint、API key（保存后只显示掩码）
  - 选默认模型 + 参数（温度、max_tokens 等）
- 展示各供应商「是否已配置 + 掩码 + 当前生效」。

### 4.6 兼容与迁移
- 已存在的每用户 oai_settings 里的密钥：**迁移到服务端密钥库后，从用户目录清除/忽略**。
- 提供一次性迁移脚本 + 回滚说明（保留旧密钥备份，不直接删）。

## 5. 分阶段执行

- **P-A（配置源 + 读取入口）**：加 `getServerModelConfig()` + 服务端密钥库；适配器改读服务端配置。
- **P-B（API 收权）**：`/api/v1/chat/generate` 拒绝客户端模型覆盖；`/api/v1/secrets` 改全局 admin-only。
- **P-C（Web UI 收权）**：移除/隐藏用户侧模型面板，显示只读状态。
- **P-D（后台配置 UI）**：`/ops` 加模型网关配置区。
- **P-E（迁移 + 验证）**：迁移旧密钥、清用户侧配置；跑全量测试 + 端到端聊天验证。

## 6. 风险与注意

- **红线**：`chats.js` / `characters.js` / `prompt-converters.js` 三文件零触碰（本计划不涉及聊天核心逻辑改动）。
- **密钥安全**：密钥只存服务端、只显示掩码、绝不回显明文；`/api/v1/secrets` 改全局后必须收紧为 admin-only。
- **回退**：迁移前备份旧密钥，保留「回退到每用户配置」的开关/脚本，出问题可回滚。
- **验证**：`test:prompt-baseline` 浏览器 9/9 byte-identical + `replay-server.mjs` 服务端 oracle 必须不回归（模型请求体变了要重跑 oracle 确认）。

## 7. 待确认（执行前需要你拍板）

1. 服务端是否**只接一家**（比如只 DeepSeek），还是保留「多供应商 + 后台切换」？
2. 用户是否还需要**自己选模型**（在服务端提供的一批模型里选），还是完全由后台定死一个默认模型？
3. 旧账户里已有的个人密钥是「迁移后删除」还是「只忽略、保留备份」？
