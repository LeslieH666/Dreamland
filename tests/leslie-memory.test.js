import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import express from 'express';

import { LeslieMemoryStore } from '../src/leslie-memory/store.js';
import { resolveMemoryUserRoot, router as memoryRouter } from '../src/leslie-memory/router.js';
import { scoreMemoryEvent, selectMemoryEvents } from '../src/leslie-memory/scoring.js';
import { MEMORY_MODEL_PROVIDERS, normalizeMemoryModelSettings } from '../src/leslie-memory/schema.js';

const STORY_BINDING = {
    worldLine: 'story',
    storyScopeId: '11111111-1111-4111-8111-111111111111',
    personaId: '22222222-2222-4222-8222-222222222222',
    personaSourceKey: '哥哥.png',
    personaName: '哥哥',
    counterpartId: '33333333-3333-4333-8333-333333333333',
    counterpartType: 'character',
    counterpartSourceKey: '妹妹.png',
    counterpartName: '妹妹',
    confirmed: true,
};

describe('Leslie memory request path', () => {
    test('keeps the DeepSeek memory provider in the persisted schema allowlist', () => {
        expect(MEMORY_MODEL_PROVIDERS).toContain('deepseek');
        expect(normalizeMemoryModelSettings({ provider: 'deepseek' }).provider).toBe('deepseek');
    });

    test('normalizes SillyTavern relative user roots without touching user data', () => {
        const relativeRoot = path.join('data', 'default-user');
        const request = { user: { directories: { root: relativeRoot } } };

        expect(resolveMemoryUserRoot(request)).toBe(path.resolve(relativeRoot));
    });

    test('preserves an existing absolute user root', () => {
        const absoluteRoot = path.join(os.tmpdir(), 'leslie-existing-user');
        const request = { user: { directories: { root: absoluteRoot } } };

        expect(resolveMemoryUserRoot(request)).toBe(absoluteRoot);
    });

    test('accepts a group ensure request through the existing API route', async () => {
        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-memory-router-'));
        const app = express();
        app.use(express.json());
        app.use((request, _response, next) => {
            request.user = { directories: { root: temporaryRoot } };
            next();
        });
        app.use('/api/leslie/memory', memoryRouter);
        const server = await new Promise(resolve => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        });

        try {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api/leslie/memory/ensure`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    chatKey: 'group:group-42::chat-one',
                    characterKey: 'group:group-42',
                    coreSnapshot: { name: 'Test Group' },
                    isGroup: true,
                }),
            });
            const result = await response.json();

            expect(response.status).toBe(200);
            expect(result.created).toBe(true);
            expect(result.memory.manifest.chatKey).toBe('group:group-42::chat-one');
            expect(result.memory.state.enabled).toBe(false);
        } finally {
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });
});

describe('Leslie memory store', () => {
    let temporaryRoot;
    let store;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-memory-'));
        store = new LeslieMemoryStore(temporaryRoot);
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    test('creates an isolated disabled memory with a protected core snapshot', () => {
        const result = store.ensureMemory({
            chatKey: 'character/avatar.png::chat-one',
            characterKey: 'character/avatar.png',
            coreSnapshot: { name: 'Leslie', personality: 'Careful and loyal.' },
        });

        expect(result.created).toBe(true);
        expect(result.memory.state.enabled).toBe(false);
        expect(result.memory.coreSnapshot.personality).toBe('Careful and loyal.');
        expect(fs.existsSync(path.join(temporaryRoot, 'leslie', 'memory', result.memory.manifest.id, 'events.jsonl'))).toBe(true);
    });

    test('binds new memories to one stable Persona story line and rejects another scope', () => {
        const result = store.ensureMemory({
            chatKey: '妹妹.png::主线',
            characterKey: '妹妹.png',
            identityBinding: STORY_BINDING,
        });
        const otherBinding = {
            ...STORY_BINDING,
            storyScopeId: '44444444-4444-4444-8444-444444444444',
            personaId: '55555555-5555-4555-8555-555555555555',
            personaSourceKey: '同学.png',
            personaName: '同学',
        };
        const mismatch = store.ensureMemory({
            memoryId: result.memory.manifest.id,
            chatKey: '妹妹.png::主线',
            characterKey: '妹妹.png',
            identityBinding: otherBinding,
        });

        expect(result.identityStatus).toBe('matched');
        expect(result.memory.manifest.schemaVersion).toBe(5);
        expect(result.memory.manifest.identityBinding.personaName).toBe('哥哥');
        expect(mismatch.identityStatus).toBe('mismatch');
        expect(() => store.assertStoryScope(result.memory.manifest.id, otherBinding.storyScopeId)).toThrow(/different Persona/);
        expect(() => store.assertStoryScope(result.memory.manifest.id, STORY_BINDING.storyScopeId)).not.toThrow();
    });

    test('keeps legacy memories unbound until an explicit confirmed binding', () => {
        const result = store.ensureMemory({ chatKey: 'legacy-chat', characterKey: '妹妹.png' });
        expect(result.identityStatus).toBe('unbound');
        expect(result.memory.manifest.identityBinding).toBeNull();
        expect(() => store.bindIdentity(result.memory.manifest.id, STORY_BINDING)).toThrow(/explicit confirmation/);

        const manifest = store.bindIdentity(result.memory.manifest.id, STORY_BINDING, { confirmed: true });
        expect(manifest.identityBinding.personaId).toBe(STORY_BINDING.personaId);
        expect(fs.readdirSync(path.join(temporaryRoot, 'leslie', 'memory', result.memory.manifest.id, 'history'))
            .some(file => file.startsWith('manifest-'))).toBe(true);
    });

    test('shares only a small memory sample from the same character on the opposite world line', () => {
        const story = store.ensureMemory({
            chatKey: '妹妹.png::故事线',
            characterKey: '妹妹.png',
            identityBinding: STORY_BINDING,
        }).memory;
        const reality = store.ensureMemory({
            chatKey: '妹妹.png::现实线',
            characterKey: '妹妹.png',
            identityBinding: {
                ...STORY_BINDING,
                worldLine: 'reality',
                storyScopeId: '44444444-4444-4444-8444-444444444444',
            },
        }).memory;
        const otherCharacter = store.ensureMemory({
            chatKey: '同学.png::现实线',
            characterKey: '同学.png',
            identityBinding: {
                ...STORY_BINDING,
                worldLine: 'reality',
                storyScopeId: '55555555-5555-4555-8555-555555555555',
                counterpartId: '66666666-6666-4666-8666-666666666666',
                counterpartSourceKey: '同学.png',
                counterpartName: '同学',
            },
        }).memory;
        for (const memory of [story, reality, otherCharacter]) {
            store.updateState(memory.manifest.id, { enabled: true });
        }
        store.upsertEvents(reality.manifest.id, [{
            summary: '现实里，妹妹记得哥哥喜欢清晨散步。',
            level: 'B',
            approved: true,
            source: [{ messageId: 3 }],
            tags: ['清晨', '散步'],
        }]);
        store.upsertEvents(otherCharacter.manifest.id, [{
            summary: '这条属于另一个角色，不应跨线泄露。',
            level: 'A',
            approved: true,
            source: [{ messageId: 5 }],
        }]);

        const context = store.selectCrossLineContext(story.manifest.id, {
            query: '清晨散步',
            maximum: 2,
        });

        expect(context.enabled).toBe(true);
        expect(context.currentWorldLine).toBe('story');
        expect(context.memories).toHaveLength(1);
        expect(context.memories[0]).toMatchObject({
            summary: '现实里，妹妹记得哥哥喜欢清晨散步。',
            fromWorldLine: 'reality',
            sourceMemoryId: reality.manifest.id,
        });
    });

    test('lists confirmed and legacy memories without pretending legacy data has a story binding', () => {
        const bound = store.ensureMemory({
            chatKey: '妹妹.png::主线',
            characterKey: '妹妹.png',
            coreSnapshot: { name: '妹妹', avatar: '妹妹.png' },
            identityBinding: STORY_BINDING,
        });
        const legacy = store.ensureMemory({
            chatKey: 'legacy-chat',
            characterKey: 'legacy.png',
            coreSnapshot: { name: '旧角色', avatar: 'legacy.png' },
        });

        expect(store.listMemorySources()).toEqual(expect.arrayContaining([expect.objectContaining({
            memoryId: bound.memory.manifest.id,
            chatKey: '妹妹.png::主线',
            displayName: '妹妹',
            identityStatus: 'confirmed',
            identityBinding: expect.objectContaining({ counterpartName: '妹妹', confirmed: true }),
        }), expect.objectContaining({
            memoryId: legacy.memory.manifest.id,
            displayName: '旧角色',
            identityStatus: 'unbound',
            identityBinding: null,
        })]));
    });

    test('clones a bound memory when a chat branch receives a new story-line identity', () => {
        const main = store.ensureMemory({
            chatKey: '妹妹.png::主线',
            characterKey: '妹妹.png',
            identityBinding: STORY_BINDING,
        });
        const branchBinding = {
            ...STORY_BINDING,
            storyScopeId: '66666666-6666-4666-8666-666666666666',
        };
        const branch = store.ensureMemory({
            memoryId: main.memory.manifest.id,
            chatKey: '妹妹.png::分支',
            parentChatKey: '妹妹.png::主线',
            characterKey: '妹妹.png',
            isBranch: true,
            branchPointMessageId: 4,
            identityBinding: branchBinding,
        });

        expect(branch.branched).toBe(true);
        expect(branch.identityStatus).toBe('matched');
        expect(branch.memory.manifest.id).not.toBe(main.memory.manifest.id);
        expect(branch.memory.manifest.identityBinding.storyScopeId).toBe(branchBinding.storyScopeId);
    });

    test('stores a group chat in the same schema while preserving participant attribution', () => {
        const result = store.ensureMemory({
            chatKey: 'group:group-42::shared-chat',
            characterKey: 'group:group-42',
            coreSnapshot: {
                name: '旧画室里的香夜梨与雅雪',
                description: '[香夜梨]\n冷淡而温柔。\n\n[雅雪]\n开朗而敏锐。',
            },
            isGroup: true,
        });
        const [event] = store.upsertEvents(result.memory.manifest.id, [{
            summary: '雅雪发现香夜梨把旧画室当作安稳的落脚点。',
            level: 'B',
            participants: ['香夜梨', '雅雪'],
            source: [{ messageId: 7 }],
        }], { sourceType: 'ai' });

        expect(result.created).toBe(true);
        expect(result.memory.manifest.chatKey).toBe('group:group-42::shared-chat');
        expect(result.memory.manifest.characterKey).toBe('group:group-42');
        expect(result.memory.manifest).not.toHaveProperty('isGroup');
        expect(event.participants).toEqual(['香夜梨', '雅雪']);
        expect(result.memory.state.enabled).toBe(false);
    });

    test('automatically approves AI A memories for real-time relationship calculation', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const [event] = store.upsertEvents(memory.manifest.id, [{
            summary: 'The character decided to trust the user after a rescue.',
            level: 'A',
            source: [{ messageId: 12, swipeId: 0, hash: 'abc' }],
            relationshipImpact: {
                changes: { affection: 1, trust: 3, intimacy: 1, rapport: 0, security: 2, bond: 2 },
                reason: 'A rescue established lasting trust.',
            },
        }], { sourceType: 'ai' });

        expect(event.status).toBe('active');
        expect(event.approved).toBe(true);
        expect(event.relationshipImpact.changes.trust).toBe(3);
    });

    test('keeps the experimental relationship toggle separate from memory injection', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const state = store.updateState(memory.manifest.id, { relationship: { enabled: true } });

        expect(state.enabled).toBe(false);
        expect(state.relationship.enabled).toBe(true);
        expect(state.relationship.experimental).toBe(true);
    });

    test('projects A and B as long-term scores while C fades with message age', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const id = memory.manifest.id;
        store.updateState(id, { relationship: { enabled: true }, settings: { cDecayTurns: 8 } });
        store.upsertEvents(id, [
            {
                summary: 'A lasting act of trust.',
                level: 'A',
                importance: 100,
                confidence: 1,
                approved: true,
                source: [{ messageId: 2 }],
                relationshipImpact: {
                    changes: { affection: 1, trust: 3, intimacy: 0, rapport: 0, security: 0, bond: 0 },
                    reason: 'Long-term trust evidence.',
                },
            },
            {
                summary: 'A considerate daily detail.',
                level: 'C',
                importance: 100,
                confidence: 1,
                source: [{ messageId: 10 }],
                relationshipImpact: {
                    changes: { affection: 0, trust: 0, intimacy: 0, rapport: 3, security: 0, bond: 0 },
                    reason: 'Recent mutual understanding.',
                },
            },
        ]);

        const fresh = store.getRelationship(id, { currentMessageId: 10 });
        const faded = store.getRelationship(id, { currentMessageId: 18 });

        expect(fresh.enabled).toBe(true);
        expect(fresh.dimensions.affection).toBe(3);
        expect(fresh.dimensions.trust).toBe(9);
        expect(fresh.dimensions.rapport).toBe(1.5);
        expect(faded.dimensions.trust).toBe(9);
        expect(faded.dimensions.rapport).toBeCloseTo(0.6, 1);
    });

    test('removes a relationship contribution when its source message becomes invalid', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const id = memory.manifest.id;
        store.updateState(id, { relationship: { enabled: true } });
        store.upsertEvents(id, [{
            summary: 'A promise was kept.',
            level: 'B',
            importance: 80,
            confidence: 1,
            source: [{ messageId: 4, swipeId: 0, hash: 'before' }],
            relationshipImpact: {
                changes: { affection: 0, trust: 3, intimacy: 0, rapport: 0, security: 0, bond: 0 },
                reason: 'The promise increased trust.',
            },
        }]);

        expect(store.getRelationship(id, { currentMessageId: 5 }).dimensions.trust).toBeGreaterThan(0);
        store.invalidateByMessageIds(id, [4], 'Message was swiped.');
        expect(store.getRelationship(id, { currentMessageId: 5 }).dimensions.trust).toBe(0);
    });

    test('reinforces repeated AI memories instead of creating duplicates', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const [first] = store.upsertEvents(memory.manifest.id, [{
            summary: 'They promised to return before dawn.',
            level: 'B',
            source: [{ messageId: 3 }],
        }], { sourceType: 'ai' });
        const [repeated] = store.upsertEvents(memory.manifest.id, [{
            summary: 'They promised to return before dawn!',
            level: 'B',
            source: [{ messageId: 9 }],
        }], { sourceType: 'ai' });

        expect(repeated.id).toBe(first.id);
        expect(repeated.reinforcement).toBe(2);
        expect(repeated.source.map(item => item.messageId)).toEqual([3, 9]);
        expect(store.readEvents(memory.manifest.id)).toHaveLength(1);
    });

    test('invalidates memories that depend on edited or swiped messages', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const [event] = store.upsertEvents(memory.manifest.id, [{
            summary: 'A promise was made.',
            level: 'B',
            source: [{ messageId: 4, swipeId: 0, hash: 'old' }],
        }]);

        const affected = store.invalidateByMessageIds(memory.manifest.id, [4], 'Message was edited.');
        expect(affected).toHaveLength(1);
        expect(store.readEvents(memory.manifest.id).find(item => item.id === event.id).status).toBe('invalid');
    });

    test('versions and restores the growth state', () => {
        const { memory } = store.ensureMemory({ chatKey: 'chat', characterKey: 'character' });
        const id = memory.manifest.id;
        const first = store.updateState(id, { enabled: true, growth: { relationship: 'Cautious allies.' } });
        const second = store.updateState(id, { growth: { relationship: 'Trusted companions.' } });

        expect(first.revision).toBe(1);
        expect(second.revision).toBe(2);
        expect(store.listHistory(id).map(item => item.revision)).toEqual(expect.arrayContaining([0, 1]));

        const restored = store.restoreState(id, 1);
        expect(restored.relationship.enabled).toBe(false);
        expect(restored.growth.relationship).toBe('Cautious allies.');
        expect(restored.revision).toBe(3);
    });

    test('migrates legacy state to an independent memory-model setting and keeps a rollback copy', () => {
        const { memory } = store.ensureMemory({
            chatKey: 'legacy-chat',
            characterKey: 'character',
            identityBinding: STORY_BINDING,
        });
        const paths = store.getPaths(memory.manifest.id);
        const legacyState = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
        delete legacyState.settings.memoryModel;
        legacyState.schemaVersion = 2;
        legacyState.growth.relationship = 'A preserved legacy relationship.';
        const legacyManifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
        legacyManifest.schemaVersion = 2;
        delete legacyManifest.identityBinding.worldLine;
        store.appendEventRecords(memory.manifest.id, [{
            id: '77777777-7777-4777-8777-777777777777',
            summary: 'A legacy formative event awaiting approval.',
            level: 'A',
            importance: 90,
            confidence: 0.8,
            participants: [],
            tags: [],
            source: [{ messageId: 1, swipeId: 0, hash: 'legacy' }],
            sourceType: 'ai',
            status: 'pending',
            approved: false,
            pinned: false,
            reinforcement: 1,
            candidateChange: null,
            supersedes: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }]);
        fs.writeFileSync(paths.state, `${JSON.stringify(legacyState)}\n`);
        fs.writeFileSync(paths.manifest, `${JSON.stringify(legacyManifest)}\n`);

        const migrated = store.getMemory(memory.manifest.id);
        const historyFiles = fs.readdirSync(paths.history);

        expect(migrated.manifest.schemaVersion).toBe(5);
        expect(migrated.state.schemaVersion).toBe(5);
        expect(migrated.state.relationship.enabled).toBe(false);
        expect(migrated.manifest.identityBinding.worldLine).toBe('story');
        expect(migrated.state.settings.memoryModel.provider).toBe('chat');
        expect(migrated.state.growth.relationship).toBe('A preserved legacy relationship.');
        expect(migrated.events[0].status).toBe('active');
        expect(migrated.events[0].approved).toBe(true);
        expect(historyFiles.some(file => file.startsWith('state-migration-v2-'))).toBe(true);
        expect(historyFiles.some(file => file.startsWith('manifest-migration-v2-'))).toBe(true);
        expect(historyFiles.some(file => file.startsWith('events-migration-v2-'))).toBe(true);
    });

    test('persists a separate memory model and restores the previous selection', () => {
        const { memory } = store.ensureMemory({ chatKey: 'model-chat', characterKey: 'character' });
        const id = memory.manifest.id;
        const local = store.updateState(id, {
            settings: {
                memoryModel: {
                    provider: 'local',
                    endpoint: 'http://127.0.0.1:5001',
                    model: 'peach-local',
                    apiKey: 'local-only-secret',
                    temperature: 0.4,
                },
            },
        });

        expect(local.settings.memoryModel).toMatchObject({
            provider: 'local',
            endpoint: 'http://127.0.0.1:5001',
            model: 'peach-local',
            temperature: 0.4,
        });
        expect(store.getMemory(id).state.settings.memoryModel.apiKey).toBe('local-only-secret');

        const deepseek = store.updateState(id, {
            settings: {
                memoryModel: {
                    provider: 'deepseek',
                    endpoint: 'https://api.deepseek.com',
                    model: 'deepseek-v4-flash',
                    apiKey: 'synthetic-deepseek-key',
                    temperature: 0.2,
                },
            },
        });

        expect(deepseek.settings.memoryModel).toMatchObject({
            provider: 'deepseek',
            endpoint: 'https://api.deepseek.com',
            model: 'deepseek-v4-flash',
            temperature: 0.2,
        });
        expect(store.getMemory(id).state.settings.memoryModel.apiKey).toBe('synthetic-deepseek-key');

        const restored = store.restoreState(id, 0);
        expect(restored.settings.memoryModel.provider).toBe('chat');
        expect(store.getMemory(id).state.settings.memoryModel.provider).toBe('chat');
    });

    test('creates a separate branch and drops events after the branch point', () => {
        const { memory } = store.ensureMemory({ chatKey: 'main-chat', characterKey: 'character' });
        store.upsertEvents(memory.manifest.id, [
            { summary: 'An early promise.', level: 'A', approved: true, source: [{ messageId: 2 }] },
            { summary: 'A later betrayal.', level: 'A', approved: true, source: [{ messageId: 20 }] },
        ]);

        const branch = store.cloneMemory(memory.manifest.id, { chatKey: 'branch-chat', characterKey: 'character', branchPointMessageId: 5 });
        expect(branch.manifest.id).not.toBe(memory.manifest.id);
        expect(branch.manifest.parentMemoryId).toBe(memory.manifest.id);
        expect(branch.events.map(event => event.summary)).toEqual(['An early promise.']);
    });

    test('keeps the same memory on rename and clones only an explicit branch', () => {
        const { memory } = store.ensureMemory({ chatKey: 'old-name', characterKey: 'character' });
        const renamed = store.ensureMemory({ memoryId: memory.manifest.id, chatKey: 'new-name', characterKey: 'character' });
        const branched = store.ensureMemory({
            memoryId: memory.manifest.id,
            chatKey: 'branch-name',
            characterKey: 'character',
            branchPointMessageId: 3,
            isBranch: true,
            parentChatKey: 'new-name',
        });

        expect(renamed.memory.manifest.id).toBe(memory.manifest.id);
        expect(renamed.branched).toBe(false);
        expect(renamed.memory.manifest.chatKey).toBe('new-name');
        expect(branched.memory.manifest.id).not.toBe(memory.manifest.id);
        expect(branched.branched).toBe(true);
    });

    test('rebinds a renamed branch instead of creating a nested clone', () => {
        const { memory } = store.ensureMemory({ chatKey: 'main-chat', characterKey: 'character' });
        const { memory: branch } = store.ensureMemory({
            memoryId: memory.manifest.id,
            chatKey: 'branch-chat',
            characterKey: 'character',
            isBranch: true,
            parentChatKey: 'main-chat',
        });
        const renamed = store.ensureMemory({
            memoryId: branch.manifest.id,
            chatKey: 'renamed-branch',
            characterKey: 'character',
            isBranch: true,
            parentChatKey: 'main-chat',
        });

        expect(renamed.memory.manifest.id).toBe(branch.manifest.id);
        expect(renamed.branched).toBe(false);
        expect(renamed.memory.manifest.chatKey).toBe('renamed-branch');
    });
});

describe('Leslie memory selection', () => {
    test('lets a relevant older memory outrank an unrelated recent detail', () => {
        const events = [
            {
                id: 'old', summary: 'The spare key is hidden below the flowerpot.', level: 'C', status: 'active',
                importance: 25, confidence: 1, reinforcement: 1, source: [{ messageId: 1 }], tags: ['key', 'flowerpot'], participants: [],
            },
            {
                id: 'new', summary: 'They ate noodles for lunch.', level: 'C', status: 'active',
                importance: 25, confidence: 1, reinforcement: 1, source: [{ messageId: 99 }], tags: ['lunch'], participants: [],
            },
        ];

        const selected = selectMemoryEvents(events, { query: 'Where did we hide the flowerpot key?', currentMessageId: 100, maximum: 1 });
        expect(selected[0].event.id).toBe('old');
        expect(scoreMemoryEvent(events[0], { query: 'flowerpot key', currentMessageId: 100 })).toBeGreaterThan(scoreMemoryEvent(events[1], { query: 'flowerpot key', currentMessageId: 100 }));
    });

    test('forgets stale B and C details unless the current conversation recalls them', () => {
        const events = [
            {
                id: 'stale-c', summary: 'The spare key is below the flowerpot.', level: 'C', status: 'active',
                importance: 30, confidence: 1, reinforcement: 1, source: [{ messageId: 1 }], tags: ['key'], participants: [],
            },
            {
                id: 'stale-b', summary: 'They planned a winter journey.', level: 'B', status: 'active',
                importance: 60, confidence: 1, reinforcement: 1, source: [{ messageId: 1 }], tags: ['journey'], participants: [],
            },
        ];
        const settings = { cDecayTurns: 8, bDecayTurns: 40 };

        expect(selectMemoryEvents(events, { query: 'What shall we eat?', currentMessageId: 100, settings })).toEqual([]);
        expect(selectMemoryEvents(events, { query: 'Where is the flowerpot key?', currentMessageId: 100, settings }).map(item => item.event.id)).toContain('stale-c');
        expect(selectMemoryEvents(events, { query: 'Should we resume the winter journey?', currentMessageId: 100, settings }).map(item => item.event.id)).toContain('stale-b');
    });
});
