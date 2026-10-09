# DreamLand 前后端分离重构 —— 自动执行规范（Autonomous Execution Spec）

> **本文件是给「AI 编码 Agent」（如 DeepSeek-Flash）直接照做的自包含执行规范。**
> 使用方式：把本文件地址发给 Agent，并附一句：*“按该文件逐 Phase 执行，每完成一个 Phase 按文末『报告格式』输出并停下等待我确认。”*
>
> 配套方案：[frontend-backend-separation-plan.md](frontend-backend-separation-plan.md)

---

## 0. 元指令（Agent 必读，先于一切）

### 0.1 你的角色与执行方式
- 你是**自主执行本规范的编码 Agent**。按 Phase 0 → 5 顺序执行；**每完成一个 Phase 就停止并输出报告，等待人工确认后再进入下一 Phase**（除非人工已明确说“连续执行到 Phase N”）。
- 一个 Phase 内包含多个任务（task）。**每完成一个 task 都要跑验证命令**，通过后再做下一个 task。

### 0.2 环境与前置
- 仓库根目录：包含 `server.js`、`package.json`、`src/`、`public/` 的那个目录。开工先执行 `pwd` 并 `ls` 确认。
- 运行要求：Node.js >= 20，npm，git。首次执行：
  ```bash
  node -v && npm -v && git status
  npm ci   # 仅在 node_modules 缺失或 package-lock 变化时
  ```
- 本项目是 ESM（`"type": "module"`），脚本用 `import/export`。

### 0.3 必读文件（动手前）
`README.md`、`docs/project-overview.md`、`docs/roadmap.md`、`docs/frontend-backend-separation-plan.md`、本文件。

### 0.4 数据安全红线（违反即判定失败）
- `data/`、`Config/`、`Runtime/`、`Cache/`、`Run/`、`logs/`、`backups/`、`notes/private/` 是本地用户数据，**只读不提交**。
- **绝不提交/打印**：角色卡、聊天记录、密钥、Cookie、记忆、语音、真实人物素材。
- 测试只用合成 fixture。

### 0.5 验证命令（task 后必跑；跑不过就修，禁止跳过）
```bash
npm run lint          # 源码/前端脚本 lint
npm run test:unit     # 单元测试
npm run check:repo    # 仓库卫生（数据/文件边界）
```
Phase 收尾全量：
```bash
npm run validate      # = check:repo + lint + lint(tests) + test:unit
```

### 0.6 提交规范
- 一个小改动 = 一个提交，消息用 `feat:` / `refactor:` / `fix:` / `chore:`。
- 只推送项目自己的 `origin`；**绝不新增/推送到 SillyTavern / AIRI 上游 remote**。
- 改动项目状态时同步更新 `docs/roadmap.md` 或 `CHANGELOG.md`。

### 0.7 停止并询问的条件
出现以下情况**立即停止并报告**，不要自行臆断：
1. 删除/改动会触及 `src/endpoints/chats.js`、`characters.js`、`prompt-converters.js` 的**存储格式或兼容性**。
2. 找不到某个文件/挂载点，或 grep 结果与本文档描述不符。
3. 某条验证命令反复失败且原因不明。

---

## Phase 0 —— 基线与裁剪（砍 AIRI + 本地模型部署）

**目标**：锁定后端核心；移除 AIRI 与本地模型托管；产出 API 清单；建立自有 Linux 镜像。

### Task 0.1 建立基线
- [ ] 执行：
  ```bash
  git status
  npm ci
  npm run validate        # 记录基线结果；若本就有失败，先记录不动，不在本 task 修复
  ```
- [ ] 建立回退点：
  ```bash
  git checkout -b refactor/execution
  git tag refactor-base   # 若 tag 已存在则跳过
  ```
- [ ] 阅读 `src/server-main.js`、`src/server-startup.js`，在阶段笔记里记录：中间件顺序、路由挂载前缀、鉴权位置。笔记放 `notes/` 或临时文件（不提交数据）。

### Task 0.2 裁剪「本地模型托管」（保留 KoboldCpp *远程*适配器）
> 原则：删除的是“**本机启动/停止托管 KoboldCpp**”能力，**保留** `src/endpoints/backends/kobold.js`（远程 KoboldCpp 适配器）。

- [ ] 定位所有引用：
  ```bash
  grep -rniE "leslie-local-model|local-model|localModel|GGUF|gguf|managed.?kobold|KoboldCpp" \
    src/ public/ default/ docs/ mobile/ README.md README.en.md package.json \
    --exclude-dir=node_modules --exclude-dir=nodebridge
  ```
