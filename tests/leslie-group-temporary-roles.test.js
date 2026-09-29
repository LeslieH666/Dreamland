import { describe, expect, test } from '@jest/globals';

import {
    LESLIE_GROUP_CHAT_METADATA_KEY,
    MAX_TEMPORARY_ROLES,
    MAX_TEMPORARY_ROLE_STATE_EVENTS,
    TEMPORARY_ROLE_STATES,
    addTemporaryRole,
    branchTemporaryRoleMetadata,
    createTemporaryCharacter,
    createTemporaryRole,
    getEffectiveGroupMemberAvatars,
    getSwipeGroupMemberAvatars,
    getTemporaryRoleAvatar,
    getTemporaryRoleMetadata,
    isTemporaryCharacter,
    markTemporaryRoleActive,
    markTemporaryRoleReview,
    normalizeTemporaryRoleMetadata,
    setTemporaryRoleAutomation,
    setTemporaryRoleState,
    shouldReviewTemporaryRoles,
    syncTemporaryCharacterRuntime,
} from '../public/scripts/leslie-group-temporary-roles-core.js';

const CREATED_AT = '2026-09-27T08:00:00.000Z';

function makeRole(index = 1, createdAtMessage = 2) {
    return createTemporaryRole({
        name: `临时角色 ${index}`,
        description: '只在当前场景中出现。',
        personality: '谨慎。',
        scene_role: '递送一封信。',
        speech_style: '简短直接。',
        knowledge_boundary: '不知道群聊开始前发生的事。',
        talkativeness: 0.4,
    }, {
        id: `temp_1234567${index}`,
        createdAtMessage,
        createdAt: CREATED_AT,
    });
}

describe('Leslie temporary group role schema', () => {
    test('normalizes untrusted metadata and discards malformed roles', () => {
        const metadata = normalizeTemporaryRoleMetadata({
            schema_version: 999,
            temporary_roles: [
                { ...makeRole(), name: '  信使\u0000  ', talkativeness: 5 },
                { id: 'not-valid', name: '无效' },
                { ...makeRole(), name: '重复 ID' },
            ],
        });

        expect(metadata.schema_version).toBe(2);
        expect(metadata.temporary_roles).toHaveLength(1);
        expect(metadata.temporary_roles[0].name).toBe('信使');
        expect(metadata.temporary_roles[0].talkativeness).toBe(1);
        expect(metadata.automation.proposal_enabled).toBe(false);
    });

    test('rejects duplicate names and enforces the per-chat role limit', () => {
        const first = makeRole(1);
        expect(() => addTemporaryRole({ temporary_roles: [first] }, { ...makeRole(2), name: first.name })).toThrow(/already exists/iu);

        const full = {
            temporary_roles: Array.from({ length: MAX_TEMPORARY_ROLES }, (_, index) => makeRole(index + 1)),
        };
        expect(() => addTemporaryRole(full, createTemporaryRole({ name: '额外角色' }, {
            id: 'temp_99999999',
            createdAt: CREATED_AT,
        }))).toThrow(/at most/iu);
    });

    test('migrates v1 metadata with automation disabled and validates v2 review settings', () => {
        const migrated = normalizeTemporaryRoleMetadata({
            schema_version: 1,
            temporary_roles: [makeRole()],
            automation: { proposal_enabled: true },
        });
        expect(migrated.schema_version).toBe(2);
        expect(migrated.automation.proposal_enabled).toBe(false);

        let configured = setTemporaryRoleAutomation(migrated, {
            proposal_enabled: true,
            archive_suggestions_enabled: true,
            review_interval_messages: 2,
        });
        configured = markTemporaryRoleReview(configured, 10);
        expect(configured.automation.review_interval_messages).toBe(4);
        expect(shouldReviewTemporaryRoles(configured, 13)).toBe(false);
        expect(shouldReviewTemporaryRoles(configured, 14)).toBe(true);
    });
});

