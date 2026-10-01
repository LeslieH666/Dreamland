/** Browser-only appearance preferences. Chat and account schemas stay untouched. */
export const DREAMLAND_STYLES = Object.freeze({
    clear: { label: '澄光', english: 'Clear', description: '轻盈蓝灰 · 连续会话', icon: 'fa-cloud-sun' },
    moon: { label: '月幕', english: 'Moon', description: '静谧夜色 · 顶部导航', icon: 'fa-moon' },
    paper: { label: '梦境手帖', english: 'Paper', description: '暖纸墨绿 · 书页阅读', icon: 'fa-book-open' },
    blue: { label: '蔚蓝终端', english: 'Blue', description: '蓝白几何 · BA 灵感', icon: 'fa-shapes' },
});

export const APPEARANCE_KEYS = Object.freeze({
    style: 'dreamland.appearance.style',
    decoration: 'dreamland.appearance.decoration',
    background: 'dreamland.appearance.background',
});
const OPTIONS = Object.freeze({
    style: Object.keys(DREAMLAND_STYLES),
    decoration: ['full', 'subtle', 'off'],
    background: ['off', 'soft', 'visible'],
});
const DEFAULTS = Object.freeze({ style: 'clear', decoration: 'subtle', background: 'off' });

/** Validate preferences before applying them to DOM attributes or saving them. */
export function normalizeAppearance(key, value) {
    return OPTIONS[key]?.includes(value) ? value : DEFAULTS[key];
}

/** Read only presentation state; blocked storage uses the safe default. */
export function readAppearance(storage, key) {
    try {
        return normalizeAppearance(key, storage?.getItem(APPEARANCE_KEYS[key]));
    } catch {
        return DEFAULTS[key];
    }
}

/** Returns the validated selection even when persistence is unavailable. */
export function writeAppearance(storage, key, value) {
    const normalized = normalizeAppearance(key, value);
    if (!APPEARANCE_KEYS[key]) return undefined;
    try {
        storage?.setItem(APPEARANCE_KEYS[key], normalized);
    } catch {
        // Presentation can still change for this session in restricted webviews.
    }
    return normalized;
}
