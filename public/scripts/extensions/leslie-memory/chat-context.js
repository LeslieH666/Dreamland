import {
    TEMPORARY_ROLE_STATES,
    createTemporaryCharacter,
    getTemporaryRoleAvatar,
    getTemporaryRoleMetadata,
} from '../../leslie-group-temporary-roles-core.js';

function cleanText(value) {
    return String(value ?? '').trim();
}

function getChatId(context) {
    return cleanText(context.chatId || context.getCurrentChatId?.());
}

function getParentChatId(context) {
    return cleanText(context.chatMetadata?.main_chat);
}

function getCharacterByAvatar(context, avatar) {
    const characterIndex = context.characters?.findIndex(character => character?.avatar === avatar) ?? -1;
    return {
        characterIndex,
        character: characterIndex >= 0 ? context.characters[characterIndex] : null,
    };
}

/**
 * Resolves a stable Leslie-memory identity for either a normal character chat or a group chat.
 * Both modes intentionally use the same chat-key shape and storage contract.
 * @param {ReturnType<import('../../extensions.js').getContext>} context SillyTavern context.
 * @returns {Object} Resolved chat identity or an object containing an error.
 */
export function getMemoryChatIdentity(context, persona = {}) {
    const chatId = getChatId(context);
    const personaSourceKey = cleanText(persona.sourceKey || context.chatMetadata?.persona || `name:${context.name1 || 'user'}`);
    const personaIdentity = {
        sourceKey: personaSourceKey,
        name: cleanText(persona.name || context.name1) || '当前剧情身份',
        lockedToChat: persona.lockedToChat === true,
    };

    if (context.groupId !== null && context.groupId !== undefined && cleanText(context.groupId)) {
        const groupId = cleanText(context.groupId);
        const group = context.groups?.find(item => String(item?.id) === groupId);
        if (!group || !chatId) {
            return { error: '请先打开一个群聊会话，再使用群聊记忆。', context };
        }

        const permanentMembers = (Array.isArray(group.members) ? group.members : []).map((avatar, groupIndex) => {
            const { character, characterIndex } = getCharacterByAvatar(context, avatar);
            return {
                avatar: cleanText(avatar),
                name: cleanText(character?.name) || cleanText(avatar) || `成员 ${groupIndex + 1}`,
                character,
                characterIndex,
                groupIndex,
                disabled: Array.isArray(group.disabled_members) && group.disabled_members.includes(avatar),
            };
        });
        const temporaryMembers = getTemporaryRoleMetadata(context.chatMetadata).temporary_roles.map((role, temporaryIndex) => {
            const avatar = getTemporaryRoleAvatar(role.id);
            const runtime = getCharacterByAvatar(context, avatar);
            return {
                avatar,
                name: role.name,
                character: runtime.character ?? createTemporaryCharacter(role),
                characterIndex: runtime.characterIndex,
                groupIndex: permanentMembers.length + temporaryIndex,
                disabled: role.state !== TEMPORARY_ROLE_STATES.ACTIVE,
                temporary: true,
            };
        });
        const members = [...permanentMembers, ...temporaryMembers];
        if (!members.length) {
            return { error: '当前群聊没有可用成员，暂时无法建立群聊记忆。', context };
        }

        const characterKey = `group:${groupId}`;
        const parentChatId = getParentChatId(context);
        return {
            context,
            isGroup: true,
            group,
            groupId,
            members,
            displayName: cleanText(group.name) || '当前群聊',
            characterKey,
            chatKey: `${characterKey}::${chatId}`,
            relationshipKey: `${characterKey}::${chatId}::persona:${personaSourceKey}`,
            parentChatKey: parentChatId ? `${characterKey}::${parentChatId}` : null,
            isBranch: Boolean(parentChatId),
            persona: personaIdentity,
        };
    }

    const character = context.characters?.[context.characterId];
    if (!character || !chatId) {
        return { error: '请先打开一个角色或群聊会话，再使用长期记忆。', context };
    }

    const characterKey = cleanText(character.avatar || character.name || context.characterId);
    const parentChatId = getParentChatId(context);
    return {
        context,
        isGroup: false,
        character,
        members: [{
            avatar: cleanText(character.avatar),
            name: cleanText(character.name),
            character,
            characterIndex: Number(context.characterId),
            groupIndex: 0,
            disabled: false,
        }],
        displayName: cleanText(character.name) || '当前角色',
        characterKey,
        chatKey: `${characterKey}::${chatId}`,
        relationshipKey: `${characterKey}::${chatId}::persona:${personaSourceKey}`,
        parentChatKey: parentChatId ? `${characterKey}::${parentChatId}` : null,
        isBranch: Boolean(parentChatId),
        persona: personaIdentity,
    };
}

/**
 * Returns human-readable participant labels, disambiguating duplicate character names with avatars.
 * @param {Object} identity Resolved memory identity.
 * @returns {string[]} Stable labels in group-member order.
 */
export function getMemoryMemberLabels(identity) {
    const members = identity?.members ?? [];
    return members.map(member => {
        const duplicateCount = members.filter(other => other.name === member.name).length;
        return duplicateCount > 1 && member.avatar ? `${member.name}（${member.avatar}）` : member.name;
    }).filter(Boolean);
}

