import { describe, expect, test } from '@jest/globals';

import {
    buildMemoryCoreSnapshot,
    buildMemoryQuery,
    buildMemoryTranscript,
    getMemoryChatIdentity,
    getMemoryMessageSpeaker,
} from '../public/scripts/extensions/leslie-memory/chat-context.js';
import {
    LESLIE_GROUP_CHAT_METADATA_KEY,
    TEMPORARY_ROLE_STATES,
    createTemporaryRole,
    getTemporaryRoleAvatar,
    setTemporaryRoleState,
} from '../public/scripts/leslie-group-temporary-roles-core.js';

function createGroupContext() {
    return {
        groupId: 'group-42',
        chatId: 'shared-chat',
        chatMetadata: { main_chat: 'main-chat' },
        characterId: 1,
        name1: '哥哥',
        name2: '雅雪',
        characters: [
            {
                name: '香夜梨',
                avatar: '香夜梨.png',
                description: '每天来到旧画室画画。',
                personality: '冷淡、寡言，但会照顾人。',
                scenario: '旧画室。',
                mes_example: '<START>\n香夜梨：别碰。',
                data: { creator_notes: '保持平静语气。' },
            },
            {
                name: '雅雪',
                avatar: '雅雪.png',
                description: '跟随香夜梨来到旧画室。',
                personality: '开朗、敏锐，喜欢观察反应。',
                scenario: '旧画室。',
                mes_example: '<START>\n雅雪：被我吓到了？',
                data: { creator_notes: '玩笑下有细腻观察。' },
            },
        ],
        groups: [{
            id: 'group-42',
            name: '旧画室里的香夜梨与雅雪',
            members: ['香夜梨.png', '雅雪.png'],
            disabled_members: ['香夜梨.png'],
        }],
        chat: [
            { is_user: false, is_system: false, name: '香夜梨', original_avatar: '香夜梨.png', mes: '颜色还没调好。' },
            { is_user: true, is_system: false, name: '哥哥', mes: '我只是看看。' },
            { is_user: false, is_system: false, original_avatar: '雅雪.png', mes: '哥哥被警告了呢。' },
        ],
    };
}

describe('Leslie memory chat identity', () => {
    test('keeps the existing solo identity and chat-key shape', () => {
        const context = {
            groupId: null,
            chatId: 'solo-chat',
            chatMetadata: {},
            characterId: 0,
            characters: [{ name: '雨宫铃', avatar: '雨宫铃.png' }],
        };

        const identity = getMemoryChatIdentity(context);

        expect(identity.isGroup).toBe(false);
        expect(identity.chatKey).toBe('雨宫铃.png::solo-chat');
        expect(identity.characterKey).toBe('雨宫铃.png');
        expect(identity.displayName).toBe('雨宫铃');
        expect(identity.relationshipKey).toContain('persona:name:user');
    });

    test('keeps the chat key stable while separating two Persona relationship keys', () => {
        const context = {
            groupId: null,
            chatId: 'solo-chat',
            chatMetadata: {},
            characterId: 0,
            characters: [{ name: '妹妹', avatar: '妹妹.png' }],
        };
        const brother = getMemoryChatIdentity(context, { sourceKey: '哥哥.png', name: '哥哥' });
        const classmate = getMemoryChatIdentity(context, { sourceKey: '同学.png', name: '同学' });

        expect(brother.chatKey).toBe(classmate.chatKey);
        expect(brother.relationshipKey).not.toBe(classmate.relationshipKey);
        expect(brother.persona.name).toBe('哥哥');
        expect(classmate.persona.name).toBe('同学');
    });

    test('uses a stable group id plus chat id without changing the storage contract', () => {
        const identity = getMemoryChatIdentity(createGroupContext());

        expect(identity.isGroup).toBe(true);
        expect(identity.characterKey).toBe('group:group-42');
        expect(identity.chatKey).toBe('group:group-42::shared-chat');
        expect(identity.parentChatKey).toBe('group:group-42::main-chat');
        expect(identity.members.map(member => member.name)).toEqual(['香夜梨', '雅雪']);
        expect(identity.members[0].disabled).toBe(true);
    });
});

describe('Leslie group speaker attribution', () => {
    test('uses message names and original avatars instead of the last active group member', () => {
        const context = createGroupContext();
        const identity = getMemoryChatIdentity(context);

        expect(getMemoryMessageSpeaker(context.chat[0], context, identity)).toBe('香夜梨');
        expect(getMemoryMessageSpeaker(context.chat[1], context, identity)).toBe('哥哥');
        expect(getMemoryMessageSpeaker(context.chat[2], context, identity)).toBe('雅雪');

        const transcript = buildMemoryTranscript(
            context.chat.map((message, index) => ({ message, index })),
            context,
            identity,
        );
        expect(transcript.map(item => item.speaker)).toEqual(['香夜梨', '哥哥', '雅雪']);
        expect(buildMemoryQuery(context, identity)).toContain('当前回复角色：雅雪');
        expect(buildMemoryQuery(context, identity)).toContain('香夜梨：颜色还没调好。');
    });

    test('disambiguates duplicate character names by avatar when group messages provide one', () => {
        const context = createGroupContext();
        context.characters[1].name = '香夜梨';
        const identity = getMemoryChatIdentity(context);

        expect(getMemoryMessageSpeaker(context.chat[0], context, identity)).toBe('香夜梨（香夜梨.png）');
        expect(getMemoryMessageSpeaker(context.chat[2], context, identity)).toBe('香夜梨（雅雪.png）');
    });

    test('keeps archived temporary roles in the shared group memory roster for historical attribution', () => {
        const context = createGroupContext();
        const role = createTemporaryRole({
            name: '送信人',
            description: '只在这一幕送来一封信。',
        }, {
            id: 'temp_messenger-01',
            createdAtMessage: 1,
            createdAt: '2026-09-27T08:00:00.000Z',
        });
        const archived = setTemporaryRoleState(
            { temporary_roles: [role] },
            role.id,
            TEMPORARY_ROLE_STATES.ARCHIVED,
            4,
            '2026-09-27T08:05:00.000Z',
        );
        context.chatMetadata[LESLIE_GROUP_CHAT_METADATA_KEY] = archived;
        const message = {
            is_user: false,
            original_avatar: getTemporaryRoleAvatar(role.id),
            name: role.name,
            mes: '信已经送到。',
        };

        const identity = getMemoryChatIdentity(context);

        expect(identity.chatKey).toBe('group:group-42::shared-chat');
        expect(identity.members.at(-1)).toMatchObject({ name: '送信人', temporary: true, disabled: true });
        expect(getMemoryMessageSpeaker(message, context, identity)).toBe('送信人');
        expect(buildMemoryCoreSnapshot(identity, () => ({})).description).toContain('送信人');
    });
});

describe('Leslie protected group core', () => {
    test('fairly aggregates each member into the existing core-snapshot fields', () => {
        const identity = getMemoryChatIdentity(createGroupContext());
        const snapshot = buildMemoryCoreSnapshot(identity, () => {
            throw new Error('Group snapshots must not fall back to a single active card.');
        });

        expect(snapshot.name).toBe('旧画室里的香夜梨与雅雪');
        expect(snapshot.avatar).toBe('group:group-42');
        expect(snapshot.description).toContain('香夜梨');
        expect(snapshot.description).toContain('雅雪');
        expect(snapshot.personality).toContain('[香夜梨]');
        expect(snapshot.personality).toContain('冷淡、寡言');
        expect(snapshot.personality).toContain('[雅雪]');
        expect(snapshot.personality).toContain('开朗、敏锐');
    });
});
