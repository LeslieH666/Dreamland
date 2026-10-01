/**
 * Keeps Leslie's semantic light/dark palette aligned with the currently
 * selected SillyTavern theme without changing or saving theme data.
 */

import {
    DESIGN_LANGUAGES,
    readDesignLanguagePreference,
    writeDesignLanguagePreference,
} from './leslie-design-language-core.js';
import { APPEARANCE_KEYS, DREAMLAND_STYLES, readAppearance, writeAppearance } from './dreamland-appearance-core.js';

const DARK_LUMINANCE_THRESHOLD = 0.42;
const THEME_PREFERENCE_KEY = 'leslie.theme.preference';
const COLOR_PALETTE_KEY = 'leslie.color.palette';
const THEME_MODES = Object.freeze(['auto', 'light', 'dark']);
const COLOR_PALETTES = Object.freeze(['jade', 'iris', 'clay', 'slate']);

const COLOR_PALETTE_META = Object.freeze({
    jade: { label: '青瓷', description: '柔和的青绿与暖白', light: '#23766e', dark: '#75c8ba' },
    iris: { label: '鸢尾', description: '克制的蓝紫与雾白', light: '#5656a5', dark: '#aaa9e9' },
    clay: { label: '暖砂', description: '陶土橘与奶油白', light: '#a45138', dark: '#e7ac8b' },
    slate: { label: '石墨', description: '冷灰与低调蓝调', light: '#45647d', dark: '#9bbad1' },
});

const THEME_MODE_META = Object.freeze({
    auto: {
        label: '自动',
        description: '跟随应用主题',
        icon: 'fa-circle-half-stroke',
    },
    light: {
        label: '亮色',
        description: '始终使用亮色',
        icon: 'fa-sun',
    },
    dark: {
        label: '暗色',
        description: '始终使用暗色',
        icon: 'fa-moon',
    },
});

const DESIGN_LANGUAGE_META = Object.freeze({
    dreamland: {
        label: 'DreamLand',
        description: '澄光、月幕、梦境手帖、蔚蓝终端',
        icon: 'fa-cloud',
    },
    cupertino: {
        label: 'Cupertino',
        description: 'Apple 风格的新界面',
        icon: 'fa-mobile-screen-button',
    },
    classic: {
        label: '经典',
        description: '重构前的 Telegram 风格',
        icon: 'fa-paper-plane',
    },
});

/**
 * Access localStorage without breaking restricted or sandboxed webviews.
 * @returns {Storage | null} Browser storage when available.
 */
