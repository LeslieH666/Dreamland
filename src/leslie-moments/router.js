import path from 'node:path';
import express from 'express';

import { LeslieIdentityStore, LeslieIdentityStoreError } from '../leslie-identity/store.js';
import { LeslieMemoryStore, LeslieMemoryStoreError } from '../leslie-memory/store.js';
import { selectChatMemoryContext } from './chat-memory-adapter.js';
import { LeslieMomentsActivityStore, LeslieMomentsActivityStoreError } from './activity-store.js';
import { LeslieMomentsMemoryStore } from './memory-store.js';
import { LeslieMomentsSettingsStore } from './settings-store.js';
import { generateMomentsOnline, getConfiguredMomentsOnlineModels, MomentsOnlineModelError } from './online-model.js';
import { LeslieMomentsStore, LeslieMomentsStoreError } from './store.js';

export const router = express.Router();

export function resolveMomentsUserRoot(request) {
    const userRoot = request.user?.directories?.root;
    if (typeof userRoot !== 'string' || !userRoot.trim()) {
        throw new LeslieMomentsStoreError('NO_USER', 'No active SillyTavern user was found.');
    }
    return path.resolve(userRoot);
}

function getStores(request) {
    const userRoot = resolveMomentsUserRoot(request);
    return {
        userRoot,
        identity: new LeslieIdentityStore(userRoot),
        moments: new LeslieMomentsStore(userRoot),
        activity: new LeslieMomentsActivityStore(userRoot),
        chatMemory: new LeslieMemoryStore(userRoot),
        memory: new LeslieMomentsMemoryStore(userRoot),
        settings: new LeslieMomentsSettingsStore(userRoot),
    };
}

function sendError(response, error) {
    if (error instanceof MomentsOnlineModelError) {
        return response.status(error.code === 'INVALID_INPUT' ? 400 : error.code === 'MODEL_NOT_CONFIGURED' ? 409 : 502)
            .send({ error: error.code, message: error.message });
    }
    if (error instanceof LeslieMomentsStoreError || error instanceof LeslieMomentsActivityStoreError || error instanceof LeslieIdentityStoreError || error instanceof LeslieMemoryStoreError || error instanceof TypeError) {
        const status = error.code === 'NOT_FOUND' ? 404 : ['IDENTITY_MISMATCH', 'IDENTITY_CONFLICT', 'INVALID_STATE'].includes(error.code) ? 409 : 400;
        return response.status(status).send({ error: error.code ?? 'INVALID_INPUT', message: error.message });
    }
    console.error('Leslie moments request failed.', error);
    return response.status(500).send({ error: 'INTERNAL_ERROR', message: 'Leslie moments request failed. Check the server log for details.' });
}

function toIdentitySnapshot(entity, avatar = '') {
    return {
        entityId: entity.id,
        type: entity.type,
        sourceKey: entity.sourceKey,
        label: entity.label,
        avatar: String(avatar ?? '').trim().slice(0, 1000),
    };
}

function normalizeRawIdentity(value, type = value?.type) {
    return {
        id: value?.id,
        type,
        sourceKey: value?.sourceKey,
        label: value?.label,
    };
}

function resolveNormalDraft(identityStore, body) {
    const rawTargets = body.visibility?.type === 'selected' && Array.isArray(body.visibility.targets) ? body.visibility.targets : [];
    const rawContentRole = body.contentRole && typeof body.contentRole === 'object' ? body.contentRole : null;
    const resolution = identityStore.resolveEntities([
        normalizeRawIdentity(body.author, 'persona'),
        ...rawTargets.map(item => normalizeRawIdentity(item, item.type || 'character')),
        ...(rawContentRole ? [normalizeRawIdentity(rawContentRole, rawContentRole.type || 'character')] : []),
    ]);
    const author = resolution.entities[0];
    const targets = resolution.entities.slice(1, 1 + rawTargets.length);
    const contentRole = rawContentRole ? resolution.entities[resolution.entities.length - 1] : null;
    return {
        author: toIdentitySnapshot(author, body.author?.avatar),
        visibility: {
            type: body.visibility?.type === 'selected' ? 'selected' : 'all',
            targets: targets.map((entity, index) => toIdentitySnapshot(entity, rawTargets[index]?.avatar)),
        },
        contentRole: contentRole ? toIdentitySnapshot(contentRole, rawContentRole.avatar) : null,
        storyBinding: null,
    };
}

