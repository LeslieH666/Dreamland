/**
 * Seed Leslie memory + identity for the fixture chats, through the real stores.
 *
 * This mirrors src/leslie-demo-mode/seed.js so the fixtures look like ordinary
 * supported state to the memory interceptor rather than hand-written files.
 */

import path from 'node:path';

import { LeslieIdentityStore } from '../../../src/leslie-identity/store.js';
import { LeslieMemoryStore } from '../../../src/leslie-memory/store.js';
import { buildMemoryIdentityBinding, upsertMemoryMetadata } from '../../../public/scripts/extensions/leslie-memory/identity-context.js';
import { FIXTURE_PERSONA_AVATAR, FIXTURE_USER_NAME } from './corpus.mjs';

const GROWTH_SUMMARY = '学会了先核对坐标再落笔，也更愿意把不确定的地方标出来。';

/**
 * Active memory events, pinned so the injected list is byte-stable.
 *
 * The score is `levelWeight + importance*1.8 + relevance*4.5 + recency*1.6 + …`
 * (src/leslie-memory/scoring.js:52), and `relevance` depends on the chat text.
 * To keep one total order regardless of that term the fixtures:
 *   - use levels A/B/B, whose weights (3.2 / 2.1) dominate the rest of the sum;
 *   - use distinct importances, which then separate the two B entries;
 *   - phrase every summary with no character (or bigram) in common with the
 *     fixture chat, so relevance is 0 for all of them — splitTerms() emits both
 *     single Han characters and bigrams (src/leslie-memory/scoring.js:1).
 * Without this the two same-level entries can swap places between runs.
 */
const EVENT_PLAN = [
    { summary: '苹果树旁亮着路灯。', level: 'A', importance: 92 },
    { summary: '沙漠里埋着蓝图。', level: 'B', importance: 88 },
    { summary: '糖罐放在窗台。', level: 'B', importance: 84 },
];

/**
 * Create one memory per chat and return the metadata fragment for each.
 * @param {string} userRoot User root directory.
 * @param {Record<string, {avatar: string, chatName: string, characterName: string}>} chatKeys Chat keys.
 * @returns {Record<string, object>} chatKey → metadata fragment.
 */
export function seedFixtureMemory(userRoot, chatKeys) {
    const identities = new LeslieIdentityStore(userRoot);
    const memories = new LeslieMemoryStore(userRoot);
    const persona = { type: 'persona', sourceKey: FIXTURE_PERSONA_AVATAR, label: FIXTURE_USER_NAME };
    const metadata = {};

    for (const [chatKey, entry] of Object.entries(chatKeys)) {
        const resolution = identities.resolveStoryScope({
            persona,
            counterpart: { type: 'character', sourceKey: entry.avatar, label: entry.characterName },
            chat: { chatKey },
        });
        const identityBinding = buildMemoryIdentityBinding(resolution, { worldLine: 'story' });
        const memory = memories.createMemory({
            chatKey,
            characterKey: entry.avatar,
            coreSnapshot: { avatar: entry.avatar, name: entry.characterName },
            identityBinding,
        });
        const events = memories.upsertEvents(memory.manifest.id, EVENT_PLAN.map(entry => ({
            summary: entry.summary,
            level: entry.level,
            tags: ['合成夹具'],
            importance: entry.importance,
            confidence: 1,
            approved: true,
            // One shared messageId keeps age (and therefore recency) identical.
            source: [{ messageId: 2, swipeId: 0, hash: 'synthetic-fixture' }],
            relationshipImpact: { source: 'manual', reason: '合成夹具中的协作。', changes: { affection: 2, trust: 2, rapport: 1, security: 1, bond: 1, intimacy: 1 } },
        })));
        memories.updateState(memory.manifest.id, {
            enabled: true,
            analysis: { autoExtract: false },
            growth: {
                summary: GROWTH_SUMMARY,
                relationship: '从初识到能够直接沟通工作细节，边界清晰。',
                traits: ['注重核对', '表达直接'],
                goals: ['把这一季的观测记录整理完'],
                evidenceEventIds: events.map(event => event.id),
            },
            relationship: { enabled: true },
        });
        metadata[chatKey] = {
            leslie_memory: upsertMemoryMetadata({}, { memoryId: memory.manifest.id, chatKey, identityBinding }),
        };
    }

    return metadata;
}

/**
 * Default data root layout helper for callers that need the user root.
 * @param {string} dataRoot Data root.
 * @returns {string} User root.
 */
export function defaultUserRoot(dataRoot) {
    return path.join(dataRoot, 'default-user');
}
