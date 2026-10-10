/**
 * Key-id based secret interface for the public API (Phase 2, task 2.5).
 *
 * The public surface never contains a secret value. Clients see:
 *   - `key_id`: the stable slot name (for example `api_key_openai`),
 *   - `entry_id`: which stored entry is active,
 *   - `label` and a masked preview.
 *
 * Plaintext is reachable only through `getSecret`, which is for server-side
 * callers (model adapters, TTS) and is never returned by an HTTP response in
 * this module.
 *
 * Storage reuses `SecretManager`, so the on-disk format, the optional mounted
 * environment secret and the external-source precedence all stay in one place.
 */

import path from 'node:path';

import { EXTERNAL_SECRET_ID, SECRET_KEYS, SecretManager } from '../endpoints/secrets.js';
import { badRequest, notFound } from './errors.js';

/**
 * The public secret surface is server-global (not per account) after the server-managed
 * model gateway landed: provider API keys belong to the operator, so they live under the
 * server data root rather than a user directory.
 * @returns {import('../users.js').UserDirectoryList} A global directory descriptor.
 */
function globalSecretDirectories() {
    const root = String(globalThis.DATA_ROOT ?? '');
    return {
        root,
        backups: path.join(root, 'backups'),
        characters: '',
        chats: '',
        groups: '',
        groupChats: '',
        worlds: '',
        avatars: '',
        user: '',
        vectors: '',
    };
}

/** Keys that may be configured through the API (the well-known provider slots). */
export const EXPOSABLE_SECRET_KEYS = Object.freeze(
    Object.values(SECRET_KEYS).filter(key => key !== SECRET_KEYS._MIGRATED && !key.endsWith('_url')),
);

/**
 * Validate a key id.
 * @param {unknown} keyId Candidate key id.
 * @returns {string} The validated key id.
 * @throws {ApiError} 400 when unknown.
 */
export function assertSecretKeyId(keyId) {
    const value = String(keyId ?? '').trim();
    if (!EXPOSABLE_SECRET_KEYS.includes(value)) {
        throw badRequest('Unknown secret key id.');
    }
    return value;
}

/**
 * List the server's global secret slots. Never returns a plaintext value.
 * @returns {object[]} Key-id list.
 */
export function listSecretIds() {
    const manager = new SecretManager(globalSecretDirectories());
    const state = manager.getSecretState();
    return EXPOSABLE_SECRET_KEYS.map(keyId => {
        const entries = Array.isArray(state?.[keyId]) ? state[keyId] : [];
        const active = entries.find(entry => entry.active) ?? null;
        return {
            key_id: keyId,
            configured: entries.length > 0,
            entry_id: active?.id ?? null,
            label: active?.label ?? null,
            // `value` from getSecretState is already masked by the manager.
            preview: active?.value ?? null,
            source: active?.id === EXTERNAL_SECRET_ID ? 'external' : (active ? 'stored' : null),
            entries: entries.map(entry => ({ entry_id: entry.id, label: entry.label, active: Boolean(entry.active) })),
        };
    });
}

/**
 * Read a secret value for server-side use only.
 * @param {string} keyId Secret key id.
 * @param {string | null} [entryId] Specific stored entry.
 * @returns {string} Plaintext value, or an empty string when unset.
 */
export function getSecret(keyId, entryId = null) {
    return new SecretManager(globalSecretDirectories()).readSecret(assertSecretKeyId(keyId), entryId);
}

/**
 * Store a secret value.
 * @param {string} keyId Secret key id.
 * @param {string} value Secret value.
 * @param {string} [label] Human-readable label.
 * @returns {{entry_id: string}} The new entry id (never the value).
 * @throws {ApiError} 400 when the value is empty.
 */
export function setSecret(keyId, value, label = 'API') {
    const key = assertSecretKeyId(keyId);
    const normalized = String(value ?? '');
    if (normalized.trim() === '') {
        throw badRequest('value must not be empty.');
    }
    const entryId = new SecretManager(globalSecretDirectories()).writeSecret(key, normalized, String(label).slice(0, 64));
    return { entry_id: entryId };
}

/**
 * Delete a stored secret entry.
 * @param {string} keyId Secret key id.
 * @param {string | null} [entryId] Entry to delete; the active entry when omitted.
 * @returns {{deleted: boolean}} Result.
 */
export function deleteSecret(keyId, entryId = null) {
    const key = assertSecretKeyId(keyId);
    const manager = new SecretManager(globalSecretDirectories());
    const state = manager.getSecretState();
    const entries = Array.isArray(state?.[key]) ? state[key] : [];
    const target = entryId ?? entries.find(entry => entry.active)?.id ?? null;
    if (!target) {
        throw notFound('There is no stored secret for that key id.');
    }
    if (target === EXTERNAL_SECRET_ID) {
        throw badRequest('This key is supplied by the environment or a mounted secret and cannot be deleted here.');
    }
    manager.deleteSecret(key, target);
    return { deleted: true };
}
