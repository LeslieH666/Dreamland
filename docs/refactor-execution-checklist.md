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

---

## 附 F：Phase 1 裁决记录（Lead 已决，Phase 2 起按此执行）

- **D2（e2e 既有失败）**：`tests/leslie-settings.e2e.js` 4 处 `.leslie-sidebar-actions [data-action="settings"]` 是**既有测试漂移**（`leslie-theme.js` 自基线未改；`dreamland-pages.css:8` 在 dreamland 设计语言下隐藏该选择器），与重构无关。**现在修复**（仅改测试、不动应用代码）：把 4 处选择器改为 `.dreamland-navigation [data-action="settings"]`（对齐已通过的 `leslie-user-preferences.e2e.js`），随后重跑 e2e 确认全绿。
- **D3（非 root 取舍）**：**保留 `USER node`（uid 1000）非 root**。公网后端以非 root 为安全基线；bind mount 属主 `chown -R 1000:1000` 属一次性运维步骤，已在 Dockerfile/compose/README 写明。不接受回退到 root + su-exec。
- **D1（容器链路）**：仍延后到有 Docker 的主机/CI 实跑（`docker build` + `docker compose -f deploy/docker-compose.tls.yml up -d` + `curl https://$DOMAIN/version`）；不阻塞 Phase 2/3，但**上线前必须闭环**。
- **D4**：明文密钥告警属正向信号，保留；反代下 IP 白名单用「Caddy 精确匹配 + TLS + 可选 Basic 认证」兜底，取舍已记录，接受。

---

## 附 G：Phase 2 裁决记录（Lead 已决，Phase 3 起按此执行）

- **D1（`/chats/{id}/generate` 网关模式）**：**接受方案 (a) 作为 Phase 2 的过渡契约**；但这是本项目最重要的架构发现——**提示词组装（角色卡/World Info/Persona/记忆）目前只在浏览器 `public/script.js`**（`Generate` + `getWorldInfoPrompt` + `prepareOpenAIMessages`），服务端 `src/` 零引用。**新增「Phase 2.5 服务端提示词组装（authoritative turn）」，作为 Phase 5（RN App）前的强制前置**：把浏览器提示词管线移植到服务端，使后端对“完整聊天轮次”权威，Web/RN 都退化为薄客户端。**明确否决方案 (c)**（RN 自己组装提示词）——会造成多客户端逻辑重复与漂移，违背“单一事实来源”。
- **D2（5 个 501 操作）**：**接受 Phase 2 内保持 501**，不阻塞核心聊天 MVP。授权后续（非阻塞）通过「在非红线文件**新增导出**」或「移植浏览器逻辑」补齐，优先级：**Swipe 重生成 > 朋友圈发帖 > World Info 增删改 > 工坊生成 > 头像写**。“红线冻结”指**不得改变既有行为/存储格式**；**新增导出（不改既有逻辑）是允许的**，须带测试。
- **D3（契约新增 `/auth/pkce` + `/secrets`）**：**接受**。两者分别是 RFC 7636 PKCE 与 Task 2.5 密钥抽象的必需端点。
- **D4**：`/capabilities` **维持需鉴权**（客户端先登录再发现能力，避免向匿名者暴露特性；D7 的域级细化留到 RN 需要时）。`GET /worldinfo` 返回全部书目（服务端无聊天上下文、激活在客户端）——接受。
- **D5/D6**：refresh token 内存态 + 限流进程内，接受（与 P6 Redis 延后一致）；测试期服务重启会登出客户端，可接受。
- **D7**：`/capabilities` 域级细化、`EXPOSABLE_SECRET_KEYS` 扩展，延后到 RN 需要时。

---

## 附 H：Phase 3 裁决记录（Lead 已决，下一步按此执行）

- **D1（`characters.js:35` 的 `process.platform==='android'`）**：**保留不动**。它是 Android 内存策略的运行时能力判断，与桌面/服务器分离无关，且位于红线冻结文件；为“平台分支清零”去触碰它不划算。作为已记录的例外接受。
- **D2**：Electron 依赖安装闭环（`allowScripts` 放行 + 缓存重定向），CI 需可写缓存目录——接受。
- **D3**：安装包生成仍依赖 Windows PowerShell，与容器链路同性质延后——接受，桌面发行前在 Windows 主机闭环。
- **D4**：`getPlatform()` 早于参数解析读配置导致的宿主启动崩溃，已用 `isConfigPathSet()` 守卫修复——接受，属真实修复。
- **D5**：`verify:targets` 不并入 `validate`（避免在有 Docker 的机器误触发构建），改为 CI 强制——接受；生产必设 `DREAMLAND_SECRET_ENCRYPTION_KEY` 已在 README 提示。
- **下一步排序**：**先做 Phase 2.5（服务端提示词组装），再做 Phase 4/5**。理由：Phase 2.5 是 Phase 5（RN App，主前端）的强制前置，且风险最高、最贴聊天核心，应尽早单独、谨慎推进。

