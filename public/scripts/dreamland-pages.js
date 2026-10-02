/** BA page host. Reuses live controls and keeps chat and draft nodes intact. */
import { BLUE_ARCHIVE_NOTICE, DREAMLAND_BRAND } from './dreamland-brand.js';

const pages = new Map();
const mounts = new Map();
let host;
let active = null;
let navigation;
let navigationAnchor;
let initialized = false;
let focusedViewportHeight = 0;

function syncKeyboard() {
    const viewport = window.visualViewport;
    const editable = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
    const keyboard = Boolean(usesDreamlandPages() && editable && viewport && window.innerWidth <= 700
        && Math.max(window.innerHeight, focusedViewportHeight) - viewport.height > 150);
    document.body.toggleAttribute('data-dreamland-keyboard', keyboard);
    if (keyboard) document.body.style.setProperty('--dreamland-visible-height', `${Math.round(viewport.height)}px`);
    else document.body.style.removeProperty('--dreamland-visible-height');
    if (!editable) focusedViewportHeight = 0;
}

export function usesDreamlandPages() {
    return typeof document !== 'undefined' && document.body?.dataset.leslieDesignLanguage === 'dreamland'
        && document.body.dataset.dreamlandStyle === 'blue';
}

export function registerDreamlandPage(name, open) {
    pages.set(name, open);
}

export function getDreamlandPage() {
    return active?.name ?? 'chat';
}

