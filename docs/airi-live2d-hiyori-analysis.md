# AIRI Live2D 与 Hiyori 结构分析

> 归档日期：2026-09-20  
> 范围：DreamLand 仓库内集成的 AIRI Desktop、Hiyori Free/Pro 模型包，以及可用于制作替代角色的 AI 辅助工作流。

## 结论摘要

Hiyori 不是由 AIRI 在运行时生成的角色，也不依赖在线 Live2D 服务。它是 Live2D 官方预先制作完成的 Cubism 示例模型。AIRI 的职责是加载其运行时文件，并把鼠标视线、自动眨眼、动作、表情和语音口型等信号写入标准 Cubism 参数。

Hiyori 的自然感主要来自预先完成的人工资产：分层并补全遮挡区域的角色美术、ArtMesh、Deformer、参数关键形态、物理系统以及动作。AIRI 自身不会从一张平面图片重建这些数据。

单张角色图在 2026 年已经可以通过 AI 自动完成较好的分层、遮挡补画、基础网格和初始绑定，但要达到 Hiyori Pro 的稳定程度，复杂头发、衣物、肢体、参数组合和物理效果仍需人工检查与精修。

## Hiyori 的来源与许可边界

模型包内的 `ReadMe.txt` 记录了以下信息：

- 角色：桃濑日和（Hiyori Momose）。
- 插画：Kani Biimu。
- Live2D 建模：Live2D。
- 基于 Cubism 3.0 制作的标准示例模型。
- Pro 版本的模型关键点和动画关键帧在 2023-03-08 更新。
- 肩部使用了 Cubism 的 Glue（胶水）功能。

本仓库中的模型包：

- [`hiyori_pro_zh.zip`](../airi/packages/stage-ui/src/assets/live2d/models/hiyori_pro_zh.zip)
- [`hiyori_free_zh.zip`](../airi/packages/stage-ui/src/assets/live2d/models/hiyori_free_zh.zip)