---

## Phase 2.5 —— 服务端提示词组装（authoritative turn）

> **状态**：Phase 5（RN App）前**强制前置**；在 Phase 3 之后执行。
> 目标：把浏览器侧提示词组装（角色卡 / World Info / Persona / 记忆 / 群聊）移植到服务端，使后端对“完整聊天轮次”权威，Web/RN 都退化为薄客户端。
> **红线**：不改 JSONL/聊天核心格式、不改 SillyTavern 行为；产出提示词必须与现有浏览器组装**逐字等价**（用回归夹具证明）。

### 2.5.1 盘点（不写业务代码）
- [ ] 定位并列出浏览器侧组装入口与依赖：`public/script.js` 的 `Generate`、`getWorldInfoPrompt`、`prepareOpenAIMessages`，以及 Persona / 记忆 / World Info / 群聊 / Swipe 注入点。
- [ ] 输出 `docs/prompt-assembly-map.md`：每个函数 → 数据依赖（settings / power_user / chat / character / world_info / personas / memory）→ 输入输出。
- [ ] 确认哪些依赖在服务端可从 `request.user.directories` 等价取得（同一 JSON/JSONL 文件），哪些是浏览器独有（需移植或改为服务端状态）。
- [ ] **零代码改动**；提交仅此文档。

### 2.5.2 抽取为共享模块（保持 web 行为不变）
- [ ] 把组装逻辑抽到可被 `src/` 与 `public/scripts/` 共同引用的同构模块（先决定放置位置与浏览器打包方式，并在报告说明）。
- [ ] 浏览器仍先调用共享模块（`public/script.js` 改为薄调用），**行为与输出零变化**。
- [ ] 验证：`npm run validate` 通过；浏览器聊天冒烟输出与之前一致。

### 2.5.3 服务端接 `/generate`（权威轮次）
- [ ] `/api/v1/chats/{id}/generate` 改为调用共享模块组装完整提示词（角色卡/World Info/Persona/记忆/群聊），经既有模型代理流式返回；**旧浏览器路径与网关模式仍可用**（双轨）。
- [ ] 保留契约里 `messages` 透传作为高级/降级能力。

### 2.5.4 回归证明（逐字等价）
- [ ] 建合成夹具语料（角色卡 + World Info + Persona + 记忆 + 群聊 + Swipe 各若干）。
- [ ] 对同一夹具，比对「浏览器组装」与「服务端组装」产出的最终 messages/提示词**逐字一致**（写自动化断言）。
- [ ] `npm run validate` 通过；聊天核心 diff 仍为空。

### 2.5.5 切换与收口
- [ ] 更新契约：`/generate` 文案由“网关模式”改为“权威轮次”。
- [ ] RN/后续客户端统一走服务端 `/generate`；浏览器 legacy 路径保留至 Phase 4 收口后再择机退役。

### Phase 2.5 完成标准
1. 服务端 `/generate` 能组装与浏览器**逐字等价**的完整提示词（夹具断言通过）。
2. 聊天核心（chats/characters/prompt-converters）diff 为空；JSONL/Swipe/WorldInfo/群聊兼容不变。
3. `npm run validate` 通过。
4. 契约已标注“权威轮次”。

---

## 附 I：Phase 2.5.1 盘点裁决（Lead 已决，2.5.2 按此执行）

盘点文档 `docs/prompt-assembly-map.md` 已审核。Q1–Q8 裁决：

