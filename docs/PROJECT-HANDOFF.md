# DreamLand 项目交接文档（二次开发 Handoff）

> 用途：把项目的技术路径、设计要求、当前状态一次性讲清楚，供后续 agent 接手二次开发。
> 分支：`refactor/execution`（未推送 origin，仅在本地）。
> 更新时间：2026-10-10。

---

## 1. 项目定位

DreamLand 是 **SillyTavern 的 fork**（`pkgVersion 1.18.0`），目标是把原来的「单体 Express + jQuery 网页 + Electron」拆成**前后端分离的产品**：

- **一个 Linux 服务器后端**，服务所有注册用户（**多租户 SaaS**）。
- **iOS / Android 移动前端**（React Native 优先，后续可迁原生）。
- **桌面端**：同一套代码出两个构建（服务器 + Electron 桌面）。
- **模型接入**：只做**云 API 代理**（OpenAI / DeepSeek / 火山引擎），**不做本地模型部署**（AIRI 与本地模型相关代码已移除）。

## 2. 架构总览

```
客户端
├─ Web PWA（public/，SillyTavern 前端 + DreamLand 主题）
├─ 移动端（apps/mobile，React Native + Expo SDK 57）
└─ 桌面（src/electron，Electron 宿主）
        │
        ▼
后端（Express 单体，node server.js）
├─ /                     Web UI（登录后使用）
├─ /login /ops          登录页 / 运营面板
├─ /api/v1/*            公共 API（JWT 鉴权，供移动端 + Web 客户端）
│   ├─ auth  characters  chats  groups  worldinfo  voice  leslie  secrets  ops
├─ /api/v1/ops/*        运营面板 API（仅管理员）
├─ /api/backends/*      SillyTavern legacy 模型代理（Web 聊天走这条）
└─ 模型网关（src/model-gateway，统一多供应商配置）
```

### 三条鉴权体系（并存，注意区分）

| 体系 | 用途 | 位置 |
|---|---|---|
| Cookie session | SillyTavern Web UI 登录（`/api/users/login`） | `src/users.js` |
| JWT（Bearer） | 公共 API `/api/v1/*` | `src/api-v1/auth.js` + `auth-middleware.js` |
| Leslie Bridge | 本地伴生进程（桌面/本机） | `src/leslie-bridge/` |

三种都共用同一套账号存储（`src/users.js` → node-persist，`data/_storage/`），账号的 `admin` 布尔字段是管理员判定依据。

## 3. 技术路径（我们走到哪了）

### P0–P5（重构主线，已完成）

1. **P0 清理**：移除 AIRI / 本地模型部署（`airi/`、`models/`、`src/leslie-local-model/`）；保留 `src/leslie-bridge/`（API seed）与 `src/endpoints/backends/kobold.js`（远程适配器）。
2. **P2 公共 API**：`src/api-v1/`（JWT auth、secrets、rate-limit、characters/chats/groups/worldinfo/voice/leslie）。
3. **P2.5 权威轮次**：`src/prompt-assembly/`（16 个共享模块），把浏览器拼提示词的管线提升到服务端 `/api/v1/chats/:id/generate`；`docs/authoritative-turn-spec.md` 定义契约。
4. **Phase 4 Web PWA**：token 双轨、CSP、PWA、模块拆分。
5. **Phase 5 移动端**：`apps/mobile/`（Expo + TS + RN），`src/theme.ts` 统一主题，7 个 feature 模块。

### 服务端统一模型 API（T1–T8，已完成）

把「AI 模型的 API 配置/密钥」从客户端全部收回，统一为**服务器后台配置的多供应商模型网关**：

- 客户端（Web/移动端）**不再有模型 API 配置/密钥入口**，只能在服务端「模型清单」里选模型。
- 后端 `src/model-gateway/store.js`：`PROVIDER_PRESETS`（openai/deepseek/volcengine/custom）+ `listAvailableModels()` / `resolveModelConfig()` / `getModelById()`。
- 模型密钥存**全局 secrets**（只存 key id + 掩码），`/api/v1/secrets` 已改为全局 admin-only。
- Web 聊天（legacy `/api/backends/chat-completions/generate`）通过 `model_id` 经 `resolveModelConfig` 走网关；没传 `model_id` 回退服务端默认模型。
- `/ops` 运营面板有「模型网关」配置区（供应商预设下拉 + 极简 API 清单「名称 + 显示勾选」）。

