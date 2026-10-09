/**
 * Shared build-target verification.
 *
 * Both packaging targets (server = ①+②, desktop = ①+②+④) must be produced from
 * one source tree and serve one `public/` UI. These helpers assert exactly
 * that, so a regression cannot silently fork the front-end or leak the desktop
 * host into the server image.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Directories that are never part of a shipped target. */
export const NON_SOURCE_DIRECTORIES = Object.freeze(['node_modules', '.git', 'dist', 'backups', 'data', 'Cache', 'Runtime', 'Run']);

/**
 * Every `public/` directory in the repository (outside vendored/ignored trees).
 * @param {string} root Repository root.
 * @returns {string[]} Context-relative paths of `public` directories.
 */
export function findPublicTrees(root) {
    const found = [];
    const walk = (directory, relative) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (NON_SOURCE_DIRECTORIES.includes(entry.name)) {
                continue;
            }
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.name === 'public') {
                found.push(childRelative);
                continue;
            }
            walk(path.join(directory, entry.name), childRelative);
        }
    };
    walk(root, '');
    return found;
}

/**
 * Verify that the repository has exactly one shared web UI tree.
 * @param {string} root Repository root.
 * @returns {{ok: boolean, trees: string[], missing: string[]}} Result.
 */
export function verifySharedPublicTree(root) {
    const trees = findPublicTrees(root);
    const required = ['index.html', 'script.js', 'scripts/leslie-bootstrap.js'];
    const missing = required.filter(entry => !fs.existsSync(path.join(root, 'public', entry)));
    return {
        ok: trees.length === 1 && trees[0] === 'public' && missing.length === 0,
        trees,
        missing,
    };
}

/**
 * Read a JSON file.
 * @param {string} file Absolute path.
 * @returns {object} Parsed JSON.
 */
export function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Report a verification result and exit non-zero when it failed.
 * @param {string} label Check name.
 * @param {{ok: boolean, [key: string]: unknown}} result Check result.
 * @returns {void}
 */
export function reportCheck(label, result) {
    const detail = result.detail ? ` ${result.detail}` : '';
    if (result.ok) {
        console.log(`  [ok]   ${label}${detail}`);
        return;
    }
    console.error(`  [FAIL] ${label}${detail}`);
    process.exitCode = 1;
}
