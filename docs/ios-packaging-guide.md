# iOS 打包指南（独立 .ipa）

> 目标：把 `apps/mobile`（React Native + Expo SDK 57）打包成**脱离 Expo Go 的独立 iOS 应用**，装到真机试用。
> 现状：SDK 57 已匹配 App Store 的 Expo Go，可先走 Expo Go 快速验证（`exp://192.168.5.220:8081`）。本文档是「正式打包」路径。

## 0. 前置条件

| 项 | 状态 | 说明 |
|---|---|---|
| Expo 账号 | ✅ 已有 `lesliehuang` | CLI 已登录 |
| Apple Developer 账号 | ❓ 需确认 | 装真机需要签名（个人 $99/年，或免费个人签名 7 天有效期） |
| iPhone 设备 UDID | ❓ 需获取 | Ad Hoc / 开发签名要用 |
| CocoaPods | ❌ 未装 | 仅本地构建需要；EAS 云构建不需要 |
| Xcode | ⚠️ 部分 | 有 CLI + 运行时，但 Simulator.app GUI 缺失；打包真机 .ipa 用 EAS 可绕开 Xcode |

## 1. 推荐路径：EAS 云构建（不依赖本机 Xcode/CocoaPods）

EAS 是 Expo 的云端构建服务，在 Expo 服务器上完成签名打包，本机只需装 EAS CLI。

```bash
cd apps/mobile
# 1) 装 EAS CLI（或 npx eas-cli）
npm i -g eas-cli

# 2) 登录（复用已有 Expo 账号）
eas login            # 会打开浏览器，登录 lesliehuang

# 3) 初始化 EAS 配置（生成 eas.json + 更新 app.json）
eas build:configure

# 4) 构建（preview = Ad Hoc，可装到已注册 UDID 的真机）
eas build -p ios --profile preview
```

构建完成后 EAS 会给一个下载链接 / 二维码，iPhone 扫码即可安装。

### Apple 签名准备（首次要配，在 expo.dev 或用 `eas credentials`）

1. 在 Apple Developer 后台建 **App ID**（bundle id 已定为 `com.dreamland.mobile`）。
2. 注册 iPhone 的 **UDID**（Xcode → Window → Devices；或第三方工具查）。
3. 建 **Ad Hoc 分发证书 + Provisioning Profile**（包含该 UDID）。
4. 用 `eas credentials` 把证书/Profile 导入 EAS，或让 EAS 自动管理（`eas build` 会引导）。

### eas.json 建议（preview profile）

```jsonc
{
  "cli": { "version": ">= 57.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "production": {
      "distribution": "store"
    }
  }
}
```

## 2. 备选路径：本地构建（需要 Xcode + CocoaPods + 签名）

```bash
cd apps/mobile
# 1) 装 CocoaPods（需要 sudo 密码）
sudo gem install cocoapods

# 2) 生成 ios/ 原生工程
npx expo prebuild -p ios

# 3) 连上 iPhone，构建并安装（需要 Xcode signing 配好）
npx expo run:ios --device
```

> 本机当前无 CocoaPods、无 ios/ 目录，走这条要先装 CocoaPods + 配 Xcode 签名，比 EAS 重，仅在本机网络受限时才选。

## 3. 关键配置（打包前确认）

- **后端地址**：`apps/mobile/App.tsx` 读 `EXPO_PUBLIC_API_URL`，默认 `http://127.0.0.1:18790`。
  - 打包时要把后端地址定死成生产地址：`EXPO_PUBLIC_API_URL=https://dreamland.clarixe.top`。
  - 用 `eas build -p ios --profile preview` 前，通过 `.env` 或 `eas.json` 的 `env` 字段注入。
- **bundle id**：`com.dreamland.mobile`（app.json 已定，正式上架前可能需改）。
- **scheme**：`dreamland`（app.json）。
- **TTS**：已用 `expo-audio`（expo-av 已移除）。

## 4. 常见坑

- EAS 构建需要 Expo 账号 + Apple 账号**同一个团队**能创建证书；个人免费账号做的开发证书 **7 天过期**，付费账号 Ad Hoc 证书约 1 年。
- 真机首次安装「未受信任开发者」：iPhone 设置 → 通用 → VPN 与设备管理 → 信任该证书。
- 若只想快速真机试，优先 **Expo Go**（SDK 57 匹配），不必打包。
