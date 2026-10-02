/** Local BA artwork only. Loading never touches chat data or gates initialization. */
export const BA_ASSETS = Object.freeze({
    peach: 'School_Icon_MomoTalk.png',
    phone: 'Common_Icon_MoMoTalk.png',
    tile: 'Emoji_Momotalk.png',
    incoming: 'School_Chat_BG.png',
    outgoing: 'School_Chat_BG_Outgoing.png',
    outgoingDark: 'School_Chat_BG_Outgoing_Dark.png',
    incomingDark: 'School_Chat_BG_Dark.png',
    popup: 'Common_Popup_Bg.png',
    popupDark: 'Common_Popup_Bg_Dark.png',
    title: 'Common_Title_Bg.png',
    titleDark: 'Common_Title_Bg_Dark.png',
    primaryPattern: 'Common_Btn_Rose_Primary.png',
    primaryPatternDark: 'Common_Btn_Rose_Primary_Dark.png',
    softPattern: 'Common_Btn_Rose_Soft.png',
    softPatternDark: 'Common_Btn_Rose_Soft_Dark.png',
    back: 'Common_Icon_Back.png',
    close: 'Common_Icon_Close.png',
    settings: 'Nav_Settings.png',
    moments: 'Nav_Moments.png',
    workshop: 'Nav_Workshop.png',
    background: 'Nav_Background.png',
    home: 'Nav_Chat.png',
    about: 'Nav_About.png',
    search: 'Common_Icon_Search.png',
    plus: 'Common_Icon_Plus.png',
    copy: 'Common_Icon_Copy.png',
    heart: 'Common_Icon_Heart.png',
    pin: 'Common_Btn_Pin_01.png',
    scene: 'BG_SchaleOperationRoom.jpg',
    sceneDark: 'BG_MainOffice_Night.jpg',
    city: 'BG_View_Kivotos.jpg',
});


export function getBaAssetUrl(key) {
    return Object.hasOwn(BA_ASSETS, key) ? '/img/blue-archive/bundled/' + BA_ASSETS[key] : null;
}

