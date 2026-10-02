/** One MomoTalk layout with rose controls, scenery and display mode. */
import { APPEARANCE_KEYS, readAppearance, writeAppearance } from './dreamland-appearance-core.js';
import { normalizePalette, applyDreamlandPalette } from './dreamland-palette.js';
import { syncBaAppearance } from './dreamland-ba-assets.js';
import { syncDreamlandPages } from './dreamland-pages.js';

const MODE_KEY = 'leslie.theme.preference';
const PALETTE_KEY = 'leslie.color.palette';
const MODES = {
    auto: { label: '跟随系统', icon: 'fa-circle-half-stroke' },
    light: { label: '亮色', icon: 'fa-sun' },
    dark: { label: '暗色', icon: 'fa-moon' },
};
function storage() {
    try { return localStorage; } catch { return null; }
}
function readMode() {
    try {
        const value = storage()?.getItem(MODE_KEY);
        return Object.hasOwn(MODES, value) ? value : 'auto';
    } catch { return 'auto'; }
}
function readPalette() {
    try { return normalizePalette(storage()?.getItem(PALETTE_KEY)); } catch { return 'rose'; }
}
function applyAppearance() {
    if (!document.body?.classList.contains('leslie-modern')) return;
    const body = document.body;
    body.dataset.leslieDesignLanguage = 'dreamland';
    body.dataset.dreamlandStyle = 'blue';
    const mode = body.dataset.leslieThemePreference || readMode();
    body.dataset.leslieThemePreference = mode;
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    body.dataset.leslieColorScheme = dark ? 'dark' : 'light';
    applyDreamlandPalette(body, body.dataset.leslieColorPalette || readPalette(), dark);
    for (const key of ['decoration', 'background']) {
        const attribute = 'dreamland' + key[0].toUpperCase() + key.slice(1);
        body.dataset[attribute] ||= readAppearance(storage(), key);
    }
    syncControls();
}
function chooseMode(mode) {
    if (!Object.hasOwn(MODES, mode)) return;
    try { storage()?.setItem(MODE_KEY, mode); } catch { /* session-only appearance */ }
    document.body.dataset.leslieThemePreference = mode;
    applyAppearance();
}
function heading(text) {
    const node = document.createElement('div');
    node.className = 'leslie-theme-menu-heading';
    node.textContent = text;
    node.setAttribute('role', 'presentation');
    return node;
}
function ensureMenu() {
    let menu = document.getElementById('leslie-theme-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'leslie-theme-menu';
    menu.className = 'leslie-theme-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'MomoTalk 外观');
    menu.append(heading('明暗模式'));
    for (const [mode, meta] of Object.entries(MODES)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.leslieThemeMode = mode;
        button.setAttribute('role', 'menuitemradio');
        button.innerHTML = '<i class="fa-solid ' + meta.icon + '" aria-hidden="true"></i><span>' + meta.label + '</span>';
        button.addEventListener('click', () => { chooseMode(mode); closeMenu(); });
        menu.append(button);
    }
    document.body.append(menu);
    return menu;
}
function closeMenu() {
    const menu = document.getElementById('leslie-theme-menu');
    if (menu) { menu.hidden = true; delete menu.dataset.open; }
    document.querySelectorAll('.leslie-theme-toggle').forEach(button => button.setAttribute('aria-expanded', 'false'));
}
function toggleMenu(anchor) {
    const menu = ensureMenu();
    const open = menu.hidden || anchor.getAttribute('aria-expanded') !== 'true';
    closeMenu();
    if (!open) return;
    menu.hidden = false;
    menu.dataset.open = 'true';
    anchor.setAttribute('aria-expanded', 'true');
    const bounds = anchor.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(bounds.right - size.width, innerWidth - size.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(bounds.bottom + 6, innerHeight - size.height - 8)) + 'px';
}
function syncControls() {
    syncBaAppearance();
    syncDreamlandPages();
    const mode = document.body.dataset.leslieThemePreference || readMode();
    for (const button of document.querySelectorAll('.leslie-theme-toggle')) {
        button.title = 'MomoTalk 外观：' + MODES[mode].label;
        button.setAttribute('aria-label', button.title);
    }
    for (const choice of document.querySelectorAll('#leslie-theme-menu [role="menuitemradio"]')) {
        const selected = choice.dataset.leslieThemeMode === mode;
        choice.classList.toggle('is-active', selected);
        choice.setAttribute('aria-checked', String(selected));
    }
    for (const [id, value] of [['leslie-display-mode-select', mode]]) {
        const select = document.getElementById(id);
        if (select) select.value = value;
    }
    for (const key of Object.keys(APPEARANCE_KEYS)) {
        const select = document.getElementById('dreamland-' + key + '-select');
        if (select) select.value = document.body.dataset['dreamland' + key[0].toUpperCase() + key.slice(1)] || readAppearance(storage(), key);
    }
}
function initialize() {
    applyAppearance();
    const host = document.querySelector('.leslie-sidebar-actions');
    if (host && !host.querySelector('.leslie-theme-toggle')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'leslie-icon-button leslie-theme-toggle';
        button.innerHTML = '<i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i>';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', event => { event.stopPropagation(); toggleMenu(button); });
        host.prepend(button);
    }
    ensureMenu();
    syncControls();
}
document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.id === 'leslie-display-mode-select') chooseMode(target.value);
    else if (['decoration', 'background'].includes(target.dataset.dreamlandPreference)) {
        const key = target.dataset.dreamlandPreference;
        document.body.dataset['dreamland' + key[0].toUpperCase() + key.slice(1)] = writeAppearance(storage(), key, target.value);
        syncControls();
    }
}, true);
document.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && !event.target.closest('#leslie-theme-menu, .leslie-theme-toggle')) closeMenu();
}, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.addEventListener('dreamland:appearance-ready', syncControls);
window.addEventListener('resize', closeMenu);
window.addEventListener('storage', event => {
    if (event.key === null || event.key?.startsWith('leslie.') || event.key?.startsWith('dreamland.appearance.')) {
        for (const key of ['leslieThemePreference', 'leslieColorPalette', 'dreamlandDecoration', 'dreamlandBackground']) delete document.body.dataset[key];
        applyAppearance();
    }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
let frame;
const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
        initialize();
        if (document.querySelector('.leslie-sidebar-actions .leslie-theme-toggle')) observer.disconnect();
    });
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
observer.observe(document.body, { childList: true, subtree: true });
