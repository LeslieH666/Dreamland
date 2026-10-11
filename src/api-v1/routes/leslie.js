/**
 * `/api/v1` Leslie domain endpoints: memory, moments, identity and workshop.
 *
 * These reuse the exported store classes directly — they are the same objects
 * the web UI's routers construct — so no Leslie business logic is duplicated.
 * Operations whose logic exists only in the browser (moments publishing,
 * workshop generation) are reported as not implemented rather than
 * re-implemented on the server.
 */

import path from 'node:path';
import express from 'express';

import { LeslieMemoryStore } from '../../leslie-memory/store.js';
import { LeslieMomentsStore } from '../../leslie-moments/store.js';
import { LeslieIdentityStore } from '../../leslie-identity/store.js';
import { asyncRoute, notImplemented } from '../errors.js';
import { decodeId } from '../ids.js';
import { toApiList } from '../presenters.js';

export const leslieRouter = express.Router();

/**
 * Resolve the absolute per-user Leslie storage root.
 * @param {import('express').Request} request v1 request.
 * @returns {string} Absolute user root.
 */
function userRoot(request) {
    return path.resolve(request.user.directories.root);
}

// ------------------------------------------------------------------ memory

leslieRouter.get('/memory', asyncRoute(async (request, response) => {
    const store = new LeslieMemoryStore(userRoot(request));
    const sources = store.listMemorySources();
    response.send(toApiList((Array.isArray(sources) ? sources : []).map(source => ({
        id: String(source.memoryId ?? ''),
        character_key: String(source.characterKey ?? ''),
        chat_key: String(source.chatKey ?? ''),
        display_name: String(source.displayName ?? ''),
        identity_status: String(source.identityStatus ?? 'unbound'),
        updated_at: source.updatedAt ? new Date(source.updatedAt).toISOString() : null,
    }))));
}, 'Listing memory profiles failed.'));

// ----------------------------------------------------------------- moments

leslieRouter.get('/moments/feed', asyncRoute(async (request, response) => {
    const store = new LeslieMomentsStore(userRoot(request));
    const timeline = store.listPosts({ includeArchived: false });
    const posts = Array.isArray(timeline?.posts) ? timeline.posts : [];
    response.send(toApiList(posts.map(post => ({
        id: String(post.id ?? ''),
        author_entity_id: String(post.authorEntityId ?? ''),
        content: String(post.content ?? ''),
        visibility: String(post.visibility ?? 'public'),
        status: String(post.status ?? 'active'),
        created_at: post.createdAt ? new Date(post.createdAt).toISOString() : null,
        comments: Array.isArray(post.comments) ? post.comments.length : 0,
        likes: Array.isArray(post.likes) ? post.likes.length : 0,
    }))));
}, 'Reading the moments feed failed.'));

leslieRouter.post('/moments/posts', asyncRoute(async (_request, _response) => {
    throw notImplemented(
        'Publishing a moment is not available through /api/v1 yet. It needs the persona/storyline draft resolution that only the browser router performs.',
    );
}, 'Publishing a moment failed.'));

// ---------------------------------------------------------------- identity

leslieRouter.get('/identity/personas', asyncRoute(async (request, response) => {
    const store = new LeslieIdentityStore(userRoot(request));
    const registry = store.getRegistry();
    const entities = Array.isArray(registry?.entities) ? registry.entities : [];
    response.send(toApiList(entities
        .filter(entity => entity?.type === 'persona')
        .map(entity => ({
            id: String(entity.id ?? ''),
            name: String(entity.name ?? ''),
            type: 'persona',
            updated_at: registry?.updatedAt ? new Date(registry.updatedAt).toISOString() : null,
        }))));
}, 'Listing personas failed.'));

// ---------------------------------------------------------------- workshop

leslieRouter.post('/workshop/generate', asyncRoute(async (_request, _response) => {
    throw notImplemented(
        'Character workshop generation is not available through /api/v1 yet. The workshop runs in the browser: it builds its prompts client-side and calls the chat API from the page, so there is no server-side implementation to reuse.',
    );
}, 'Generating a workshop draft failed.'));

export { decodeId };