/** Bounded concurrency and retry; successful images are available immediately. */
export async function loadBaAssets(loadImage, { keys = Object.keys(BA_ASSETS), retries = 2, concurrency = 4, onLoaded = () => {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const assets = {};
    let next = 0;
    async function worker() {
        while (next < keys.length) {
            const key = keys[next++];
            const url = getBaAssetUrl(key);
            if (!url) continue;
            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    const request = attempt ? url + '?retry=' + attempt + '&t=' + Date.now() : url;
                    await loadImage(request);
                    assets[key] = request;
                    onLoaded(key, request);
                    break;
                } catch {
                    if (attempt < retries) await pause(250 * (attempt + 1));
                }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
    return assets;
}

/** A completed/expired request always releases its handlers and timer. */
export function loadBaImage(url, { ImageClass = Image, timeout = 12000 } = {}) {
    return new Promise((resolve, reject) => {
        const picture = new ImageClass();
        let finished = false;
        let timer;
        const finish = error => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            picture.onload = null;
            picture.onerror = null;
            if (error) reject(error);
            else resolve();
        };
        picture.onload = () => finish();
        picture.onerror = () => finish(new Error('Local image unavailable'));
        timer = setTimeout(() => finish(new Error('Asset load timeout')), timeout);
        picture.src = url;
    });
}

let loading;
const loaded = {};
let failures = [];
let manifestMissing = false;
let initialized = false;

export function describeBaAssetStatus(status, failed = [], missing = false) {
    if (status === 'ready') return 'MomoTalk 与 BA 游戏素材已就绪，可离线使用。';
    if (status === 'loading') return '正在检测并读取本机游戏素材…';
    const files = failed.map(key => BA_ASSETS[key]).filter(Boolean);
    const detail = files.slice(0, 3).join('、') + (files.length > 3 ? '等' : '');
    if (status === 'missing' && missing) return '本机素材文件尚未恢复，请按素材说明导入后点击“重新检测”。';
    return (status === 'partial' ? '已加载 ' + (Object.keys(BA_ASSETS).length - files.length) + '/' + Object.keys(BA_ASSETS).length + ' 张素材。' : '素材暂时读取失败。')
        + (detail ? '待重试：' + detail + '。' : '') + '可点击“重新检测”，聊天仍可使用。';
}
function syncStatus() {
    const status = document.body.dataset.baAssets;
    for (const element of document.querySelectorAll('[data-ba-asset-status]')) {
        const text = describeBaAssetStatus(status, failures, manifestMissing);
        if (element.textContent !== text) element.textContent = text;
    }
    for (const button of document.querySelectorAll('[data-ba-asset-retry]')) {
        button.disabled = Boolean(loading);
        button.textContent = loading ? '检测中…' : '重新检测';
    }
}
function applyImages() {
    const dark = document.body.dataset.leslieColorScheme === 'dark';
    for (const [alias, key] of Object.entries({
        bubble: dark ? 'incomingDark' : 'incoming',
        panel: dark ? 'popupDark' : 'popup',
        heading: dark ? 'titleDark' : 'title',
        scenery: dark ? 'sceneDark' : 'scene',
        outgoing: dark ? 'outgoingDark' : 'outgoing',
        primaryPattern: dark ? 'primaryPatternDark' : 'primaryPattern',
        softPattern: dark ? 'softPatternDark' : 'softPattern',
    })) {
        document.body.style.setProperty('--ba-' + alias, loaded[key] ? 'url("' + loaded[key] + '")' : 'none');
    }
    document.body.toggleAttribute('data-ba-bubbles', Boolean(loaded[dark ? 'incomingDark' : 'incoming'] && loaded[dark ? 'outgoingDark' : 'outgoing']));
    document.body.toggleAttribute('data-ba-panels', Boolean(loaded[dark ? 'popupDark' : 'popup']));
    for (const key of ['search', 'plus', 'copy', 'heart', 'home', 'workshop']) document.body.toggleAttribute('data-ba-' + key, Boolean(loaded[key]));
    // Each available icon can be used even when an unrelated picture fails.
    for (const [action, key] of Object.entries({ home: 'home', moments: 'moments', workshop: 'workshop', background: 'background', settings: 'settings', about: 'about' })) {
        for (const icon of document.querySelectorAll('.dreamland-navigation [data-action="' + action + '"] i')) icon.toggleAttribute('data-ba-icon', Boolean(loaded[key]));
    }
}
async function checkManifest() {
    try {
        const response = await fetch('/img/blue-archive/bundled/installed.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        manifestMissing = response.status === 404;
    } catch { manifestMissing = false; }
}
export function retryBaAssets() {
    if (loading || typeof document === 'undefined' || !document.body) return loading;
    document.body.dataset.baAssets = 'loading';
    const keys = Object.keys(BA_ASSETS).filter(key => !loaded[key]);
    // Login framing and the principal bubbles come first.
    keys.sort((a, b) => Number(['popup', 'popupDark', 'city', 'incoming', 'outgoing'].includes(b)) - Number(['popup', 'popupDark', 'city', 'incoming', 'outgoing'].includes(a)));
    loading = Promise.all([
        checkManifest(),
        loadBaAssets(loadBaImage, { keys, onLoaded(key, url) {
            loaded[key] = url;
            document.body.style.setProperty('--ba-' + key, 'url("' + url + '")');
            applyImages();
        } }),
    ]).then(() => {
        failures = Object.keys(BA_ASSETS).filter(key => !loaded[key]);
        document.body.dataset.baAssets = failures.length ? (Object.keys(loaded).length ? 'partial' : 'missing') : 'ready';
    }).catch(() => {
        document.body.dataset.baAssets = Object.keys(loaded).length ? 'partial' : 'missing';
    }).finally(() => {
        loading = null;
        applyImages();
        syncStatus();
    });
    syncStatus();
    return loading;
}
export function syncBaAppearance() {
    if (typeof document === 'undefined' || !document.body) return;
    document.querySelector('.leslie-brand')?.setAttribute('aria-label', 'MomoTalk · DreamLand');
    if (!initialized) {
        initialized = true;
        document.addEventListener('click', event => {
            if (event.target instanceof Element && event.target.closest('[data-ba-asset-retry]')) void retryBaAssets();
        });
        window.addEventListener('online', () => {
            if (document.body.dataset.baAssets !== 'ready') void retryBaAssets();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && document.body.dataset.baAssets !== 'ready') void retryBaAssets();
        });
        void retryBaAssets();
    }
    applyImages();
    syncStatus();
}
