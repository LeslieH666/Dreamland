/**
 * `/api/v1/groups` — group chats.
 *
 * `src/endpoints/groups.js` defines its CRUD inline and exports no helpers, but
 * it does export its router, so the adapter invokes those routes with a mock
 * request/response. Group files, member normalization and the chat cascade on
 * delete therefore stay in exactly one implementation.
 */

import express from 'express';

import { router as legacyGroupsRouter } from '../../endpoints/groups.js';
import { asyncRoute, badRequest, notFound } from '../errors.js';
import { decodeId, decodeIdList, encodeId } from '../ids.js';
import { invokeWithRequest, readJsonOrThrow } from '../adapters/express.js';
import { toApiGroup, toApiList } from '../presenters.js';

export const groupsRouter = express.Router();

/**
 * Invoke a legacy group route.
 * @param {import('express').Request} request v1 request.
 * @param {string} legacyPath Route path inside the legacy router.
 * @param {object} [body] Legacy body.
 * @returns {Promise<any>} Parsed legacy response.
 */
async function callLegacy(request, legacyPath, body = {}) {
    const captured = await invokeWithRequest(legacyGroupsRouter, request, { method: 'POST', path: legacyPath, body });
    return readJsonOrThrow(captured, { fallbackMessage: 'The group operation failed.' });
}

groupsRouter.get('/', asyncRoute(async (request, response) => {
    const groups = /** @type {object[]} */ (await callLegacy(request, '/all'));
    response.send(toApiList((Array.isArray(groups) ? groups : []).map(group => toApiGroup(group))));
}, 'Listing groups failed.'));

groupsRouter.post('/', asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    if (!body.name || String(body.name).trim() === '') {
        throw badRequest('name is required.');
    }
    await callLegacy(request, '/create', {
        name: String(body.name).trim(),
        members: decodeIdList('character', body.member_ids),
    });
    const groups = /** @type {object[]} */ (await callLegacy(request, '/all'));
    const created = (Array.isArray(groups) ? groups : []).find(group => group.name === String(body.name).trim());
    if (!created) {
        throw notFound('The group was created but could not be read back.');
    }
    response.status(201).send(toApiGroup(created));
}, 'Creating a group failed.'));

groupsRouter.get('/:id', asyncRoute(async (request, response) => {
    const groupId = decodeId('group', request.params.id);
    const groups = /** @type {object[]} */ (await callLegacy(request, '/all'));
    const group = (Array.isArray(groups) ? groups : []).find(item => String(item.id) === groupId);
    if (!group) {
        throw notFound('That group does not exist.');
    }
    response.send(toApiGroup(group));
}, 'Reading a group failed.'));

groupsRouter.patch('/:id', asyncRoute(async (request, response) => {
    const groupId = decodeId('group', request.params.id);
    const body = request.body ?? {};
    if (!body.name || String(body.name).trim() === '') {
        throw badRequest('name is required.');
    }
    await callLegacy(request, '/edit', {
        id: groupId,
        name: String(body.name).trim(),
        members: decodeIdList('character', body.member_ids),
    });
    const groups = /** @type {object[]} */ (await callLegacy(request, '/all'));
    const group = (Array.isArray(groups) ? groups : []).find(item => String(item.id) === groupId);
    if (!group) {
        throw notFound('That group does not exist.');
    }
    response.send(toApiGroup(group));
}, 'Updating a group failed.'));

groupsRouter.delete('/:id', asyncRoute(async (request, response) => {
    const groupId = decodeId('group', request.params.id);
    await callLegacy(request, '/delete', { id: groupId });
    response.sendStatus(204);
}, 'Deleting a group failed.'));

export { encodeId };
