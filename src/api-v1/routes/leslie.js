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
import { LeslieIdentityStore } from '../../leslie-identity/store.js';
import { asyncRoute, badRequest, conflict, notFound, notImplemented } from '../errors.js';
import {
    getStores as getMomentsStores,
    resolveAuthor,
    resolveNormalDraft,
    resolveStoryDraft,
} from '../../leslie-moments/router.js';
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

/**
 * Map a Leslie store error code onto the matching `/api/v1` failure.
 * @param {unknown} error Thrown value.
 * @returns {unknown} An ApiError, or the original value when unmapped.
 */
function momentsFailure(error) {
    const code = error && typeof error === 'object' ? error.code : null;
    const message = error instanceof Error ? error.message : String(error);
    switch (code) {
        case 'NOT_FOUND':
            return notFound(message);
        case 'INVALID_INPUT':
        case 'NO_USER':
            return badRequest(message);
        case 'LIMIT_REACHED':
        case 'IDENTITY_MISMATCH':
        case 'INVALID_STATE':
            return conflict(message);
        default:
            return error;
    }
}

/**
 * Present one moment, reading reactions from the activity store's decoration.
 * @param {object} post Decorated moment post.
 * @returns {object} v1 resource.
 */
function toApiMoment(post) {
    const likeList = Array.isArray(post?.reactions?.likes) ? post.reactions.likes : (Array.isArray(post?.likes) ? post.likes : []);
    const commentList = Array.isArray(post?.reactions?.comments) ? post.reactions.comments : (Array.isArray(post?.comments) ? post.comments : []);
    return {
        id: String(post?.id ?? ''),
        author_entity_id: String(post?.author?.entityId ?? post?.authorEntityId ?? ''),
        author_label: post?.author?.label ? String(post.author.label) : null,
        content: String(post?.content ?? ''),
        visibility: String(post?.visibility?.type ?? post?.visibility ?? 'all'),
        status: String(post?.status ?? 'active'),
        mode: post?.mode ? String(post.mode) : null,
        created_at: post?.createdAt ? new Date(post.createdAt).toISOString() : null,
        edited_at: post?.editedAt ? new Date(post.editedAt).toISOString() : null,
        likes: likeList.length,
        comments: commentList.length,
    };
}

/**
 * Decorate posts with the activity store, failing open exactly like the web router so a
 * broken activity file cannot take the feed down.
 * @param {object} stores Moments store bundle.
 * @param {object[]} posts Posts to decorate.
 * @returns {{posts: object[], status: object|null}} Decorated posts and activity status.
 */
function decorateMoments(stores, posts) {
    try {
        const decorated = stores.activity.decoratePosts(posts);
        return {
            posts: Array.isArray(decorated?.posts) ? decorated.posts : posts,
            status: decorated?.status ?? null,
        };
    } catch {
        return { posts, status: null };
    }
}

/** The moments feed. Shared by `/moments` and the older `/moments/feed` path. */
const listMoments = asyncRoute(async (request, response) => {
    const stores = getMomentsStores(request);
    const timeline = stores.moments.listPosts({
        includeArchived: request.query.includeArchived === 'true',
        viewerEntityId: typeof request.query.viewerEntityId === 'string' ? request.query.viewerEntityId : null,
    });
    const posts = Array.isArray(timeline?.posts) ? timeline.posts : [];
    const decorated = decorateMoments(stores, posts);
    response.send(toApiList(decorated.posts.map(toApiMoment)));
}, 'Reading the moments feed failed.');

// `/moments` is the resource name; `/moments/feed` is kept because the client shipped with it.
leslieRouter.get('/moments', listMoments);
leslieRouter.get('/moments/feed', listMoments);

leslieRouter.post('/moments/posts', asyncRoute(async (request, response) => {
    try {
        const stores = getMomentsStores(request);
        const body = request.body ?? {};
        const mode = body.mode === 'story' ? 'story' : 'reality';
        // Reuse the web router's draft resolution: it is what resolves the author Persona,
        // the visibility targets and (for story lines) the memory binding.
        const binding = mode === 'story'
            ? resolveStoryDraft(stores, body)
            : resolveNormalDraft(stores.identity, body);
        const post = stores.moments.createPost({
            mode,
            content: body.content,
            origin: 'user',
            sourceContext: { contentRole: binding.contentRole },
            ...binding,
        });
        const decorated = decorateMoments(stores, [post]);
        response.status(201).send(toApiMoment(decorated.posts[0]));
    } catch (error) {
        throw momentsFailure(error);
    }
}, 'Publishing a moment failed.'));

leslieRouter.patch('/moments/posts/:postId', asyncRoute(async (request, response) => {
    try {
        const stores = getMomentsStores(request);
        const body = request.body ?? {};
        const existing = stores.moments.getPost(request.params.postId);
        const draft = resolveNormalDraft(stores.identity, {
            author: body.author,
            visibility: body.visibility,
        });
        if (existing.storyBinding && draft.author.entityId !== existing.storyBinding.personaId) {
            throw conflict('The selected story line belongs to a different Persona.');
        }
        const post = stores.moments.updatePost(request.params.postId, {
            authorEntityId: draft.author.entityId,
            content: body.content,
            visibility: draft.visibility,
        });
        const decorated = decorateMoments(stores, [post]);
        response.send(toApiMoment(decorated.posts[0]));
    } catch (error) {
        throw momentsFailure(error);
    }
}, 'Editing a moment failed.'));

// Archive and restore are the two status transitions the web router exposes.
for (const [route, status] of [['archive', 'archived'], ['restore', 'active']]) {
    leslieRouter.post(`/moments/posts/:postId/${route}`, asyncRoute(async (request, response) => {
        try {
            const stores = getMomentsStores(request);
            const post = stores.moments.setPostStatus(request.params.postId, status);
            const decorated = decorateMoments(stores, [post]);
            response.send(toApiMoment(decorated.posts[0]));
        } catch (error) {
            throw momentsFailure(error);
        }
    }, 'Changing the moment status failed.'));
}

leslieRouter.put('/moments/posts/:postId/likes', asyncRoute(async (request, response) => {
    try {
        const stores = getMomentsStores(request);
        const post = stores.moments.getPost(request.params.postId);
        const author = resolveAuthor(stores.identity, request.body?.author);
        const result = stores.activity.setLike(post, author, request.body?.liked);
        const decorated = decorateMoments(stores, [post]);
        response.send({ ...result, post: toApiMoment(decorated.posts[0]) });
    } catch (error) {
        throw momentsFailure(error);
    }
}, 'Updating the moment like failed.'));

leslieRouter.post('/moments/posts/:postId/comments', asyncRoute(async (request, response) => {
    try {
        const stores = getMomentsStores(request);
        const post = stores.moments.getPost(request.params.postId);
        // A character-authored moment is replied to as that character, mirroring the web router.
        const author = post.author?.type === 'character'
            ? post.author
            : resolveAuthor(stores.identity, request.body?.author);
        const comment = stores.activity.addComment(post, author, request.body?.content, {
            parentCommentId: request.body?.parentCommentId ?? null,
        });
        const decorated = decorateMoments(stores, [post]);
        response.status(201).send({ comment, post: toApiMoment(decorated.posts[0]) });
    } catch (error) {
        throw momentsFailure(error);
    }
}, 'Adding the moment comment failed.'));

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
