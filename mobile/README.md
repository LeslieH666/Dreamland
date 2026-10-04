# DreamLand Android apps

This workspace builds two Android apps from the same native shell and shared capability module: `clientDebug` connects to a DreamLand server on a trusted local network, while `standaloneDebug` runs the DreamLand Node.js service inside the app and stores data in the phone's private app directory. The first standalone beta targets Android arm64 devices (Android 8+).

The standalone beta uses the Node.js 24 Android runtime from the `fogtape/nodejs-mobile` pre-release line. The pinned archive is checked against its SHA-256 digest before staging. Tracked DreamLand server files, production npm dependencies and the Android capability shim are bundled; the computer's `data/`, `Config/`, secrets, logs and runtime folders are excluded.

## Build

Load the Android toolchain, stage the verified Node runtime and server dependencies, then build the standalone beta APK:

```powershell
. D:\Projects\AndroidBuildEnv\activate.ps1
cd D:\Projects\Leslietavern
powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\android\prepare-standalone-beta.ps1
cd D:\Projects\Leslietavern\mobile\android
.\gradlew.bat assembleStandaloneDebug
```

Output: `mobile/android/app/build/outputs/apk/standalone/debug/app-standalone-debug.apk`.

The standalone beta serves only at 127.0.0.1:18790, not over the LAN. Its data survives app updates but is removed if Android app data is cleared or the app is uninstalled. Desktop-data migration and on-device chat acceptance still need testing. Mobile local-model management and AIRI are disabled. The connected client continues to block other private-network origins.

Build the computer-connected client with .\gradlew.bat assembleClientDebug; its APK is written under app/build/outputs/apk/client/debug/.

This debug beta is for direct installation and evaluation. It uses Android's debug signing key; a release build needs a user-owned signing key. The Node mobile runtime is a third-party pre-release. Launch and standalone settings navigation were verified on an Android 16 ARM64 phone; connected desktop chat, on-device data persistence and desktop-data migration still need acceptance testing.