- **Q1（方案）**：**接受方案 A**（`src/prompt-assembly/` 同构纯模块 + 两侧薄适配，含把 `public/script.js` 组装段改为显式入参的薄调用）。否决 B（复制必然漂移）、C（服务端 import public 脚本因 DOM 依赖不可行）。
- **Q2（范围）**：**Phase 2.5 只做 CC 族（chat completions）**；TC 族（kobold/novel/TGW/horde 的 text completions）作为后续独立任务。理由：产品仅代理云端 API（OpenAI/DeepSeek/火山）全走 CC；TC 只服务自托管 text-gen 端点，非当前主路径。→ 大幅缩小移植面（跳过 §3 的 30 步 TC 管线）。
- **Q3（拦截器/filter）**：**服务端自行实现拦截器阶段**（共享模块保留等价钩子位置），**否决“客户端上报”**（削弱权威 + 信任边界）。`filter` 闭包（唯一注册者 `/inject`）**不移植**。`leslie-reality` 替换式流水线**单独延后**（自建整条消息，语义不同）；`leslie-memory`/`leslie-reply-style` 拦截器随 2.5 主体移植（本质是“静态注册 + 动态上下文合并”）。
- **Q4（向量/数据银行/`/inject`）**：**接受不移植**，文档化边界。核心聊天 MVP 不依赖向量/运行期注入。
- **Q5（WI 随机 + timedWorldInfo 写回）**：**允许服务端写回 `chat_metadata.timedWorldInfo`**（服务端本就是权威持久化方；只写 metadata 首行，不改 JSONL 正文格式）。**断言用可注入随机种子**：WI 概率的 `Math.random` 换成可注入 RNG，测试注入固定 seed、生产用真随机；等价断言在相同 seed 下做。
- **Q6（事件）**：**接受不复刻、仅文档化边界**（树内 0 订阅者；第三方订阅属边界，声明其不在服务端权威轮次生效）。
- **Q7（逐字等价范围）**：**“未触发预算裁剪时逐字一致”为硬标准**（含空白/换行/顺序/槽位）；**触发裁剪时**要求同款 tokenizer（服务端 `/api/tokenizers`）+ 同算法 + 语义等价，逐位一致作为目标、tokenizer 实现差异可文档化。
- **Q8（图片 fetch）**：**Phase 2.5 不代抓**。多模态/视觉为后续独立任务；非 data URL 的服务端 fetch 涉及 SSRF，需单独安全评审。客户端仍可上传 data URL。

**2.5.2 落地关键安全约束**：
1. **先建基线夹具、再重构**：改任何代码前，先对一组合成输入（角色卡 + WI + Persona + 记忆 + 群聊 + Swipe + 各 type）**录制浏览器当前产出**作为逐字等价基线；否则重构后无对照物。
2. **按 §13 的 7 步逐函数抽取，每步都跑“浏览器行为不变”验证**，禁止一次性铺开。
3. 抽取后的模块必须是**纯函数**（显式入参、不原地改入参、无 DOM/模块级状态依赖）；`prepareOpenAIMessages` 的原地 `shift/reverse` 改为入参复制。
4. 红线照旧：`src/endpoints/chats.js`、`characters.js`、`prompt-converters.js` diff 为空。

---

## 附 J：Phase 2.5.2 的 CC 专属 7 步分解（Lead 已确认）

2.5.2 按下列 CC 专属步骤逐函数抽取；每步门槛 = `npm run test:prompt-baseline` 8/8 逐字一致 + lint/test:unit/check:repo：

1. `getExtensionPrompt` 筛选/字典序/拼接（保留 async `filter` 语义）
2. 宏引擎 `substituteParams` 适配层（显式入参，与 `power_user.experimental_macro_engine` 同款）
3. token 计数适配层（服务端 `/api/tokenizers` 对齐；按 Q7，逐字影响仅在触发裁剪时出现，本步做“同款 tokenizer + 同算法”功能校验）
4. World Info 激活 `checkWorldInfo`（注入 RNG 种子）
5. 注册表与顺序：`sanitizeServiceSettings` + `getPromptCollection` + `preparePromptsForChatCompletion`
6. `populateChatCompletion` + `populationInjectionPrompts` + `populateChatHistory` + `populateDialogueExamples`（去原地 `shift`/`reverse`）
7. `prepareOpenAIMessages` 薄编排 + 拦截器钩子（仅 memory/reply-style）+ 两处 DOM 读取改入参

**执行节奏**：先做第 1–2 步并**停下中段检查**（Lead 审“逐字一致”证据后再放行 3–7）；禁止一次性铺开。

---

## 附 K：Phase 2.5.2 第 1–2 步中段审查（Lead 已决，3–7 步按此执行）

- **§5.1（浏览器引用选型）**：**接受 `/prompt-assembly` 只读静态挂载**。调查正确：`public/script.js` 非 webpack 产物，webpack alias 与相对路径均不可行；挂载 `src/prompt-assembly/`（纯逻辑、无密钥、公开可读与 `public/scripts/**` 同级）是最小可行方案。保留 `index:false + fallthrough:false`；第 3 步补一条断言 `/prompt-assembly/extension-prompts.js` 返回 200 的单元测试。
- **§5.2（filter 实为空操作）**：**保留现有 no-op 语义，不修**。async 谓词传入 `Array.filter` 恒真属既有行为；唯一注册者 `/inject` 按 Q4 不在服务端范围，无实际影响。作为“已知遗留怪癖”记录，不做行为变更。
- **§5.4（实验宏引擎无法抬升）**：**服务端 Phase 2.5 只支持 legacy 宏引擎**；实验引擎 `substituteParamsExtended`/`MacroEngine` 因宏定义 import 浏览器模块而保持浏览器独占，服务端命中时**抛错（fail-closed）而非静默降级**。作为已知限制文档化，若 RN 端确需实验引擎再单独立项移植其定义。
- **放行 3–7 步**：每步门槛不变（`test:prompt-baseline` 8/8 + lint/test:unit/check:repo + 红线 diff 为空）。**第 4 步（World Info 激活）是最后一个硬输入**：若出现“需行为取舍才能逐字一致”的差异，停下报告，不要为了凑逐字一致而偷偷改行为。