function synchronizeAccessibility() {
    const shell = document.getElementById('sheld');
    const sidebar = document.getElementById('leslie-conversation-sidebar');
    const mobile = window.innerWidth <= 700;
    const chatVisible = !active && (!mobile || document.body.classList.contains('leslie-mobile-chat-open'));
    shell?.toggleAttribute('inert', !chatVisible);
    shell?.setAttribute('aria-hidden', String(!chatVisible));
    sidebar?.toggleAttribute('inert', mobile && Boolean(active || chatVisible));
    sidebar?.setAttribute('aria-hidden', String(mobile && Boolean(active || chatVisible)));
    navigation?.querySelectorAll('[data-action]').forEach(button => {
        const selected = button.dataset.action === (active?.name ?? 'home');
        if (selected) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
}

function ensureHost() {
    if (host) return;
    host = document.createElement('main');
    host.id = 'dreamland-page-host';
    host.hidden = true;
    host.setAttribute('aria-label', '功能页面');
    document.body.append(host);
}

function leaveCurrent() {
    if (!active) return;
    const previous = active;
    active = null;
    previous.leave?.();
    previous.element.hidden = true;
}

function saveHistory(name, mode) {
    if (mode === 'none') return;
    const state = { ...(history.state ?? {}), dreamlandPage: name };
    history[mode === 'replace' ? 'replaceState' : 'pushState'](state, '');
}

export function presentDreamlandPage(name, element, leave = () => {}) {
    if (!usesDreamlandPages() || !element) return false;
    ensureHost();
    if (active?.name === name && active.element === element) return true;
    leaveCurrent();
    if (!mounts.has(element)) {
        const anchor = document.createComment(`DreamLand ${name} page`);
        element.before(anchor);
        const region = element.matches('[role="dialog"], [role="main"]') ? element : element.querySelector(':scope > [role="dialog"], :scope > [role="main"]');
        mounts.set(element, { anchor, region, hidden: element.hidden, role: region?.getAttribute('role'), modal: region?.getAttribute('aria-modal') });
    }
    const mount = mounts.get(element);
    mount.region?.setAttribute('role', 'region');
    mount.region?.removeAttribute('aria-modal');
    element.dataset.dreamlandPageView = name;
    host.append(element);
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false');
    host.hidden = false;
    active = { name, element, leave };
    document.body.dataset.dreamlandPage = name;
    synchronizeAccessibility();
    return true;
}

export function returnToDreamlandChat(name, { historyMode = 'replace' } = {}) {
    if (!usesDreamlandPages() || (name && active?.name !== name)) return false;
    leaveCurrent();
    if (host) host.hidden = true;
    delete document.body.dataset.dreamlandPage;
    saveHistory('chat', historyMode);
    synchronizeAccessibility();
    return true;
}

export function navigateDreamlandPage(name, { historyMode = 'push' } = {}) {
    if (!usesDreamlandPages()) return false;
    if (name === 'home' || name === 'chat') return returnToDreamlandChat(undefined, { historyMode });
    const open = pages.get(name);
    if (!open) return false;
    try {
        if (active?.name !== name) {
            open();
            saveHistory(name, historyMode);
        }
        synchronizeAccessibility();
        return true;
    } catch (error) {
        console.warn('[DreamLand pages] Could not open page.', error);
        returnToDreamlandChat(undefined, { historyMode: 'none' });
        return false;
    }
}

function restoreMountedViews() {
    for (const [element, mount] of mounts) {
        element.hidden = mount.hidden;
        delete element.dataset.dreamlandPageView;
        mount.anchor.after(element);
        if (mount.region) {
            mount.region.setAttribute('role', mount.role);
            if (mount.modal !== null) mount.region.setAttribute('aria-modal', mount.modal);
        }
    }
}

function setupStaticPages() {
    const about = document.createElement('section');
    about.className = 'dreamland-content-page';
    about.hidden = true;
    about.innerHTML = `<header><h1>关于 DreamLand</h1></header><article class="dreamland-about"><img src="${DREAMLAND_BRAND.icon}" width="64" height="64" alt=""><h2>DreamLand</h2><p>${DREAMLAND_BRAND.tagline}</p><p>${DREAMLAND_BRAND.introduction}</p><h3>MomoTalk · Blue Archive</h3><p>${BLUE_ARCHIVE_NOTICE}</p><a href="${DREAMLAND_BRAND.feedback}" target="_blank" rel="noopener noreferrer">项目反馈与素材联系</a></article>`;
    document.body.append(about);
    registerDreamlandPage('about', () => presentDreamlandPage('about', about));
    const background = document.getElementById('Backgrounds');
    registerDreamlandPage('background', () => {
        if (!background) throw new Error('Background controls unavailable');
        presentDreamlandPage('background', background);
    });
}

export function syncDreamlandPages() {
    if (typeof document === 'undefined') return;
    if (!initialized && document.querySelector('.dreamland-navigation')) {
        initialized = true;
        navigation = document.querySelector('.dreamland-navigation');
        navigationAnchor = document.createComment('DreamLand navigation');
        navigation.before(navigationAnchor);
        setupStaticPages();
        window.addEventListener('popstate', event => {
            if (usesDreamlandPages()) navigateDreamlandPage(event.state?.dreamlandPage ?? 'chat', { historyMode: 'none' });
        });
        window.addEventListener('resize', () => {
            if (usesDreamlandPages()) synchronizeAccessibility();
            syncKeyboard();
        }, { passive: true });
        window.visualViewport?.addEventListener('resize', syncKeyboard, { passive: true });
        document.addEventListener('focusin', () => {
            focusedViewportHeight = Math.max(focusedViewportHeight, window.innerHeight);
            syncKeyboard();
        });
        document.addEventListener('focusout', () => requestAnimationFrame(syncKeyboard));
    }
    if (!navigation) return;
    syncKeyboard();
    const home = navigation.querySelector('[data-action="home"]');
    if (usesDreamlandPages()) {
        if (navigation.parentElement !== document.body) document.body.append(navigation);
        home.querySelector('span').textContent = '聊天';
        home.title = '聊天与首页';
        synchronizeAccessibility();
    } else {
        leaveCurrent();
        if (host) host.hidden = true;
        delete document.body.dataset.dreamlandPage;
        restoreMountedViews();
        navigationAnchor.after(navigation);
        home.querySelector('span').textContent = '归处';
        home.title = '归处';
        // Let the shared mobile layout reapply its accessibility state.
        document.dispatchEvent(new CustomEvent('dreamland:page-layout-changed'));
    }
}
