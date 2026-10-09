import { describe, expect, test } from '@jest/globals';

import {
    DREAMLAND_MODE_ENV,
    DEFAULT_RUNTIME_MODE,
    RUNTIME_MODE_DESKTOP,
    RUNTIME_MODE_SERVER,
    getRuntimeMode,
    isDesktopMode,
    isServerMode,
    parseRuntimeMode,
    resolveBrowserLaunchEnabled,
    resolveRuntimeMode,
    setRuntimeMode,
    shouldSealUserSpaceOnExit,
} from '../src/runtime-mode.js';

describe('DreamLand runtime mode', () => {
    test('defaults to server when the environment says nothing', () => {
        expect(DEFAULT_RUNTIME_MODE).toBe(RUNTIME_MODE_SERVER);
        expect(parseRuntimeMode(undefined)).toBe(RUNTIME_MODE_SERVER);
        expect(parseRuntimeMode('')).toBe(RUNTIME_MODE_SERVER);
        expect(resolveRuntimeMode({})).toEqual({ mode: RUNTIME_MODE_SERVER, raw: '', invalid: false });
    });

    test('accepts the two documented modes case-insensitively', () => {
        expect(parseRuntimeMode('server')).toBe(RUNTIME_MODE_SERVER);
        expect(parseRuntimeMode('SERVER')).toBe(RUNTIME_MODE_SERVER);
        expect(parseRuntimeMode(' desktop ')).toBe(RUNTIME_MODE_DESKTOP);
        expect(resolveRuntimeMode({ [DREAMLAND_MODE_ENV]: 'Desktop' })).toEqual({
            mode: RUNTIME_MODE_DESKTOP,
            raw: 'Desktop',
            invalid: false,
        });
    });

    test('falls back to server and reports an unknown mode instead of guessing', () => {
        const resolved = resolveRuntimeMode({ [DREAMLAND_MODE_ENV]: 'tablet' });
        expect(resolved.mode).toBe(RUNTIME_MODE_SERVER);
        expect(resolved.raw).toBe('tablet');
        expect(resolved.invalid).toBe(true);
    });

    test('never launches a browser in server mode even when it is configured', () => {
        expect(resolveBrowserLaunchEnabled({ mode: RUNTIME_MODE_SERVER, configured: true })).toBe(false);
        expect(resolveBrowserLaunchEnabled({ mode: undefined, configured: true })).toBe(false);
        expect(resolveBrowserLaunchEnabled({ mode: RUNTIME_MODE_DESKTOP, configured: true })).toBe(true);
        expect(resolveBrowserLaunchEnabled({ mode: RUNTIME_MODE_DESKTOP, configured: false })).toBe(false);
    });

    test('seals the encrypted user space on exit only for the desktop host', () => {
        expect(shouldSealUserSpaceOnExit(RUNTIME_MODE_DESKTOP)).toBe(true);
        expect(shouldSealUserSpaceOnExit(RUNTIME_MODE_SERVER)).toBe(false);
        expect(shouldSealUserSpaceOnExit(undefined)).toBe(false);
    });

    test('publishes the resolved mode for the rest of the process', () => {
        expect(setRuntimeMode(RUNTIME_MODE_DESKTOP)).toBe(RUNTIME_MODE_DESKTOP);
        expect(getRuntimeMode()).toBe(RUNTIME_MODE_DESKTOP);
        expect(isDesktopMode()).toBe(true);
        expect(isServerMode()).toBe(false);

        // An unknown value must never leave the process in an undefined mode.
        expect(setRuntimeMode('nonsense')).toBe(RUNTIME_MODE_SERVER);
        expect(getRuntimeMode()).toBe(RUNTIME_MODE_SERVER);
        expect(isServerMode()).toBe(true);
    });
});