/**
 * Returns the actual speaker for a saved chat message. Group messages carry their own name/avatar,
 * while solo messages safely fall back to the active character.
 * @param {Object} message SillyTavern chat message.
 * @param {Object} context SillyTavern context.
 * @param {Object} identity Resolved memory identity.
 * @returns {string} Speaker label.
 */
export function getMemoryMessageSpeaker(message, context, identity) {
    if (message?.is_user) {
        return cleanText(context.name1) || '用户';
    }
    const originalAvatar = cleanText(message?.original_avatar);
    if (originalAvatar) {
        const memberIndex = identity?.members?.findIndex(item => item.avatar === originalAvatar) ?? -1;
        if (memberIndex >= 0) {
            return getMemoryMemberLabels(identity)[memberIndex];
        }
        const { character } = getCharacterByAvatar(context, originalAvatar);
        if (character?.name) {
            return cleanText(character.name);
        }
    }
    const explicitName = cleanText(message?.name);
    if (explicitName && explicitName !== 'unused') {
        return explicitName;
    }
    return cleanText(identity?.character?.name || context.name2 || identity?.displayName) || '角色';
}

/**
 * Formats a bounded transcript without losing group speaker attribution.
 * @param {{message: Object, index: number}[]} items Indexed chat messages.
 * @param {Object} context SillyTavern context.
 * @param {Object} identity Resolved memory identity.
 * @returns {{id: number, speaker: string, text: string}[]} Model-ready transcript.
 */
export function buildMemoryTranscript(items, context, identity) {
    return items.map(item => ({
        id: item.index,
        speaker: getMemoryMessageSpeaker(item.message, context, identity),
        text: cleanText(item.message?.mes).slice(0, 4000),
    }));
}

/**
 * Builds a recent-message query for relevance scoring. Group queries include speaker names and the
 * currently drafted member, making the shared archive usable across all native group generation modes.
 * @param {Object} context SillyTavern context.
 * @param {Object} identity Resolved memory identity.
 * @param {number} [limit=3] Maximum recent messages.
 * @returns {string} Relevance query.
 */
export function buildMemoryQuery(context, identity, limit = 3) {
    const recent = (context.chat ?? [])
        .filter(message => !message?.is_system)
        .slice(-Math.max(1, Number(limit) || 3))
        .map(message => `${getMemoryMessageSpeaker(message, context, identity)}：${cleanText(message?.mes)}`);
    if (identity?.isGroup) {
        const activeCharacter = context.characters?.[context.characterId];
        if (activeCharacter?.name) {
            recent.unshift(`当前回复角色：${cleanText(activeCharacter.name)}`);
        }
    }
    return recent.join('\n');
}

function getRawCharacterField(character, field) {
    if (!character) {
        return '';
    }
    if (field === 'characterNote') {
        return cleanText(character.data?.extensions?.depth_prompt?.prompt || character.data?.creator_notes);
    }
    if (field === 'mesExample') {
        return cleanText(character.mes_example);
    }
    return cleanText(character[field]);
}

function joinMemberFields(members, field, maximumLength) {
    const availableMembers = members.filter(member => getRawCharacterField(member.character, field));
    if (!availableMembers.length) {
        return '';
    }
    const perMemberLimit = Math.max(256, Math.floor((maximumLength - (availableMembers.length * 40)) / availableMembers.length));
    return availableMembers.map(member => {
        const value = getRawCharacterField(member.character, field).slice(0, perMemberLimit);
        return `[${member.name}]\n${value}`;
    }).join('\n\n').slice(0, maximumLength);
}

/**
 * Creates the existing protected-core shape for both solo and group chats. Group cards are aggregated
 * into the same fields, so no storage-schema migration is needed and every member gets a fair share.
 * @param {Object} identity Resolved memory identity.
 * @param {Function} getSoloFields Existing SillyTavern character-card field resolver.
 * @returns {{name: string, avatar: string, description: string, personality: string, scenario: string, mesExample: string, characterNote: string}}
 */
export function buildMemoryCoreSnapshot(identity, getSoloFields) {
    if (!identity?.isGroup) {
        const fields = getSoloFields();
        return {
            name: identity?.character?.name || '',
            avatar: identity?.character?.avatar || '',
            description: fields.description || '',
            personality: fields.personality || '',
            scenario: fields.scenario || '',
            mesExample: fields.mesExamples || '',
            characterNote: fields.charDepthPrompt || fields.creatorNotes || '',
        };
    }

    const roster = identity.members
        .map(member => `- ${member.name}（${member.avatar || '无头像'}${member.disabled ? '，当前静音' : ''}）`)
        .join('\n');
    const descriptions = joinMemberFields(identity.members, 'description', 17_000);
    return {
        name: identity.displayName,
        avatar: `group:${identity.groupId}`,
        description: [`群聊成员：\n${roster}`, descriptions].filter(Boolean).join('\n\n').slice(0, 20_000),
        personality: joinMemberFields(identity.members, 'personality', 20_000),
        scenario: joinMemberFields(identity.members, 'scenario', 20_000),
        mesExample: joinMemberFields(identity.members, 'mesExample', 40_000),
        characterNote: joinMemberFields(identity.members, 'characterNote', 10_000),
    };
}