- [ ] 删除目录 `src/leslie-local-model/`（`git rm -r src/leslie-local-model`）。
- [ ] 在 `src/server-startup.js` 删除：
  - import 行：`import { router as leslieLocalModelRouter } from './leslie-local-model/router.js';`
  - 挂载行：`app.use('/api/leslie/local-model', leslieLocalModelRouter);`
- [ ] 在 `src/electron/` 删除本地模型托管逻辑：`local-model-catalog.js`、`local-services.js` 中「启动/停止托管 KoboldCpp」部分（`index.js` 中相关 IPC 调用一并删）。
- [ ] 清理前端本地模型 UI：`public/scripts/leslie-local-model-core.js`、`leslie-connection-state.js`、`leslie-connection-state-core.js`、`leslie-settings.js`、`leslie-mobile-client.js` 中的“本机启动模型”入口；**保留**“连接远程 KoboldCpp/自托管地址”能力。
- [ ] 删除 `models/` 目录及 `models/README.md`；清理 `default/config.yaml`、README、docs 中本地模型/GGUF 文案。
- [ ] 验证：
  ```bash
  npm run lint && npm run test:unit && npm run check:repo
  ```

### Task 0.3 裁剪 AIRI（**保留 `src/leslie-bridge/` 作为 API 种子**）
> ⚠️ **不要整体删除 `src/leslie-bridge/`**。它是 Phase 2 公共 API 的种子，只删 AIRI 专属的 companion 部分。

- [ ] 定位所有引用：
  ```bash
  grep -rniE "airi|companion|leslie-bridge" src/ public/ docs/ mobile/ README.md README.en.md package.json \
    --exclude-dir=node_modules --exclude-dir=nodebridge
  ```
- [ ] 删除 AIRI 应用子树：`git rm -r airi/`。
- [ ] 删除 Electron 里 AIRI 启停：`src/electron/index.js`、`src/electron/local-services.js` 中 AIRI 相关 IPC/逻辑。
- [ ] 删除 `src/leslie-bridge/router.js` 中 AIRI 专属路由：`/companion/state`、`/companion/audio/speech`、`/companion/audio/transcriptions`；删除仅服务于 companion 的 `companion-request.js`、`companion-session.js`（先确认无其它引用）。
- [ ] **保留** `src/leslie-bridge/` 的 `auth.js`、`protocol.js`、`errors.js`、`model-chat.js`、`openai-audio.js`、`router.js` 中 `/health`、`/capabilities`、`/chat/completions`、`/model/chat/completions`、`/audio/speech`。
- [ ] 删除文档 `docs/airi-bridge.md`、`docs/airi-launcher.md`、`docs/airi-live2d-hiyori-analysis.md`；清理 README、`docs/project-overview.md`、`docs/roadmap.md` 中 AIRI 表述。
- [ ] 验证：
  ```bash
  npm run lint && npm run test:unit && npm run check:repo
  ```

### Task 0.4 遗留引用检测（必须全绿）
```bash
# 期望：无命中（若命中，逐条处理：删除或加入下方允许清单并写清理由）
grep -rniE "airi|leslie-local-model|managed.?kobold|local-model" \
  src/ public/ default/ docs/ mobile/ README.md README.en.md package.json \
  --exclude-dir=node_modules --exclude-dir=nodebridge
```
- [ ] 允许清单（除此之外必须为 0 命中）：无。
- [ ] 记录检测结果到阶段报告。

### Task 0.5 API 清单
- [ ] 遍历 `src/endpoints/*.js` 与 `src/leslie-*/router.js`，产出 `docs/api-inventory.md`，至少包含每项：挂载前缀、主要 HTTP 方法、是否要求登录、对应源文件。
- [ ] 提交该文档。

### Task 0.6 自有 Linux 镜像
- [ ] 修改**根目录 `Dockerfile`**（`docker/` 下只有 compose/entrypoint/build-lib，无 Dockerfile）、`docker/docker-compose.yml`、`docker/docker-entrypoint.sh`：把镜像名/服务名 `ghcr.io/sillytavern/sillytavern` / `sillytavern` 改为本项目自有命名（如 `dreamland/server`）。
- [ ] 确认镜像构建产物不含 `airi/`、`src/electron/`、`src/leslie-local-model/`、`models/`、`mobile/android`。
- [ ] `docker build -f Dockerfile -t dreamland/server:dev .` 成功；按 `docker/docker-compose.yml` 起容器，`curl http://localhost:8000/version` 返回 JSON。

