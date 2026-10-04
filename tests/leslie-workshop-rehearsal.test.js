import { describe, expect, test } from '@jest/globals';
import { normalizeCharacterCard, assessCharacterCard } from '../public/scripts/leslie-character-workshop/core.js';
import {
    createRehearsalSession, validateRehearsalReply, buildRehearsalFollowupRequest,
    normalizeRehearsalFollowup, normalizeRehearsalAudit, getRehearsalExamples,
    withRehearsalExamples, preserveRehearsalExamples,
} from '../public/scripts/leslie-character-workshop/rehearsal.js';

const scenes = () => createRehearsalSession({ scenes: Array.from({ length: 3 }, (_, i) => ({ title: `合成场景 ${i}`, setting: '两个成年书店同事正在闲聊。', playerLine: `第 ${i} 次玩家提问？` })) });
const full = () => {
    const session = scenes();
    session.scenes.forEach((scene, i) => { scene.replies = [`  原话 ${i}，别改！\n半句也行。`, '嗯']; scene.followup = `追问 ${i}？`; });
    return session;
};
describe('Human voice rehearsal', () => {
    test('rejects incomplete scenes and role-label injection while preserving ordinary whitespace', () => {
        expect(() => createRehearsalSession({ scenes: [] })).toThrow();
        expect(() => createRehearsalSession({ scenes: [{}, {}, {}] })).toThrow();
        expect(validateRehearsalReply('  等下。\n我想想。 ')).toBe('  等下。\n我想想。 ');
        expect(() => validateRehearsalReply('')).toThrow();
        expect(() => validateRehearsalReply('嗯。\n<START>')).toThrow();
        expect(() => validateRehearsalReply('{{user}}: 偷加玩家台词')).toThrow();
    });
    test('player continuation includes the actual human response without writing a character answer', () => {
        const session = full();
        const request = buildRehearsalFollowupRequest({}, {}, session.scenes[0]);
        expect(request.prompt).toContain(JSON.stringify(session.scenes[0].replies[0]));
        expect(normalizeRehearsalFollowup({ playerLine: '那我等你。' })).toBe('那我等你。');
        expect(() => normalizeRehearsalFollowup({ characterLine: '替角色写了。' })).toThrow();
    });
    test('only accepts habits quoted from character answers and conflicts with traceable facts', () => {
        const session = full();
        const payload = {
            habits: [{ habit: '用短句', scene: 0, turn: 0, quote: '半句也行。' }, { habit: '自己编的', scene: 0, turn: 0, quote: '温柔理性' }, { habit: '玩家提问', scene: 0, turn: 0, quote: '玩家提问' }],
            conflicts: [{ message: '检查实际冲突', scene: 1, turn: 0, fact: '24 岁' }, { message: '编造事实', scene: 1, turn: 0, fact: '住在城堡' }],
        };
        const audit = normalizeRehearsalAudit(payload, session, {}, { fields: { age: '24 岁' } });
        expect(audit.habits).toHaveLength(1);
        expect(audit.conflicts).toHaveLength(1);
    });
    test('restores verbatim originals and leaves common short words in supplemental examples', () => {
        const session = full();
        const card = normalizeCharacterCard({ data: { mes_example: Array.from({ length: 3 }, (_, i) => `<START>\n{{user}}: 补充提问 ${i}？\n{{char}}: 嗯，等等。`).join('\n') } });
        const output = preserveRehearsalExamples(card, session);
        expect(output.data.mes_example.split('<START>').length - 1).toBe(6);
        expect(output.data.mes_example).toContain('{{char}}:   原话 0，别改！\n半句也行。');
        expect(output.data.mes_example).toContain('补充提问 2？');
        expect(output.mes_example).toBe(output.data.mes_example);
        expect(card.data.mes_example).not.toContain('原话');
        expect(assessCharacterCard(output, { requireWorkshopExamples: true }).blocking.some(item => item.code === 'workshop_example_structure')).toBe(false);
    });
    test('avoids duplicate originals on repeated review and caps total example count', () => {
        const session = full();
        const card = normalizeCharacterCard({ data: { mes_example: Array.from({ length: 9 }, (_, i) => `<START>\n{{user}}: 新问题 ${i}？\n{{char}}: 新回答 ${i}。`).join('\n') } });
        const first = preserveRehearsalExamples(card, session);
        expect(first.data.mes_example.split('<START>').length - 1).toBe(8);
        expect(preserveRehearsalExamples(first, session).data.mes_example).toBe(first.data.mes_example);
    });
    test('skipped scenes and incomplete second turns never produce empty character turns', () => {
        const session = scenes();
        session.scenes[0].replies[0] = '第一句原话。';
        session.scenes[0].followup = '第二次提问？';
        expect(getRehearsalExamples(session)).toHaveLength(1);
        expect(getRehearsalExamples(session)[0].turns).toHaveLength(2);
        expect(withRehearsalExamples({ prompt: '草稿' }, session).prompt).toContain('5 组');
        const original = { prompt: '不带试演的请求' };
        expect(withRehearsalExamples(original, scenes())).toBe(original);
        const card = normalizeCharacterCard({});
        expect(preserveRehearsalExamples(card, null)).toBe(card);
    });
});
