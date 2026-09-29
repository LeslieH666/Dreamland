import { describe, expect, test } from '@jest/globals';

import {
    beginRealitySession,
    buildRealityMessageSystemPrompt,
    buildRealityTimePrompt,
    createRealityChatBinding,
    formatElapsedTime,
    getWorldLineKind,
    hasUsableRealityProfile,
    LESLIE_WORLD_LINE_METADATA_KEY,
    LESLIE_WORLD_LINE_SCHEMA_VERSION,
    matchesRealityChatBinding,
    normalizeRealityProfile,
    selectWorldLineChat,
    shouldGenerateRealitySessionOpening,
    touchRealitySession,
    validateRealityMessage,
} from '../public/scripts/leslie-reality-context.js';

describe('Leslie reality world line context', () => {
    test('records the real elapsed interval between sessions and advances activity time', () => {
        const session = beginRealitySession({
            schemaVersion: 1,
            kind: 'reality',
            createdAt: '2026-09-19T00:00:00.000Z',
            lastActiveAt: '2026-09-19T12:00:00.000Z',
            conversationAnchor: 'keep-existing-jsonl',
        }, {
            now: new Date('2026-09-20T00:00:00.000Z'),
            personaSourceKey: '哥哥.png',
        });

        expect(session.lastSessionGapMs).toBe(12 * 60 * 60 * 1000);
        expect(session.previousActiveAt).toBe('2026-09-19T12:00:00.000Z');
        expect(session.personaSourceKey).toBe('哥哥.png');
        expect(session.schemaVersion).toBe(LESLIE_WORLD_LINE_SCHEMA_VERSION);
        expect(session.conversationAnchor).toBe('keep-existing-jsonl');
        expect(touchRealitySession(session, { now: new Date('2026-09-20T00:05:00.000Z') }).lastActiveAt)
            .toBe('2026-09-20T00:05:00.000Z');
    });

    test('builds a reality-only time cue without changing story chats', () => {
        const metadata = beginRealitySession({
            kind: 'reality',
            lastActiveAt: '2026-09-19T12:00:00.000Z',
        }, { now: new Date('2026-09-20T00:00:00.000Z') });
        const prompt = buildRealityTimePrompt(metadata, {
            now: new Date('2026-09-20T00:00:00.000Z'),
            locale: 'zh-CN',
            timeZone: 'Asia/Shanghai',
        });

        expect(prompt).toContain('约 12 小时');
        expect(prompt).toContain('Asia/Shanghai');
        expect(prompt).toContain('不要机械报时');
        expect(buildRealityTimePrompt({ kind: 'story' })).toBe('');
        expect(formatElapsedTime(25 * 60 * 60 * 1000)).toBe('约 1 天');
        expect(buildRealityTimePrompt(beginRealitySession(null), {
            now: new Date('2026-09-20T00:00:00.000Z'),
            locale: 'zh-CN',
            timeZone: 'Asia/Shanghai',
        })).toContain('第一次联系');
    });

    test('selects the newest chat from the requested line and Persona only', () => {
        const history = [
            { file_name: 'story-new', last_mes: '2026-09-20T03:00:00.000Z', chat_metadata: {} },
            {
                file_name: 'reality-wrong-persona',
                last_mes: '2026-09-20T04:00:00.000Z',
                chat_metadata: { [LESLIE_WORLD_LINE_METADATA_KEY]: { kind: 'reality', personaSourceKey: '同学.png' } },
            },
            {
                file_name: 'reality-right-persona',
                last_mes: '2026-09-20T02:00:00.000Z',
                chat_metadata: {
                    [LESLIE_WORLD_LINE_METADATA_KEY]: {
                        schemaVersion: 1,
                        kind: 'reality',
                        personaSourceKey: '哥哥.png',
                    },
                },
            },
        ];

        expect(getWorldLineKind(history[0].chat_metadata)).toBe('story');
        expect(selectWorldLineChat(history, 'story')?.file_name).toBe('story-new');
        expect(selectWorldLineChat(history, 'reality', '哥哥.png')?.file_name).toBe('reality-right-persona');
    });

    test('binds asynchronous reality work to one chat file and session', () => {
        const metadata = {
            integrity: 'reality-integrity',
            [LESLIE_WORLD_LINE_METADATA_KEY]: {
                kind: 'reality',
                sessionStartedAt: '2026-09-26T15:19:15.000Z',
            },
        };
        const binding = createRealityChatBinding({ characterId: 3, chatId: 'reality-chat', metadata });

        expect(matchesRealityChatBinding(binding, { characterId: 3, chatId: 'reality-chat', metadata })).toBe(true);
        expect(matchesRealityChatBinding(binding, { characterId: 3, chatId: 'story-chat', metadata })).toBe(false);
        expect(matchesRealityChatBinding(binding, {
            characterId: 3,
            chatId: 'reality-chat',
            metadata: {
                ...metadata,
                [LESLIE_WORLD_LINE_METADATA_KEY]: { kind: 'story' },
            },
        })).toBe(false);
        expect(matchesRealityChatBinding(binding, {
            characterId: 3,
            chatId: 'reality-chat',
            metadata: {
                ...metadata,
                [LESLIE_WORLD_LINE_METADATA_KEY]: {
                    kind: 'reality',
                    sessionStartedAt: '2026-09-26T15:20:00.000Z',
                },
            },
        })).toBe(false);
    });

    test('normalizes the de-fictionalized profile and preserves it between sessions', () => {
        const profile = normalizeRealityProfile({
            sourceHash: 'profile-v1',
            traits: ['克制', '克制', '', '好奇'],
            emotionalStyle: '不急于下结论',
            messageStyle: '短句，偶尔幽默',
            boundaries: ['不替用户做决定'],
            scenario: '这个字段不属于现实人格',
        });
        const session = beginRealitySession({ kind: 'reality', realityProfile: profile });

        expect(profile.traits).toEqual(['克制', '好奇']);
        expect(profile).not.toHaveProperty('scenario');
        expect(hasUsableRealityProfile(profile)).toBe(true);
        expect(session.realityProfile).toEqual(profile);
    });

    test('generates one proactive greeting for every newly entered reality session', () => {
        const metadata = beginRealitySession({
            kind: 'reality',
            lastActiveAt: '2026-09-19T12:00:00.000Z',
        }, { now: new Date('2026-09-19T12:00:01.000Z') });

        expect(shouldGenerateRealitySessionOpening(metadata)).toBe(true);
        expect(shouldGenerateRealitySessionOpening({
            ...metadata,
            lastOpeningSessionAt: metadata.sessionStartedAt,
        })).toBe(false);
        expect(shouldGenerateRealitySessionOpening(metadata, { minimumGapMs: 30 * 60 * 1000 })).toBe(false);
    });

    test('builds a strict instant-message prompt from profile and bounded memory only', () => {
        const prompt = buildRealityMessageSystemPrompt({
            characterName: '小夏',
            userName: 'Leslie',
            profile: {
                traits: ['温柔', '有主见'],
                emotionalStyle: '坦诚',
                messageStyle: '自然短句',
                boundaries: ['不说教'],
                scenario: '魔法学院大战',
                first_mes: '固定开场白',
            },
            memoryContext: {
                realityMemories: ['记得用户最近睡得很晚'],
                crossLineMemories: ['共鸣一', '共鸣二', '不应进入的第三条'],
            },
        });

        expect(prompt).toContain('只输出“小夏”准备发送给用户的一条消息正文');
        expect(prompt).toContain('记得用户最近睡得很晚');
        expect(prompt).toContain('共鸣二');
        expect(prompt).not.toContain('不应进入的第三条');
        expect(prompt).not.toContain('魔法学院大战');
        expect(prompt).not.toContain('固定开场白');
    });

    test('accepts plain chat text and rejects roleplay decoration', () => {
        expect(validateRealityMessage('刚忙完，忽然想问问你今天过得怎么样。', { characterName: '小夏' }).valid).toBe(true);
        expect(validateRealityMessage('小夏：刚忙完。', { characterName: '小夏' }).valid).toBe(false);
        expect(validateRealityMessage('*轻轻叹气* 今天有点累。').valid).toBe(false);
        expect(validateRealityMessage('（看向窗外）今天下雨了。').valid).toBe(false);
        expect(validateRealityMessage('轻轻叹了口气，今天有点累。').valid).toBe(false);
        expect(validateRealityMessage('<think>先分析一下</think>今天有点累。').valid).toBe(false);
        expect(validateRealityMessage('- 第一个回复\n- 第二个回复').valid).toBe(false);
        expect(validateRealityMessage('“整条消息不要加引号”').valid).toBe(false);
    });
});
