import { describe, expect, jest, test } from '@jest/globals';
import { checkAppEntry } from '../public/scripts/dreamland-app-entry.js';

/** @returns {object} Synthetic session dependencies; no real tokens or account data. */
function harness(overrides = {}) {
    return {
        pathname: '/app',
        fetchVersion: jest.fn(async () => ({ mode: 'server' })),
        hasToken: jest.fn(() => true),
        fetchAccount: jest.fn(async () => ({ status: 200, ok: true })),
        clearTokens: jest.fn(),
        redirectToLogin: jest.fn(),
        ...overrides,
    };
}

describe('DreamLand application session entry', () => {
    test('keeps desktop root bootstrap unchanged', async () => {
        const options = harness({ pathname: '/' });
        expect(await checkAppEntry(options)).toBe(true);
        expect(options.fetchVersion).not.toHaveBeenCalled();
    });

    test('desktop app alias does not require a bearer token', async () => {
        const options = harness({ fetchVersion: async () => ({ mode: 'desktop' }), hasToken: () => false });
        expect(await checkAppEntry(options)).toBe(true);
        expect(options.fetchAccount).not.toHaveBeenCalled();
    });

    test('sends anonymous server visitors to login before account modules load', async () => {
        const options = harness({ hasToken: () => false });
        expect(await checkAppEntry(options)).toBe(false);
        expect(options.redirectToLogin).toHaveBeenCalledTimes(1);
        expect(options.fetchAccount).not.toHaveBeenCalled();
    });

    test.each([401, 403])('clears a rejected token (HTTP %i) before returning to login', async status => {
        const options = harness({ fetchAccount: async () => ({ status, ok: false }) });
        expect(await checkAppEntry(options)).toBe(false);
        expect(options.clearTokens).toHaveBeenCalledTimes(1);
        expect(options.redirectToLogin).toHaveBeenCalledTimes(1);
    });

    test('allows a validated token to start the application', async () => {
        const options = harness();
        expect(await checkAppEntry(options)).toBe(true);
        expect(options.clearTokens).not.toHaveBeenCalled();
    });

    test('does not discard a session for a temporary server failure', async () => {
        const options = harness({ fetchAccount: async () => ({ status: 503, ok: false }) });
        await expect(checkAppEntry(options)).rejects.toThrow('无法验证登录状态');
        expect(options.clearTokens).not.toHaveBeenCalled();
        expect(options.redirectToLogin).not.toHaveBeenCalled();
    });
});
