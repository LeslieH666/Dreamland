import { APPEARANCE_KEYS, readAppearance } from './dreamland-appearance-core.js';

// Login reads the same local appearance without reading any account data.
let storage;
try { storage = localStorage; } catch { storage = null; }
document.body.dataset.dreamlandStyle = readAppearance(storage, 'style');
document.body.dataset.dreamlandDecoration = readAppearance(storage, 'decoration');
document.body.dataset.leslieDesignLanguage = 'dreamland';
function applyLoginScheme() {
    let mode;
    try { mode = storage?.getItem('leslie.theme.preference'); } catch { mode = null; }
    document.body.dataset.leslieColorScheme = ['light', 'dark'].includes(mode) ? mode : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
applyLoginScheme();
window.addEventListener('storage', event => {
    if (event.key === null || event.key === APPEARANCE_KEYS.style) document.body.dataset.dreamlandStyle = readAppearance(storage, 'style');
    if (event.key === null || event.key === 'leslie.theme.preference') applyLoginScheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLoginScheme);
