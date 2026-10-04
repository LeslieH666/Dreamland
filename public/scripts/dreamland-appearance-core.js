/** One MomoTalk layout; colors and scenery remain independent preferences. */
export const DREAMLAND_STYLES = Object.freeze({
    blue: { label: 'MomoTalk · 蔚蓝', english: 'Blue', description: 'MomoTalk 主界面 · BA 游戏素材', icon: 'fa-comment-dots' },
});

export const APPEARANCE_KEYS = Object.freeze({
    style: 'dreamland.appearance.style',
    decoration: 'dreamland.appearance.decoration',
    background: 'dreamland.appearance.background',
    glassTransparency: 'dreamland.appearance.glassTransparency',
    glassBlur: 'dreamland.appearance.glassBlur',
});
export const GLASS_RANGES = Object.freeze({
    glassTransparency: { min: 0, max: 100, default: '28' },
    glassBlur: { min: 0, max: 48, default: '24' },
});

export function validGlassValue(key, value) {
    const range = GLASS_RANGES[key];
    return Boolean(range && typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
        && Number(value) >= range.min && Number(value) <= range.max);
}
const OPTIONS = Object.freeze({
    style: Object.keys(DREAMLAND_STYLES),
    decoration: ['subtle', 'off'],
    background: ['off', 'soft', 'visible'],
});
const DEFAULTS = Object.freeze({ style: 'blue', decoration: 'subtle', background: 'off' });

/** Validate preferences before applying them to DOM attributes or saving them. */
export function normalizeAppearance(key, value) {
    if (GLASS_RANGES[key]) return validGlassValue(key, value) ? value : GLASS_RANGES[key].default;
    return OPTIONS[key]?.includes(value) ? value : DEFAULTS[key];
}

/** Read only presentation state; blocked storage uses the safe default. */
export function readAppearance(storage, key) {
    try {
        return normalizeAppearance(key, storage?.getItem(APPEARANCE_KEYS[key]));
    } catch {
        return GLASS_RANGES[key]?.default ?? DEFAULTS[key];
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
