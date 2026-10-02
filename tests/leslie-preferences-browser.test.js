/* global globalThis */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

const names = ['Storage', 'localStorage', 'sessionStorage', 'window', 'document', 'fetch'];
const original = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let preferences;
let post;

beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    class BrowserStorage {
        values = new Map();
        getItem(key) { return this.values.get(key) ?? null; }
        setItem(key, value) { this.values.set(key, String(value)); }
        removeItem(key) { this.values.delete(key); }
        clear() { this.values.clear(); }
    }
    Object.assign(globalThis, {
        Storage: BrowserStorage,
        localStorage: new BrowserStorage(),
        sessionStorage: new BrowserStorage(),
        window: { addEventListener: jest.fn() },
        document: { addEventListener: jest.fn() },
    });
    post = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = jest.fn(async (url, options) => {
        if (options?.method === 'POST') return post(JSON.parse(options.body));
        return { ok: true, json: async () => url === '/csrf-token' ? { token: 'synthetic-token' } : preferences };
    });
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    for (const name of names) {
        if (original[name]) Object.defineProperty(globalThis, name, original[name]);
        else delete globalThis[name];
    }
});

test('migrates existing default-space preferences without saving secrets or drafts', async () => {
    preferences = { saved: false, owner: 'default-user', values: {} };
    globalThis.localStorage.setItem('dreamland.appearance.style', 'blue');
    globalThis.localStorage.setItem('language', 'zh-cn');
    globalThis.localStorage.setItem('synthetic-draft', 'private synthetic text');
    const { initializeUserSpacePreferences } = await import('../public/scripts/leslie-user-preferences.js');
    await initializeUserSpacePreferences();
    expect(post).toHaveBeenCalledWith({ owner: 'default-user', changes: { 'dreamland.appearance.style': 'blue', language: 'zh-cn' } });
    expect(globalThis.localStorage.getItem('dreamland.appearance.style')).toBe('blue');
    expect(globalThis.localStorage.getItem('leslie.preferences.owner')).toBe('default-user');
});

test('restores the selected space before consumers load and clears the previous space browser data', async () => {
    preferences = { saved: true, owner: 'alice', values: { 'dreamland.appearance.style': 'paper', 'leslie.theme.preference': 'dark' } };
    globalThis.localStorage.setItem('leslie.preferences.owner', 'bob');
    globalThis.localStorage.setItem('dreamland.appearance.style', 'blue');
    globalThis.localStorage.setItem('synthetic-draft', 'private synthetic text');
    globalThis.sessionStorage.setItem('synthetic-draft', 'private synthetic text');
    const { initializeUserSpacePreferences } = await import('../public/scripts/leslie-user-preferences.js');
    await initializeUserSpacePreferences();
    expect(globalThis.localStorage.getItem('dreamland.appearance.style')).toBe('blue');
    expect(globalThis.localStorage.getItem('synthetic-draft')).toBeNull();
    expect(globalThis.sessionStorage.getItem('synthetic-draft')).toBeNull();
    expect(post).not.toHaveBeenCalled();
});

test('retains failed changes for retry, saves later values and keeps demo appearance out of the login hint', async () => {
    preferences = { saved: true, owner: '__leslie-demo--alice', values: {} };
    globalThis.localStorage.setItem('dreamland.login.appearance', '{"dreamland.appearance.style":"blue"}');
    const { initializeUserSpacePreferences, flushUserSpacePreferences } = await import('../public/scripts/leslie-user-preferences.js');
    await initializeUserSpacePreferences();
    globalThis.localStorage.setItem('dreamland.appearance.style', 'paper');
    post.mockResolvedValueOnce({ ok: false });
    expect(await flushUserSpacePreferences()).toBe(false);
    globalThis.localStorage.setItem('dreamland.appearance.style', 'moon');
    globalThis.localStorage.setItem('synthetic-secret', 'private synthetic text');
    expect(await flushUserSpacePreferences()).toBe(true);
    expect(post.mock.calls.at(-1)[0]).toEqual({ owner: '__leslie-demo--alice', changes: { 'dreamland.appearance.style': 'blue' } });
    expect(globalThis.localStorage.getItem('dreamland.login.appearance')).toBe('{"dreamland.appearance.style":"blue"}');
});