### 相关 commit（最近关键一批）

```
02b91d63a fix: prevent the register/recover links from navigating under <base href=/>
dbc2ed83a feat: simplify the ops model gateway with provider presets
5b44fc5d2 fix: make /version public so the login page can detect server mode
5fd9749a3 feat(T5): hide the Web model panel and route legacy generate through the gateway
4c626a449 feat(T7): add an editable model gateway section to the ops panel
1e92b51d3 feat(T6): add a server model catalog picker to the mobile settings
4c9746f56 feat(T4): clear personal model keys and force-ignore the per-account model block
eda12ac45 feat(T3): add GET /api/v1/models and restrict /generate to catalog model ids
cf446a786 feat(T2): resolve model_id from the server gateway in the adapter
107e3f8b9 feat(T1): add the server model gateway store and make secrets global
```

## 4. 关键设计约束（红线 + 门槛，务必遵守）

### 红线 3 文件（绝对零触碰）

```
src/endpoints/chats.js
src/endpoints/characters.js
src/prompt-converters.js
```

这三个文件必须与 `refactor-base` tag 保持 **zero-diff**。注意 `src/api-v1/routes/chats.js`（公共 API 路由）**不是**红线，可以改，别混淆。

### 字节等价 oracle（改提示词相关必须回归）

- `npm run test:prompt-baseline`：浏览器基线，必须 **9/9 byte-identical**。
- `node replay-server.mjs`：服务端 oracle，必须 **9/9 byte-identical**。

### fail-closed 清单（这些「实验性/分叉」路径一律禁止默认启用）

- WI regex、vectors、实验性 macro 引擎、不支持的 tokenizer 供应商、`/inject` filter、`leslie-reality`。

### 门槛纪律（验收必须断言退出码/计数，不 grep 信号）

- `npm run lint`、`npm run lint --prefix tests`、`npm run test:unit` 全 **exit 0**。
- 移动端 `apps/mobile`：`tsc --noEmit` exit 0。
- 每步**原子 commit**；失败用独立 commit 修复并如实披露。

## 5. 代码结构（关键目录）

```
src/
├─ server-main.js          Express 入口（中间件顺序：CORS → whitelist → accessLogger → requireLogin → /version…）
├─ users.js                账号存储 + 鉴权（requireLoginMiddleware / getPasswordHash / getAllUserHandles）
├─ endpoints/               SillyTavern 核心端点（红线在此）
│   └─ backends/chat-completions.js   模型适配器（T2 已改：按 model_id 走网关）
├─ api-v1/                 公共 API（JWT）
│   ├─ auth.js  auth-middleware.js  secrets.js  router.js
│   └─ routes/  auth/characters/chats/groups/worldinfo/voice/leslie/secrets/ops
├─ prompt-assembly/        共享提示词装配（16 模块，P2.5）
├─ model-gateway/store.js  模型网关（供应商预设 + 模型清单）
├─ leslie-moments/         朋友圈（store/activity-store/settings-store/router）
├─ leslie-bridge/          本地伴生进程 API seed
└─ electron/               Electron 桌面宿主

public/                    Web 前端（SillyTavern UI）
├─ index.html  login.html  ops.html
├─ css/dreamland-theme.css  DreamLand 主题（remake 红 #c9505b 设计系统）
└─ scripts/login.js  openai.js  script.js …

apps/mobile/               React Native + Expo SDK 57
├─ App.tsx                 EXPO_PUBLIC_API_URL 注入后端地址（默认 127.0.0.1:18790）
├─ src/theme.ts            统一主题 token
└─ src/features/{auth,characters,chat,voice,feed,home,settings}

docs/                      规划文档（roadmap.md、frontend-backend-separation-plan.md、
                           authoritative-turn-spec.md、server-managed-model-api-plan.md、本文档）
scripts/clear-personal-model-keys.mjs   清除个人密钥（dry-run 默认，--execute 执行）
```

## 6. 部署环境

| 项 | 值 |
|---|---|
| 服务器 | Ubuntu 26.04 LTS，`192.168.5.222`（hostname `dreamland-server`），6 核 / 14G 内存 |
| 运行方式 | Docker（`--network host`，端口 **8000**，`--restart unless-stopped`），容器名 `dreamland` |
| 数据 | `~/dreamland-data`（持久化），`~/dreamland-config`（config.yaml） |
| 镜像构建 | Dockerfile，基础镜像用 `docker.m.daocloud.io/library/node:lts-alpine3.23`（Docker Hub 被墙，已改镜像源） |
| 公网 | Cloudflare 隧道 → `https://dreamland.clarixe.top`（`/version` 被 CF WAF 挡是预期） |
| 管理员 | `admin` / `DreamLand@2026`（**占位密码，务必改**） |
| 模型网关 | `/ops` → 模型网关（供应商预设 + 模型清单），密钥只显掩码 |

