/**
 * Cursor pagination for the public API.
 *
 * Cursors are opaque base64url offsets. They are validated on the way in and
 * never expose a filesystem path, and an unparseable cursor is a 400 rather
 * than a silent restart from the beginning.
 */

import { badRequest } from './errors.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/**
 * Read `limit` and `cursor` from a request.
 * @param {import('express').Request} request Express request.
 * @returns {{offset: number, limit: number}} Pagination window.
 * @throws {ApiError} 400 when `limit` or `cursor` is invalid.
 */
export function readPageWindow(request) {
    const rawLimit = request.query?.limit;
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined && rawLimit !== '') {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
            throw badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
        }
        limit = parsed;
    }

    const rawCursor = request.query?.cursor;
    let offset = 0;
    if (rawCursor !== undefined && rawCursor !== '') {
        const decoded = Buffer.from(String(rawCursor), 'base64url').toString('utf8');
        // Decoding invalid base64url yields an empty or non-numeric string, so
        // require the plain digits the writer emits.
        if (!/^\d+$/.test(decoded)) {
            throw badRequest('cursor is not a valid pagination cursor.');
        }
        offset = Number(decoded);
    }

    return { offset, limit };
}

/**
 * Slice a list and compute the next cursor.
 * @param {object[]} items Full list.
 * @param {{offset: number, limit: number}} window Pagination window.
 * @returns {{page: object[], nextCursor: string | null}} Page and next cursor.
 */
export function paginate(items, { offset, limit }) {
    const list = Array.isArray(items) ? items : [];
    const page = list.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const nextCursor = nextOffset < list.length
        ? Buffer.from(String(nextOffset), 'utf8').toString('base64url')
        : null;
    return { page, nextCursor };
}