### Phase 0 完成标准（全部满足才算完成）
1. `npm run validate` 通过。
2. 遗留引用检测无命中（Task 0.4）。
3. `docker build` 成功且健康检查 200。
4. `docs/api-inventory.md` 已提交。
5. 聊天核心未改：`src/endpoints/chats.js`、`characters.js`、`prompt-converters.js` 及 JSONL 格式零改动（在报告中确认）。

---

## Phase 1 —— 后端可公网部署（Linux + TLS + env）

**目标**：同一后端核心在无 Electron 的 Linux 上稳定安全运行。

### Task 1.1 去桌面假设（模式门控）
- [ ] 引入运行模式：环境变量 `DREAMLAND_MODE=server|desktop`（默认 `server`），在 `src/command-line.js` 解析并挂到 `globalThis`。
- [ ] 在 `src/server-main.js` / `src/server-startup.js` 中，将「浏览器自动拉起、托盘、桌面退出封存、本地模型启停」改为**仅 `desktop` 模式启用**；`server` 模式默认关闭。
- [ ] 验证：`DREAMLAND_MODE=server npm run start` 启动不尝试打开浏览器、不触发 Electron。

### Task 1.2 配置 12-factor 化
- [ ] 在 `src/command-line.js` 或新增 `src/config-env.js`：`dataRoot`、`port`、`listen`、`whitelistMode`、`cors.*`、密钥来源支持环境变量 `DREAMLAND_*`，优先级高于 `default/config.yaml`。
- [ ] 服务器模式密钥改从环境变量/挂载 secret 读取，不依赖仓库内 `config.yaml` 明文。
- [ ] 更新 `README.md` 增加环境变量清单表。

### Task 1.3 容器与 TLS
- [ ] `Dockerfile`：`USER node` 非 root + `tini`；`docker-compose.yml` 挂载 `config/`、`data/`、`plugins/` 卷。
- [ ] 新增反向代理配置（Caddy 或 Nginx，任选其一，写进 `docker/` 或 `deploy/`）：终止 TLS、转发到容器 8000。
- [ ] 验证：经反代 HTTPS 访问 `/version` 成功；`npm run validate` 通过。

### Phase 1 完成标准
1. `DREAMLAND_MODE=server` 下无任何桌面/Electron 依赖被触发。
2. 环境变量可覆盖关键配置，密钥不落 `config.yaml` 明文。
3. HTTPS 反代可访问 `/version`。
4. `npm run validate` 通过。

---

## Phase 2 —— 公共 API v1 + Token 认证（核心）

**目标**：产出 App/Web 可长期依赖的版本化 API；**不重写业务逻辑**。

### Task 2.1 建立 `/api/v1` 骨架
- [ ] 以 `src/leslie-bridge/` 为蓝本，新建 `src/api-v1/`，挂载前缀 `/api/v1`；沿用 `/health`、`/capabilities`、SSE 流式、OpenAI 兼容错误结构。
- [ ] 在 `src/server-main.js` 挂载（与 `/api/leslie/bridge/v1` 并存或替代，二选一并在报告说明）。

### Task 2.2 OpenAPI 契约
- [ ] 产出 `docs/contracts/api-v1.openapi.yaml`，至少覆盖：账户、角色卡、聊天、群聊、WorldInfo、记忆、朋友圈、语音、工坊、群聊编排。

### Task 2.3 Token 认证（与旧 cookie 双轨）
- [ ] 新增 `src/api-v1/auth-middleware.js`：JWT access + refresh；OAuth2 密码模式 + PKCE（第一方 App）。
- [ ] 让 `/api/v1` 走新中间件；旧 Web 桌面版继续走 cookie-session（双轨共存，迁移期互不影响）。
- [ ] 新增账户接口（注册/登录/刷新/登出），复用 `src/users.js` 的账户存储，不重写。

### Task 2.4 适配层（复用 handler，不复制业务）
- [ ] 把现有 handler 挂到 v1：`characters/chats/groups/worldinfo/memory/moments/identity/tts/工坊/群聊编排`——调用现有导出函数。
- [ ] 流式统一：固化 SSE 字段 + `X-Accel-Buffering: no`；写最小客户端样例验证流式接收。

### Task 2.5 密钥接口抽象
- [ ] `src/endpoints/secrets.js` 抽成 `getSecret/setSecret` 接口；服务器模式用加密存储（测试期可用文件加密或环境变量），客户端只拿 key-id，**不下发明文**。

