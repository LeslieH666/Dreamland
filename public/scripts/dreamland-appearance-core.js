/** One MomoTalk layout; colors and scenery remain independent preferences. */
export const DREAMLAND_STYLES = Object.freeze({
    blue: { label: 'MomoTalk · 蔚蓝', english: 'Blue', description: 'MomoTalk 主界面 · BA 游戏素材', icon: 'fa-comment-dots' },
});

export const APPEARANCE_KEYS = Object.freeze({
    style: 'dreamland.appearance.style',
    decoration: 'dreamland.appearance.decoration',
    background: 'dreamland.appearance.background',
});
const OPTIONS = Object.freeze({
    style: Object.keys(DREAMLAND_STYLES),
    decoration: ['subtle', 'off'],
    background: ['off', 'soft', 'visible'],
});
const DEFAULTS = Object.freeze({ style: 'blue', decoration: 'subtle', background: 'off' });

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
