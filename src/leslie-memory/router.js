import path from 'node:path';
import express from 'express';

import { LeslieMemoryStore, LeslieMemoryStoreError } from './store.js';

export const router = express.Router();

/**
 * Resolve SillyTavern's active user directory for Leslie's isolated storage.
 * SillyTavern may expose a relative root when started from the project folder.
 * @param {import('express').Request} request Express request.
 * @returns {string} Absolute path to the active user's existing data directory.
 */
export function resolveMemoryUserRoot(request) {
    const userRoot = request.user?.directories?.root;
    if (typeof userRoot !== 'string' || !userRoot.trim()) {
        throw new LeslieMemoryStoreError('NO_USER', 'No active SillyTavern user was found.');
    }
    return path.resolve(userRoot);
}

function getStore(request) {
    return new LeslieMemoryStore(resolveMemoryUserRoot(request));
}

function sendError(response, error) {
    if (error instanceof LeslieMemoryStoreError || error instanceof TypeError) {
        const status = error.code === 'NOT_FOUND' ? 404 : 400;
        return response.status(status).send({ error: error.code ?? 'INVALID_INPUT', message: error.message });
    }
    console.error('Leslie memory request failed.', error);
    return response.status(500).send({ error: 'INTERNAL_ERROR', message: 'Leslie memory request failed. Check the server log for details.' });
}

router.post('/ensure', (request, response) => {
    try {
        return response.send(getStore(request).ensureMemory(request.body));
    } catch (error) {
        return sendError(response, error);
    }
});

router.get('/catalog', (request, response) => {
    try {
        return response.send({ sources: getStore(request).listMemorySources() });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/events/invalidate', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        const events = store.invalidateByMessageIds(request.params.memoryId, request.body?.messageIds, request.body?.reason);
        return response.send({ events });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/events', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        const sourceType = request.body?.sourceType ?? 'manual';
        const events = store.upsertEvents(request.params.memoryId, request.body?.events, { sourceType });
        return response.send({ events });
    } catch (error) {
        return sendError(response, error);
    }
});

router.patch('/:memoryId/events/:eventId', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        const event = store.patchEvent(request.params.memoryId, request.params.eventId, request.body);
        return response.send({ event });
    } catch (error) {
        return sendError(response, error);
    }
});

router.put('/:memoryId/state', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        const state = store.updateState(request.params.memoryId, request.body);
        return response.send({ state });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/state/restore', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        const state = store.restoreState(request.params.memoryId, request.body?.revision);
        return response.send({ state });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/core-snapshot', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        if (request.body?.confirmed !== true) {
            throw new LeslieMemoryStoreError('CONFIRMATION_REQUIRED', 'Updating the protected core snapshot requires explicit confirmation.');
        }
        return response.send(store.updateCoreSnapshot(request.params.memoryId, request.body?.coreSnapshot));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/branch', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.sourceStoryScopeId);
        const memory = store.cloneMemory(request.params.memoryId, request.body);
        return response.send({ memory });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/context', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        return response.send(store.selectContext(request.params.memoryId, request.body));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/cross-line-context', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        return response.send(store.selectCrossLineContext(request.params.memoryId, request.body));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/relationship', (request, response) => {
    try {
        const store = getStore(request);
        store.assertStoryScope(request.params.memoryId, request.body?.storyScopeId);
        return response.send({ relationship: store.getRelationship(request.params.memoryId, request.body) });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:memoryId/identity', (request, response) => {
    try {
        const manifest = getStore(request).bindIdentity(request.params.memoryId, request.body?.identityBinding, { confirmed: request.body?.confirmed });
        return response.send({ manifest });
    } catch (error) {
        return sendError(response, error);
    }
});

router.get('/:memoryId', (request, response) => {
    try {
        return response.send({ memory: getStore(request).getMemory(request.params.memoryId) });
    } catch (error) {
        return sendError(response, error);
    }
});