---

## 附 L：Phase 2.5.2 第 4 步停止点裁决（Lead 已决，4–7 步按此执行）

第 4 步发现的三个分叉源（WI 正则、`WORLDINFO_SCAN_DONE` 监听者、vectors 强制激活）属实。裁决：

- **Q-a（逐字一致范围）**：选 **(i) 夹具范围逐字一致 + 文档化分叉**。**不**移植 WI 正则引擎、**不**移植 vectors 激活路径（不推翻 Q4）。这三个分叉源 + 实验宏引擎（附 K）统一记为「**未复刻的高级/可选能力**」。
- **Q-b（分叉源激活时服务端行为）**：**fail-closed（抛清晰错误）**，与实验宏引擎一致。精确检测：① `extension_settings.regex` 含作用于 `WORLD_INFO` placement 的规则；② vectors 启用；③ 注册了 `WORLDINFO_SCAN_DONE` 监听者（服务端不注册；第 4 步顺带确认树内订阅者数并报告，若为 0 则该项仅文档化、不触发）。
- **Q-c（getTokenizerModel）**：**收窄抬升 + fail-closed**。把 `getTokenizerModel` 抬升到共享模块，但只实现 CC 相关 provider（OpenAI / DeepSeek / OpenAI-compatible custom）；对其它 provider 服务端 fail-closed（抛错），不产出错误计数。
- **通用原则（适用于第 5–7 步）**：任何被 Q4/Q-a 排除、且会改变提示词的分叉源（如第 6 步的 vectors 注入），一律「激活时 fail-closed + 文档化边界」，不得静默分叉、不得为凑逐字一致偷偷改行为。

**放行第 4–7 步**：按上述裁决推进；每步门槛不变。第 4 步完成后（World Info 抬升 + RNG 种子注入 + timedWorldInfo 写回 + 分叉源 fail-closed 检查）停下报告。

---

## 附 M：Phase 2.5.2 第 4 步拆分子步（Lead 已决）

第 4 步核心抬升（1,872 行）按 4 个可独立过门的子步推进；每步门槛：`test:prompt-baseline` 8/8 + lint/test:unit/check:repo + 红线 diff 为空。

1. `WorldInfoTimedEffects` + `WorldInfoBuffer`（596 行，纯状态机，最独立）
2. `getSortedEntries` + `parseDecorators` + `loadWorldInfo` + lore 收集（240 行）
3. `checkWorldInfo` 扫描循环（566 行，注入 RNG / tokenizer / 宏 / 注册表）
4. 构建/位置/合并 + `getWorldInfoPrompt` 薄编排（~200 行，注入 `getRegexedString` 占位 + `setExtensionPrompt`）

**接线时机（不单独接线）**：
- `createSeededRandom` → 子步 3；`resolveChatCompletionTokenizerModel` → 子步 3（预算裁剪计数）。
- `assertWorldInfoPortable` → 子步 4 / 第 7 步编排入口（最早有完整 `context` 处）。

**`getTokenizerModel` 双实现**：**接受临时并存**（浏览器原函数冻结不动 + 服务端收窄 fail-closed），**统一收口推迟到第 7 步 / 2.5.3**（届时浏览器也改走共享模块、未支持 provider 保留本地回退）。列入待收口清单。

**放行第 4 步的 4 个子步**：按 1→2→3→4 顺序推进，每个子步过门槛后再做下一个；子步 4 完成后停下报告，再做第 5–7 步。

**子步提交纪律（子步 1 授权）**：子步 1 以**专用一轮**执行。**每个子步 = 一个原子提交，且仅在完整门槛（`test:prompt-baseline` 8/8 + lint/test:unit/check:repo）通过后才提交**——不提交未经验证的中间态。若单轮预算不足，工作保持未提交、以 `/tmp` 备份兜底、下一轮继续；**不要**把“搬运”与“接线+验证”拆成两个提交（搬运提交会构成未验证的浏览器行为变更）。

---

## 附 N：长任务授权 + 全量自查检查点（Lead 已决）