function getBrowserStorage() {
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

/**
 * Convert an sRGB channel to a linear-light channel.
 * @param {number} channel Channel value between 0 and 255.
 * @returns {number} Linear-light channel value.
 */
function linearize(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Read the RGB channels from a CSS rgb/rgba color.
 * @param {string} color CSS color value.
 * @returns {number[] | null} RGB channels, or null when parsing fails.
 */
function parseRgb(color) {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    return channels?.length === 3 && channels.every(Number.isFinite) ? channels : null;
}

/**
 * Infer whether the active SillyTavern UI tint is dark.
 * @returns {'light' | 'dark'} Leslie color scheme.
 */
function getAutomaticColorScheme() {
    const rootStyle = getComputedStyle(document.documentElement);
    const tint = rootStyle.getPropertyValue('--SmartThemeBlurTintColor').trim();
    const channels = parseRgb(tint);

    if (!channels) {
        return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    const [red, green, blue] = channels.map(linearize);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return luminance < DARK_LUMINANCE_THRESHOLD ? 'dark' : 'light';
}

/**
 * Read the local presentation-only theme preference.
 * @returns {'auto' | 'light' | 'dark'} Theme preference.
 */
function getThemePreference() {
    try {
        const storedPreference = localStorage.getItem(THEME_PREFERENCE_KEY);
        return THEME_MODES.includes(storedPreference) ? storedPreference : 'auto';
    } catch {
        return 'auto';
    }
}

function getColorPalette() {
    try {
        const stored = localStorage.getItem(COLOR_PALETTE_KEY);
        return COLOR_PALETTES.includes(stored) ? stored : 'jade';
    } catch {
        return 'jade';
    }
}

function setColorPalette(palette) {
    if (!COLOR_PALETTES.includes(palette)) return;
    try {
        localStorage.setItem(COLOR_PALETTE_KEY, palette);
    } catch {
        // Keep the selected palette for this session if storage is unavailable.
    }
    document.body.dataset.leslieColorPalette = palette;
    syncThemeControls();
}

/**
 * Persist a presentation-only preference without touching SillyTavern data.
 * @param {'auto' | 'light' | 'dark'} preference Theme preference.
 */
function setThemePreference(preference) {
    if (!THEME_MODES.includes(preference)) {
        return;
    }

    try {
        if (preference === 'auto') {
            localStorage.removeItem(THEME_PREFERENCE_KEY);
        } else {
            localStorage.setItem(THEME_PREFERENCE_KEY, preference);
        }
    } catch {
        // A restricted webview may disable localStorage. The current session
        // can still apply the selected mode through the body dataset.
    }

    document.body.dataset.leslieThemePreference = preference;
    applyLeslieColorScheme();
}

/**
 * Apply and persist a presentation-only design language.
 * @param {'dreamland' | 'cupertino' | 'classic'} designLanguage Requested language.
 */
function setDesignLanguage(designLanguage) {
    const normalized = writeDesignLanguagePreference(getBrowserStorage(), designLanguage);
    document.body.dataset.leslieDesignLanguage = normalized;
    syncThemeControls();
}

function setDreamLandAppearance(key, value) {
    const normalized = writeAppearance(getBrowserStorage(), key, value);
    if (!normalized) return;
    document.body.dataset[`dreamland${key[0].toUpperCase()}${key.slice(1)}`] = normalized;
    if (key === 'style') setDesignLanguage('dreamland');
    syncThemeControls();
}

/**
 * Resolve the effective Leslie light/dark scheme.
 * @returns {'light' | 'dark'} Leslie color scheme.
 */
function getLeslieColorScheme() {
    const preference = document.body?.dataset.leslieThemePreference || getThemePreference();
    return preference === 'auto' ? getAutomaticColorScheme() : preference;
}

function applyLeslieColorScheme() {
    if (!document.body?.classList.contains('leslie-modern')) {
        return;
    }

    document.body.dataset.leslieThemePreference ||= getThemePreference();
    document.body.dataset.leslieDesignLanguage ||= readDesignLanguagePreference(getBrowserStorage());
    document.body.dataset.leslieColorPalette ||= getColorPalette();
    document.body.dataset.leslieColorScheme = getLeslieColorScheme();
    for (const key of Object.keys(APPEARANCE_KEYS)) {
        const attribute = `dreamland${key[0].toUpperCase()}${key.slice(1)}`;
        document.body.dataset[attribute] ||= readAppearance(getBrowserStorage(), key);
    }
    syncThemeControls();
}

function createMenuHeading(label) {
    const heading = document.createElement('div');
    heading.className = 'leslie-theme-menu-heading';
    heading.textContent = label;
    heading.setAttribute('role', 'presentation');
    return heading;
}

/**
 * Build the shared theme picker once.
 * @returns {HTMLDivElement | null} Theme picker element.
 */
function ensureThemeMenu() {
    if (!document.body) {
        return null;
    }

    let menu = document.getElementById('leslie-theme-menu');
    if (menu instanceof HTMLDivElement) {
        return menu;
    }

    menu = document.createElement('div');
    menu.id = 'leslie-theme-menu';
    menu.className = 'leslie-theme-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '界面主题');

    menu.append(createMenuHeading('显示模式'));

    for (const mode of THEME_MODES) {
        const meta = THEME_MODE_META[mode];
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.leslieThemeMode = mode;
        button.setAttribute('role', 'menuitemradio');
        button.innerHTML = `
            <i class="fa-solid ${meta.icon}" aria-hidden="true"></i>
            <span><strong>${meta.label}</strong><small>${meta.description}</small></span>
            <i class="fa-solid fa-check leslie-theme-choice-check" aria-hidden="true"></i>
        `;
        button.addEventListener('click', () => {
            setThemePreference(mode);
            closeThemeMenu();
        });
        menu.append(button);
    }

    menu.append(createMenuHeading('DreamLand 风格'));
    for (const [style, meta] of Object.entries(DREAMLAND_STYLES)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.dreamlandStyle = style;
        button.setAttribute('role', 'menuitemradio');
        button.innerHTML = `<i class="fa-solid ${meta.icon}" aria-hidden="true"></i><span><strong>${meta.label} · ${meta.english}</strong><small>${meta.description}</small></span><i class="fa-solid fa-check leslie-theme-choice-check" aria-hidden="true"></i>`;
        button.addEventListener('click', () => {
            setDreamLandAppearance('style', style);
            closeThemeMenu();
        });
        menu.append(button);
    }

    const paletteSeparator = document.createElement('hr');
    paletteSeparator.className = 'leslie-theme-menu-separator';
    menu.append(paletteSeparator, createMenuHeading('原界面主题色（Cupertino / 经典）'));

    for (const palette of COLOR_PALETTES) {
        const meta = COLOR_PALETTE_META[palette];
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.leslieColorPalette = palette;
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-label', `${meta.label}，${meta.description}，提供亮色与暗色版本`);
        button.innerHTML = `
            <span class="leslie-palette-preview" aria-hidden="true"><i style="background:${meta.light}"></i><i style="background:${meta.dark}"></i></span>
            <span><strong>${meta.label}</strong><small>${meta.description}</small></span>
            <i class="fa-solid fa-check leslie-theme-choice-check" aria-hidden="true"></i>
        `;
        button.addEventListener('click', () => {
            setColorPalette(palette);
            closeThemeMenu();
        });
        menu.append(button);
    }

    const separator = document.createElement('hr');
    separator.className = 'leslie-theme-menu-separator';
    menu.append(separator, createMenuHeading('设计语言'));

    for (const designLanguage of DESIGN_LANGUAGES) {
        const meta = DESIGN_LANGUAGE_META[designLanguage];
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.leslieDesignLanguage = designLanguage;
        button.setAttribute('role', 'menuitemradio');
        button.innerHTML = `
            <i class="fa-solid ${meta.icon}" aria-hidden="true"></i>
            <span><strong>${meta.label}</strong><small>${meta.description}</small></span>
            <i class="fa-solid fa-check leslie-theme-choice-check" aria-hidden="true"></i>
        `;
        button.addEventListener('click', () => {
            setDesignLanguage(designLanguage);
            closeThemeMenu();
        });
        menu.append(button);
    }

    document.body.append(menu);
    return menu;
}

/**
 * Create a quick-access theme button for a Leslie header.
 * @returns {HTMLButtonElement} Theme toggle button.
 */
function createThemeButton() {
    const button = document.createElement('button');
    const icon = document.createElement('i');
    button.type = 'button';
    button.className = 'leslie-icon-button leslie-theme-toggle';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    icon.className = 'fa-solid fa-circle-half-stroke';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleThemeMenu(button);
    });
    return button;
}

/** Add the appearance control to the conversation sidebar only. */
function ensureThemeControls() {
    const host = document.querySelector('.leslie-sidebar-actions');

    document.querySelectorAll('#leslie-chat-actions > .leslie-theme-toggle').forEach(button => button.remove());

    if (host instanceof HTMLElement) {
        if (!host.querySelector(':scope > .leslie-theme-toggle')) {
            host.prepend(createThemeButton());
        }
    }

    ensureThemeMenu();
    syncThemeControls();

    if (host?.querySelector(':scope > .leslie-theme-toggle')) {
        controlObserver.disconnect();
    }
}

/** Keep icons, accessible labels and selected menu state synchronized. */
function syncThemeControls() {
    if (!document.body) {
        return;
    }

    const preference = document.body.dataset.leslieThemePreference || getThemePreference();
    const scheme = document.body.dataset.leslieColorScheme || getLeslieColorScheme();
    const designLanguage = document.body.dataset.leslieDesignLanguage || readDesignLanguagePreference(getBrowserStorage());
    const palette = COLOR_PALETTES.includes(document.body.dataset.leslieColorPalette)
        ? document.body.dataset.leslieColorPalette : getColorPalette();
    const meta = THEME_MODE_META[preference];
    const designMeta = DESIGN_LANGUAGE_META[designLanguage];
    const paletteMeta = COLOR_PALETTE_META[palette];
    const style = document.body.dataset.dreamlandStyle || readAppearance(getBrowserStorage(), 'style');
    const styleMeta = DREAMLAND_STYLES[style];

    for (const button of document.querySelectorAll('.leslie-theme-toggle')) {
        button.dataset.leslieThemeMode = preference;
        button.title = `界面外观：${designLanguage === 'dreamland' ? styleMeta.label : paletteMeta.label} · ${designMeta.label} · ${meta.label}（当前${scheme === 'dark' ? '暗色' : '亮色'}）`;
        button.setAttribute('aria-label', button.title);
        const icon = button.querySelector(':scope > i');
        if (icon) {
            icon.className = `fa-solid ${meta.icon}`;
        }
    }

    for (const choice of document.querySelectorAll('#leslie-theme-menu [data-leslie-theme-mode]')) {
        const selected = choice.dataset.leslieThemeMode === preference;
        choice.classList.toggle('is-active', selected);
        choice.setAttribute('aria-checked', String(selected));
    }

    for (const choice of document.querySelectorAll('#leslie-theme-menu [data-leslie-design-language]')) {
        const selected = choice.dataset.leslieDesignLanguage === designLanguage;
        choice.classList.toggle('is-active', selected);
        choice.setAttribute('aria-checked', String(selected));
    }

    for (const choice of document.querySelectorAll('#leslie-theme-menu [data-leslie-color-palette]')) {
        const selected = choice.dataset.leslieColorPalette === palette;
        choice.classList.toggle('is-active', selected);
        choice.setAttribute('aria-checked', String(selected));
    }

    const paletteSelect = document.getElementById('leslie-palette-select');
    if (paletteSelect instanceof HTMLSelectElement) paletteSelect.value = palette;
    for (const choice of document.querySelectorAll('#leslie-theme-menu [data-dreamland-style]')) {
        const selected = designLanguage === 'dreamland' && choice.dataset.dreamlandStyle === style;
        choice.classList.toggle('is-active', selected);
        choice.setAttribute('aria-checked', String(selected));
    }
    for (const key of Object.keys(APPEARANCE_KEYS)) {
        const select = document.getElementById(`dreamland-${key}-select`);
        const attribute = `dreamland${key[0].toUpperCase()}${key.slice(1)}`;
        if (select instanceof HTMLSelectElement) select.value = document.body.dataset[attribute] || readAppearance(getBrowserStorage(), key);
    }
    const languageSelect = document.getElementById('dreamland-language-select');
    if (languageSelect instanceof HTMLSelectElement) languageSelect.value = designLanguage;
}

/**
 * Position and open the shared picker next to its trigger.
 * @param {HTMLButtonElement} anchor Trigger button.
 */
function openThemeMenu(anchor) {
    const menu = ensureThemeMenu();
    if (!menu) {
        return;
    }

    closeThemeMenu();
    menu.hidden = false;
    menu.dataset.open = 'true';
    anchor.setAttribute('aria-expanded', 'true');

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gutter = 8;
    const left = Math.max(gutter, Math.min(anchorRect.right - menuRect.width, innerWidth - menuRect.width - gutter));
    const preferredTop = anchorRect.bottom + 6;
    const top = preferredTop + menuRect.height <= innerHeight - gutter
        ? preferredTop
        : Math.max(gutter, anchorRect.top - menuRect.height - 6);

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

/** Close the picker and reset every trigger state. */
function closeThemeMenu() {
    const menu = document.getElementById('leslie-theme-menu');
    if (menu) {
        menu.hidden = true;
        delete menu.dataset.open;
    }

    for (const button of document.querySelectorAll('.leslie-theme-toggle')) {
        button.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Toggle the picker for a trigger.
 * @param {HTMLButtonElement} anchor Trigger button.
 */
function toggleThemeMenu(anchor) {
    const menu = ensureThemeMenu();
    if (!menu) {
        return;
    }

    if (!menu.hidden && anchor.getAttribute('aria-expanded') === 'true') {
        closeThemeMenu();
    } else {
        openThemeMenu(anchor);
    }
}

let updateFrame = 0;
let controlsFrame = 0;

function scheduleLeslieColorSchemeUpdate() {
    cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(applyLeslieColorScheme);
}

function scheduleThemeControlsUpdate() {
    cancelAnimationFrame(controlsFrame);
    controlsFrame = requestAnimationFrame(ensureThemeControls);
}

// SillyTavern applies a theme by updating CSS variables on the root element.
// Watching that style attribute also covers imported and custom themes.
new MutationObserver(scheduleLeslieColorSchemeUpdate).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
});

document.addEventListener('change', (event) => {
    if (event.target instanceof Element && event.target.matches('#themes, toolcool-color-picker')) {
        scheduleLeslieColorSchemeUpdate();
    } else if (event.target instanceof HTMLSelectElement && event.target.id === 'leslie-palette-select') {
        setColorPalette(event.target.value);
    } else if (event.target instanceof HTMLSelectElement && event.target.id === 'dreamland-language-select') {
        setDesignLanguage(event.target.value);
    } else if (event.target instanceof HTMLSelectElement && event.target.dataset.dreamlandPreference) {
        setDreamLandAppearance(event.target.dataset.dreamlandPreference, event.target.value);
    }
}, true);

// Other windows may change appearance; no account or chat data is involved.
window.addEventListener('storage', (event) => {
    if (event.key === null || event.key?.startsWith('dreamland.appearance.') || event.key?.startsWith('leslie.')) {
        delete document.body.dataset.leslieDesignLanguage;
        delete document.body.dataset.leslieThemePreference;
        delete document.body.dataset.leslieColorPalette;
        for (const key of Object.keys(APPEARANCE_KEYS)) {
            delete document.body.dataset[`dreamland${key[0].toUpperCase()}${key.slice(1)}`];
        }
        applyLeslieColorScheme();
    }
});

document.addEventListener('dreamland:appearance-ready', syncThemeControls);

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleLeslieColorSchemeUpdate);

document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && !event.target.closest('#leslie-theme-menu, .leslie-theme-toggle')) {
        closeThemeMenu();
    }
}, true);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeThemeMenu();
    }
});

window.addEventListener('resize', closeThemeMenu);

const controlObserver = new MutationObserver(scheduleThemeControlsUpdate);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        scheduleLeslieColorSchemeUpdate();
        scheduleThemeControlsUpdate();
        controlObserver.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
} else {
    scheduleLeslieColorSchemeUpdate();
    scheduleThemeControlsUpdate();
    controlObserver.observe(document.body, { childList: true, subtree: true });
}

window.addEventListener('load', () => {
    scheduleLeslieColorSchemeUpdate();
    scheduleThemeControlsUpdate();
}, { once: true });
