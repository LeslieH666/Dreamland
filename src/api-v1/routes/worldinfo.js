/**
 * `/api/v1/worldinfo` — World Info books.
 *
 * `readWorldInfoFile` is exported by `src/endpoints/worldinfo.js`, so reading
 * reuses the canonical parser (including its dummy/empty-book handling). Entry
 * *writes* have no server-side implementation anywhere — the editor lives in
 * the browser — so they are reported as not implemented instead of being
 * re-implemented here.
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import { readWorldInfoFile } from '../../endpoints/worldinfo.js';
import { asyncRoute, notImplemented } from '../errors.js';
import { decodeCompositeId } from '../ids.js';
import { readPageWindow, paginate } from '../pagination.js';
import { toApiList, toApiWorldInfoEntry } from '../presenters.js';

export const worldInfoRouter = express.Router();

/**
 * Read every World Info entry of the account.
 *
 * The contract describes this as "entries for the current chat context", but
 * no server-side chat-context resolution exists (World Info activation is
 * computed in the browser), so this returns all books with their entries and
 * leaves context filtering to the client. Recorded as a deviation in the
 * phase report.
 * @param {import('express').Request} request v1 request.
 * @returns {object[]} Flattened entries.
 */
function readAllEntries(request) {
    const worldsRoot = request.user.directories.worlds;
    if (!fs.existsSync(worldsRoot)) {
        return [];
    }
    const entries = [];
    for (const file of fs.readdirSync(worldsRoot)) {
        if (path.extname(file) !== '.json') {
            continue;
        }
        const bookName = file.replace(/\.json$/, '');
        const book = readWorldInfoFile(request.user.directories, bookName, false);
        const bookEntries = book?.entries && typeof book.entries === 'object' ? book.entries : {};
        let index = 0;
        for (const entry of Object.values(bookEntries)) {
            entries.push(toApiWorldInfoEntry(bookName, entry, index++));
        }
    }
    return entries;
}

worldInfoRouter.get('/', asyncRoute(async (request, response) => {
    const { page, nextCursor } = paginate(readAllEntries(request), readPageWindow(request));
    response.send(toApiList(page, nextCursor));
}, 'Listing World Info entries failed.'));

worldInfoRouter.post('/', asyncRoute(async () => {
    throw notImplemented(
        'Creating a World Info entry is not available through /api/v1 yet. The book editor is browser-only and no server-side entry writer is exported.',
    );
}, 'Creating a World Info entry failed.'));

worldInfoRouter.put('/:id', asyncRoute(async (request) => {
    // Validated so a malformed id still fails as a 400 rather than a 501.
    decodeCompositeId('worldinfo', request.params.id);
    throw notImplemented(
        'Updating a World Info entry is not available through /api/v1 yet. The book editor is browser-only and no server-side entry writer is exported.',
    );
}, 'Updating a World Info entry failed.'));

worldInfoRouter.delete('/:id', asyncRoute(async (request) => {
    decodeCompositeId('worldinfo', request.params.id);
    throw notImplemented(
        'Deleting a World Info entry is not available through /api/v1 yet. The book editor is browser-only and no server-side entry writer is exported.',
    );
}, 'Deleting a World Info entry failed.'));