### N.1 长任务：自主完成 Phase 2.5.2 剩余部分

Flash **连续自主执行**以下单元，每单元完整门槛通过后提交单个原子 commit（装不下保持未提交、下一单元继续）；命中附 L/M 已裁决的分叉源按 fail-closed 处理，**无需停下**：

1. 第 4 步子步 2：`getSortedEntries` + `parseDecorators` + `loadWorldInfo` + lore 收集（先做 **import 感知**注入面扫描）
2. 第 4 步子步 3：`checkWorldInfo` 扫描循环（注入 RNG/tokenizer/宏/注册表；接线 `createSeededRandom` + `resolveChatCompletionTokenizerModel`）
3. 第 4 步子步 4：构建/位置/合并 + `getWorldInfoPrompt` 薄编排（注入 `getRegexedString` 占位 + `setExtensionPrompt`；接线 `assertWorldInfoPortable`）
4. 第 5 步：注册表与顺序（`sanitizeServiceSettings` + `getPromptCollection` + `preparePromptsForChatCompletion`）
5. 第 6 步：`populateChatCompletion` + `populationInjectionPrompts` + `populateChatHistory` + `populateDialogueExamples`（去原地 `shift`/`reverse`）
6. 第 7 步：`prepareOpenAIMessages` 薄编排 + 拦截器钩子（仅 memory/reply-style）+ 两处 DOM 读取改入参

**停靠条件**：完成第 7 步后停下报告（Phase 2.5.2 收口）；或出现**未在附 L/M 覆盖**的新分叉/需决策项时停下报告。每步门槛不变：`test:prompt-baseline` 8/8 + lint/test:unit/check:repo + 红线 diff 为空。

### N.1 进度标记与追加纪律（子步 2 已收口后更新）

- **已完成**：子步 1、子步 2（`d622433f6`；import 感知扫描 + getter 注入 + 备份/node --check/lint 兜底，导出面 70→70）。
- **剩余 5 个单元**：子步 3 → 子步 4 → 第 5 步 → 第 6 步 → 第 7 步。

**追加纪律（子步 3–7 沿用）**：
1. **import 感知注入面扫描**：每个单元动工前先解析 `import {…} from` 绑定 + 模块级声明；可变浏览器绑定（`this_chid`/`characters`/`chat_metadata`/`world_info`/`selected_world_info`/strategy 枚举等）一律用 **getter** 注入，不捕获值（浏览器运行期会重新赋值）。
2. **动手前备份 + `node --check` + `npm run lint`（no-undef）** 作为提交前兜底；禁止提交中间态。
3. **测试只断言真实行为**：不把“代码并不具备的行为”写进断言（如 `parseDecorators` 剥离、`getSortedEntries` 过滤 disable）。

**子步 3/4 总结出的教训（第 5–7 步沿用）**：
4. **注入参数命名用 `env` 而非 `context`**：被搬函数若内部已有局部 `const context = getContext()`，注入参数叫 `context` 会静默遮蔽它（lint/no-undef 不报），导致 AN 劫持等读 `undefined`。约定：注入参数统一叫 `env`，内部保留 `context = env.getContext()`。
5. **空选集提前返回的副作用跳过必须保留**：不要把扫描/构建阶段“统一化”而丢掉原有 `length === 0` 提前返回（它会跳过 timedEffects 副作用）。
6. **jest 运行时是“缺失具名导出”的唯一关口**：`node --check` 与 lint 抓不到 `import { X }` 中 X 不存在，只有 jest 加载时报错。故“jest 加载成功”是每个迁移单元的必过关口。

### N.1 进度（子步 3、4 已收口后更新）
- World Info 抬升（第 4 步）**完整收口**：`world-info.js` 6289 → 4713 行，公共导出始终 70 个不变。
- 已完成单元：子步 1、2、3、4（`e84181ecf`）。
- 剩余 3 个单元：**第 5 步 → 第 6 步 → 第 7 步**（第 7 步完成即 Phase 2.5.2 收口）。
- 欠账：子步 4 的构建阶段专属单测（`buildWorldInfoPrompt` 四种位置分支），在第 5 步一并补上。

### N.1 第 5 步范围调整（Lead 已决）

**第 5 步只做「注册表/顺序」核心**：2 个常量（`chatCompletionDefaultPrompts` 81 行 + `promptManagerDefaultPromptOrder` 54 行）+ 6 个方法（`isPromptDisabledForActiveCharacter`/`sanitizeServiceSettings`/`checkForMissingPrompts`/`getPromptOrderForCharacter`/`getPromptCollection`/`shouldTrigger`，共 84 行逻辑）。注入设计：这 7 段**不引用任何 import**、只引用 `this.*` → 把 `this` 作为 `env` 传入，`this.` 机械替换为 `env.`；唯一工厂依赖 `new PromptCollection()` 注入为 `env.createPromptCollection()`。

