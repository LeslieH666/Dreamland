/**
 * `/api/v1/secrets` — key-id only API-key management.
 *
 * Added for Phase 2 task 2.5 (the approved contract draft predates it). The
 * response never contains a secret value: only the key id, the entry id, a
 * masked preview and the source, so a compromised client cannot exfiltrate a
 * provider key it did not already know.
 */

import express from 'express';

import { asyncRoute } from '../errors.js';
import { deleteSecret, listSecretIds, setSecret } from '../secrets.js';
import { toApiList } from '../presenters.js';

export const secretsRouter = express.Router();

secretsRouter.get('/', asyncRoute(async (request, response) => {
    response.send(toApiList(listSecretIds(request.user.directories)));
}, 'Listing secret key ids failed.'));

secretsRouter.put('/:keyId', asyncRoute(async (request, response) => {
    const result = setSecret(
        request.user.directories,
        request.params.keyId,
        request.body?.value,
        request.body?.label ?? 'API',
    );
    response.status(201).send({ key_id: String(request.params.keyId), entry_id: result.entry_id });
}, 'Storing a secret failed.'));

secretsRouter.delete('/:keyId', asyncRoute(async (request, response) => {
    deleteSecret(request.user.directories, request.params.keyId, request.body?.entry_id ?? null);
    response.sendStatus(204);
}, 'Deleting a secret failed.'));
