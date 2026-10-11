/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- Jest browser state regression suite. */
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { refreshServerModels, selectServerModel, serverModels } from '../public/scripts/server-models.js';
let originalFetch;
beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.document = { documentElement: { dataset: {} }, dispatchEvent: () => {} };
    globalThis.CustomEvent = class {};
});
afterAll(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    delete globalThis.CustomEvent;
});
const reply = data => ({ ok: true, json: async () => data });
test('restores a catalog choice, rejects arbitrary choices and reconciles removed models', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(reply({ mode: 'server' }))
        .mockResolvedValueOnce(reply({ models: [{ id: 'first', name: '<unsafe>' }, { id: 'second' }] }));
    await refreshServerModels({ preferredId: 'second' });
    expect(serverModels.selectedId).toBe('second');
    expect(selectServerModel('arbitrary-endpoint')).toBe(false);
    globalThis.fetch = jest.fn().mockResolvedValueOnce(reply({ mode: 'server' }))
        .mockResolvedValueOnce(reply({ models: [{ id: 'first' }] }));
    await refreshServerModels();
    expect(serverModels.selectedId).toBe('first');
});
test('an unavailable catalog clears stale choices and exposes an error instead of personal APIs', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(reply({ mode: 'server' })).mockResolvedValueOnce({ ok: false });
    await refreshServerModels();
    expect(serverModels.selectedId).toBe('');
    expect(serverModels.models).toEqual([]);
    expect(serverModels.error).toContain('重新登录');
    expect(serverModels.mode).toBe('server');
});
test('desktop mode does not fetch the managed catalog', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(reply({ mode: 'desktop' }));
    await refreshServerModels();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(serverModels.mode).toBe('desktop');
});