function resolveStoryDraft(stores, body) {
    const normalDraft = resolveNormalDraft(stores.identity, body);
    if (body.memorySourceId) {
        const memory = stores.chatMemory.getMemory(body.memorySourceId);
        const binding = memory.manifest.identityBinding;
        if (!binding?.confirmed) {
            throw new LeslieMemoryStoreError('IDENTITY_MISMATCH', 'The selected character memory is not bound to a confirmed story line.');
        }
        if (normalDraft.author.entityId !== binding.personaId) {
            throw new LeslieMemoryStoreError('IDENTITY_MISMATCH', 'The selected character memory belongs to a different Persona.');
        }
        return {
            ...normalDraft,
            storyBinding: {
                storyScopeId: binding.storyScopeId,
                personaId: binding.personaId,
                counterpartId: binding.counterpartId,
                counterpartType: binding.counterpartType,
                chatKey: memory.manifest.chatKey,
                personaName: binding.personaName,
                counterpartName: binding.counterpartName,
            },
        };
    }
    const resolution = stores.identity.resolveStoryScope(body.storyContext);
    if (normalDraft.author.entityId !== resolution.persona.id) {
        throw new LeslieIdentityStoreError('IDENTITY_MISMATCH', 'The selected story line belongs to a different Persona.');
    }
    return {
        author: toIdentitySnapshot(resolution.persona, body.author?.avatar),
        visibility: normalDraft.visibility,
        storyBinding: {
            storyScopeId: resolution.storyScope.id,
            personaId: resolution.persona.id,
            counterpartId: resolution.counterpart.id,
            counterpartType: resolution.counterpart.type,
            chatKey: resolution.storyScope.currentChatKey,
            personaName: resolution.persona.label,
            counterpartName: resolution.counterpart.label,
        },
    };
}

function resolveAuthor(identityStore, author) {
    const result = identityStore.resolveEntities([normalizeRawIdentity(author, 'persona')]);
    return toIdentitySnapshot(result.entities[0], author?.avatar);
}

function resolveCharacter(identityStore, actor) {
    const result = identityStore.resolveEntities([normalizeRawIdentity(actor, 'character')]);
    return toIdentitySnapshot(result.entities[0], actor?.avatar);
}

function resolveActivityCandidates(identityStore, post, body) {
    if (post.visibility?.type === 'selected') {
        return post.visibility.targets;
    }
    const rawCandidates = Array.isArray(body?.activityCandidates) ? body.activityCandidates.slice(0, 50) : [];
    if (!rawCandidates.length) {
        return [];
    }
    const resolution = identityStore.resolveEntities(rawCandidates.map(item => normalizeRawIdentity(item, item?.type || 'character')));
    return resolution.entities
        .filter(entity => entity.type === 'character' || entity.type === 'group')
        .map((entity, index) => toIdentitySnapshot(entity, rawCandidates[index]?.avatar));
}

function canCharacterComment(settings, actorEntityId) {
    const policy = settings.characterPolicies.find(item => item.actor.entityId === actorEntityId);
    return policy?.canInteract !== false;
}

function resolveCommentCandidates(stores, post, body) {
    const settings = stores.settings.readSettings();
    return resolveActivityCandidates(stores.identity, post, body)
        .filter(candidate => canCharacterComment(settings, candidate.entityId));
}

function logActivityFailure(error) {
    console.warn(`Leslie moments background activity is unavailable. ${String(error?.message || error).slice(0, 500)}`);
}

function alignPersonaCommentAuthorsFailOpen(stores) {
    let posts;
    try {
        posts = stores.moments.alignPersonaCommentAuthors().timeline.posts;
    } catch (error) {
        console.warn(`Leslie moments Persona comment repair is unavailable. ${String(error?.message || error).slice(0, 500)}`);
        try {
            posts = stores.moments.readTimeline().posts;
        } catch {
            return;
        }
    }
    try {
        stores.activity.alignPersonaCommentAuthors(posts);
    } catch (error) {
        console.warn(`Leslie moments Persona activity repair is unavailable. ${String(error?.message || error).slice(0, 500)}`);
    }
}

