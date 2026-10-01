/* eslint-disable playwright/no-standalone-expect */
import { describe, expect, test } from '@jest/globals';

import {
    buildPlotCompassPrompt,
    countPlotTurns,
    createPlotPlan,
    getPlotCompassSchema,
    LESLIE_PLOT_COMPASS_METADATA_KEY,
    normalizePlotCompassMetadata,
    normalizePlotSuggestions,
} from '../public/scripts/leslie-plot-compass-core.js';

function suggestion(overrides = {}) {
    return {
        title: '追查匿名来信',
        kind: 'continuation',
        hook: '一封与旧线索有关的匿名信出现在门口。',
        goal: '在数周调查中找出寄信者，并决定是否揭开会改变双方处境的真相。',
        whyNow: '最近的平静给了双方重新检查旧疑点的空间。',
        timeHorizon: '故事内跨越数周，并从住所转移到多个调查地点。',
        impact: '调查结果会长期改变双方的信任、公开身份与可依赖的盟友。',
        beats: ['发现信件', '建立长期调查目标', '代价与矛盾升级', '关键选择形成新的生活常态'],
        firstMove: '我把信放到桌上，问她是否认得上面的符号。',
        duration: { minTurns: 24, maxTurns: 48 },
        ...overrides,
    };
}

describe('Leslie plot compass', () => {
    test('normalizes exactly three complete and distinct plot directions', () => {
        const result = normalizePlotSuggestions({
            suggestions: [
                suggestion(),
                suggestion({ title: '重新划定边界', kind: 'relationship', goal: '谈清双方没有说出口的期待。' }),
                suggestion({ title: '意外的访客', kind: 'disruption', goal: '判断来访者是否值得信任。' }),
                suggestion({ title: '多余方向', goal: '第四项不会进入结果。' }),
            ],
        });
        expect(result).toHaveLength(3);
        expect(result.map(item => item.kind)).toEqual(['continuation', 'relationship', 'disruption']);
        expect(result[0].duration).toEqual({ minTurns: 24, maxTurns: 48 });
    });

    test('recovers fenced JSON and rejects incomplete or command-like openings', () => {
        const valid = suggestion();
        const raw = `\`\`\`json\n${JSON.stringify({ suggestions: [
            valid,
            suggestion({ title: '命令', firstMove: '/delete 10' }),
            suggestion({ title: '缺少节拍', beats: ['只有一步'] }),
        ] })}\n\`\`\``;
        expect(normalizePlotSuggestions(raw)).toEqual([expect.objectContaining({ title: valid.title })]);
    });

    test('rejects small-event output without an explicit horizon and lasting impact', () => {
        expect(normalizePlotSuggestions({
            suggestions: [suggestion({ timeHorizon: '' }), suggestion({ impact: '' })],
        })).toEqual([]);
    });

    test('builds a current-line, user-controlled prompt with accepted-plan history', () => {
        const prompt = buildPlotCompassPrompt({
            userName: '管理员',
            aiNames: ['洛茜'],
            durationEnabled: true,
            intensity: 'bold',
            history: [{ title: '旧主线', goal: '找到遗失的档案。' }],
        });
        expect(prompt).toContain('用户 Persona 是“管理员”');
        expect(prompt).toContain('AI 角色是“洛茜”');
        expect(prompt).toContain('另一条世界线');
        expect(prompt).toContain('旧主线');
        expect(prompt).toContain('12–80');
        expect(prompt).toContain('篇章级主线');
        expect(prompt).toContain('难以轻易撤销的选择');
        expect(prompt).toContain('disruption');
    });

    test('omits duration from the schema when the user disables estimates', () => {
        const withDuration = getPlotCompassSchema({ durationEnabled: true });
        const withoutDuration = getPlotCompassSchema({ durationEnabled: false });
        const withItem = withDuration.value.properties.suggestions.items;
        const withoutItem = withoutDuration.value.properties.suggestions.items;
        expect(withItem.required).toContain('duration');
        expect(withItem.required).toEqual(expect.arrayContaining(['timeHorizon', 'impact']));
        expect(withItem.properties.beats.minItems).toBe(4);
        expect(withItem.properties.duration.properties.minTurns.minimum).toBe(12);
        expect(withItem.properties.duration.properties.maxTurns.maximum).toBe(80);
        expect(withoutItem.required).not.toContain('duration');
        expect(withoutItem.properties.duration).toBeUndefined();
    });

    test('drops a pinned plan when a branch ends before its acceptance point', () => {
        const plan = createPlotPlan(suggestion(), { id: 'plot-synthetic', messageId: 12, swipeId: 1 });
        const value = {
            schemaVersion: 2,
            activePlan: plan,
            history: [{ ...plan, id: 'older', acceptedAtMessageId: 4, status: 'completed', endedAtMessageId: 8 }],
        };
        expect(normalizePlotCompassMetadata(value, { messageCount: 10 })).toEqual({
            schemaVersion: 2,
            activePlan: null,
            history: [expect.objectContaining({ id: 'older', status: 'completed' })],
        });
    });

    test('counts only user turns after a plan is accepted', () => {
        const plan = createPlotPlan(suggestion(), { id: 'plot-synthetic', messageId: 1 });
        const messages = [
            { is_user: true },
            { is_user: false },
            { is_user: true },
            { is_user: false },
            { is_user: true },
            { is_user: false, is_system: true },
        ];
        expect(countPlotTurns(messages, plan)).toBe(2);
        expect(LESLIE_PLOT_COMPASS_METADATA_KEY).toBe('leslie_plot_compass');
    });

    test('migrates v1 plans without discarding their original short estimate', () => {
        const legacy = suggestion({
            timeHorizon: undefined,
            impact: undefined,
            beats: ['旧阶段一', '旧阶段二'],
            duration: { minTurns: 6, maxTurns: 10 },
        });
        const value = normalizePlotCompassMetadata({
            schemaVersion: 1,
            activePlan: {
                ...legacy,
                id: 'legacy-plan',
                acceptedAtMessageId: 1,
                acceptedAtSwipeId: 0,
                status: 'active',
            },
            history: [],
        }, { messageCount: 3 });
        expect(value).toEqual(expect.objectContaining({
            schemaVersion: 2,
            activePlan: expect.objectContaining({
                id: 'legacy-plan',
                timeHorizon: '跨越多个剧情阶段',
                duration: { minTurns: 6, maxTurns: 10 },
            }),
        }));
    });

    test('fails open for an unknown future schema instead of rewriting it', () => {
        expect(normalizePlotCompassMetadata({ schemaVersion: 99, activePlan: createPlotPlan(suggestion()) }, { messageCount: 3 })).toEqual({
            schemaVersion: 2,
            activePlan: null,
            history: [],
        });
    });
});
