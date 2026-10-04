# MomoTalk / Blue Archive 本机素材包

获取日期：2026-10-02。固定版本：Global Android **1.93.454564**。

当前 Blue 风格使用 MomoTalk 的粉色标题、会话列表与左右消息布局，并直接加载游戏图片。强调色固定为默认红色，暗色采用暖炭灰与玫瑰色。经典操作按钮使用蓝色、黄色，不受红色选择强调色影响。项目随附 **48 个原始图集部件、1 张原始字标纹理、3 张原始场景图、20 个明确登记的适配和 1 张项目生图素材**，共 73 张图片，位于 `bundled/`。完整逐项信息在 [sources.json](sources.json)：包含下载地址、原图 SHA-256、图集名称、裁切坐标、NGUI 边框和透明边距；完整文件哈希保存在 `bundled/installed.json`。

导航使用用户指定的 `Common_Icon_Setting_Game`、`Common_Icon_Social`、`Event_Icon_Message`、`Event_Icon_Replay` 彩色原图，以 contain 等比显示。Event 的独立图集 bundle、SHA-256 与裁切元数据已记录。首页 `Dreamland_Nav_Home.png` 是内置 imagegen 生成并经用户确认、摆正的项目图标，**不是游戏原图**；配色参考指定素材，最终提示词为“保持已确认的蓝白房屋图标，仅将底座调水平、墙壁及门窗调竖直，保留描边、高光、右下阴影和透明背景”。它随源码保存并按哈希校验；素材恢复器保留这张已校验的项目图片，若文件丢失需从项目源码恢复，不能从游戏 CDN 下载。

工坊随机角色卡入口使用原始 `Event_Icon_CardShop`，偏好入口使用原始 `Event_Icon_MinigameOption`；两者来自同版本 Event 图集，裁切与来源哈希已登记。MomoTalk 字标保持原始 256 × 64（4:1）比例。

## 来源与提取