**部署命令（Mac → 服务器）**：
```bash
# rsync（排除 node_modules/.git/data/Config/apps/mobile/tests 等）
rsync -az --delete --exclude='node_modules/' --exclude='.git/' --exclude='data/' \
  --exclude='Config/' --exclude='apps/' --exclude='mobile/' --exclude='models/' \
  --exclude='tests/' ./ leslie@192.168.5.222:~/dreamland/

# 服务器上：换镜像源 + 重建 + 重启
ssh leslie@192.168.5.222 "cd ~/dreamland && \
  sed -i 's|^FROM node:|FROM docker.m.daocloud.io/library/node:|' Dockerfile && \
  docker build -t dreamland/server:latest . && \
  docker rm -f dreamland; \
  docker run -d --name dreamland --restart unless-stopped --network host \
    -v ~/dreamland-data:/home/node/app/data -v ~/dreamland-config:/home/node/app/config \
    -e DREAMLAND_MODE=server dreamland/server:latest"
```

## 7. 当前状态

### 已完成
- P0–P5 重构主线（后端 + API + PWA + RN 移动端 + 桌面宿主）。
- 服务端统一模型网关（T1–T8）。
- 部署上线（Ubuntu + Cloudflare），局域网 + 公网可用。
- Web 主题（remake 红）、移动端主题统一。
- 登录页注册、运营面板（用户数据查看 / 账号增改 / 改密码 / 模型网关）。

### 进行中 / 待办
1. **iOS 真机验证**：已升级 Expo SDK 57，Expo CLI 已登录 `lesliehuang`；真机走 Expo Go（`exp://192.168.5.220:8081`，Metro 由本会话起）。独立 `.ipa` 需 EAS + Apple Developer。
2. **T5 遗留**：Web 聊天目前仍走 legacy 浏览器拼提示词路径（已接模型网关）；切到 `/api/v1/chats/:id/generate` 权威轮次是「以后的大改」，未做。
3. **P6 多租户 / 计费**：未开始。
4. **Windows 桌面安装包**：未做。
5. **个人密钥清除**：`scripts/clear-personal-model-keys.mjs` 已在服务器跑过（--execute），账户模型字段已清空。

### 已知坑（接手时注意）
- `~/.expo` 写入需要 `danger-full-access` 沙箱权限（Metro / expo login 都要）。
- Docker 部署必须 `--network host`，否则白名单会 403（桥接网络隐藏真实客户端 IP）。
- `login.html` / `index.html` 有 `<base href="/">`，任何 `href="#"` 链接都要 `preventDefault()`，否则会整页跳走（已修注册/忘记密码链接）。
- `/version` 必须保持在 `requireLoginMiddleware` 之前（登录页靠它判断 server 模式）。
- 密钥/密码/私聊内容**绝不回显明文**（已落实：ops 只显掩码、聊天只报元数据、设置只报计数）。

## 8. 给二次开发 agent 的建议

1. 动手前先读 `README.md`、`docs/project-overview.md`、`docs/roadmap.md` 和本文件。
2. 改提示词/聊天相关，先跑 `test:prompt-baseline` + `replay-server.mjs` 确认字节一致。
3. 每次提交后自检：`git diff refactor-base -- src/endpoints/chats.js src/endpoints/characters.js src/prompt-converters.js` 必须为空。
4. 模型相关改动都收敛到 `src/model-gateway/`，别在 `src/endpoints/` 里散落模型配置。
5. 数据在 `data/<handle>/` 下：characters/（角色卡）、chats/（.jsonl）、group chats/、User Avatars/（角色图）、settings.json、worlds/、vectors/；朋友圈在 `src/leslie-moments/`。
6. 环境变量：`DREAMLAND_MODE`、`DREAMLAND_PORT`、`DREAMLAND_DATA_ROOT`、`DREAMLAND_LISTEN`、`DREAMLAND_WHITELIST_MODE`、`DREAMLAND_SECRET_*`、`EXPO_PUBLIC_API_URL`（移动端后端地址）。