**`preparePromptsForChatCompletion`（150 行，openai.js）随第 6 步一起搬**：它依赖 `ChatCompletion`/`Message`/`MessageCollection`/`promptManager`，正是第 6 步 `populateChatCompletion` 要搬的同一簇；单独在第 5 步搬需先预置第 6 步机制、第 6 步再改一次。排期合并、无行为变更、不涉及 fail-closed。

### N.1 第 6 步拆分为 6a + 6b（Lead 已决，Q-6）

侦察发现第 6 步实际 1,422 行（5 函数 621 行 + 4 类簇 801 行），是计划量的 2.3×。按附 M 先例拆为两个单元，各自过完整门槛后单个原子 commit：

- **6a（类簇，~801 行）**：`TokenHandler` + `Message` + `MessageCollection` + `ChatCompletion` → `src/prompt-assembly/chat-completion.js`；`ChatCompletion` 保持 `export class` 薄 re-export（簇外 9 处引用）；媒体工具/`ToolManager`/`t` 走 `env` 注入。
- **6b（populate 函数，~621 行）**：5 个函数 → `src/prompt-assembly/populate.js`；**去 4 处原地改写**（`:860` splice、`:865` reverse、`:909` splice、`:1313` shift，均改为对副本操作）；`ChatCompletion` 仅经 `env`（函数侧 0 处直接引用类，已实测）。

**6b 的关键正确性点**：去原地改写后，必须用 `test:prompt-baseline` 8/8 证明**输出不变**，并确认无调用方依赖“调用方数组被反转/弹出”的副作用（改前/改后各记录一次）。

**循环依赖规避**：`Prompt`/`INJECTION_POSITION` 走 `env` 注入（不 import PromptManager.js）；`substituteParams`/`getExtensionPrompt`/`getExtensionPromptMaxDepth`/`extension_prompt_roles`/`extension_prompt_types` 从**共享模块** import，不再从 `script.js`。

### N.1 检查点放松（Lead 已决，回应“往返太密”）

剩余单元（**6a 接线 → 6b → 第 7 步**）**不再逐单元停下等确认**。授权 Flash 一口气跑完，仅在以下两个条件停下报告：
1. **Phase 2.5.2 完整收口（第 7 步完成）**；
2. 出现**未在附 L/M/N + Q-6 覆盖**的新分叉/需决策项。

理由：纪律已固化（原子提交 + 每单元门槛 + jest 关口 + fail-closed + import 感知扫描），剩余三步是同一套已验证模式、决策已全部预置，无需逐步人工审。每单元仍须过完整门槛后单个原子 commit。

### N.1 6a 设计确认（configureChatCompletion 模块级 env）

采纳 `configureChatCompletion(env)` + `getChatCompletionEnvironment()` 的**模块级 DI**（而非给 ~30 个方法加 `env` 参数）。约束：env 里可变绑定用 **getter**（`getOaiSettings: () => oai_settings` 等）以保持“读当前值”；`configureChatCompletion` 必须 **fail-closed** 校验 `REQUIRED_ENV_KEYS`、缺键抛错；浏览器初始化时配置一次、服务端各自配置一次。这是对“纯函数”原则的务实偏离，**仅限这些有状态类**；populate 函数（6b）仍走显式 `env` 参数。

### N.1 6b-part-2 集成修正（Lead 已决）

- **`getExtensionPrompt` 签名冲突**：共享核心是 `getExtensionPromptCore(registry, position, depth, opts)`，populate 代码沿用位置签名 `(position, depth, separator, role, wrap)`。**采用方案 (b)**：populate.js 内调用 `env.getExtensionPrompt(position, depth, sep, role, wrap)` / `env.getExtensionPromptMaxDepth()`，由 openai.js（浏览器）或服务端各自提供适配器（内部调共享核心 + 各自 registry）；populate.js **不感知 registry 形状**。
- **两个 provider 枚举**（`tool_reasoning_modes`、`interleaved_reasoning_providers`）**不随迁、不硬编码**：留在 openai.js（值由 `chat_completion_sources` 构造），经 `env` 注入给 populate.js。
- **工具链纪律（更正）**：上一轮“eslint 有陈旧缓存、行号不可信”是**误判**——实为读报错时漏看文件名头，把指向 `populate.js` 的行号当成了 `openai.js`。**lint 可信**；读报错前先确认文件名归属。仍以 **jest 加载**（纪律⑥）为主关口（它抓得到缺失具名导出与签名错位）。

