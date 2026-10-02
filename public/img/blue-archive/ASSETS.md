# MomoTalk / Blue Archive 本机素材包

获取日期：2026-10-02。固定版本：Global Android **1.93.454564**。

当前 Blue 风格使用 MomoTalk 的粉色标题、会话列表与左右消息布局，并直接加载游戏图片。暗色采用暖炭灰与玫瑰色。已安装 **27 个原始图集部件、3 张原始场景图和 7 个明确登记的着色适配**，图片合计约 1012 KiB。完整逐项信息在 [sources.json](sources.json)：包含下载地址、原图 SHA-256、图集名称、裁切坐标、NGUI 边框和透明边距；安装结果的哈希写入本机 `local/installed.json`。

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

其余已提取部件是同一清单中的备用圆角、标题、搜索、返回、日程、朋友、表情和纹理。当前运行时只预加载实际映射的 28 张图。备用图片不代表已实现游戏的相应功能。

七个适配文件为 `School_Chat_BG_Outgoing.png`、`School_Chat_BG_Dark.png`、`School_Chat_BG_Outgoing_Dark.png`、`Common_Popup_Bg_Dark.png`、`Common_Title_Bg_Dark.png`、`Common_Btn_Normal_B_S_Pt_Dark.png`、`Common_Btn_Normal_Y_S_Pt_Dark.png`。气泡和窗体使用 RGB multiply；暗色按钮纹理先去饱和再着色，全部保留原 alpha。暗色面板为 `#2d292f`，用户气泡为 `#6e4858`，两种按钮纹理为 `#a48494` / `#b7a779`。颜色与用途均登记在清单，不能视为未经修改的游戏原图。没有使用生成式重绘或 AI 超分。

## 在新工作区恢复

此工作区已经安装素材。其他工作区可运行 [导入脚本](../../../scripts/import-blue-archive-assets.py)，其默认操作只下载上面的一个固定 bundle 和三张背景。需要 Python、UnityPy 1.25.3、Pillow 12.3.0。依赖可安装到项目的忽略目录，PowerShell 示例：

```powershell
python -m pip install --target Cache/ba-theme-python UnityPy==1.25.3 Pillow==12.3.0
$env:PYTHONPATH = (Resolve-Path Cache/ba-theme-python).Path
python scripts/import-blue-archive-assets.py
```

也可通过 `--bundle <本地 bundle 路径>`、`--originals <三个原始 JPEG 所在目录>` 离线恢复。脚本校验整个包、图片解码及原始哈希后才替换文件；版本不匹配会报错，不会静默更新到其他游戏版本。固定 CDN 文件失效时，需要先重新核实版本与清单。

刷新页面，选择 **MomoTalk · 蔚蓝**。切换后仅请求同源本机 `/img/blue-archive/local/`，运行时不联网拉取游戏素材。整包缺失时使用基础界面，单个资源失败时其余图片仍可使用；不会阻止聊天或清空草稿。安装后须刷新以重新检测素材。

## 本地保存与分发

`local/` 是忽略目录，原图、适配、安装账目及含原图的本机预览均不进入 Git；便携打包脚本也明确排除此目录。代码、来源清单和导入脚本可以随项目提供。这与游戏图片的再分发权是不同事项，资源公开可下载不等于获得再分发许可。

Blue Archive／蔚蓝档案及相关图像、标识归各自权利人所有。此主题为非官方、非商业的界面交流学习用途，DreamLand 与相关权利人不存在官方合作或授权关系。涉及权利问题可通过 [项目反馈](https://github.com/LeslieH666/LeslieTavern/issues) 联系处理。