describe('Leslie temporary group role lifecycle', () => {
    test('keeps state transitions in current-chat metadata and updates activity', () => {
        const active = { temporary_roles: [makeRole()] };
        const dormant = setTemporaryRoleState(active, 'temp_12345671', TEMPORARY_ROLE_STATES.DORMANT, 5, CREATED_AT);
        const archived = setTemporaryRoleState(dormant, 'temp_12345671', TEMPORARY_ROLE_STATES.ARCHIVED, 8, CREATED_AT);
        const touched = markTemporaryRoleActive(archived, 'temp_12345671', 7);

        expect(archived.temporary_roles[0].state).toBe(TEMPORARY_ROLE_STATES.ARCHIVED);
        expect(archived.temporary_roles[0].state_history.map(event => event.message_id)).toEqual([2, 5, 8]);
        expect(touched.temporary_roles[0].last_active_message).toBe(7);
    });

    test('prunes future roles and later state changes when a chat is branched', () => {
        const earlyRole = makeRole(1, 2);
        const lateRole = makeRole(2, 9);
        let metadata = { temporary_roles: [earlyRole, lateRole] };
        metadata = setTemporaryRoleAutomation(metadata, { proposal_enabled: true });
        metadata = setTemporaryRoleState(metadata, earlyRole.id, TEMPORARY_ROLE_STATES.DORMANT, 5, CREATED_AT);
        metadata = setTemporaryRoleState(metadata, earlyRole.id, TEMPORARY_ROLE_STATES.ARCHIVED, 10, CREATED_AT);
        metadata = markTemporaryRoleActive(metadata, earlyRole.id, 11);
        metadata = markTemporaryRoleReview(metadata, 11);

        const branch = branchTemporaryRoleMetadata(metadata, 6);

        expect(branch.temporary_roles).toHaveLength(1);
        expect(branch.temporary_roles[0].id).toBe(earlyRole.id);
        expect(branch.temporary_roles[0].state).toBe(TEMPORARY_ROLE_STATES.DORMANT);
        expect(branch.temporary_roles[0].state_history.map(event => event.message_id)).toEqual([2, 5]);
        expect(branch.temporary_roles[0].last_active_message).toBeNull();
        expect(branch.automation.proposal_enabled).toBe(true);
        expect(branch.automation_state.last_review_message).toBeNull();
    });

    test('retains the creation event when long lifecycle histories are compacted', () => {
        const role = makeRole(1, 2);
        let metadata = { temporary_roles: [role] };
        const alternatingStates = [TEMPORARY_ROLE_STATES.DORMANT, TEMPORARY_ROLE_STATES.ACTIVE];
        for (let messageId = 3; messageId < 3 + MAX_TEMPORARY_ROLE_STATE_EVENTS + 5; messageId++) {
            const state = alternatingStates[(messageId + 1) % alternatingStates.length];
            metadata = setTemporaryRoleState(metadata, role.id, state, messageId, CREATED_AT);
        }

        expect(metadata.temporary_roles[0].state_history).toHaveLength(MAX_TEMPORARY_ROLE_STATE_EVENTS);
        expect(metadata.temporary_roles[0].state_history[0].message_id).toBe(2);
        expect(branchTemporaryRoleMetadata(metadata, 2).temporary_roles[0].state).toBe(TEMPORARY_ROLE_STATES.ACTIVE);
    });
});

describe('Leslie temporary group role runtime adapter', () => {
    test('hydrates hidden card-compatible adapters without changing permanent character indexes', () => {
        const permanent = { name: '永久角色', avatar: 'permanent.png', data: { extensions: {} } };
        const characters = [permanent];
        const chatMetadata = {
            [LESLIE_GROUP_CHAT_METADATA_KEY]: { temporary_roles: [makeRole()] },
        };

        expect(syncTemporaryCharacterRuntime(chatMetadata, characters)).toBe(1);
        expect(characters[0]).toBe(permanent);
        expect(characters).toHaveLength(2);
        expect(isTemporaryCharacter(characters[1])).toBe(true);
        expect(characters[1].avatar).toBe(getTemporaryRoleAvatar('temp_12345671'));
        expect(createTemporaryCharacter(makeRole()).data.extensions.depth_prompt.prompt).toContain('知识边界');
    });

    test('uses only active roles for new turns but keeps archived roles available for swipes', () => {
        const role = makeRole();
        const archived = setTemporaryRoleState({ temporary_roles: [role] }, role.id, TEMPORARY_ROLE_STATES.ARCHIVED, 4, CREATED_AT);
        const chatMetadata = { [LESLIE_GROUP_CHAT_METADATA_KEY]: archived };
        const group = { members: ['permanent.png'] };

        expect(getEffectiveGroupMemberAvatars(group, chatMetadata)).toEqual(['permanent.png']);
        expect(getSwipeGroupMemberAvatars(group, chatMetadata)).toEqual(['permanent.png', getTemporaryRoleAvatar(role.id)]);
        expect(getTemporaryRoleMetadata(chatMetadata).temporary_roles[0].state).toBe(TEMPORARY_ROLE_STATES.ARCHIVED);
    });
});
