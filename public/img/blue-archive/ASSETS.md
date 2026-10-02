# MomoTalk / Blue Archive 本机素材包

获取日期：2026-10-02。固定版本：Global Android **1.93.454564**。

当前 Blue 风格使用 MomoTalk 的粉色标题、会话列表与左右消息布局，并直接加载游戏图片。暗色采用暖炭灰与玫瑰色。项目随附 **27 个原始图集部件、3 张原始场景图和 7 个明确登记的着色适配**，图片合计约 1012 KiB，位于 `bundled/`。完整逐项信息在 [sources.json](sources.json)：包含下载地址、原图 SHA-256、图集名称、裁切坐标、NGUI 边框和透明边距；完整文件哈希保存在 `bundled/installed.json`。

## 来源与提取

原始文件来自 Nexon 公开资源 CDN。同一版本的 [resource-data.json](https://ba.dn.nexoncdn.co.kr/com.nexon.bluearchive/e3ec4c1e969240ff/resource-data.json) 用于核对文件名与背景校验值。获取流程参考 [BA-AD 作者仓库](https://github.com/Deathemonic/BA-AD) 的公开版本与目录查询方式，没有读取账号、运行游戏客户端或使用第三方重新绘制的 PNG 包。

- UI 来源：[固定版本 AssetBundle](https://ba.dn.nexoncdn.co.kr/com.nexon.bluearchive/e3ec4c1e969240ff/Preload/Android/prologdepengroup-assets-_mx-uis-atlas-_mxprolog-2024-11-18_assets_all_1611534265.bundle)，1,832,133 字节；SHA-256 为 `0e70ed53933a136bc1d39deee742b283e377355219e4657e46245ef8f2954019`。
- 该 bundle 使用 NGUI 的 `Common` / `Emoji` Texture2D 与 UIAtlas `mSprites`。提取器按游戏元数据裁切，而不是按截图目测位置切图。
- 背景是同一版本 CDN 的原始 JPEG：`BG_SchaleOperationRoom.jpg`、`BG_MainOffice_Night.jpg`、`BG_View_Kivotos.jpg`；具体 URL、MD5 和 SHA-256 逐项保存在清单。
- [官方系统展示](https://bluearchive.jp/system) 与 [Kivo 背景目录](https://kivo.wiki/gallery/1) 用于构图和场景对照；最终包的来源记录统一指向原始 CDN 文件。

## 应用映射

| 应用区域 | 游戏部件 | 处理 |
| --- | --- | --- |
| MomoTalk 标题与首页标识 | `School_Icon_MomoTalk`、`Common_Icon_MoMoTalk` | 原始桃子与手机图片；标题、说明文字由 HTML 提供 |
| 聊天气泡 | `School_Chat_BG` | 原始通用聊天气泡按元数据九宫格拉伸；应用在 MomoTalk 布局，不能称为完整 MomoTalk 专用贴图包 |
| 用户消息、暗色阅读 | `School_Chat_BG_Outgoing`、`School_Chat_BG_Dark` | 从上一原图保持透明度着色；用户气泡镜像尾部 |
| 记忆、次级确认与登录弹窗 | `Common_Popup_Bg` | 原始窗体边框、分隔线和阴影，九宫格伸缩；BA 设置、朋友圈和工坊使用整页容器 |
| 主要按钮和工具标题 | `Common_Btn_BG`、`Common_Btn_Normal_B_S_Pt`、`Common_Btn_Normal_Y_S_Pt` | 原始按钮底图与蓝/黄角部纹理；点击与文字仍由原控件提供 |
| 首页、朋友圈、工坊、背景、设置、关于及关闭 | `Common_Icon_ToLobby`、`School_Icon_Chat`、`Common_Icon_StudentRecord`、`Common_Icon_SpecialLobby`、`Common_Icon_Setting_Game`、`Common_Icon_Notice`、`Common_Icon_Close` | 按功能语义映射；白色图标使用有对比度的底色 |
| 首页亮/暗场景 | 夏莱工作室、夜间办公室 | 原始背景配阅读遮罩；“装饰关闭”隐藏场景 |
| 登录背景 | 基沃托斯城市 | 原始背景按窗口比例裁切显示 |

其余已提取部件是同一清单中的备用圆角、标题、搜索、返回、日程、朋友、表情和纹理。当前运行时按最多四个并发请求读取实际映射的 28 张图。备用图片不代表已实现游戏的相应功能。

七个适配文件为 `School_Chat_BG_Outgoing.png`、`School_Chat_BG_Dark.png`、`School_Chat_BG_Outgoing_Dark.png`、`Common_Popup_Bg_Dark.png`、`Common_Title_Bg_Dark.png`、`Common_Btn_Normal_B_S_Pt_Dark.png`、`Common_Btn_Normal_Y_S_Pt_Dark.png`。气泡和窗体使用 RGB multiply；暗色按钮纹理先去饱和再着色，全部保留原 alpha。暗色面板为 `#2d292f`，用户气泡为 `#6e4858`，两种按钮纹理为 `#a48494` / `#b7a779`。颜色与用途均登记在清单，不能视为未经修改的游戏原图。没有使用生成式重绘或 AI 超分。

## 校验与修复

素材直接保存在项目文件夹，正常使用无需下载或安装。`node scripts/prepare-blue-archive-assets.cjs --check` 可校验全部 37 张图片。文件损坏时可运行 [导入脚本](../../../scripts/import-blue-archive-assets.py)，其默认操作只下载上面的一个固定 bundle 和三张背景，验证后恢复到 `bundled/`。恢复工具需要 Python、UnityPy 1.25.3、Pillow 12.3.0。依赖可安装到项目的忽略目录，PowerShell 示例：

```powershell
python -m pip install --target Cache/ba-theme-python UnityPy==1.25.3 Pillow==12.3.0
$env:PYTHONPATH = (Resolve-Path Cache/ba-theme-python).Path
python scripts/import-blue-archive-assets.py
```

也可通过 `--bundle <本地 bundle 路径>`、`--originals <三个原始 JPEG 所在目录>` 离线恢复。脚本校验整个包、图片解码及原始哈希后才替换文件；版本不匹配会报错，不会静默更新到其他游戏版本。固定 CDN 文件失效时，需要先重新核实版本与清单。

应用固定使用 **MomoTalk · 蔚蓝** 布局，仅请求同源本机 `/img/blue-archive/bundled/`，运行时不联网拉取游戏素材。每张图片失败后最多重试两次，并使用新 URL 避免失败缓存；成功图片立即使用。可在外观设置点击“重新检测”，网络恢复或返回前台也会重试失败项。状态区分图片读取失败与安装账目缺失，并显示失败文件；不会阻止聊天或清空草稿。恢复时在公开资源目录创建最终文件，再替换目标，避免把临时提取目录的私有 ACL 带入应用资源。

## 本地保存与分发

后续界面开发使用的完整 UI 素材库另存于项目 `resources/blue-archive/ui-library/1.93.454564/`，含 420 个原始 UI/依赖 bundle、7,212 张 PNG 和 21 个图集的裁切信息。该库排除剧情背景、立绘等内容资源，不参与应用启动加载；大体积归档通过同一仓库 GitHub Release 分发。检索、下载、重建及校验见[界面素材库说明](../../../resources/blue-archive/README.md)。

`bundled/` 中的 37 张固定图片及账目作为项目静态资源随项目保留。`local/` 仍是忽略目录，只保留历史提取结果和本机预览，不再作为加载路径。本机便携构建先校验全部图片，再单独复制固定清单中的图片和账目；不复制预览或其他本机文件。缺失、损坏或版本不符会在创建/清理输出目录前阻止构建，避免交付缺图包。资源来源与权利声明继续保留，不代表官方授权。

Blue Archive／蔚蓝档案及相关图像、标识归各自权利人所有。此主题为非官方、非商业的界面交流学习用途，DreamLand 与相关权利人不存在官方合作或授权关系。涉及权利问题可通过 [项目反馈](https://github.com/LeslieH666/LeslieTavern/issues) 联系处理。
