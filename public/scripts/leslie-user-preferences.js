import { PREFERENCE_OPTIONS, PREFERENCES_OWNER_KEY, LOGIN_APPEARANCE_KEY, validPreference, loginAppearance, normalizePreference } from './leslie-preferences-core.js';

let owner;
let token;
let pending = {};
let timer;
let saving;
let applying = false;

function rememberAppearance() {
    if (owner?.startsWith('__leslie-demo--')) return;
    const values = Object.fromEntries(Object.keys(PREFERENCE_OPTIONS).map(key => [key, localStorage.getItem(key)]));
    localStorage.setItem(LOGIN_APPEARANCE_KEY, JSON.stringify(loginAppearance(values)));
}

export async function flushUserSpacePreferences() {
    clearTimeout(timer);
    if (saving) await saving;
    if (!owner || !Object.keys(pending).length) return true;
    const changes = pending;
    pending = {};
    saving = fetch('/api/leslie/preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ owner, changes }), keepalive: true, signal: AbortSignal.timeout(5000),
    }).then(response => {
        if (!response.ok) throw new Error('Preference save failed.');
    }).catch(() => {
        pending = { ...changes, ...pending };
        clearTimeout(timer);
        timer = setTimeout(() => void flushUserSpacePreferences(), 2000);
    }).finally(() => { saving = null; });
    await saving;
    return !Object.keys(pending).length;
}

// Run before modules that read browser preferences during initialization.
export async function initializeUserSpacePreferences() {
    try {
        const response = await fetch('/api/leslie/preferences', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const record = await response.json();
        const oldOwner = localStorage.getItem(PREFERENCES_OWNER_KEY);
        const legacy = !record.saved && (!oldOwner || oldOwner === record.owner)
            && (oldOwner || record.owner === 'default-user');
        const existing = Object.fromEntries(Object.keys(PREFERENCE_OPTIONS).map(key => [key, localStorage.getItem(key)]).filter(([key, value]) => value !== null && validPreference(key, value)).map(([key, value]) => [key, normalizePreference(key, value)]));
        owner = record.owner;
        applying = true;
        if (oldOwner && oldOwner !== owner) {
            const hint = localStorage.getItem(LOGIN_APPEARANCE_KEY);
            localStorage.clear();
            sessionStorage.clear();
            if (hint) localStorage.setItem(LOGIN_APPEARANCE_KEY, hint);
        }
        for (const key of Object.keys(PREFERENCE_OPTIONS)) localStorage.removeItem(key);
        for (const [key, value] of Object.entries(legacy ? existing : record.values ?? {})) {
            if (value !== null && validPreference(key, value)) localStorage.setItem(key, normalizePreference(key, value));
        }
        localStorage.setItem(PREFERENCES_OWNER_KEY, owner);
        rememberAppearance();
        applying = false;
        token = (await fetch('/csrf-token').then(result => result.json())).token;
        for (const method of ['setItem', 'removeItem']) {
            const original = Storage.prototype[method];
            Storage.prototype[method] = function (key, value) {
                const selection = method === 'removeItem' ? null : normalizePreference(key, String(value));
                const result = method === 'setItem' && this === localStorage ? original.call(this, key, selection) : original.apply(this, arguments);
                if (this === localStorage && !applying && validPreference(key, selection)) {
                    pending[key] = selection;
                    rememberAppearance();
                    clearTimeout(timer);
                    timer = setTimeout(() => void flushUserSpacePreferences(), 250);
                }
                return result;
            };
        }
        if (legacy) { pending = existing; await flushUserSpacePreferences(); }
        window.addEventListener('pagehide', () => void flushUserSpacePreferences());
        window.addEventListener('online', () => void flushUserSpacePreferences());
        document.addEventListener('visibilitychange', () => { if (document.hidden) void flushUserSpacePreferences(); });
    } catch { applying = false; /* Offline or restricted storage must not prevent normal chat. */ }
}
