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
    button: 'Common_Btn_BG.png',
    bluePattern: 'Common_Btn_Normal_B_S_Pt.png',
    bluePatternDark: 'Common_Btn_Normal_B_S_Pt_Dark.png',
    yellowPattern: 'Common_Btn_Normal_Y_S_Pt.png',
    yellowPatternDark: 'Common_Btn_Normal_Y_S_Pt_Dark.png',
    back: 'Common_Icon_Back.png',
    close: 'Common_Icon_Close.png',
    settings: 'Common_Icon_Setting_Game.png',
    moments: 'School_Icon_Chat.png',
    workshop: 'Common_Icon_StudentRecord.png',
    background: 'Common_Icon_SpecialLobby.png',
    home: 'Common_Icon_ToLobby.png',
    about: 'Common_Icon_Notice.png',
    pin: 'Common_Btn_Pin_01.png',
    scene: 'BG_SchaleOperationRoom.jpg',
    sceneDark: 'BG_MainOffice_Night.jpg',
    city: 'BG_View_Kivotos.jpg',
});

export function getBaAssetUrl(key) {
    return Object.hasOwn(BA_ASSETS, key) ? `/img/blue-archive/local/${BA_ASSETS[key]}` : null;
}

/** One missing image cannot reject the other images or prevent normal chat. */
export async function loadBaAssets(loadImage) {
    const results = await Promise.allSettled(Object.entries(BA_ASSETS).map(async ([key]) => {
        const url = getBaAssetUrl(key);
        await loadImage(url);
        return [key, url];
    }));
    return Object.fromEntries(results.filter(result => result.status === 'fulfilled').map(result => result.value));
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => reject(new Error('Asset load timeout')), 5000);
        const finish = callback => () => {
            clearTimeout(timer);
            callback();
        };
        image.onload = finish(resolve);
        image.onerror = finish(() => reject(new Error('Local image unavailable')));
        image.src = url;
    });
}

let loading;
let loaded = {};

function syncStatus() {
    for (const element of document.querySelectorAll('[data-ba-asset-status]')) {
        const status = document.body.dataset.baAssets;
        const text = status === 'ready' ? 'MomoTalk 与 BA 游戏素材已就绪，可离线使用。'
            : status === 'partial' ? '部分游戏图片未能读取；可用图片已加载，聊天仍可使用。'
                : status === 'missing' ? '尚未安装本机游戏素材包；当前使用基础界面。' : '正在读取本机游戏素材…';
        if (element.textContent !== text) element.textContent = text;
    }
}

export function syncBaAppearance() {
    if (typeof document === 'undefined' || !document.body) return;
    const active = document.body.dataset.leslieDesignLanguage === 'dreamland' && document.body.dataset.dreamlandStyle === 'blue';
    const brand = document.querySelector('.leslie-brand');
    brand?.setAttribute('aria-label', active ? 'MomoTalk · DreamLand' : 'DreamLand');
    if (!active) return;
    if (!loading) {
        document.body.dataset.baAssets = 'loading';
        loading = loadBaAssets(loadImage).then(assets => {
            loaded = assets;
            for (const [key, url] of Object.entries(assets)) {
                document.body.style.setProperty(`--ba-${key}`, `url("${url}")`);
            }
            const count = Object.keys(assets).length;
            document.body.dataset.baAssets = count === Object.keys(BA_ASSETS).length ? 'ready' : count ? 'partial' : 'missing';
            syncBaAppearance();
        });
    }
    const dark = document.body.dataset.leslieColorScheme === 'dark';
    for (const [alias, key] of Object.entries({
        bubble: dark ? 'incomingDark' : 'incoming',
        panel: dark ? 'popupDark' : 'popup',
        heading: dark ? 'titleDark' : 'title',
        scenery: dark ? 'sceneDark' : 'scene',
        outgoing: dark ? 'outgoingDark' : 'outgoing',
        bluePattern: dark ? 'bluePatternDark' : 'bluePattern',
        yellowPattern: dark ? 'yellowPatternDark' : 'yellowPattern',
    })) {
        document.body.style.setProperty(`--ba-${alias}`, loaded[key] ? `url("${loaded[key]}")` : 'none');
    }
    document.body.toggleAttribute('data-ba-bubbles', Boolean(loaded[dark ? 'incomingDark' : 'incoming'] && loaded[dark ? 'outgoingDark' : 'outgoing']));
    document.body.toggleAttribute('data-ba-panels', Boolean(loaded[dark ? 'popupDark' : 'popup']));
    syncStatus();
}
