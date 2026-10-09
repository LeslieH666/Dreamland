/**
 * Platform injection: data root.
 *
 * The same backend core stores user data in one directory tree, but the two
 * deployments obtain that directory differently:
 *
 *   - server: a mounted volume (or an object-storage-backed mount). The path
 *     must be explicit and absolute so a container cannot silently write into
 *     its ephemeral image layer;
 *   - desktop: a local directory, which may be relative to the install.
 *
 * `resolveDataRoot()` returns the same shape for both, so callers never branch
 * on the platform or the runtime mode.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DATA_ROOT_KIND = Object.freeze({
    SERVER_VOLUME: 'server-volume',
    DESKTOP_DIRECTORY: 'desktop-directory',
});

/**
 * @typedef {object} DataRoot
 * @property {string} kind One of DATA_ROOT_KIND.
 * @property {string} root Absolute data root.
 * @property {string} source Where the value came from (`env`, `config` or `default`).
 * @property {() => boolean} ensure Creates the directory if missing and reports success.
 * @property {() => string} describe Human-readable summary for logs.
 */

/**
 * Check that a directory can be written to.
 * @param {string} directory Absolute directory.
 * @returns {boolean} Whether a probe file could be created.
 */
function isWritable(directory) {
    const probe = path.join(directory, `.write-probe-${process.pid}`);
    try {
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve the data root for a deployment.
 * @param {{mode: string, configuredRoot: string, configuredByEnv: boolean, cwd?: string}} options Resolution input.
 * @returns {DataRoot} Data root descriptor.
 */
export function resolveDataRoot({ mode, configuredRoot, configuredByEnv, cwd = process.cwd() }) {
    const raw = String(configuredRoot ?? '').trim() || './data';
    const isServer = mode !== 'desktop';
    const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw);

    if (isServer) {
        if (!path.isAbsolute(raw)) {
            console.warn(
                `Warning: the server data root "${raw}" is relative. Set DREAMLAND_DATA_ROOT to an absolute `
                + `mounted path so a container restart cannot lose data. Resolved to ${absolute}.`,
            );
        }
        return {
            kind: DATA_ROOT_KIND.SERVER_VOLUME,
            root: absolute,
            source: configuredByEnv ? 'env' : 'config',
            ensure() {
                return ensureDirectory(absolute);
            },
            describe() {
                const writable = fs.existsSync(absolute) ? isWritable(absolute) : 'not-created';
                return `data root ${absolute} (server volume, source ${configuredByEnv ? 'environment' : 'config'}, writable: ${writable})`;
            },
        };
    }

    return {
        kind: DATA_ROOT_KIND.DESKTOP_DIRECTORY,
        root: absolute,
        source: configuredByEnv ? 'env' : (path.isAbsolute(raw) ? 'config' : 'default'),
        ensure() {
            return ensureDirectory(absolute);
        },
        describe() {
            return `data root ${absolute} (desktop directory, source ${path.isAbsolute(raw) ? 'config' : 'install-relative'})`;
        },
    };
}

/**
 * Create a directory tree if it does not exist.
 * @param {string} directory Absolute directory.
 * @returns {boolean} Whether the directory now exists.
 */
function ensureDirectory(directory) {
    try {
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        return true;
    } catch (error) {
        console.warn(`Warning: could not create the data root at ${directory}: ${error?.message || error}`);
        return false;
    }
}
