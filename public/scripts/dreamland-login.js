import { APPEARANCE_KEYS, readAppearance } from './dreamland-appearance-core.js';
import { syncBaAppearance } from './dreamland-ba-assets.js';
import { LOGIN_APPEARANCE_KEY, loginAppearance } from './leslie-preferences-core.js';
import { applyDreamlandPalette } from './dreamland-palette.js';
import { applyGlassAppearance, clearGlassAppearance } from './dreamland-glass.js';

// Login reads the same local appearance without reading any account data.
let storage;
try { storage = localStorage; } catch { storage = null; }
let appearance = {};
try { appearance = loginAppearance(JSON.parse(storage?.getItem(LOGIN_APPEARANCE_KEY) || '{}')); } catch { /* no saved hint */ }
function applyAppearance(values) {
    appearance = loginAppearance(values);
    const preferences = { getItem: key => appearance[key] ?? storage?.getItem(key) };
    clearGlassAppearance(document.body);
    applyGlassAppearance(document.body, preferences);
    document.body.dataset.dreamlandStyle = readAppearance(preferences, 'style');
    document.body.dataset.dreamlandDecoration = readAppearance(preferences, 'decoration');
    document.body.dataset.leslieDesignLanguage = 'dreamland';
    applyLoginScheme();
}
function applyLoginScheme() {
    let mode;
    try { mode = appearance['leslie.theme.preference'] ?? storage?.getItem('leslie.theme.preference'); } catch { mode = null; }
    document.body.dataset.leslieColorScheme = ['light', 'dark'].includes(mode) ? mode : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyDreamlandPalette(document.body, appearance['leslie.color.palette'], document.body.dataset.leslieColorScheme === 'dark');
    syncBaAppearance();
}
applyAppearance(window.LeslieLoginAppearance || appearance);
window.addEventListener('dreamland-login-appearance', event => applyAppearance(event.detail));
window.addEventListener('storage', event => {
    if ([APPEARANCE_KEYS.glassTransparency, APPEARANCE_KEYS.glassBlur].includes(event.key)) {
        applyAppearance({ ...appearance, [event.key]: event.newValue });
        return;
    }
    if (event.key === LOGIN_APPEARANCE_KEY) {
        try { applyAppearance(JSON.parse(storage?.getItem(LOGIN_APPEARANCE_KEY) || '{}')); } catch { /* keep the current appearance */ }
        return;
    }
    if (event.key === null || event.key === APPEARANCE_KEYS.style) document.body.dataset.dreamlandStyle = readAppearance(storage, 'style');
    if (event.key === null || event.key === 'leslie.theme.preference') applyLoginScheme();
    syncBaAppearance();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLoginScheme);