function decoratePostsFailOpen(activityStore, posts) {
    const fallbackPosts = posts.map(post => ({
        ...post,
        readReceipts: Array.isArray(post.readReceipts) ? post.readReceipts : [],
        reactions: {
            likes: Array.isArray(post.reactions?.likes) ? post.reactions.likes : [],
            comments: Array.isArray(post.reactions?.comments) ? post.reactions.comments : [],
        },
    }));
    let decoratedPosts = fallbackPosts;
    let status;
    let activityFailed = false;
    try {
        decoratedPosts = activityStore.decoratePosts(posts);
    } catch (error) {
        activityFailed = true;
        logActivityFailure(error);
    }
    try {
        status = activityStore.getStatus();
    } catch (error) {
        logActivityFailure(error);
    }
    if (activityFailed) {
        status = {
            ...(status ?? {}),
            state: 'error',
            lastError: '朋友圈互动数据不可用；原动态仍可正常使用。',
        };
    }
    return {
        posts: decoratedPosts,
        status: status ?? {
            state: 'error',
            paused: false,
            pendingCount: 0,
            dueCount: 0,
            lastError: '朋友圈互动数据不可用；原动态仍可正常使用。',
        },
    };
}

function planActivityFailOpen(stores, post, body) {
    try {
        const candidates = resolveActivityCandidates(stores.identity, post, body);
        stores.activity.planPost(post, candidates, { enthusiasm: body?.enthusiasm });
    } catch (error) {
        logActivityFailure(error);
    }
}

function cancelActivityFailOpen(activityStore, postId) {
    try {
        activityStore.cancelPost(postId);
    } catch (error) {
        logActivityFailure(error);
    }
}

function invalidateMomentMemoryFailOpen(memoryStore, postId) {
    try {
        memoryStore.invalidatePost(postId);
    } catch (error) {
        console.warn(`Leslie moments memory invalidation is unavailable. ${String(error?.message || error).slice(0, 500)}`);
    }
}

function resolveSettingsDraft(identityStore, body) {
    const rawPolicies = Array.isArray(body?.characterPolicies) ? body.characterPolicies.slice(0, 500) : [];
    if (!rawPolicies.length) {
        return {
            globalAiPostingEnabled: body?.globalAiPostingEnabled === true,
            onlineModel: body?.onlineModel,
            characterPolicies: [],
        };
    }
    const resolution = identityStore.resolveEntities(rawPolicies.map(policy => normalizeRawIdentity(policy.actor, 'character')));
    return {
        globalAiPostingEnabled: body?.globalAiPostingEnabled === true,
        onlineModel: body?.onlineModel,
        characterPolicies: resolution.entities.map((entity, index) => ({
            actor: toIdentitySnapshot(entity, rawPolicies[index]?.actor?.avatar),
            canPost: rawPolicies[index]?.canPost === true,
            frequency: rawPolicies[index]?.frequency,
            useChatMemory: rawPolicies[index]?.useChatMemory === true,
            canInteract: rawPolicies[index]?.canInteract !== false,
        })),
    };
}

router.get('/settings', (request, response) => {
    try {
        return response.send({ settings: getStores(request).settings.readSettings() });
    } catch (error) {
        return sendError(response, error);
    }
});

router.get('/models', async (request, response) => {
    try {
        const models = await getConfiguredMomentsOnlineModels({ directories: request.user.directories });
        return response.send({ models });
    } catch (error) {
        return sendError(response, error);
    }
});

