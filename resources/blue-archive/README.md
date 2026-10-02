# Blue Archive 界面素材库

固定来源版本：Global Android **1.93.454564**，获取日期：2026-10-02。本库供 DreamLand 后续界面开发选用，范围为 UI 图集、图标、按钮、面板、控件纹理及其字体、材质等依赖。

已下载 **420 个原始 AssetBundle**（298,765,384 字节），导出 **7,212 张 PNG**，其中包括 **21 个 NGUI 图集的 2,170 个部件**。PNG 是按资源条目计数，包含同版本预加载/正式加载图集的重叠项，并非 7,212 张互不重复的设计。裁切坐标、九宫格边框、透明边距、来源及 SHA-256 保存在索引。

剧情场景、立绘、角色展示图、游戏背景、宣传插画，以及模型、语音和音乐不在本次下载范围。完整资源清单里的 1,333 个内容类 UI bundle 已排除，排除路径保留在索引。少数 UI bundle 将控件与其他画面放在一起；原始包按目录归档，图片导出额外排除已知背景、立绘和插画命名。14 个零尺寸 `Font Texture` 是运行时生成的字体图集占位项，不含静态像素；原始包仍完整保留，索引单独记录。

## 本地位置与 GitHub 下载

素材保存在项目目录 `resources/blue-archive/ui-library/1.93.454564/`：

- `bundles/`：原始资源包，保留 CDN 的目录和文件名。
- `exported/Texture2D/`：完整纹理，含未拆分的原始图集。
- `exported/NGUI/`：按原始元数据拆出的独立控件。
- `manifest.json`：来源版本、原始大小、MD5、SHA-256、排除及失败清单。
- `index.json`：逐张 PNG、完整图集元数据及动态字体占位记录。

大体积素材库通过[同一仓库的 GitHub Release](https://github.com/LeslieH666/LeslieTavern/releases/tag/ba-ui-library-1.93.454564)分发。下载 `blue-archive-ui-1.93.454564.zip`，解压到 `resources/blue-archive/ui-library/`，即可恢复上述目录。下载地址、压缩包大小和 SHA-256 另存于 [ui-release.json](ui-release.json)。[ui-library-index.json](ui-library-index.json) 随源码提交，可在未下载图片时检索名称和来源。

PowerShell 搜索 MomoTalk、聊天气泡、按钮或窗体：

```powershell
$libraryIndex = Get-Content resources/blue-archive/ui-library-index.json -Raw | ConvertFrom-Json
$libraryIndex.images | Where-Object { $_.name -match 'MomoTalk|Chat_BG|Btn_|Popup' } | Select-Object name, type, file, size
```

这里的图片库不会在启动应用时整体加载，也不默认加入便携应用。实际运行所需的 37 张图片继续使用 `public/img/blue-archive/bundled/`，随源码和便携包分发，详见[运行素材说明](../../public/img/blue-archive/ASSETS.md)。本次未追加新的聊天或登录场景背景。

## 校验与重建

下载脚本只请求固定版本 CDN，支持断点续用；每个文件通过原始大小和 MD5 后才入库，同时生成 SHA-256。再次下载不会切换版本：

```powershell
node scripts/download-blue-archive-ui.cjs
node scripts/download-blue-archive-ui.cjs --check
```

解码及拆图需要 Python、UnityPy 1.25.3、Pillow 12.3.0。依赖放在项目忽略目录，不提交到源码：

```powershell
python -m pip install --target Cache/ba-ui-python UnityPy==1.25.3 Pillow==12.3.0
python scripts/export-blue-archive-ui.py --dependencies Cache/ba-ui-python
node scripts/package-blue-archive-ui.cjs
```

导出前会校验原始包 SHA-256；导出错误写入 `index.json` 并令任务失败，动态字体空占位单独登记。打包仅接受清单和图片索引内的文件，并复核每个哈希；输出在 `Cache/research/ba-ui-release/`，不会打包账号、聊天、配置或其他项目目录。重建压缩包的字节哈希可能因归档时间信息变化而不同，应使用新生成的 `ui-release.json`。

## 来源

- 实际原始文件来自 Nexon 的[固定版本资源清单](https://ba.dn.nexoncdn.co.kr/com.nexon.bluearchive/e3ec4c1e969240ff/resource-data.json)，每项 CDN 地址保存在索引。
- 版本和目录检索方法参考 [BA-AD 作者仓库](https://github.com/Deathemonic/BA-AD)。
- [官方系统展示](https://bluearchive.jp/system)用于界面结构参考；此前参考的 [Kivo 背景目录](https://kivo.wiki/gallery/1)未用于本次背景下载。

Blue Archive／蔚蓝档案图像、字体与标识归相应权利人所有。原始素材不因本项目源码许可证而变为 AGPL 授权。本库为非官方界面开发参考，不代表权利人授权或官方合作；涉及权利问题可通过[项目反馈](https://github.com/LeslieH666/LeslieTavern/issues)联系处理。
