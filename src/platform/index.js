/**
 * Platform entry point.
 *
 * Business code depends on this module only. It decides — from the resolved
 * runtime mode and the process environment — which concrete implementation of
 * each platform capability is in play:
 *
 *   - `secrets`   : how secrets are protected at rest and whether the
 *                   environment/mounted file is authoritative;
 *   - `dataRoot`  : where user data lives and how it must be created;
 *   - `environment`: small capability questions that used to be inline
 *                    `process.platform` checks (browser launcher support,
 *                    terminal title, Android runtime, desktop host assets).
 *
 * Nothing here reads configuration eagerly: the module is resolved lazily on
 * first use so tests and CLI parsing can set the mode and environment first.
 */

import { isDesktopMode, getRuntimeMode } from '../runtime-mode.js';
import { resolveDataRoot } from './data-root.js';
import { resolveSecretStorage } from './secret-store.js';

/**
 * @typedef {object} PlatformEnvironment
 * @property {string} mode Runtime mode.
 * @property {boolean} isDesktop True for the Electron host.
 * @property {boolean} isAndroid True on the Android runtime.
 * @property {boolean} supportsBrowserLaunch Whether a desktop browser can be opened.
 * @property {boolean} supportsTerminalTitle Whether the terminal title can be set.
 * @property {(title: string) => void} applyTerminalTitle Set the process/window title.
 * @property {(name: string) => string} desktopIconAsset Resolve a desktop icon asset name.
 */

/**
 * @typedef {object} Platform
 * @property {PlatformEnvironment} environment
 * @property {ReturnType<typeof resolveSecretStorage>} secrets
 * @property {ReturnType<typeof resolveDataRoot>} dataRoot
 */

/** @type {Platform | null} */
let cached = null;
/** @type {Partial<Platform> | null} */
let overrides = null;

/**
 * Build the platform description from the current process state.
 * @returns {Platform} Resolved platform.
 */
function build() {
    const mode = getRuntimeMode();
    const isDesktop = isDesktopMode();
    const platform = process.platform;

    const environment = {
        mode,
        isDesktop,
        isAndroid: platform === 'android',
        // Only the desktop host has a browser to open; a server deployment
        // never launches one (see src/runtime-mode.js).
        supportsBrowserLaunch: isDesktop,
        supportsTerminalTitle: platform !== 'android',
        applyTerminalTitle(title) {
            // An Android runtime has no TTY to write an escape sequence to, so
            // it only renames the process.
            if (platform === 'android' || platform === 'win32') {
                process.title = title;
                return;
            }
            process.stdout.write(`\x1b]2;${title}\x1b\\`);
        },
        desktopIconAsset: name => (platform === 'win32' ? `${name}.ico` : `${name}-192.png`),
    };

    return {
        environment,
        secrets: resolveSecretStorage({ mode, environment: process.env, platform }),
        dataRoot: resolveDataRoot({
            mode,
            // The authoritative value is installed by src/command-line.js once
            // arguments are parsed; this fallback covers early callers.
            configuredRoot: String(process.env.DREAMLAND_DATA_ROOT ?? globalThis.COMMAND_LINE_ARGS?.dataRoot ?? './data'),
            configuredByEnv: Boolean(process.env.DREAMLAND_DATA_ROOT),
        }),
        ...overrides,
    };
}

/**
 * Get the platform description, building it once per process.
 * @returns {Platform} Platform.
 */
export function getPlatform() {
    if (!cached) {
        cached = build();
    }
    return cached;
}

/**
 * Drop the cached platform (the runtime mode or environment changed).
 * @returns {void}
 */
export function resetPlatform() {
    cached = null;
    overrides = null;
}

/**
 * Install explicit platform values before the first `getPlatform()` call.
 * Used by the CLI (data root resolved during argument parsing) and by tests.
 * @param {Partial<Platform>} value Values to pin.
 * @returns {void}
 */
export function configurePlatform(value) {
    overrides = { ...(overrides ?? {}), ...value };
    cached = null;
}
