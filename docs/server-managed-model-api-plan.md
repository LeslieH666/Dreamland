# Server-Managed Model API Plan (Draft — 已细化，未执行)

## 1. 目标

把「AI 模型 API 配置/密钥」从 Web 端、移动端全部收回，统一为**服务器后台配置的多供应商模型网关**。用户在服务端提供的**模型清单**里选择模型，客户端不再有任何模型 API 配置或密钥入口。

## 2. 已确认决策（2026-10-10）

1. **保留多供应商**：服务端支持 OpenAI / DeepSeek / 火山 等多个供应商，后台可增删、启停。
2. **用户从服务端清单选模型**：后台维护一个「可用模型清单」，用户只能从这个清单里选，不能自定义模型、不能填密钥。
3. **不保留个人密钥**：旧账户里已有的个人 API key 一律清除/忽略，不做迁移、不保留。

## 3. 现状（模型配置散落在哪）

| 位置 | 现状 | 要改成 |
|---|---|---|
| Web UI「模型连接」面板 | 用户可填自己的 key/endpoint/模型 | **移除**，换成「从服务端清单选模型」下拉 |
| 移动端 `SettingsScreen.tsx` | 已无密钥配置 | 加「模型选择」（读服务端清单），无密钥 |
| `/api/v1/secrets` | 每用户隔离的密钥库 | **服务端全局 + 仅管理员** |
| `/api/v1/chat/:id/generate` | 读每用户 oai_settings + 接受客户端覆盖 source/model | 只用服务端网关配置，模型仅限清单内 |
| 适配器 `chat-completions.js` | 从请求体读 provider 配置 | 从服务端网关配置读 provider/key/model |
| `/api/v1/ops/gateway` | 只读展示 | 升级为**可编辑**的模型网关配置 |

## 4. 目标架构

```
Web / 移动端
   │  只发「聊天 + 选中的 model_id」，不带任何 key/endpoint
   ▼
/api/v1/chat/*（校验 model_id 在服务端清单内）
   │  按 model_id 查「服务端模型网关配置」→ 得到 provider + key + 真实模型名
   ▼
适配器 chat-completions.js → 对应供应商
```

## 5. 数据模型（服务端，admin-only）

**供应商（Provider）**
```jsonc
{ "id": "deepseek", "name": "DeepSeek", "endpoint": "https://api.deepseek.com/v1",
  "apiKeySecretId": "secret:deepseek",   // 指向全局密钥库，只存 key id
  "enabled": true }
```

**模型清单（Model catalog）**
```jsonc
{ "id": "deepseek-chat", "name": "DeepSeek-V3", "provider": "deepseek",
  "apiModel": "deepseek-chat", "enabled": true,
  "params": { "temperature": 0.9, "max_tokens": 800 } }
```

- 密钥存服务端全局密钥库（复用/改造 `secrets.json`），`apiKeySecretId` 只存引用。
- 模型清单暴露给客户端时**只返回** `id/name/enabled`，不含 provider 详情与密钥。

## 6. 改动清单（分层）

### 6.1 服务端核心
- 新增「模型网关配置」权威存储 + `getServerModelGateway()` / `getModelById()` / `listAvailableModels()` 读取入口（全局，不绑用户目录）。
- 适配器 `chat-completions.js` 改为按 `model_id` 从服务端配置取 provider/key/apiModel，不再信任请求体 provider 配置。

### 6.2 API 层
- 新增 `GET /api/v1/models` → 返回可用模型清单（用户可见，无密钥）。
- `/api/v1/chat/:id/generate`：只接受清单内的 `model_id`；忽略客户端传的 source/key/endpoint。
- `/api/v1/secrets`：改服务端全局 + `requireOpsAdmin`。
- 新增 ops 端点（见 6.4）读写供应商/模型清单。

### 6.3 Web UI
- 移除「模型连接」面板（key/endpoint/模型自填）。
- 换成「模型选择」下拉（数据来自 `GET /api/v1/models`），显示只读状态「模型由服务器提供」。

### 6.4 移动端
- `SettingsScreen` 加「模型选择」（读 `/api/v1/models`），无密钥输入。

### 6.5 运营面板 `/ops`
- 新增「模型网关」配置区：
  - 供应商管理：增删/启停供应商、填 endpoint、填 API key（只显示掩码）。
  - 模型清单管理：增删/启停模型、映射供应商、设默认参数。
  - 显示「当前生效」状态。

### 6.6 清除个人密钥
- 一次性脚本：遍历所有账户，删除/忽略其 `oai_settings` 里的 key/endpoint（保留聊天/角色等非模型数据）。
- 服务端读取模型配置时**强制忽略**每用户 oai_settings 的模型段。

## 7. 可执行 Task 清单（顺序执行，未开始）

- **T1 配置源 + 读取入口**：新增全局模型网关存储 + `getServerModelGateway/listAvailableModels`；`secrets.js` 改为全局 admin-only。
- **T2 适配器收权**：`chat-completions.js` 按 `model_id` 从服务端取配置。
- **T3 API 收权**：`/api/v1/models` 端点 + `/api/v1/chat/generate` 只认清单内 model_id。
- **T4 清除个人密钥**：迁移/清除脚本 + 服务端强制忽略每用户模型段。
- **T5 Web UI 收权**：移除模型连接面板 → 模型选择下拉。
- **T6 移动端模型选择**：SettingsScreen 加模型下拉。
- **T7 后台配置 UI**：`/ops` 模型网关配置区（供应商 + 模型清单）。
- **T8 验证**：全量测试 + `test:prompt-baseline` 9/9 + `replay-server.mjs` oracle + 端到端聊天（多供应商切换、清单选模型）。

每个 T 完成后单 commit，红线 3 文件（`chats.js`/`characters.js`/`prompt-converters.js`）零触碰。

## 8. 风险与注意

- 密钥只存服务端、只显掩码、绝不回显；`/api/v1/secrets` 改全局后必须 admin-only。
- 清除个人密钥前备份（脚本先 dry-run 列出将删内容，再执行）。
- 模型请求体变化需重跑 `replay-server.mjs` oracle，确认字节一致或差异可解释。