router.put('/model-selection', async (request, response) => {
    try {
        const provider = String(request.body?.provider ?? '').trim();
        const models = await getConfiguredMomentsOnlineModels({ directories: request.user.directories });
        const selected = models.find(item => item.provider === provider);
        if (!selected) {
            throw new MomentsOnlineModelError('MODEL_NOT_CONFIGURED', '请选择已在模型连接中配置的联网模型。');
        }
        const settingsStore = getStores(request).settings;
        const previous = settingsStore.readSettings();
        const settings = settingsStore.updateSettings({ ...previous, onlineModel: { provider, model: selected.model } });
        return response.send({ settings, models });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/generate', async (request, response) => {
    try {
        const stores = getStores(request);
        const selectedProvider = stores.settings.readSettings().onlineModel.provider;
        const models = await getConfiguredMomentsOnlineModels({ directories: request.user.directories });
        const onlineModel = models.find(item => item.provider === selectedProvider);
        if (!onlineModel) {
            throw new MomentsOnlineModelError('MODEL_NOT_CONFIGURED', '请先在模型连接中配置联网 API，再在朋友圈选择它。');
        }
        const controller = new AbortController();
        response.on('close', () => {
            if (!response.writableEnded) controller.abort();
        });
        const content = await generateMomentsOnline({
            directories: request.user.directories,
            onlineModel,
            input: request.body,
            signal: controller.signal,
        });
        if (!response.writableEnded) return response.send({ content });
    } catch (error) {
        if (!response.writableEnded) return sendError(response, error);
    }
});

router.put('/settings', (request, response) => {
    try {
        const stores = getStores(request);
        const draft = resolveSettingsDraft(stores.identity, request.body);
        const settings = stores.settings.updateSettings(draft);
        const allowedPublisherIds = settings.globalAiPostingEnabled
            ? settings.characterPolicies.filter(policy => policy.canPost).map(policy => policy.actor.entityId)
            : [];
        const disallowedCommenterIds = settings.characterPolicies
            .filter(policy => policy.canInteract === false)
            .map(policy => policy.actor.entityId);
        stores.activity.cancelPublisherJobs(allowedPublisherIds);
        stores.activity.cancelCommentJobs(disallowedCommenterIds);
        if (settings.globalAiPostingEnabled) {
            stores.activity.syncPublisherJobs(settings.characterPolicies);
        }
        return response.send({ settings });
    } catch (error) {
        return sendError(response, error);
    }
});

router.get('/', (request, response) => {
    try {
        const includeArchived = request.query.includeArchived === 'true';
        const viewerEntityId = typeof request.query.viewerEntityId === 'string' ? request.query.viewerEntityId : null;
        const stores = getStores(request);
        alignPersonaCommentAuthorsFailOpen(stores);
        const timeline = stores.moments.listPosts({ includeArchived, viewerEntityId });
        const decorated = decoratePostsFailOpen(stores.activity, timeline.posts);
        return response.send({
            ...timeline,
            posts: decorated.posts,
            activityStatus: decorated.status,
        });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/', (request, response) => {
    try {
        const stores = getStores(request);
        const mode = request.body?.mode;
        const binding = mode === 'story'
            ? resolveStoryDraft(stores, request.body)
            : resolveNormalDraft(stores.identity, request.body);
        const post = stores.moments.createPost({
            mode,
            content: request.body?.content,
            origin: 'user',
            sourceContext: {
                importedMemories: request.body?.memoryImports,
                contentRole: binding.contentRole,
            },
            ...binding,
        });
        planActivityFailOpen(stores, post, request.body);
        return response.status(201).send({ post: decoratePostsFailOpen(stores.activity, [post]).posts[0] });
    } catch (error) {
        return sendError(response, error);
    }
});

router.patch('/:postId', (request, response) => {
    try {
        const stores = getStores(request);
        const existing = stores.moments.getPost(request.params.postId);
        const draft = resolveNormalDraft(stores.identity, {
            author: request.body?.author,
            visibility: request.body?.visibility,
        });
        if (existing.storyBinding && draft.author.entityId !== existing.storyBinding.personaId) {
            throw new LeslieIdentityStoreError('IDENTITY_MISMATCH', 'The selected story line belongs to a different Persona.');
        }
        const post = stores.moments.updatePost(request.params.postId, {
            authorEntityId: draft.author.entityId,
            content: request.body?.content,
            visibility: draft.visibility,
        });
        invalidateMomentMemoryFailOpen(stores.memory, post.id);
        planActivityFailOpen(stores, post, request.body);
        return response.send({ post: decoratePostsFailOpen(stores.activity, [post]).posts[0] });
    } catch (error) {
        return sendError(response, error);
    }
});

for (const [route, status] of [['archive', 'archived'], ['restore', 'active']]) {
    router.post(`/:postId/${route}`, (request, response) => {
        try {
            const stores = getStores(request);
            const post = stores.moments.setPostStatus(request.params.postId, status);
            if (status === 'archived') {
                cancelActivityFailOpen(stores.activity, post.id);
                invalidateMomentMemoryFailOpen(stores.memory, post.id);
            } else {
                planActivityFailOpen(stores, post, request.body);
            }
            return response.send({ post: decoratePostsFailOpen(stores.activity, [post]).posts[0] });
        } catch (error) {
            return sendError(response, error);
        }
    });
}

router.put('/:postId/likes', (request, response) => {
    try {
        const stores = getStores(request);
        const post = stores.moments.getPost(request.params.postId);
        if (post.status !== 'active') {
            throw new LeslieMomentsStoreError('INVALID_STATE', 'Restore this moment before liking it.');
        }
        const author = resolveAuthor(stores.identity, request.body?.author);
        const result = stores.activity.setLike(post, author, request.body?.liked);
        return response.send({
            ...result,
            post: stores.activity.decoratePosts([post])[0],
        });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/:postId/comments', (request, response) => {
    try {
        const stores = getStores(request);
        const post = stores.moments.getPost(request.params.postId);
        if (post.status !== 'active') {
            throw new LeslieMomentsStoreError('INVALID_STATE', 'Restore this moment before replying.');
        }
        const author = post.author?.type === 'persona'
            ? post.author
            : resolveAuthor(stores.identity, request.body?.author);
        const decoratedBefore = stores.activity.decoratePosts([post])[0];
        const parent = request.body?.parentCommentId
            ? decoratedBefore.reactions.comments.find(item => item.id === request.body.parentCommentId)
            : null;
        const comment = stores.activity.addComment(post, author, request.body?.content, {
            parentCommentId: request.body?.parentCommentId,
        });
        const candidates = resolveCommentCandidates(stores, post, request.body);
        stores.activity.planThread(post, {
            ...comment,
            parentActorEntityId: parent?.actor?.type === 'character'
                ? parent.actor.entityId
                : post.author?.type === 'character' ? post.author.entityId : null,
        }, candidates, { enthusiasm: request.body?.enthusiasm });
        return response.status(201).send({
            comment,
            post: stores.activity.decoratePosts([post])[0],
        });
    } catch (error) {
        return sendError(response, error);
    }
});

router.get('/activity/status', (request, response) => {
    try {
        return response.send({ status: getStores(request).activity.getStatus() });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/pause', (request, response) => {
    try {
        return response.send({ status: getStores(request).activity.setPaused(Boolean(request.body?.paused)) });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/heartbeat', (request, response) => {
    try {
        const status = getStores(request).activity.heartbeat(request.body?.state, request.body?.error);
        return response.send({ status });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/reconcile', (request, response) => {
    try {
        const stores = getStores(request);
        const timeline = stores.moments.readTimeline();
        const allCandidates = resolveActivityCandidates(stores.identity, { visibility: { type: 'all' } }, request.body);
        const reconciled = stores.activity.reconcilePosts(timeline.posts, allCandidates, {
            enthusiasm: request.body?.enthusiasm,
        });
        const settings = stores.settings.readSettings();
        const publishing = settings.globalAiPostingEnabled
            ? stores.activity.syncPublisherJobs(settings.characterPolicies)
            : { jobs: [] };
        return response.send({
            scheduledReads: reconciled.jobs.length,
            scheduledPosts: publishing.jobs.length,
            status: stores.activity.getStatus(),
        });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/jobs/claim', (request, response) => {
    try {
        const stores = getStores(request);
        const timeline = stores.moments.readTimeline();
        const claim = stores.activity.claimJob(timeline.posts);
        if (claim.job && claim.job.type !== 'compose_post') {
            const settings = stores.settings.readSettings();
            claim.job.permissions = {
                canComment: canCharacterComment(settings, claim.job.actor.entityId),
            };
        }
        if (claim.post) {
            claim.post = stores.activity.decoratePosts([claim.post])[0];
        }
        return response.send(claim);
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/jobs/:jobId/complete', (request, response) => {
    try {
        const stores = getStores(request);
        const job = stores.activity.getJob(request.params.jobId);
        const post = stores.moments.getPost(job.postId);
        const knownComments = stores.activity.decoratePosts([post])[0].reactions.comments;
        const settings = stores.settings.readSettings();
        const activity = stores.activity.completeJob(request.params.jobId, request.body, {
            knownComments,
            allowComments: canCharacterComment(settings, job.actor.entityId),
        });
        const createdComment = activity.comments.find(item => item.jobId === job.id) ?? null;
        try {
            stores.memory.recordObservation(job.actor, post, {
                comment: createdComment,
                summary: request.body?.memorySummary,
                topics: request.body?.topics,
                importance: request.body?.importance,
            });
        } catch (error) {
            console.warn(`Leslie moments memory update is unavailable. ${String(error?.message || error).slice(0, 500)}`);
        }
        if (createdComment) {
            try {
                const parent = createdComment.parentCommentId
                    ? activity.comments.find(item => item.id === createdComment.parentCommentId)
                    : null;
                const candidates = resolveCommentCandidates(stores, post, request.body);
                stores.activity.planThread(post, {
                    ...createdComment,
                    parentActorEntityId: parent?.actor?.type === 'character'
                        ? parent.actor.entityId
                        : post.author?.type === 'character' ? post.author.entityId : null,
                }, candidates, { enthusiasm: request.body?.enthusiasm });
            } catch (error) {
                logActivityFailure(error);
            }
        }
        return response.send({ activity });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/jobs/:jobId/publish', (request, response) => {
    try {
        const stores = getStores(request);
        const job = stores.activity.getJob(request.params.jobId);
        if (job.type !== 'compose_post') {
            throw new LeslieMomentsActivityStoreError('INVALID_STATE', 'The requested job is not a publishing job.');
        }
        const settings = stores.settings.readSettings();
        const policy = settings.characterPolicies.find(item => item.actor.entityId === job.actor.entityId);
        if (!settings.globalAiPostingEnabled || !policy?.canPost) {
            stores.activity.completeComposeJob(job.id, { skipped: true });
            return response.send({ post: null, skipped: true });
        }
        if (request.body?.action === 'skip') {
            stores.activity.completeComposeJob(job.id, { skipped: true });
            return response.send({ post: null, skipped: true });
        }
        const post = stores.moments.createPost({
            mode: 'reality',
            worldLine: 'reality',
            origin: 'ai',
            content: request.body?.content,
            author: job.actor,
            visibility: { type: 'all', targets: [] },
            sourceContext: { importedMemories: [], contentRole: job.actor },
        });
        stores.activity.completeComposeJob(job.id, { publishedPostId: post.id });
        try {
            stores.memory.recordObservation(job.actor, post, {
                summary: request.body?.memorySummary,
                topics: request.body?.topics,
                importance: request.body?.importance,
            });
        } catch (error) {
            console.warn(`Leslie moments memory update is unavailable. ${String(error?.message || error).slice(0, 500)}`);
        }
        planActivityFailOpen(stores, post, request.body);
        return response.status(201).send({ post: decoratePostsFailOpen(stores.activity, [post]).posts[0], skipped: false });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/memory/context', (request, response) => {
    try {
        const stores = getStores(request);
        const actor = resolveCharacter(stores.identity, request.body?.actor);
        const post = request.body?.postId ? stores.moments.getPost(request.body.postId) : null;
        const personaId = post?.author?.type === 'persona' ? post.author.entityId : (post?.storyBinding?.personaId ?? null);
        const storyScopeId = post?.storyBinding?.storyScopeId ?? null;
        const query = String(request.body?.query ?? post?.content ?? '').slice(0, 5000);
        const social = stores.memory.selectContext({
            actorEntityId: actor.entityId,
            personaId,
            storyScopeId,
            query,
            maximum: request.body?.maximum,
        });
        const policy = stores.settings.getPolicy(actor.entityId);
        const chat = policy?.useChatMemory && post
            ? selectChatMemoryContext(stores.userRoot, {
                actorEntityId: actor.entityId,
                personaId,
                storyScopeId,
                query,
                maximum: request.body?.maximum,
            })
            : { memories: [] };
        return response.send({ socialMemories: social.events, chatMemories: chat.memories });
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/activity/jobs/:jobId/fail', (request, response) => {
    try {
        const stores = getStores(request);
        const job = stores.activity.failJob(request.params.jobId, request.body?.error, {
            retryAfterMs: request.body?.retryAfterMs,
        });
        return response.send({ job });
    } catch (error) {
        return sendError(response, error);
    }
});