原始文件来自 Nexon 公开资源 CDN。同一版本的 [resource-data.json](https://ba.dn.nexoncdn.co.kr/com.nexon.bluearchive/e3ec4c1e969240ff/resource-data.json) 用于核对文件名与背景校验值。获取流程参考 [BA-AD 作者仓库](https://github.com/Deathemonic/BA-AD) 的公开版本与目录查询方式，没有读取账号、运行游戏客户端或使用第三方重新绘制的 PNG 包。

- UI 来源：[固定版本 AssetBundle](https://ba.dn.nexoncdn.co.kr/com.nexon.bluearchive/e3ec4c1e969240ff/Preload/Android/prologdepengroup-assets-_mx-uis-atlas-_mxprolog-2024-11-18_assets_all_1611534265.bundle)，1,832,133 字节；SHA-256 为 `0e70ed53933a136bc1d39deee742b283e377355219e4657e46245ef8f2954019`。
- 该 bundle 使用 NGUI 的 `Common` / `Emoji` Texture2D 与 UIAtlas `mSprites`。提取器按游戏元数据裁切，而不是按截图目测位置切图。
- 背景是同一版本 CDN 的原始 JPEG：`BG_SchaleOperationRoom.jpg`、`BG_MainOffice_Night.jpg`、`BG_View_Kivotos.jpg`；具体 URL、MD5 和 SHA-256 逐项保存在清单。
- [官方系统展示](https://bluearchive.jp/system) 与 [Kivo 背景目录](https://kivo.wiki/gallery/1) 用于构图和场景对照；最终包的来源记录统一指向原始 CDN 文件。

## 应用映射

| 应用区域 | 游戏部件 | 处理 |
| --- | --- | --- |
| MomoTalk 标题与首页标识 | `School_Icon_MomoTalk`、`Common_Icon_MoMoTalk`、`ImgFont_Momotalk` | 原始桃子、手机图片与游戏字标；说明文字由 HTML 提供 |
| 聊天气泡 | `School_Chat_BG` | 原始通用聊天气泡按元数据九宫格拉伸；应用在 MomoTalk 布局，不能称为完整 MomoTalk 专用贴图包 |
| 用户消息、暗色阅读 | `School_Chat_BG_Outgoing`、`School_Chat_BG_Dark` | 从上一原图保持透明度着色；用户气泡镜像尾部 |
| 记忆、次级确认与登录弹窗 | `Common_Popup_Bg` | 原始窗体边框、分隔线和阴影，九宫格伸缩；BA 设置、朋友圈和工坊使用整页容器 |
| 继续、确认、生成和发布 | `Common_Btn_BG`、`Common_Btn_Normal_B_S_Pt`、`Common_Btn_Normal_Y_S_Pt` | 完整底板保持 alpha 着色为蓝、黄，九宫格拉伸后倾斜；原始蓝、黄纹理保持轮廓叠加，文字正立 |
| 快捷卡片、取消和小工具 | `Common_Btn_BG` | 原始浅色底板及登记的暗色适配；保留按钮原有事件和图标 |
| 角色头像边框、记忆纸张 | `Card_Line_Char`、`Common_Bg_Paper` | 原始切角边框按元数据伸缩；纸张孔洞装饰与细分隔线用于只读核心详情 |
| 聊天、朋友圈、工坊、背景、设置、关于 | `School_Icon_Chat`、`Cafe_Icon_Photo`、`Cafe_Icon_NameEdit`、`Common_Icon_Outdoor`、`Common_Icon_Option`、`Cafe_Icon_Info` | 提取原始白色图形到 `Nav_*.png`；按当前按钮颜色显示，统一约 25px，无单独色块 |
| 搜索、新建、导入和已点赞 | `Common_Icon_Search`、`Common_Icon_Plus`、`Common_Icon_Copy`、`Common_Icon_Heart` | 使用原始图形与当前文字颜色；缺图时保留原按钮图标与点击行为 |
| 功能页标题栏 | `Common_Btn_Normal_B_S_Pt` | 回退后的低透明度按钮纹理与浅色渐变；Common_Top_Menu_Bg 和 Common_Reward_Deco 保留备用，已撤销标题栏应用 |
| 关闭 | `Common_Icon_Close` | 原始关闭图形按当前文字颜色显示，无独立强调色底块 |
| 首页亮/暗场景 | 夏莱工作室、夜间办公室 | 原始背景配阅读遮罩；“装饰关闭”隐藏场景 |
| 登录背景 | 基沃托斯城市 | 原始背景按窗口比例裁切显示 |

其余已提取部件是同一清单中的备用圆角、标题、搜索、返回、日程、朋友、表情和纹理。当前运行时按最多四个并发请求读取实际映射的 37 张图片；旧红色按钮纹理保留在清单作为历史适配，已不参与按钮加载。备用图片不代表已实现游戏的相应功能。

此前七个适配包括气泡、窗体和旧按钮暗色版本，按 RGB multiply 或去饱和着色保留 alpha。新增四个 `Common_Btn_Rose_*` 将原生红色纹理的明暗映射到登记的红色范围，保留原始透明度，避免纹理末端过暗或文字低对比。六个 `Nav_*` 仅提取原始白色 UI 图形与 alpha，去除彩色底块；聊天图标中的彩色圆点相应变为透明孔。适配的颜色范围、操作、用途、源文件和哈希全部登记，不能视为未经修改的游戏原图。没有使用生成式重绘或 AI 超分。

字标来自同版本的独立 Texture2D bundle，按对象名称、pathId、bundle SHA-256 与图片 SHA-256 校验。蓝、黄、暗色底板采用 `multiply-rgb-preserve-alpha`，已在清单登记；底板轮廓和原始阴影不变。恢复时传入 `--library resources/blue-archive/ui-library/1.93.454564` 可使用校验后的本地额外 bundle。

中文界面采用本地可分发的资源圆体子集，字体来源、修改、哈希和 OFL 许可见 [字体说明](../../fonts/dreamland-rounded/README.md)。字体读取失败时立即使用系统字体，不阻塞登录和聊天。截图候选 Blueaka 的分发许可尚未确认，当前未随项目打包。

## 校验与修复

素材直接保存在项目文件夹，正常使用无需下载或安装。`node scripts/prepare-blue-archive-assets.cjs --check` 可校验全部 73 张图片。文件损坏时可运行 [导入脚本](../../../scripts/import-blue-archive-assets.py)，其默认操作下载固定图集 bundle、字标 bundle 和三张背景，验证后恢复到 `bundled/`。恢复工具需要 Python、UnityPy 1.25.3、Pillow 12.3.0。依赖可安装到项目的忽略目录，PowerShell 示例：

```powershell
python -m pip install --target Cache/ba-theme-python UnityPy==1.25.3 Pillow==12.3.0
$env:PYTHONPATH = (Resolve-Path Cache/ba-theme-python).Path
python scripts/import-blue-archive-assets.py
```

也可通过 `--bundle <本地 bundle 路径>`、`--originals <三个原始 JPEG 所在目录>` 离线恢复。脚本校验整个包、图片解码及原始哈希后才替换文件；版本不匹配会报错，不会静默更新到其他游戏版本。固定 CDN 文件失效时，需要先重新核实版本与清单。

应用固定使用 **MomoTalk · 蔚蓝** 布局，仅请求同源本机 `/img/blue-archive/bundled/`，运行时不联网拉取游戏素材。每张图片失败后最多重试两次，并使用新 URL 避免失败缓存；成功图片立即使用。可在外观设置点击“重新检测”，网络恢复或返回前台也会重试失败项。状态区分图片读取失败与安装账目缺失，并显示失败文件；不会阻止聊天或清空草稿。恢复时在公开资源目录创建最终文件，再替换目标，避免把临时提取目录的私有 ACL 带入应用资源。

## 本地保存与分发

后续界面开发使用的完整 UI 素材库另存于项目 `resources/blue-archive/ui-library/1.93.454564/`，含 420 个原始 UI/依赖 bundle、7,212 张 PNG 和 21 个图集的裁切信息。该库排除剧情背景、立绘等内容资源，不参与应用启动加载；大体积归档通过同一仓库 GitHub Release 分发。检索、下载、重建及校验见[界面素材库说明](../../../resources/blue-archive/README.md)。

`bundled/` 中的 73 张固定图片及账目作为项目静态资源随项目保留。`local/` 仍是忽略目录，只保留历史提取结果和本机预览，不再作为加载路径。本机便携构建先校验全部图片，再单独复制固定清单中的图片和账目；不复制预览或其他本机文件。缺失、损坏或版本不符会在创建/清理输出目录前阻止构建，避免交付缺图包。资源来源与权利声明继续保留，不代表官方授权。

Blue Archive／蔚蓝档案及相关图像、标识归各自权利人所有。此主题为非官方、非商业的界面交流学习用途，DreamLand 与相关权利人不存在官方合作或授权关系。涉及权利问题可通过 [项目反馈](https://github.com/LeslieH666/LeslieTavern/issues) 联系处理。
