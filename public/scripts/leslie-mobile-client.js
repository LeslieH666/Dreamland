const DREAMLAND_ANDROID_CLIENT_MARKER = 'DreamLandAndroidClient/';
const DREAMLAND_ANDROID_STANDALONE_MARKER = 'DreamLandAndroidStandalone/';

/** True only inside the dedicated DreamLand Android WebView. */
export function isDreamLandAndroidClient() {
    return typeof navigator !== 'undefined'
        && (navigator.userAgent.includes(DREAMLAND_ANDROID_CLIENT_MARKER)
            || navigator.userAgent.includes(DREAMLAND_ANDROID_STANDALONE_MARKER));
}

/** True only inside the on-device DreamLand server WebView. */
export function isDreamLandAndroidStandalone() {
    return typeof navigator !== 'undefined' && navigator.userAgent.includes(DREAMLAND_ANDROID_STANDALONE_MARKER);
}

/** The connected Android client does not expose desktop-only services. */
export function getDreamLandClientCapabilities() {
    const androidClient = isDreamLandAndroidClient();
    return Object.freeze({
        localModelManagement: !androidClient,
        airiCompanion: !androidClient,
        localServer: isDreamLandAndroidStandalone(),
    });
}
