export const LESLIE_GROUP_CHAT_METADATA_KEY = 'leslie_group_v1';
export const TEMPORARY_ROLE_SCHEMA_VERSION = 2;
export const MAX_TEMPORARY_ROLES = 12;
export const MAX_TEMPORARY_ROLE_STATE_EVENTS = 32;

export const DEFAULT_TEMPORARY_ROLE_AUTOMATION = Object.freeze({
    proposal_enabled: false,
    archive_suggestions_enabled: false,
    review_interval_messages: 8,
});

export const TEMPORARY_ROLE_STATES = Object.freeze({
    ACTIVE: 'active',
    DORMANT: 'dormant',
    ARCHIVED: 'archived',
});

const VALID_STATES = new Set(Object.values(TEMPORARY_ROLE_STATES));
const TEMPORARY_AVATAR_PREFIX = 'leslie-temp:';

function cleanText(value, maximumLength) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maximumLength);
}

function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(maximum, Math.max(minimum, number));
}

function normalizeMessageId(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeNullableMessageId(value) {
    return value === null || value === undefined ? null : normalizeMessageId(value);
}

function normalizeAutomationSettings(value, allowEnabled = false) {
    return {
        proposal_enabled: allowEnabled && value?.proposal_enabled === true,
        archive_suggestions_enabled: allowEnabled && value?.archive_suggestions_enabled === true,
        review_interval_messages: Math.round(clampNumber(
            value?.review_interval_messages,
            4,
            40,
            DEFAULT_TEMPORARY_ROLE_AUTOMATION.review_interval_messages,
        )),
    };
}

function normalizeStringArray(value, maximumItems = 6, maximumLength = 200) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => cleanText(item, maximumLength))
        .filter(Boolean)
        .filter((item, index, values) => values.indexOf(item) === index)
        .slice(0, maximumItems);
}