### N.1 6b-part-2 接线教训（Lead 已记，第 7 步沿用）

- **TDZ 审计**：`openAiAssemblyEnv()` 若放在被引用 `const` 之前、且用**值**（非 getter）读取，会在初始化期触发 `ReferenceError`（页面卡 preloader）。接线前先列 `openAiAssemblyEnv()` 引用的每个绑定在 openai.js 的声明行号；凡声明晚于 env 定义处的，一律改**惰性 getter** `() => binding`，或把 env 定义移到所有被引用 `const` 之后。
- **`openai.js` 的唯一下限关卡是浏览器基线**：没有任何测试 import `openai.js`，jest“加载成功”只证明 `populate.js` 自身可加载、不代表 `openai.js` 能用。凡改动 `openai.js`，**必须以 `test:prompt-baseline` 8/8 为准**（lint/jest 通过不等于可用）。

### N.1 6b-part-2 二次失败后的诊断纪律（Lead 已决）

- **先补诊断、再猜根因**：`run-baseline.mjs` 目前不捕获页面异常，只能看到“preloader 没消失”、看不到真实 JS 报错。**先做一个独立小 commit** 给 harness 加 `page.on('pageerror')` + `page.on('console', error)`，并在 8 用例全失败时打印第一条 pageerror——这样任何接线类改动都能立刻看到根因，避免“猜 TDZ → 被证伪”这类盲试。
- **TDZ 假设已证伪**：把 `openAiAssemblyEnv()` 移到所有 `const` 之后仍无法修复页面加载；真实根因待 pageerror 揭示，不要继续用 TDZ 解释。

### N.1 第 7 步 DOM 入参化范围（Lead 已决，Q-7a/Q-7b）

- **Q-7a**：`$('#send_textarea').val()` 有 4 处，**只入参化组装路径 `script.js:4315`**（`Generate` 内待发文本）；其余 3 处（`4225` 斜杠命令门控、`1770`/`5692` 草稿/`sendMessageAsUser`）属浏览器 UI 关注点，**保持 DOM 读取不变**，避免扩大回归面。
- **Q-7b**：理解正确——共享模块接收 `pendingUserText` / `noteText` 入参（DOM-free）；浏览器适配器读 `$('#send_textarea').val()` 与 `$('#extension_floating_prompt').val()` 后作为入参传入；服务端从 `/api/v1` 请求体传入。

### N.1 第 7 步拦截器钩子（Lead 已记，防双重执行）

`runGenerationInterceptors` 已在 `script.js` 的 `Generate` 内**先跑一次**（组装之前）。故共享 `prepareOpenAIMessagesCore` 只提供**可选** `await env.runInterceptors?.(...)`（缺省跳过）；**浏览器适配器不传**（保持现行为、避免 CC 路径双重执行）；服务端在钩子里接自己的 memory/reply-style 实现；`reality`/`filter` 永不接入。单测必须覆盖“缺省不调用 / 提供时恰好调用一次”作回归护栏。

---

## 附 O：Phase 2.5.2 收口验收（Lead 已验）

**Phase 2.5.2（提示词组装抬升）验收通过**。核验：工作树干净；红线 3 文件（`chats.js`/`characters.js`/`prompt-converters.js`）在 `refactor-base..HEAD` 全部 commit 中**零触碰、累计 diff 为空**；`src/prompt-assembly/` 16 个共享模块齐备；`test:prompt-baseline` 8/8；validate 全绿（75 suites / 901 tests）。

**流程改进（Lead 已决）**：每单元门槛此前只跑 `npm run lint`（不覆盖 `tests/`），导致 3 个套件累计 11 个 tests-lint 错误直到收口才暴露。**自 Phase 2.5.3 起，每单元门槛 = `npm run lint` + `npm run lint --prefix tests`（或直接 `npm run validate`）**。

**下一步顺序**：
1. 补附 N.2 第 6/7 项：**真实服务 SSE 冒烟**（注册→登录→建角色→发消息→SSE，mock 模型）+ 结果写入 `docs/roadmap.md`。
2. 进入 **Phase 2.5.3**（服务端 `/generate` 权威轮次，按 `docs/authoritative-turn-spec.md`）：让 `assertWorldInfoPortable` / `createSeededRandom` / `resolveChatCompletionTokenizerModel` / `configureChatCompletion` 真正被服务端调用（当前尚无服务端调用方）。

### 附 O 2.5.3 作者注验证缺口（Lead 已决）

