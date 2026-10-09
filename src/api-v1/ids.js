/**
 * Opaque identifiers for the public API.
 *
 * The API never exposes internal file names, chat names or paths. Each opaque
 * id is `v1_<type>_<base64url(internal key)>`, which:
 *   - hides the on-disk layout from clients,
 *   - is stable for a given resource,
 *   - is validated (type prefix + strict base64url) before it is resolved.
 *
 * Authorization does NOT rely on the id being unguessable: every id is
 * resolved *inside the authenticated user's own directories*, so a forged or
 * stolen id belonging to another account simply does not resolve.
 */

import { badRequest } from './errors.js';

export const ID_PREFIX = 'v1';

/** @type {Readonly<Record<string, string>>} Single-letter type tags. */
export const ID_TYPES = Object.freeze({
    user: 'u',
    character: 'c',
    chat: 'h',
    group: 'g',
    worldinfo: 'w',
    message: 'm',
    persona: 'p',
});

/**
 * Encode an internal key as an opaque API id.
 * @param {keyof typeof ID_TYPES} type Resource type.
 * @param {string} internal Internal key (file name, card name, id...).
 * @returns {string} Opaque id.
 */
export function encodeId(type, internal) {
    const tag = ID_TYPES[type];
    if (!tag) {
        throw new TypeError(`Unknown API id type: ${type}`);
    }
    const value = String(internal ?? '');
    if (!value) {
        throw new TypeError(`Cannot encode an empty ${type} id.`);
    }
    return `${ID_PREFIX}_${tag}_${Buffer.from(value, 'utf8').toString('base64url')}`;
}

/**
 * Decode an opaque API id.
 * @param {keyof typeof ID_TYPES} type Expected resource type.
 * @param {unknown} id Opaque id from the client.
 * @returns {string} The internal key.
 * @throws {ApiError} 400 when the id is malformed or has the wrong type.
 */
export function decodeId(type, id) {
    const tag = ID_TYPES[type];
    if (!tag) {
        throw new TypeError(`Unknown API id type: ${type}`);
    }
    const raw = String(id ?? '');
    const prefix = `${ID_PREFIX}_${tag}_`;
    if (!raw.startsWith(prefix)) {
        throw badRequest(`The ${type} id is not a valid ${ID_PREFIX} ${type} identifier.`);
    }
    const encoded = raw.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
        throw badRequest(`The ${type} id is malformed.`);
    }
    let decoded;
    try {
        decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        throw badRequest(`The ${type} id is malformed.`);
    }
    if (!decoded) {
        throw badRequest(`The ${type} id is malformed.`);
    }
    return decoded;
}

/**
 * Decode an optional list of ids.
 * @param {keyof typeof ID_TYPES} type Expected resource type.
 * @param {unknown} ids Candidate list.
 * @returns {string[]} Internal keys.
 */
export function decodeIdList(type, ids) {
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.map(id => decodeId(type, id));
}

/**
 * Build a composite id for a resource addressed by two keys (book + entry uid).
 * @param {keyof typeof ID_TYPES} type Resource type.
 * @param {string[]} parts Internal key parts.
 * @returns {string} Opaque id.
 */
export function encodeCompositeId(type, parts) {
    return encodeId(type, parts.map(part => String(part)).join('\u0000'));
}

/**
 * Split a composite id back into its parts.
 * @param {keyof typeof ID_TYPES} type Expected resource type.
 * @param {unknown} id Opaque id.
 * @returns {string[]} Internal key parts.
 */
export function decodeCompositeId(type, id) {
    return decodeId(type, id).split('\u0000');
}