function normalizeTimestamp(value, fallback = '') {
    const text = cleanText(value, 64);
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeRoleId(value) {
    const id = cleanText(value, 80);
    return /^temp_[a-z0-9-]{8,72}$/iu.test(id) ? id : '';
}

function normalizeStateHistory(value, createdAtMessage, fallbackState) {
    const history = Array.isArray(value) ? value : [];
    const normalized = history
        .map(event => ({
            state: VALID_STATES.has(event?.state) ? event.state : null,
            message_id: normalizeMessageId(event?.message_id, createdAtMessage),
            changed_at: normalizeTimestamp(event?.changed_at),
        }))
        .filter(event => event.state)
        .sort((left, right) => left.message_id - right.message_id);

    if (normalized.length > MAX_TEMPORARY_ROLE_STATE_EVENTS) {
        normalized.splice(1, normalized.length - MAX_TEMPORARY_ROLE_STATE_EVENTS);
    }

    if (!normalized.length) {
        normalized.push({
            state: VALID_STATES.has(fallbackState) ? fallbackState : TEMPORARY_ROLE_STATES.ACTIVE,
            message_id: createdAtMessage,
            changed_at: '',
        });
    }

    return normalized;
}

export function getTemporaryRoleAvatar(roleId) {
    const id = normalizeRoleId(roleId);
    return id ? `${TEMPORARY_AVATAR_PREFIX}${id}` : '';
}

export function getTemporaryRoleIdFromAvatar(avatar) {
    const value = cleanText(avatar, 160);
    if (!value.startsWith(TEMPORARY_AVATAR_PREFIX)) {
        return '';
    }
    return normalizeRoleId(value.slice(TEMPORARY_AVATAR_PREFIX.length));
}

export function isTemporaryCharacter(character) {
    return character?.data?.extensions?.leslie_temporary_role?.kind === 'session-temporary-role';
}

export function normalizeTemporaryRole(value) {
    const id = normalizeRoleId(value?.id);
    const name = cleanText(value?.name, 80);
    if (!id || !name) {
        return null;
    }

    const createdAtMessage = normalizeMessageId(value?.created_at_message);
    const stateHistory = normalizeStateHistory(value?.state_history, createdAtMessage, value?.state);
    const currentState = stateHistory.at(-1)?.state ?? TEMPORARY_ROLE_STATES.ACTIVE;

    return {
        id,
        revision: Math.max(1, normalizeMessageId(value?.revision, 1)),
        name,
        description: cleanText(value?.description, 1_200),
        personality: cleanText(value?.personality, 600),
        scene_role: cleanText(value?.scene_role, 400),
        speech_style: cleanText(value?.speech_style, 300),
        knowledge_boundary: cleanText(value?.knowledge_boundary, 600),
        goals: normalizeStringArray(value?.goals),
        constraints: normalizeStringArray(value?.constraints),
        talkativeness: clampNumber(value?.talkativeness, 0, 1, 0.5),
        state: currentState,
        state_history: stateHistory,
        created_at_message: createdAtMessage,
        created_at: normalizeTimestamp(value?.created_at),
        last_active_message: value?.last_active_message === null || value?.last_active_message === undefined
            ? null
            : normalizeMessageId(value.last_active_message),
    };
}

export function normalizeTemporaryRoleMetadata(value = {}) {
    const sourceVersion = Number(value?.schema_version ?? 1);
    const roles = [];
    const seenIds = new Set();
    const sourceRoles = Array.isArray(value?.temporary_roles) ? value.temporary_roles : [];

    for (const sourceRole of sourceRoles) {
        const role = normalizeTemporaryRole(sourceRole);
        if (!role || seenIds.has(role.id)) {
            continue;
        }
        seenIds.add(role.id);
        roles.push(role);
        if (roles.length >= MAX_TEMPORARY_ROLES) {
            break;
        }
    }

    return {
        schema_version: TEMPORARY_ROLE_SCHEMA_VERSION,
        temporary_roles: roles,
        automation: normalizeAutomationSettings(value?.automation, sourceVersion === TEMPORARY_ROLE_SCHEMA_VERSION),
        automation_state: {
            last_review_message: sourceVersion === TEMPORARY_ROLE_SCHEMA_VERSION
                ? normalizeNullableMessageId(value?.automation_state?.last_review_message)
                : null,
        },
    };
}

export function setTemporaryRoleAutomation(metadata, updates = {}) {
    const current = normalizeTemporaryRoleMetadata(metadata);
    return {
        ...current,
        automation: normalizeAutomationSettings({ ...current.automation, ...updates }, true),
    };
}

export function markTemporaryRoleReview(metadata, messageId) {
    const current = normalizeTemporaryRoleMetadata(metadata);
    return {
        ...current,
        automation_state: { last_review_message: normalizeMessageId(messageId) },
    };
}

export function shouldReviewTemporaryRoles(metadata, messageCount) {
    const current = normalizeTemporaryRoleMetadata(metadata);
    if (!current.automation.proposal_enabled && !current.automation.archive_suggestions_enabled) {
        return false;
    }
    const currentMessage = normalizeMessageId(messageCount);
    const lastReview = current.automation_state.last_review_message ?? 0;
    return currentMessage - lastReview >= current.automation.review_interval_messages;
}

export function getTemporaryRoleMetadata(chatMetadata) {
    return normalizeTemporaryRoleMetadata(chatMetadata?.[LESLIE_GROUP_CHAT_METADATA_KEY]);
}

export function createTemporaryRole(value, {
    id,
    createdAtMessage = 0,
    createdAt = new Date().toISOString(),
} = {}) {
    const roleId = normalizeRoleId(id);
    if (!roleId) {
        throw new TypeError('A valid temporary role id is required.');
    }

    const role = normalizeTemporaryRole({
        ...value,
        id: roleId,
        revision: 1,
        state: TEMPORARY_ROLE_STATES.ACTIVE,
        state_history: [{ state: TEMPORARY_ROLE_STATES.ACTIVE, message_id: createdAtMessage, changed_at: createdAt }],
        created_at_message: createdAtMessage,
        created_at: createdAt,
        last_active_message: null,
    });

    if (!role) {
        throw new TypeError('Temporary role name is required.');
    }
    return role;
}

export function addTemporaryRole(metadata, role) {
    const current = normalizeTemporaryRoleMetadata(metadata);
    const normalizedRole = normalizeTemporaryRole(role);
    if (!normalizedRole) {
        throw new TypeError('Temporary role is invalid.');
    }
    if (current.temporary_roles.length >= MAX_TEMPORARY_ROLES) {
        throw new RangeError(`A chat can contain at most ${MAX_TEMPORARY_ROLES} temporary roles.`);
    }
    if (current.temporary_roles.some(item => item.id === normalizedRole.id || item.name.toLocaleLowerCase() === normalizedRole.name.toLocaleLowerCase())) {
        throw new RangeError('Temporary role id or name already exists in this chat.');
    }

    return {
        ...current,
        temporary_roles: [...current.temporary_roles, normalizedRole],
    };
}

export function setTemporaryRoleState(metadata, roleId, state, messageId, changedAt = new Date().toISOString()) {
    if (!VALID_STATES.has(state)) {
        throw new TypeError('Temporary role state is invalid.');
    }

    const current = normalizeTemporaryRoleMetadata(metadata);
    let found = false;
    const temporaryRoles = current.temporary_roles.map(role => {
        if (role.id !== roleId) {
            return role;
        }
        found = true;
        if (role.state === state) {
            return role;
        }
        const stateHistory = [...role.state_history, {
            state,
            message_id: normalizeMessageId(messageId),
            changed_at: normalizeTimestamp(changedAt),
        }];
        return normalizeTemporaryRole({ ...role, state, state_history: stateHistory });
    });

    if (!found) {
        throw new RangeError('Temporary role was not found.');
    }
    return { ...current, temporary_roles: temporaryRoles };
}

export function markTemporaryRoleActive(metadata, roleId, messageId) {
    const current = normalizeTemporaryRoleMetadata(metadata);
    return {
        ...current,
        temporary_roles: current.temporary_roles.map(role => role.id === roleId
            ? { ...role, last_active_message: normalizeMessageId(messageId) }
            : role),
    };
}

export function branchTemporaryRoleMetadata(metadata, branchMessageId) {
    const branchPoint = normalizeMessageId(branchMessageId);
    const current = normalizeTemporaryRoleMetadata(metadata);
    const temporaryRoles = current.temporary_roles
        .filter(role => role.created_at_message <= branchPoint)
        .map(role => {
            const stateHistory = role.state_history.filter(event => event.message_id <= branchPoint);
            return normalizeTemporaryRole({
                ...role,
                state_history: stateHistory,
                state: stateHistory.at(-1)?.state ?? TEMPORARY_ROLE_STATES.ACTIVE,
                last_active_message: role.last_active_message !== null && role.last_active_message <= branchPoint
                    ? role.last_active_message
                    : null,
            });
        })
        .filter(Boolean);
    return {
        ...current,
        temporary_roles: temporaryRoles,
        automation_state: {
            last_review_message: current.automation_state.last_review_message !== null
                && current.automation_state.last_review_message <= branchPoint
                ? current.automation_state.last_review_message
                : null,
        },
    };
}

export function getTemporaryRoleById(chatMetadata, roleId) {
    return getTemporaryRoleMetadata(chatMetadata).temporary_roles.find(role => role.id === roleId) ?? null;
}

export function getEffectiveGroupMemberAvatars(group, chatMetadata) {
    const permanentMembers = Array.isArray(group?.members) ? group.members : [];
    const temporaryMembers = getTemporaryRoleMetadata(chatMetadata).temporary_roles
        .filter(role => role.state === TEMPORARY_ROLE_STATES.ACTIVE)
        .map(role => getTemporaryRoleAvatar(role.id));
    return [...permanentMembers, ...temporaryMembers].filter((avatar, index, values) => avatar && values.indexOf(avatar) === index);
}

export function getSwipeGroupMemberAvatars(group, chatMetadata) {
    const permanentMembers = Array.isArray(group?.members) ? group.members : [];
    const temporaryMembers = getTemporaryRoleMetadata(chatMetadata).temporary_roles.map(role => getTemporaryRoleAvatar(role.id));
    return [...permanentMembers, ...temporaryMembers].filter((avatar, index, values) => avatar && values.indexOf(avatar) === index);
}

export function createTemporaryCharacter(roleValue) {
    const role = normalizeTemporaryRole(roleValue);
    if (!role) {
        throw new TypeError('Temporary role is invalid.');
    }

    const avatar = getTemporaryRoleAvatar(role.id);
    const description = [
        role.description,
        role.scene_role && `当前剧情职责：${role.scene_role}`,
        role.knowledge_boundary && `知识边界：${role.knowledge_boundary}`,
        role.goals.length && `当前目标：${role.goals.join('；')}`,
        role.constraints.length && `限制：${role.constraints.join('；')}`,
    ].filter(Boolean).join('\n');
    const personality = [role.personality, role.speech_style && `说话方式：${role.speech_style}`].filter(Boolean).join('\n');
    const depthPrompt = [
        `你是当前群聊会话中的临时角色“${role.name}”。`,
        role.scene_role && `你在当前剧情中的职责是：${role.scene_role}。`,
        role.knowledge_boundary && `严格遵守知识边界：${role.knowledge_boundary}。`,
        role.constraints.length && `必须遵守：${role.constraints.join('；')}。`,
        '只控制该临时角色，不替用户或其他群成员说话。',
    ].filter(Boolean).join('\n');

    return {
        name: role.name,
        avatar,
        description,
        personality,
        scenario: role.scene_role,
        first_mes: '',
        mes_example: '',
        creatorcomment: 'Leslie current-chat temporary role',
        tags: [],
        talkativeness: role.talkativeness,
        fav: false,
        create_date: role.created_at,
        chat: '',
        json_data: '',
        shallow: false,
        data: {
            name: role.name,
            description,
            personality,
            scenario: role.scene_role,
            first_mes: '',
            mes_example: '',
            creator_notes: 'Session-only Leslie temporary role. Never persist this adapter in the character library.',
            system_prompt: depthPrompt,
            post_history_instructions: `Remain ${role.name}. Reply only when selected by the group-chat orchestrator.`,
            alternate_greetings: [],
            character_version: `temporary-${role.revision}`,
            extensions: {
                talkativeness: role.talkativeness,
                depth_prompt: { prompt: depthPrompt, depth: 0, role: 'system' },
                leslie_temporary_role: {
                    kind: 'session-temporary-role',
                    id: role.id,
                    revision: role.revision,
                    state: role.state,
                },
            },
        },
    };
}

export function clearTemporaryCharacterRuntime(characters) {
    if (!Array.isArray(characters)) {
        return;
    }
    for (let index = characters.length - 1; index >= 0; index--) {
        if (isTemporaryCharacter(characters[index])) {
            characters.splice(index, 1);
        }
    }
}

export function syncTemporaryCharacterRuntime(chatMetadata, characters) {
    clearTemporaryCharacterRuntime(characters);
    const metadata = getTemporaryRoleMetadata(chatMetadata);
    for (const role of metadata.temporary_roles) {
        characters.push(createTemporaryCharacter(role));
    }
    return metadata.temporary_roles.length;
}
