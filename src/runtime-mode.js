/**
 * DreamLand runtime mode.
 *
 * The same backend core is packaged twice (see
 * docs/frontend-backend-separation-plan.md):
 *   - `server`  — headless Linux/container deployment. No browser launch,
 *                 no desktop tray, no desktop exit sealing.
 *   - `desktop` — the Electron shell on a user machine.
 *
 * `server` is the default so a bare `node server.js` never assumes a desktop.
 * The mode is resolved once in src/command-line.js and published on
 * `globalThis.DREAMLAND_MODE`.
 */

export const DREAMLAND_MODE_ENV = 'DREAMLAND_MODE';
export const RUNTIME_MODE_SERVER = 'server';
export const RUNTIME_MODE_DESKTOP = 'desktop';
export const RUNTIME_MODES = Object.freeze([RUNTIME_MODE_SERVER, RUNTIME_MODE_DESKTOP]);
export const DEFAULT_RUNTIME_MODE = RUNTIME_MODE_SERVER;

/**
 * Normalize a raw mode string.
 * @param {unknown} value Raw value from the environment.
 * @returns {typeof RUNTIME_MODE_SERVER | typeof RUNTIME_MODE_DESKTOP} A valid runtime mode.
 */
export function parseRuntimeMode(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return RUNTIME_MODES.includes(normalized) ? normalized : DEFAULT_RUNTIME_MODE;
}

/**
 * Resolve the runtime mode from the environment and report invalid input.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] Environment source.
 * @returns {{mode: string, raw: string, invalid: boolean}} Resolution result.
 */
export function resolveRuntimeMode(environment = process.env) {
    const raw = String(environment?.[DREAMLAND_MODE_ENV] ?? '').trim();
    return {
        mode: parseRuntimeMode(raw),
        raw,
        invalid: raw !== '' && !RUNTIME_MODES.includes(raw.toLowerCase()),
    };
}

/**
 * Publish the resolved mode for the rest of the process.
 * @param {string} mode Runtime mode.
 * @returns {string} The published mode.
 */
export function setRuntimeMode(mode) {
    const resolved = parseRuntimeMode(mode);
    globalThis.DREAMLAND_MODE = resolved;
    return resolved;
}

/**
 * Read the process runtime mode.
 * @returns {string} The active runtime mode.
 */
export function getRuntimeMode() {
    return parseRuntimeMode(globalThis.DREAMLAND_MODE ?? process.env?.[DREAMLAND_MODE_ENV]);
}

/** @returns {boolean} True when running as the desktop (Electron) host. */
export function isDesktopMode() {
    return getRuntimeMode() === RUNTIME_MODE_DESKTOP;
}

/** @returns {boolean} True when running as a headless server. */
export function isServerMode() {
    return getRuntimeMode() === RUNTIME_MODE_SERVER;
}

/**
 * Browser auto-launch is a desktop-only convenience: a server deployment has
 * no local browser and must never try to open one.
 * @param {{mode?: string, configured?: unknown}} options Resolution input.
 * @returns {boolean} Whether the browser should be launched after startup.
 */
export function resolveBrowserLaunchEnabled({ mode, configured }) {
    return parseRuntimeMode(mode) === RUNTIME_MODE_DESKTOP && Boolean(configured);
}

/**
 * Encrypted user spaces are sealed on exit only for the desktop host. A
 * server keeps its data root mounted and unlocked across restarts.
 * @param {string} mode Runtime mode.
 * @returns {boolean} Whether the active user space should be sealed on exit.
 */
export function shouldSealUserSpaceOnExit(mode = getRuntimeMode()) {
    return parseRuntimeMode(mode) === RUNTIME_MODE_DESKTOP;
}
