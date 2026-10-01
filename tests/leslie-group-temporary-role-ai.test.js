import { describe, expect, test } from '@jest/globals';

import {
    buildTemporaryRoleReviewPrompt,
    getTemporaryRoleReviewSchema,
    normalizeTemporaryRoleReview,
} from '../public/scripts/leslie-group-temporary-role-ai-core.js';

describe('Leslie temporary role AI review', () => {
    test('accepts one bounded role proposal and only known active archive ids', () => {
        const review = normalizeTemporaryRoleReview(JSON.stringify({
            proposal: {
                needed: true,
                reason: '剧情明确要求店主回答。',
                role: {
                    name: '旅店老板',
                    description: '经营当前旅店。',
                    personality: '谨慎但务实。',
                    scene_role: '回答住宿与失踪旅客的问题。',
                    speech_style: '简洁、有戒心。',
                    knowledge_boundary: '只知道旅店内公开发生的事。',
                    goals: ['保护旅店'],
                    constraints: ['不知道幕后真相'],
                    talkativeness: 3,
                },
            },
            archive: {
                suggestions: [
                    { role_id: 'temp_known-01', reason: '信使已经明确离开。' },
                    { role_id: 'temp_unknown', reason: '未知角色。' },
                    { role_id: 'temp_known-01', reason: '重复建议。' },
                ],
            },
        }), {
            existingNames: ['主角'],
            activeRoleIds: ['temp_known-01'],
        });

        expect(review.proposal.role.name).toBe('旅店老板');
        expect(review.proposal.role.talkativeness).toBe(1);
        expect(review.archiveSuggestions).toEqual([{
            roleId: 'temp_known-01',
            reason: '信使已经明确离开。',
        }]);
    });

    test('rejects duplicate or incomplete proposals without affecting valid archive suggestions', () => {
        const review = normalizeTemporaryRoleReview({
            proposal: {
                needed: true,
                reason: '重复已有成员。',
                role: { name: '雅雪', scene_role: '重复角色' },
            },
            archive: {
                suggestions: [{ role_id: 'temp_guard-01', reason: '守卫已经换岗离场。' }],
            },
        }, {
            existingNames: ['雅雪'],
            activeRoleIds: ['temp_guard-01'],
        });

        expect(review.proposal).toBeNull();
        expect(review.archiveSuggestions).toHaveLength(1);
    });

    test('builds a prompt that treats chat content as data and supports disabling either action', () => {
        const prompt = buildTemporaryRoleReviewPrompt({
            permanentMembers: [{ name: '雅雪' }],
            temporaryRoles: [{
                id: 'temp_guard-01',
                name: '守卫',
                state: 'active',
                scene_role: '守门',
            }],
            allowProposal: false,
            allowArchive: true,
        });

        expect(prompt).toContain('待分析的数据');
        expect(prompt).toContain('proposal.needed 必须为 false');
        expect(prompt).toContain('temp_guard-01');
        expect(getTemporaryRoleReviewSchema().value.required).toEqual(['proposal', 'archive']);
    });
});