Live2D 将 Hiyori 归类为官方原创角色示例数据。使用时必须遵守 [Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 和 [Live2D Cubism Sample Data Terms of Use](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)。后者明确规定 Hiyori 的角色设计不得被更改。

因此：

- 可以研究 Hiyori 的模型结构和标准参数约定。
- 可以用它验证 AIRI 的 Live2D 加载与控制链路。
- 不应通过替换 Hiyori 纹理、改造其角色设计或直接派生其角色资产来制作需要发布的新角色。
- Leslie 专属角色应使用独立、权属清晰的美术素材和模型工程。

## 模型包结构

Hiyori 的 ZIP 同时包含可编辑工程和运行时文件：

```text
hiyori_*_zh/
├── *.cmo3                         Cubism 可编辑模型工程
├── *.can3                         Cubism 动画工程
├── ReadMe.txt
└── runtime/
    ├── *.moc3                     编译后的模型、网格和变形数据
    ├── *.model3.json              运行时入口及文件引用
    ├── *.physics3.json            物理系统
    ├── *.pose3.json               部件姿势/显示切换，Pro 包含
    ├── *.cdi3.json                参数、部件和分组的可读信息
    ├── *.2048/texture_*.png       纹理图集
    └── motion/*.motion3.json      动作数据
```

这次分析不需要破解 `.moc3` 二进制格式：模型包已经提供 `.cmo3`、`.can3`、运行时 JSON 和纹理图集，足以确认制作结构与运行时契约。

### Free 与 Pro 对比

| 项目 | Hiyori Pro | Hiyori Free |
| --- | ---: | ---: |
| 参数数量 | 70 | 29 |
| 部件数量 | 26 | 17 |
| 组合参数组 | 2 | 3 |
| 2048 纹理图集 | 2 | 1 |
| 动作文件 | 10 | 8 |
| 物理系统 | 11 | 7 |
| 物理输入 | 34 | 24 |
| 物理输出 | 35 | 7 |
| 物理粒子顶点 | 58 | 14 |
| `.cmo3` 模型工程 | 有 | 有 |
| `.can3` 动画工程 | 有 | 有 |

Pro 版本的动作组包括：

- `Idle`
- `Flick`
- `FlickDown`
- `FlickUp`
- `Tap`
- `Tap@Body`
- `Flick@Body`

Pro 版本的物理系统覆盖前发、后发、头部丝带、裙子横向与纵向摆动、身体丝带、胸部、左右辫子和左右侧发。Free 版本保留较少的物理输出和部件控制。

## Hiyori 的制作方式

结合模型说明、纹理图集、`cdi3.json`、`physics3.json` 和 `model3.json`，其制作流程可以还原为：

```text
完整角色设计
  ↓
按脸、五官、头发、身体、衣服、手脚等拆分透明图层
  ↓
补画原图中被头发、衣物或肢体遮挡的区域
  ↓
导入 Cubism Editor，转换为 ArtMesh
  ↓
建立 Warp/Rotation Deformer、Glue 和部件层级
  ↓
为标准参数制作关键形态
  ↓
建立头发、服装和身体等物理系统
  ↓
在动画工程中制作待机、触摸和摆动动作
  ↓
导出 Cubism Web 运行时文件
```

纹理图集显示出的实际拆件包括：

- 完整的无五官脸底；
- 左右眼、瞳孔、眼睑、眉毛；
- 多种嘴部状态和口腔部件；
- 前发、侧发、后发、辫子和发饰；
- 独立躯干、领口、衣服和裙子；
- 多套手臂、手掌和手势；
- 左右腿、袜子和鞋；
- 被其他部件遮挡时仍然完整的隐藏区域。

这说明从单张图制作 Live2D 时，最困难的环节不只是抠图，而是正确推断部件前后关系并补齐原图里不存在的内容。

## AIRI 的 Live2D 接入链路

### 构建时获取内置模型

AIRI 的桌面构建配置下载 Hiyori Free 和 Pro ZIP，并放入 Stage UI 的模型资源目录：

- [`electron.vite.config.ts`](../airi/apps/stage-tamagotchi/electron.vite.config.ts#L255)

### 默认模型选择

Hiyori Pro 被注册为 `preset-live2d-1`，并作为 Stage 默认模型：

- [`display-models.ts`](../airi/packages/stage-ui/src/stores/display-models.ts#L23)
- [`stage-model.ts`](../airi/packages/stage-ui/src/stores/settings/stage-model.ts#L17)
- [`leslie-companion-defaults.ts`](../airi/apps/stage-tamagotchi/src/renderer/composables/leslie-companion-defaults.ts#L39)

内置模型使用打包资源 URL。用户导入的 ZIP 作为 `File` 写入 IndexedDB，选中时通过 `URL.createObjectURL()` 产生运行时 URL。两类模型最终都进入相同的 `stageModelSelectedUrl` 加载路径。

### ZIP 与模型入口解析

AIRI 使用 `JSZip` 和 `pixi-live2d-display` 的 `ZipLoader` 解析模型：

- [`live2d-zip-loader.ts`](../airi/packages/stage-ui-live2d/src/utils/live2d-zip-loader.ts#L13)

加载器会寻找 `.model3.json` 或旧版 `.model.json`。如果 ZIP 没有设置文件，它还可以在满足以下条件时生成临时设置：

- ZIP 中恰好有一个 `.moc3`；
- 至少存在一个 PNG 纹理；
- 可选识别 `.motion3.json`、物理和 Pose 文件。

正式角色仍应提供完整的 `.model3.json`，以便正确声明纹理、动作、物理、Pose、点击区域、LipSync、EyeBlink 和表情引用。

### 渲染接口

桌面渲染器加载 Cubism SDK for Web 5 r.3 的 Core：

- [`index.html`](../airi/apps/stage-tamagotchi/src/renderer/index.html#L18)

渲染链路为：

```text
Live2D ZIP 或 Blob URL
  ↓
ZipLoader / model3.json
  ↓
pixi-live2d-display/cubism4
  ↓
Live2D Cubism Core for Web
  ↓
PixiJS Canvas
```

模型由 `Live2DFactory.setupLive2DModel()` 建立：

- [`Model.vue`](../airi/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue#L258)

它不是 REST API，也不经过 Leslie Bridge。Leslie Bridge 负责角色聊天、状态、语音合成和语音识别；Live2D 模型文件与逐帧参数控制都发生在 AIRI 渲染器内部。

## AIRI 使用的参数与信号

### 推荐的标准参数

为了让自定义模型直接获得 AIRI 的现有能力，模型至少应优先实现：

| 功能 | 参数 ID |
| --- | --- |
| 头部角度 | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ` |
| 眼睛开合 | `ParamEyeLOpen`, `ParamEyeROpen` |
| 眼球视线 | `ParamEyeBallX`, `ParamEyeBallY` |
| 嘴部开合 | `ParamMouthOpenY` |
| 嘴部形态 | `ParamMouthForm` |
| 身体角度 | `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ` |
| 呼吸 | `ParamBreath` |
| 脸颊 | `ParamCheek` |
| 眉毛 | `ParamBrowLX/RX`, `ParamBrowLY/RY`, `ParamBrowLAngle/RAngle`, `ParamBrowLForm/RForm` |

`model3.json` 还应声明：

```json
{
  "Groups": [
    {
      "Target": "Parameter",
      "Name": "LipSync",
      "Ids": ["ParamMouthOpenY"]
    },
    {
      "Target": "Parameter",
      "Name": "EyeBlink",
      "Ids": ["ParamEyeLOpen", "ParamEyeROpen"]
    }
  ]
}
```

### 视线与眨眼

鼠标或窗口提供的指针位置被换算为模型坐标，并传入 `model.focus(x, y)`：

- [`eye-tracking.ts`](../airi/packages/stage-ui-live2d/src/composables/live2d/eye-tracking.ts)
- [`Model.vue`](../airi/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue#L742)

没有活跃指针时，AIRI 会生成随机的空闲注视。自动眨眼由 Cubism SDK 或 AIRI 自己的定时插件控制 `ParamEyeLOpen` 和 `ParamEyeROpen`。

### 语音口型

当前语音链路为：

```text
TTS AudioBufferSourceNode
  ↓
wLipSync AudioWorklet
  ↓
A/E/I/O/U 权重与音量
  ↓
取最大权重作为 mouthOpenSize
  ↓
ParamMouthOpenY
```

相关代码：

- [`model-driver-lipsync/src/live2d/index.ts`](../airi/packages/model-driver-lipsync/src/live2d/index.ts#L71)
- [`Stage.vue`](../airi/packages/stage-ui/src/components/scenes/Stage.vue#L310)
- [`motion-manager.ts`](../airi/packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts#L460)

当前实现虽然计算了 A/E/I/O/U 权重，但最后只取最大值驱动 `ParamMouthOpenY`。因此现状主要是随语音张合嘴，并未把五元音完整映射到 `ParamMouthForm` 或多个专用嘴型参数。这是后续客制化中价值较高的改进点。

### 动作与表情

模型的 `motion3.json` 通过 `model3.json` 的 Motion Group 注册。聊天流中的 `act` 或 emotion 信号可以设置 AIRI 的 `currentMotion`，再由模型播放器启动对应动作：

- [`Stage.vue`](../airi/packages/stage-ui/src/components/scenes/Stage.vue#L215)
- [`Model.vue`](../airi/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue#L498)

AIRI 也支持从 `FileReferences.Expressions` 读取 `.exp3.json`，并在每帧叠加表达式参数：

- [`expression-controller.ts`](../airi/packages/stage-ui-live2d/src/composables/live2d/expression-controller.ts)

Hiyori 自带包主要依赖 Motion Group，并未在 `model3.json` 中声明 `.exp3.json` 表情。新的 Leslie 模型可以同时提供标准动作组和独立表情，以得到比 Hiyori 更清晰的情绪控制。

## 自定义模型的 AIRI 兼容契约

推荐的交付 ZIP：

```text
leslie-character.zip
└── leslie-character/
    ├── leslie-character.model3.json
    ├── leslie-character.moc3
    ├── leslie-character.physics3.json
    ├── leslie-character.pose3.json          可选
    ├── leslie-character.cdi3.json           推荐
    ├── textures/
    │   ├── texture_00.png
    │   └── texture_01.png
    ├── motions/
    │   ├── idle.motion3.json
    │   └── ...
    └── expressions/
        ├── happy.exp3.json
        └── ...
```

最低运行条件：

1. 一个有效的 Cubism 4/5 `.moc3`。
2. 至少一张纹理。
3. 路径正确的 `.model3.json`。
4. `ParamMouthOpenY` 用于现有口型链路。
5. `ParamEyeLOpen`、`ParamEyeROpen` 用于眨眼。

推荐条件：

1. 实现完整的标准角度、视线、嘴、身体和呼吸参数。
2. 提供 `LipSync` 和 `EyeBlink` Groups。
3. 提供物理配置和至少一个 `Idle` 动作。
4. 动作组或表情名与 AIRI 的 emotion/act 映射保持一致。
5. 提供 CDI 信息，使参数与部件在调试界面中可读。
6. 在多个参数同时达到边界值时检查穿帮、层级和遮罩。

## AI 能力边界

### 已较成熟的辅助步骤

AI 或 Cubism 自动化工具目前可以较稳定地辅助：

- 生成适合 Live2D 的正面、A-Pose 角色原画；
- 识别脸、头发、眼睛、身体、服装和饰品；
- 从平面动漫图生成分层 PSD；
- 补画被其他部件遮挡的区域；
- 自动生成基础 ArtMesh；
- 自动创建基础脸部 Deformer；
- 自动生成正面脸的 Angle X/Y 初始形变；
- 生成基础眨眼、张嘴、视线和呼吸；
- 为规则发束和衣物建立初始摆动物理。

Live2D 官方工具中的相关功能：

- [PSD Import](https://docs.live2d.com/en/cubism-editor-manual/psd-import/)
- [Material Separation Photoshop Plugin](https://docs.live2d.com/en/cubism-editor-manual/material-separation-ps-plugin-download/)
- [Automatic Mesh Generator](https://docs.live2d.com/en/cubism-editor-manual/mesh-edit/)
- [Auto Generation of Facial Motion](https://docs.live2d.com/en/cubism-editor-manual/face-auto-edit/)

官方面部自动生成功能是半自动工具：它要求眼睛、眉毛、嘴、鼻子等部件已经正确拆分，且主要针对正面脸。它不能替代完整的美术拆件和全身绑定。

### 仍需人工检查的部分

- 刘海后面的完整脸、眉毛和耳朵；
- 交叉手臂、手指和宽大袖子的前后关系；
- 透明饰品、蕾丝、发光效果和复杂混合模式；
- 长发、辫子和大量独立发束的层级；
- 强透视、侧身和动态姿势；
- 高质量 Angle X/Y/Z 头部转动；
- 嘴角、脸颊、眼睛和眉毛的自然联动；
- 大幅全身动作中的衣服褶皱与遮挡；
- 多参数同时达到极值时的部件分离、破面和穿帮；
- 复杂物理参数的阻尼、延迟和幅度调校。

### 当前可用或值得跟踪的 AI 项目

#### See-through

[See-through](https://github.com/shitagaki-lab/see-through) 是 SIGGRAPH 2026 的单图动漫角色分层项目。公开实现可以将一张角色图拆成最多约 23 个语义图层、补全遮挡区域并导出分层 PSD。它适合承担“平面图到初始分层素材”的工作，但输出仍应经过美术检查。

#### image2live2d

[image2live2d](https://github.com/Wzhang3912/image2live2d) 可以从分层 PSD 建立基础网格、眨眼、嘴型、头部运动、身体参数和物理，并提供 Live2D 运行时文件及实验性的 `.cmo3` 输出。

风险与限制：

- `.moc3` 编码属于项目自己的逆向实现；
- 项目说明仍存在 Live2D SDK 许可边界；
- `.cmo3` 编辑工程输出仍标记为实验状态；
- 适合研究和原型验证，不应在没有兼容性测试与许可审查时直接作为正式发布管线。

#### Bunraku

[Bunraku](https://bunraku-live2d.github.io/) 展示了从单张图生成有序 RGBA 图层、每层网格以及参数关键形态的完整研究方向。它的目标是真正可驱动、可编辑的结构化角色，不是视频变形。

截至归档日期，其 [GitHub 仓库](https://github.com/SparcAI-Inc/Bunraku) 只有项目说明，尚未公开完整代码、权重或可直接部署的推理管线，因此暂时不能作为本项目的可执行依赖。

#### CartoonAlive

[CartoonAlive](https://human3daigc.github.io/CartoonAlive_webpage/) 使用人脸关键点和模板模型拟合单张肖像，偏向快速头像生成。其公开仓库主要是说明和展示资产，尚不足以构成本项目可复现的完整生产管线。

#### LivePortrait

[LivePortrait](https://github.com/KlingAIResearch/LivePortrait) 可以迅速让单张图按照驱动视频产生表情和头部运动，但输出是生成视频或神经网络变形帧，不是包含 ArtMesh、参数、物理和 Motion Group 的 Cubism 模型，不能直接作为 AIRI 的 Live2D ZIP。

## 推荐制作路线

当前最可靠的 Leslie 专属模型流程是“AI 负责重体力准备，Cubism 负责最终可控资产”：

```text
权属清晰的角色原图
  ↓
AI 分层与遮挡区域补画
  ↓
人工检查和修正分层 PSD
  ↓
Cubism PSD 导入与自动网格
  ↓
Cubism 自动脸部 Deformer/Angle X-Y 起稿
  ↓
人工精修头部、嘴型、身体、头发、衣物和四肢
  ↓
添加物理、Idle、动作和表情
  ↓
导出标准 Cubism Web ZIP
  ↓
AIRI 导入、参数检查和端到端语音测试
```

对于正面、全身、轮廓清晰、遮挡较少的动漫角色，这套流程可以较快得到具备眨眼、张嘴、视线、轻微转头、呼吸和基础头发摆动的原型。

达到 Hiyori Pro 级别时，AI 可以减少拆件、补画、初始网格和基础脸部绑定的工作量，但复杂物理、全身动作、参数组合与最终美术质量仍依赖人工。

## 后续客制化优先级

建议按以下顺序推进：

1. 对目标角色原图做 Live2D 可制作性检查：姿势、遮挡、分辨率、轮廓、复杂部件和素材权属。
2. 制作或生成分层 PSD，并为眼睛、嘴、头发和肢体补齐隐藏区域。
3. 先完成最小 AIRI 模型：头部 X/Y/Z、视线、眨眼、嘴部开合、呼吸和 Idle。
4. 增加独立的 `happy`、`sad`、`angry`、`surprised` 等 `.exp3.json`，统一 AIRI 情绪映射。
5. 将 wLipSync 的 A/E/I/O/U 权重映射到真正的嘴型参数，而不只驱动 `ParamMouthOpenY`。
6. 增加头发、服装和饰品物理，再制作触摸与特殊动作。
7. 建立模型 ZIP 验证和渲染回归测试，确保普通聊天在模型异常时仍然 fail open。

## 复查提示

外部 AI 项目的代码、模型权重、许可和成熟度变化较快。再次采用某个项目前，应重新确认：

- 仓库是否已经公开可运行代码与权重；
- 模型和训练数据许可是否允许本项目用途；
- 是否输出真正的结构化 Live2D/Cubism 资产；
- 是否只是输出视频或逐帧图像；
- 是否能够在 AIRI 使用的 Cubism Core for Web 中稳定加载；
- 是否可在 Windows 本地环境中重复构建和运行。
