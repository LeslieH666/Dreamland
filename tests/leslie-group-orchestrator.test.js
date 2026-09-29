import { describe, expect, test } from '@jest/globals';

import {
    GROUP_ORCHESTRATOR_PRESETS,
    normalizeGroupOrchestratorSettings,
    planSmartGroupTurn,
} from '../public/scripts/leslie-group-orchestrator-core.js';
import {
    normalizeLeslieGroupOrchestrator,
    stripLeslieGroupOrchestrator,
} from '../src/leslie-group-orchestrator/schema.js';

function character(avatar, name, overrides = {}) {
    return {
        avatar,
        name,
        talkativeness: 0.5,
        description: '',
        personality: '',
        scenario: '',
        ...overrides,
    };
}

function group(overrides = {}) {
    return {
        id: 'synthetic-group',
        members: ['guard.png', 'doctor.png', 'merchant.png'],
        disabled_members: [],
        allow_self_responses: false,
        leslie_group_orchestrator: {
            schema_version: 1,
            enabled: true,
            preset: 'balanced',
            max_speakers: 2,
            max_auto_replies: 3,
        },
        ...overrides,
    };
}

const characters = [
    character('guard.png', '守卫', { description: '负责城门、通行证和封城命令。' }),
    character('doctor.png', '医生', { description: '负责伤口、药物和病人的治疗。' }),
    character('merchant.png', '商人', { description: '熟悉市场、货物、金币和交易。' }),
];

function plan(overrides = {}) {
    return planSmartGroupTurn({
        group: group(),
        characters,
        chat: [],
        activationText: '现在该怎么办？',
        isUserInput: true,
        byAutoMode: false,
        talkativenessDefault: 0.5,
        ...overrides,
    });
}

describe('Leslie group orchestrator settings', () => {
    test('keeps missing and malformed settings safely disabled', () => {
        expect(normalizeGroupOrchestratorSettings()).toEqual({
            schema_version: 1,
            enabled: false,
            preset: 'balanced',
            max_speakers: 2,
            max_auto_replies: 3,
        });
        expect(normalizeLeslieGroupOrchestrator({ enabled: true, preset: 'unknown', max_speakers: 99 })).toEqual({
            schema_version: 1,
            enabled: false,
            preset: 'balanced',
            max_speakers: 4,
            max_auto_replies: 3,
        });
    });

    test('normalizes bounded versioned settings on both browser and server paths', () => {
        const source = {
            schema_version: 1,
            enabled: true,
            preset: GROUP_ORCHESTRATOR_PRESETS.LIVELY,
            max_speakers: 0,
            max_auto_replies: 20,
        };
        expect(normalizeGroupOrchestratorSettings(source)).toEqual({
            schema_version: 1,
            enabled: true,
            preset: 'lively',
            max_speakers: 1,
            max_auto_replies: 8,
        });
        expect(normalizeLeslieGroupOrchestrator(source)).toEqual(normalizeGroupOrchestratorSettings(source));
    });

    test('rolls back by removing only the Leslie namespace without mutating the group', () => {
        const source = group({ name: '合成测试群聊' });
        const rolledBack = stripLeslieGroupOrchestrator(source);
        expect(rolledBack.leslie_group_orchestrator).toBeUndefined();
        expect(rolledBack.members).toEqual(source.members);
        expect(rolledBack.name).toBe('合成测试群聊');
        expect(source.leslie_group_orchestrator.enabled).toBe(true);
    });
});

describe('Leslie smart group speaker planning', () => {
    test('does nothing when the feature is disabled so native behavior remains authoritative', () => {
        const result = plan({
            group: group({ leslie_group_orchestrator: { schema_version: 1, enabled: false } }),
        });
        expect(result).toEqual({ enabled: false, stop: false, speakerAvatars: [], decisions: [] });
    });

    test('treats an explicit character mention as the strongest signal', () => {
        const result = plan({
            activationText: '医生，请先看看这个伤口。',
            chat: [
                { is_user: true, name: '用户', mes: '有人在吗？' },
                { is_user: false, name: '医生', original_avatar: 'doctor.png', mes: '我在。' },
            ],
        });
        expect(result.speakerAvatars[0]).toBe('doctor.png');
        expect(result.decisions[0].reasons).toContain('explicit-mention');
    });

    test('uses card relevance and recent-speaker penalties without random selection', () => {
        const input = {
            activationText: '城门为什么封锁，我的通行证还能用吗？',
            chat: [
                { is_user: true, name: '用户', mes: '先去问问。' },
                { is_user: false, name: '商人', original_avatar: 'merchant.png', mes: '我不知道。' },
            ],
        };
        const first = plan(input);
        const second = plan(input);
        expect(first.speakerAvatars[0]).toBe('guard.png');
        expect(second).toEqual(first);
        expect(first.decisions[0].reasons).toContain('context-relevance');
    });

    test('does not let the last speaker immediately answer itself during automatic continuation', () => {
        const result = plan({
            activationText: '下一步要检查伤口。',
            isUserInput: false,
            byAutoMode: true,
            chat: [
                { is_user: true, name: '用户', mes: '继续。' },
                { is_user: false, name: '医生', original_avatar: 'doctor.png', mes: '我先准备药。' },
            ],
        });
        expect(result.speakerAvatars).not.toContain('doctor.png');
    });

    test('stops auto mode after the configured bounded reply chain', () => {
        const result = plan({
            isUserInput: false,
            byAutoMode: true,
            chat: [
                { is_user: true, name: '用户', mes: '你们继续商量。' },
                { is_user: false, name: '守卫', original_avatar: 'guard.png', mes: '一。' },
                { is_user: false, name: '医生', original_avatar: 'doctor.png', mes: '二。' },
                { is_user: false, name: '商人', original_avatar: 'merchant.png', mes: '三。' },
            ],
        });
        expect(result.stop).toBe(true);
        expect(result.reason).toBe('auto-reply-limit');
        expect(result.speakerAvatars).toEqual([]);
    });

    test('honors muted members and the configured speaker cap for collective prompts', () => {
        const result = plan({
            group: group({
                disabled_members: ['merchant.png'],
                leslie_group_orchestrator: {
                    schema_version: 1,
                    enabled: true,
                    preset: 'lively',
                    max_speakers: 2,
                    max_auto_replies: 3,
                },
            }),
            activationText: '大家都说说自己的判断。',
        });
        expect(result.speakerAvatars).toHaveLength(2);
        expect(result.speakerAvatars).not.toContain('merchant.png');
    });
});
