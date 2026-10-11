/**
 * `/api/v1/characters` — character cards.
 *
 * Reuse strategy: `src/endpoints/characters.js` keeps every card helper
 * private and is under a compatibility freeze, but it *does* export its
 * Express router. The adapter therefore invokes the existing routes with a
 * mock request/response (see adapters/express.js), so `processCharacter`,
 * `charaFormatData` and `writeCharacterData` stay the single implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import { router as legacyCharactersRouter } from '../../endpoints/characters.js';
import { asyncRoute, badRequest, notFound, notImplemented } from '../errors.js';
import { decodeId } from '../ids.js';
import { readPageWindow, paginate } from '../pagination.js';
import { invokeWithRequest, readJsonOrThrow } from '../adapters/express.js';
import { toApiCharacterCard, toApiCharacterSummary, toApiList } from '../presenters.js';

export const charactersRouter = express.Router();

/**
 * Invoke a legacy character route.
 * @param {import('express').Request} request v1 request.
 * @param {string} legacyPath Route path inside the legacy router.
 * @param {object} [body] Legacy request body.
 * @returns {Promise<unknown>} Parsed legacy response.
 */
async function callLegacy(request, legacyPath, body = {}) {
    const captured = await invokeWithRequest(legacyCharactersRouter, request, {
        method: 'POST',
        path: legacyPath,
        body,
    });
    return readJsonOrThrow(captured, {
        allowStatuses: legacyPath === '/create' || legacyPath === '/delete' ? [200] : [200],
        fallbackMessage: 'The character operation failed.',
    });
}

charactersRouter.get('/', asyncRoute(async (request, response) => {
    const characters = /** @type {object[]} */ (await callLegacy(request, '/all'));
    const query = String(request.query?.query ?? '').trim().toLowerCase();
    const filtered = query
        ? characters.filter(character => {
            const haystack = [character.name, ...(Array.isArray(character.tags) ? character.tags : [])]
                .map(value => String(value).toLowerCase())
                .join(' ');
            return haystack.includes(query);
        })
        : characters;

    const { page, nextCursor } = paginate(filtered, readPageWindow(request));
    response.send(toApiList(page.map(character => toApiCharacterSummary(character)), nextCursor));
}, 'Listing characters failed.'));

charactersRouter.post('/', asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    if (!body.name || String(body.name).trim() === '') {
        throw badRequest('name is required.');
    }
    const legacyBody = {
        ch_name: String(body.name).trim(),
        description: String(body.description ?? ''),
        personality: String(body.personality ?? ''),
        scenario: String(body.scenario ?? ''),
        first_mes: String(body.first_message ?? ''),
        mes_example: String(body.example_dialogue ?? ''),
        creator: String(body.creator ?? 'DreamLand API'),
        creator_notes: String(body.creator_notes ?? ''),
        tags: Array.isArray(body.tags) ? body.tags : [],
        alternate_greetings: Array.isArray(body.alternate_greetings) ? body.alternate_greetings : [],
        talkativeness: 0.5,
        fav: false,
        spec: 'chara_card_v2',
        spec_version: '2.0',
    };

    const avatarName = String(await callLegacy(request, '/create', legacyBody));
    const character = await callLegacy(request, '/get', { avatar_url: avatarName });
    response.status(201).send(toApiCharacterCard(character, avatarName));
}, 'Creating a character failed.'));

charactersRouter.get('/:id', asyncRoute(async (request, response) => {
    const avatarName = decodeId('character', request.params.id);
    const character = await callLegacy(request, '/get', { avatar_url: avatarName });
    if (!character || typeof character !== 'object') {
        throw notFound('That character does not exist.');
    }
    response.send(toApiCharacterCard(character, avatarName));
}, 'Reading a character failed.'));

charactersRouter.patch('/:id', asyncRoute(async (request, response) => {
    const avatarName = decodeId('character', request.params.id);
    const body = request.body ?? {};
    const legacyBody = {
        avatar_url: avatarName,
        ch_name: String(body.name ?? '').trim(),
        description: String(body.description ?? ''),
        personality: String(body.personality ?? ''),
        scenario: String(body.scenario ?? ''),
        first_mes: String(body.first_message ?? ''),
        mes_example: String(body.example_dialogue ?? ''),
        creator: String(body.creator ?? ''),
        tags: Array.isArray(body.tags) ? body.tags : [],
        talkativeness: 0.5,
        fav: false,
        spec: 'chara_card_v2',
        spec_version: '2.0',
    };
    if (!legacyBody.ch_name) {
        throw badRequest('name is required.');
    }
    await callLegacy(request, '/edit', legacyBody);
    const character = await callLegacy(request, '/get', { avatar_url: avatarName });
    response.send(toApiCharacterCard(character, avatarName));
}, 'Updating a character failed.'));

charactersRouter.delete('/:id', asyncRoute(async (request, response) => {
    const avatarName = decodeId('character', request.params.id);
    await callLegacy(request, '/delete', { avatar_url: avatarName });
    response.sendStatus(204);
}, 'Deleting a character failed.'));

charactersRouter.get('/:id/avatar', asyncRoute(async (request, response) => {
    const avatarName = decodeId('character', request.params.id);
    const filePath = path.join(request.user.directories.characters, avatarName);
    if (!fs.existsSync(filePath)) {
        throw notFound('That character has no avatar.');
    }
    response.set('Content-Type', 'image/png');
    response.set('Cache-Control', 'private, max-age=60');
    response.send(fs.readFileSync(filePath));
}, 'Reading a character avatar failed.'));

charactersRouter.put('/:id/avatar', asyncRoute(async (request, response) => {
    const avatarName = decodeId('character', request.params.id);
    const filePath = path.join(request.user.directories.characters, avatarName);
    if (!fs.existsSync(filePath)) {
        throw notFound('That character does not exist.');
    }
    // Rewriting the PNG bytes in place would drop the embedded card (the card
    // JSON lives in a PNG tEXt chunk that only the private `writeCharacterData`
    // helper can re-embed). That helper is not exported and
    // src/endpoints/characters.js is under a compatibility freeze, so this
    // operation is reported as not implemented rather than risking card loss.
    throw notImplemented(
        'Updating a character avatar is not available through /api/v1 yet. '
        + 'It needs the card-embedding writer in src/endpoints/characters.js, which is frozen for this phase.',
    );
}, 'Updating a character avatar failed.'));