### Task 2.6 限流
- [ ] 用 `rate-limiter-flexible`（已在依赖）给 `/api/v1` 加基础限流 + 每账户配额。

### Task 2.7 测试
- [ ] 新增单元测试：认证成功/失败、令牌过期、资源归属隔离（A 不能读 B）。

### Phase 2 完成标准
1. `/api/v1` 跑通「注册→登录→建角色→发消息→SSE 收回复→TTS 语音」全链路（可用 mock 模型）。
2. 旧 Web 桌面版 cookie 路径不受影响。
3. 密钥明文不下发客户端。
4. `npm run validate` 通过。

---

## Phase 3 —— 桌面双目标打包（“一举两得”落地）

**目标**：同一源码产出「服务器版」与「桌面版」两个产物。

### Task 3.1 精简 Electron 为纯桌面宿主
- [ ] `src/electron/` 只保留：托盘、自动启动、退出封存；确认已无 AIRI/本地模型控制（P0 已删，此处复核）。

### Task 3.2 平台注入接口
- [ ] 抽两个接口：**密钥存储**（服务器版=服务端加密/环境变量，桌面版=DPAPI/本地文件）、**数据根**（服务器版=卷/对象存储，桌面版=本地目录）。
- [ ] 核心代码只依赖接口，不在业务里散落 `if (process.platform)`。

### Task 3.3 两个打包脚本
- [ ] `npm run build:server` → ①+②（无 Electron）→ Linux 容器镜像。
- [ ] `npm run build:desktop` → ①+②+④ → Electron 安装包（沿用 `packaging/` 与 `src/electron/`）。
- [ ] 回归测试：确认两版共用同一 `public/`。

### Phase 3 完成标准
1. 两个产物都能启动并完成一次聊天（可 mock）。
2. 服务器镜像无 Electron 依赖；桌面端可用。
3. 平台分支集中在接口实现层，业务层无散落分支。
4. `npm run validate` 通过。

---

## Phase 4 —— Web 前端解耦为 PWA

**目标**：Web UI 变独立客户端；公网 Web 走 Token，桌面版沿用 Cookie。

- [ ] Web 端支持 Token 鉴权：`DREAMLAND_MODE=server` 时登录页走 `/api/v1` Token；`desktop` 模式沿用 cookie 登录。
- [ ] 补 PWA service worker（离线壳，不缓存聊天数据）；`manifest.json` 已存在，补齐字段。
- [ ] CSP/CORS 收紧：`src/server-main.js` 中 `helmet` 的 `contentSecurityPolicy: false` 改为显式策略；CORS 仅允许配置源。
- [ ] 按 roadmap 拆分巨型模块：优先 `public/scripts/chats.js`、`leslie-settings.js`（行为不变，只拆分）。
- [ ] 验证：双登录路径都能完成一次聊天；PWA 可安装；`npm run validate` 通过。

---

## Phase 5 —— React Native App

**目标**：基于 `/api/v1` 交付首版 iOS/Android 客户端（RN 先行，为后期原生化留分层）。

- [ ] 新建 `apps/mobile/`（推荐 Expo）：
  ```bash
  npx create-expo-app@latest apps/mobile --template blank-typescript
  ```
- [ ] 旧 `mobile/android`（WebView）标记为停用/归档（在 `mobile/README.md` 注明），暂不删除以免影响现有构建参考。
- [ ] 先做「API 客户端 + 领域类型」共享层（对接 `/api/v1`），**与 UI 组件彻底解耦**。
- [ ] 按功能模块组织：`auth / chat / characters / memory / moments / voice / settings`。
- [ ] 核心闭环：登录/注册 → 角色列表 → 聊天（SSE 流式 + 打字机）→ TTS 播放 → 记忆/朋友圈只读初版。
- [ ] 验证：iOS + Android 模拟器各跑通一次流式聊天 + 语音；SSE 无丢字。

### Phase 5 完成标准
1. 双端 App 能登录并完成一次流式聊天 + 语音。
2. API 客户端层独立可复用，与 UI 解耦。

---

## Phase 6 —— 多租户、计费与运维（**测试期暂缓，人工明确要求后再做**）

- [ ] 账户→租户模型（`src/users.js` 加租户维度 + 管理台视图）。
- [ ] Redis 会话/缓存；BullMQ 迁出 Moments/记忆进程内 worker。
- [ ] 热状态入 PostgreSQL；聊天历史继续 JSONL。
- [ ] 用量计量 + 配额 + 订阅（商用前）。
- [ ] 可观测性、备份恢复演练、密钥轮换。
- [ ] 合规（商用前）：AGPL 源码提供、内容分级/年龄门控、数据删除/导出。