现有 8 个基线**均不含作者注**（`2_floating_prompt` 未出现），而 `note_text` 是 2.5.2 显式入参化的两处 DOM 读取之一，不能被逐字等价覆盖是不可接受的。**裁决：新增第 9 个夹具用例（作者注启用 + `note_prompt`/note 内容），经 `run-baseline.mjs` 重录其浏览器基线，并入 `corpus.mjs` 与 replay oracle**。这样作者注路径同样受逐字等价门禁。

### 附 O 门槛纪律升级（Lead 已决，二次同类事故后）

**门槛必须“断言结果”，不得只 grep 信号。** 本轮 `b8de7e89d` 在单测失败状态下被提交，根因是门槛脚本只 grep 了 lint/baseline/check:repo 的信号、**从未断言单测套件通过**——与 2.5.2 收口“tests lint 未纳入门槛”同属“信号检查 ≠ 结果断言”一类。**自现在起**：
- 每单元门槛必须**显式断言**：`Test Suites: N passed, N total` 且无 `failed`；双 lint 以**退出码 0** 为准；`check:repo`/`test:prompt-baseline` 以退出码 0 为准。任何“grep 到了成功字样”都不算通过。
- 若失守：**用独立 commit 修复并记录**（不 `--amend` 掩盖），并在报告中如实披露。

---

## 附 P：P2.5 一次性收尾令（Lead 已决）

### P.1 宏 helper 簇决策（新分叉已裁决）

- **6a（先做）**：抬升 `parseMesExamples`（`script.js:3373`）+ `formatInstructModeExamples`（`instruct-mode.js:511`）到共享模块（env 注入其少量依赖），浏览器改薄包装。
- **6b（`evaluateMacros`，数据驱动）**：6a 后跑 oracle——若 9 基线**不触发** `evaluateMacros`（夹具确定性、无 `{{random}}/{{roll}}/{{time}}`）→ 注入 **fail-closed 桩**（被调用即抛错，绝不静默错）；若 oracle 显示需要 → 用 package.json 已含的 npm 依赖 `handlebars`/`moment`/`seedrandom`/`droll`（已在 dependencies + node_modules）抬升；若 bundle 版本与 npm 版本不一致导致字节漂移，作为新分叉上报。

### P.2 一次性完成清单（不再逐单元停靠）

1. 宏 helper 簇（P.1 的 6a/6b）
2. **解除 501**：`authoritative-turn.js` 接 `buildServerAssemblyEnv` + WI 前置（`getWorldInfoPrompt({enforcePortability:true, random:createSeededRandom(seed)})`）→ 调 `prepareOpenAIMessagesCore` → 跑 oracle 拿**首个分歧索引**
3. **registry 重建**，顺序 `#3 reply_style → #1 growth → #2 relationship → #4 events/cross_line → #6 persona 位置 → #9 群卡合并`，**复刻 quiet 类型门控**；每补一块跑 oracle 看索引前进
4. §6 宏 context（legacy 引擎；实验引擎 fail-closed）+ 四项服务端接线全部接通
5. §7 `/generate` 改权威轮次（复用 `handleChatCompletionGenerate`，`timedWorldInfo` 只写 JSONL 首行）
6. §8.5 更新 `docs/api-v1.openapi.yaml`（标注“权威轮次”）
7. **2.5.4 回归证明**：oracle **9/9 逐字一致**
8. **2.5.5 切换收口**：RN/后续走服务端 `/generate`（浏览器 legacy 路径保留）→ 出 P2.5 收口报告

### P.3 严格执行纪律

- 每单元：**断言退出码 0 + pass 计数**（不 grep 信号）→ 全绿后单个原子 commit
- 红线 3 文件零触碰；`test:prompt-baseline` 9/9 保持
- 命中附 L/M/N/O 已裁决分叉源按 fail-closed，**无需停下**
- **唯一停靠条件**：出现附 L/M/N/O/P 未覆盖、且有证据的新分叉——否则一路跑到 2.5.5 收口才停

### N.2 全量自查检查点（Phase 2.5.5 完成之后执行）

在 Phase 2.5 **完全收口（2.5.5 完成）后**执行一次全量自查：

1. `npm run validate`（check:repo + lint + lint(tests) + test:unit）全绿
2. `npm run test:prompt-baseline` 8/8 逐字一致
3. 红线审计：`git diff refactor-base -- src/endpoints/chats.js src/endpoints/characters.js src/prompt-converters.js` 为空；并对 `refactor-base` 以来**全部 commit** 逐一扫一遍是否误改聊天核心 / 数据文件
4. 遗留引用检测（附 B）
5. 密钥/数据安全扫描：无密钥、无 `data/`、无聊天内容进入 Git
6. 冒烟：真实服务注册→登录→建角色→发消息→SSE 全链路（mock 模型）
7. 自查结果记录到 `docs/roadmap.md` 或独立 report
