# DreamLand 与 AIRI 启动和使用指南

## 项目布局

DreamLand 与 AIRI 已合并为一个 Git 工作树：

```text
D:\Projects\Leslietavern\
├─ .git\                  唯一 Git 元数据
├─ airi\                  AIRI 桌面前端源码
├─ src\                   DreamLand 服务端和桌面壳
├─ data\                  本地用户数据
├─ Runtime\               本地 Electron 运行时
├─ Config\                本地运行配置
└─ 启动 DreamLand.cmd      统一桌面入口
```

整个目录只使用根目录的 `.git`。`airi/` 不包含嵌套 Git 元数据，也不保留单独的上游 remote。根仓库的 `origin` 是本项目自己的发布和推送目标。

两个 Node.js 应用仍保留各自的包管理边界：根目录使用 npm，`airi/` 使用 pnpm。这样可以避免混合锁文件，同时仍由一个仓库统一版本化和发布。

## 日常启动

双击 `启动 DreamLand.cmd` 启动 DreamLand。打开“设置 → 模型连接 → 本地服务”，即可分别启动或停止 AIRI 与项目适配的 Qwen3.5 本地模型。AIRI 启动完成后会出现自己的主窗口，并跳过首次配置向导。

本地服务按钮只在 Electron 桌面端可用。普通浏览器和局域网页面可以继续使用聊天功能，但不能启动或停止本机进程。

## AIRI 启动过程

从设置启动 AIRI 时，桌面端会依次执行：

1. 确认 DreamLand 已由 `启动 DreamLand.cmd` 启动并且 Bridge 已就绪。
2. 复用 DreamLand 启动时生成、只存在于进程环境中的 32 字节随机桥接令牌。
3. 检查根目录内的 `airi/` 子系统与 AIRI 桌面构建；构建缺失或源码较新时自动运行生产构建。
4. 使用同一个进程令牌和本机 Bridge URL 启动 AIRI。

令牌不会写入配置、源码、日志或用户数据。关闭应用后令牌失效。

## 首次准备

DreamLand 需要：

- `Runtime/electron.exe`
- `Config/config.yaml`
- 已安装的服务端依赖
- 本地 `data/` 用户目录

AIRI 需要已经安装依赖。当前工作区已经完成安装。以后重新克隆整个项目时，在根目录安装 DreamLand 依赖，再进入 `airi/` 安装锁文件依赖：

```powershell
cd D:\Projects\Leslietavern
npm ci
npm ci --prefix src/electron
npm ci --prefix tests
cd airi
pnpm install --frozen-lockfile
```

自动构建需要 Node.js 20 或更高版本。启动器按以下顺序寻找 Node.js：

1. `LESLIE_NODE_EXE`
2. 系统 `PATH` 中的 `node.exe`
3. 本机 Codex bundled runtime

## 连接角色并开始聊天

在 DreamLand 中：

1. 像平常一样配置聊天 provider、模型和 API 密钥。
2. 打开或创建一个角色聊天，并点选你希望 AIRI 扮演的角色。
3. 如需语音，在 DreamLand 的火山引擎语音设置中保存 App ID、Access Key，并为该角色分配音色。

在 AIRI 中：

1. 不需要选择 provider、模型或音色。
2. 看到右上角状态变成“已绑定 DreamLand 角色”后，直接输入文字或使用麦克风。
3. 如需更换外观，只打开 AIRI 设置中的“角色形象”，选择 3D、Live2D 或其他显示模型。

AIRI 只把最新一条用户输入交给 DreamLand。DreamLand 使用当前角色的角色卡、Persona、World Info、提示词扩展、记忆、聊天记录和当前模型生成回复，并把回复保存到当前聊天。AIRI 再显示回复，并使用当前角色绑定的火山音色播放。

切换角色时，只需要在 DreamLand 中点选另一个角色。AIRI 会在几秒内自动跟随，不需要重新配置接口。AIRI 的显示模型保持不变，用户可以在“角色形象”中手动更换；按角色自动记住不同显示模型属于后续优化项。

## 数据和日志

- Leslie 用户数据：`data/`
- Leslie 桌面日志：`logs/desktop/`
- AIRI 启动日志：`logs/airi/`
- 本地进程状态：`Run/`
- AIRI 构建输出：`airi/apps/stage-tamagotchi/out/`

这些本地目录不会进入 Git。不要把日志、用户数据、角色卡、聊天正文或密钥提交到仓库。

## 网络安全

AIRI 始终通过 `127.0.0.1` 连接 Bridge。DreamLand 的普通桌面服务仍遵循 `Config/config.yaml`。

如果诊断结果显示 LAN listener 为 `enabled`，DreamLand 也会监听局域网。`whitelistDirectPrivateNetworks` 只自动放行访问所用本机地址的同一私有子网，无需为手机或平板逐个添加 IP，切换家庭 Wi-Fi 或手机热点也不必改配置；公网和未用于当前连接的其他网段不会随之开放。Windows 防火墙仍应限制在可信本地子网。只需要本机访问时，把 `Config/config.yaml` 中的 `listen` 改为 `false`。

## 故障排查

先检查“设置 → 模型连接 → 本地服务”显示的状态，再查看日志。常见问题：

- 找不到 AIRI：确认项目根目录包含完整的 `airi/package.json`。
- AIRI 没有构建或界面仍是旧版：在设置里停止并重新启动 AIRI；启动器会检测源码时间并自动重建。
- 找不到 Node.js：安装 Node.js 20+ 或设置 `LESLIE_NODE_EXE`。
- AIRI 无法连接：确认 DreamLand 是由 `启动 DreamLand.cmd` 启动，并从该桌面窗口的设置中启动 AIRI。
- AIRI 显示“等待角色”：在 DreamLand 中打开一个聊天并选择角色，保持 DreamLand 主窗口已加载完成。
- AIRI 有文字但没有语音：在 DreamLand 中检查当前角色的火山音色映射、App ID 和 Access Key。
- 启动后立即退出：检查 `logs/desktop/` 和 `logs/airi/`。