---

## 附 A：执行顺序与依赖

```
P0（基线+裁剪）──▶ P1（公网部署）──▶ P2（API v1+认证）──┬─▶ P3（桌面双目标，可并行）
                                                      ├─▶ P4（Web 解耦，可并行）
                                                      └─▶ P5（RN App，可并行）
                                                           │
                                                           └─▶ P6（暂缓）
```
- P0 → P1 → P2 **串行**；P2 的 API 契约冻结后，P3/P4/P5 **可并行**；P6 **暂缓**。

---

## 附 B：遗留引用检测（每个 Phase 结束都跑一次）

Phase 0 已确立**允许清单**，以下不算残留：
- 保留的「连接用户自托管端点」能力沿用 `local-model` 命名：`public/scripts/leslie-local-model-core.js`（连接配置 + 门控 + 偏好键 `leslie-local-model-loading-enabled`）、`leslie-settings.js` 连接卡片、`public/css/leslie-local-model.css`。
- tokenizer 词表 / 二进制资源里的 `airi`、`pairing` 等字节误报。

```bash
# 1) 目录级：以下必须不存在
test ! -d airi && test ! -d models && test ! -d src/leslie-local-model && echo "DIRS-OK"

# 2) 硬删除项 grep：期望无命中
grep -rniE "leslie-local-model/router|local-model-catalog|managed.?kobold|Start-LocalModel|Stop-LocalModel|Leslie-AIRI|airi-bridge|airi-launcher" \
  src/ public/ default/ docs/ mobile/ README.md README.en.md package.json \
  --exclude-dir=node_modules --exclude-dir=nodebridge || true
```

---

## 附 C：每 Phase 完成后的报告格式（Agent 必须严格按此输出）

```markdown
## Phase X 执行报告

### 1. 改动文件清单
- [新增/修改/删除] path/to/file —— 一句话说明

### 2. 验证结果
- npm run lint: <通过/失败，粘贴关键输出尾部>
- npm run test:unit: <通过/失败>
- npm run check:repo: <通过/失败>
- npm run validate: <通过/失败>
- 遗留引用检测: <0 命中 / 命中清单>

### 3. 聊天核心是否被改动
- 明确说明 src/endpoints/chats.js、characters.js、prompt-converters.js、JSONL 格式是否有任何改动（应为“无”）。

### 4. commit 信息
- <commit hash> —— <commit message>

### 5. 未完成项 / 风险 / 需要人工决策
- ...
```

---

## 附 D：给执行 Agent 的硬约束速查（红线）

1. **禁止**整体删除 `src/leslie-bridge/`（只删 companion 专属部分）。
2. **禁止**删除 `src/endpoints/backends/kobold.js`（远程适配器）。
3. **禁止**改动 `src/endpoints/chats.js`、`characters.js`、`prompt-converters.js` 与 JSONL 存储格式、Swipe/WorldInfo/群聊兼容。
4. **禁止**提交 `data/`、`Config/`、密钥、聊天记录、真实素材。
5. **禁止**跳过验证命令；**禁止**在一个 task 未通过验证时继续下一个 task。
6. **禁止**新增/推送 SillyTavern / AIRI 上游 remote。
7. 遇到与本文档描述不符、或会触及红线的情况，**停下并报告**，不要自行发挥。

---

## 附 E：Phase 0 裁决记录（Lead 已决，Phase 1 起按此执行）

- **D2**：`leslie-bridge` 的 companion 轮次 `POST /chat/completions` 已删除（依赖被删的 `companion-session/request`，无法保留）；保留语义等价的 OpenAI 兼容网关 `POST /model/chat/completions`。✅ 采纳。
- **D4（遗留检测）**：采纳**方案 A（允许清单）**。`local-model` 命名是「连接用户自托管端点」的保留能力，与新版 AGENTS.md（“只连接、不托管本地模型”）一致；**不做方案 B 改名**（涉及持久化偏好键迁移 + 触及聊天管线）；**不做方案 C 删除**（会移除保留能力）。§附 B 已按此重写。
- **D6**：`docs/team-plan.md` 是 Lead 在规划会话中创建的产物，非外来文件，已提交。
- **D1**：容器构建验证延后至有 Docker 运行时的主机执行，不影响代码合入。
- **D7**：`npm run test:e2e --prefix tests` 延后到 Phase 1 前补跑；Electron 依赖安装（`.npmrc ignore-scripts`）到 Phase 3 再处理。
