/* eslint-disable playwright/no-standalone-expect -- Jest test.each is not recognized by the Playwright rule. */
import { describe, expect, test } from '@jest/globals';

import {
    buildDialogueStyleGuidance,
    buildDialogueOutputContract,
} from '../public/scripts/leslie-character-workshop/dialogue-style.js';
import {
    buildBriefRequest,
    buildDraftRequest,
    buildReviewRequest,
} from '../public/scripts/leslie-character-workshop/writing-skill.js';
import {
    assessBlueprintFidelity,
    buildCharacterBlueprintPrompt,
    normalizeCharacterBlueprint,
    renderCharacterBlueprintMarkup,
} from '../public/scripts/leslie-character-workshop/blueprint.js';
import {
    assessCharacterCard,
    canonicalizeDialogueRoleLabels,
    cardToCreateState,
} from '../public/scripts/leslie-character-workshop/core.js';

function createCard(blocks = [
    '{{user}}: 现在走？\n{{char}}: 等下，我拿个伞。',
    '{{user}}: 下雨了。\n{{char}}: 啊？刚还好好的。',
    '{{user}}: 我把灯关了？\n{{char}}: 先别关，我找个东西。',
    '{{user}}: 忘带钥匙了。\n{{char}}: ……你再翻翻口袋？',
]) {
    return {
        data: {
            name: 'Synthetic Dialogue Test',
            description: '成年虚构书店店员，不知道玩家未提供的信息。',
            personality: '直来直去，关系和信任逐步发展。',
            scenario: '书店准备关门。',
            first_mes: '等下，我拿个伞。',
            mes_example: blocks.map(block => `<START>\n${block}`).join('\n'),
            system_prompt: '不替用户决定台词、行动或情绪；保持认知边界。',
            post_history_instructions: '完成一个主要互动节拍；遵循用户指定的回复长度。',
            extensions: { depth_prompt: { prompt: '直来直去，按场景反应。', depth: 0, role: 'system' } },
        },
    };
}

describe('Workshop dialogue controls', () => {
    test('exposes expression choices without turning a blank default into a locked fact', () => {
        const markup = renderCharacterBlueprintMarkup();
        expect(markup).toContain('data-workshop-field="expressionIntensity"');
        for (const option of ['克制', '鲜明', '戏剧化']) {
            expect(markup).toContain(`<option value="${option}">${option}</option>`);
        }
        const blank = normalizeCharacterBlueprint({});
        const request = JSON.parse(buildCharacterBlueprintPrompt({ blueprint: blank }));
        expect(blank.fields.expressionIntensity).toBeUndefined();
        expect(request.aiFillFields.some(field => field.key === 'expressionIntensity')).toBe(true);
        expect(request.lockedFacts.some(field => field.key === 'expressionIntensity')).toBe(false);
        expect(buildDialogueStyleGuidance(blank)).toContain('表达张力：鲜明。');
    });

    test.each(['克制', '鲜明', '戏剧化'])('carries the selected %s expression into both writing and review', (expressionIntensity) => {
        const blueprint = normalizeCharacterBlueprint({ expressionIntensity });
        const request = JSON.parse(buildCharacterBlueprintPrompt({ blueprint }));
        expect(request.lockedFacts).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'expressionIntensity', value: expressionIntensity }),
        ]));
        expect(buildDraftRequest({}, {}, blueprint).prompt).toContain(`表达张力：${expressionIntensity}。`);
        expect(buildReviewRequest({}, createCard(), {}, {}, {}, blueprint).prompt).toContain(`表达张力：${expressionIntensity}。`);
        expect(assessBlueprintFidelity(createCard(), blueprint).missing).toEqual([]);
    });

    test('keeps detailed length and high action ratio controls through the whole workshop', () => {
        const blueprint = normalizeCharacterBlueprint({ replyLength: '详细', actionRatio: '较多动作描写' });
        const briefRequest = buildBriefRequest(buildCharacterBlueprintPrompt({ blueprint }));
        expect(briefRequest.prompt).toContain('详细');
        expect(briefRequest.prompt).toContain('情绪变化速度、表达强度和关系发展速度');
        for (const request of [buildDraftRequest({}, {}, blueprint), buildReviewRequest({}, createCard(), {}, {}, {}, blueprint)]) {
            expect(request.prompt).toContain('用户指定回复长度：详细');
            expect(request.prompt).toContain('用户指定动作比例：较多动作描写');
            expect(request.prompt).not.toContain('明确一个节拍、最多两行、最多一个短动作');
            expect(request.systemPrompt).not.toContain('一个即时反应、一个情绪节拍、最多两行');
        }
    });

    test('preserves an imported card voice and its existing valid examples on review', () => {
        const request = buildReviewRequest({ mode: 'imported' }, createCard(), {}, {});
        expect(request.prompt).not.toContain('表达张力：鲜明。');
        expect(request.prompt).toContain('导入卡已有的语言、回复长度、动作比例、示例数量和个人声音优先');
        expect(request.prompt).toContain('导入卡不为了凑数或增加轮次');
        const chosen = buildReviewRequest({ mode: 'imported' }, createCard(), {}, {}, {}, normalizeCharacterBlueprint({ expressionIntensity: '戏剧化' }));
        expect(chosen.prompt).toContain('表达张力：戏剧化。');
    });
});

describe('Dialogue example compatibility and quality checks', () => {
    test('requires two valid continuous blocks only for newly generated cards', () => {
        const single = createCard(Array.from({ length: 6 }, () => '{{user}}: 好了？\n{{char}}: 还没。'));
        const context = { brief: { mode: 'original' }, requireWorkshopExamples: true };
        expect(assessCharacterCard(single, context).blocking.some(item => item.code === 'workshop_example_structure')).toBe(true);
        const blocks = Array.from({ length: 6 }, (_, i) => i < 2
            ? '[USER]：好了？\n[CHAR]：还没。\n[USER]：我等你。\n[CHAR]：嗯，马上。'
            : '{{user}}: 好了？\n{{char}}: 还没。');
        expect(assessCharacterCard(createCard(blocks), context).blocking).toEqual([]);
        blocks[0] = '[USER]: 好了？\n[CHAR]: 还没。\n[USER]: 我等你。\n[CHAR]:';
        expect(assessCharacterCard(createCard(blocks), context).blocking.some(item => item.code === 'workshop_example_structure')).toBe(true);
        expect(assessCharacterCard(single).blocking).toEqual([]);
        expect(assessCharacterCard(single, { ...context, brief: { mode: 'imported' } }).blocking).toEqual([]);
    });

    test('keeps the runtime contract compact and respects longer replies and action controls', () => {
        const short = buildDialogueOutputContract();
        expect(short.length).toBeLessThan(160);
        expect(short).toContain('通常 1～3 句台词');
        const long = buildDialogueOutputContract(normalizeCharacterBlueprint({ replyLength: '详细', actionRatio: '较多动作描写' }));
        expect(long).toContain('详细');
        expect(long).toContain('较多动作描写');
        expect(long).not.toContain('1～3 句');
        expect(buildReviewRequest({ mode: 'imported' }, createCard(), {}, {}).prompt).toContain('导入卡保留原有规则');
    });

    test('accepts legacy four-example cards with both old and length-aware output contracts', () => {
        const card = createCard();
        for (const contract of ['使用短回复，最多两行。', '完成一个主要互动节拍；遵循用户指定的回复长度。', '遵循用户指定的回复长度，详细时按场景展开。']) {
            card.data.post_history_instructions = contract;
            const result = assessCharacterCard(card);
            expect(result.blocking).toEqual([]);
            expect(result.warnings.some(item => ['few_examples', 'reply_contract', 'dialogue_roles'].includes(item.code))).toBe(false);
        }
    });

    test('does not let extra turns in one block hide a missing user trigger in another', () => {
        const card = createCard([
            '{{user}}: 走？\n{{char}}: 等下。\n{{user}}: 还没好？\n{{char}}: 别催，我找钥匙呢。',
            '{{char}}: 找到了，走吧。',
            '{{user}}: 下雨了。\n{{char}}: 拿伞。',
            '{{user}}: 带哪把？\n{{char}}: 蓝的。',
        ]);
        expect(assessCharacterCard(card).warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'dialogue_roles' }),
        ]));
    });

    test('rejects empty and out-of-order turns while accepting multiline two-round examples', () => {
        const empty = createCard(['{{user}}:\n{{char}}: 嗯。']);
        const reversed = createCard(['{{char}}: 等下。\n{{user}}: 走？']);
        for (const card of [empty, reversed]) {
            expect(assessCharacterCard(card).warnings.some(item => item.code === 'dialogue_roles')).toBe(true);
        }
        const multi = createCard([
            '[USER]：你弄错了吧？\n[CHAR]：没吧？\n……等下，我看看。\n[USER]：这儿。\n[CHAR]：啊，真看漏了。\n别笑，我改就是了。',
        ]);
        const canonical = canonicalizeDialogueRoleLabels(multi);
        expect(assessCharacterCard(canonical).warnings.some(item => item.code === 'dialogue_roles')).toBe(false);
        const createState = cardToCreateState(canonical);
        expect(createState.mes_example).toContain('{{user}}:');
        expect(createState.mes_example).toContain('{{char}}:');
        expect(createState.mes_example).not.toMatch(/\[USER\]|\[CHAR\]/);
        expect(createState.mes_example).toContain('别笑，我改就是了。');
    });

    test('preserves valid character-led and consecutive character turns in imported examples', () => {
        const card = createCard([
            '{{char}}: 哎，先别走。\n{{user}}: 怎么了？\n{{char}}: 你伞没拿。\n{{char}}: 喏，给你。',
            '{{user}}: 下雨了。\n{{char}}: 啊？刚还好好的。',
            '{{user}}: 我把灯关了？\n{{char}}: 先别关，我找个东西。',
            '{{user}}: 忘带钥匙了。\n{{char}}: ……你再翻翻口袋？',
        ]);
        const review = assessCharacterCard(card, { brief: { mode: 'imported' } });
        expect(review.warnings.some(item => item.code === 'dialogue_roles')).toBe(false);
        expect(cardToCreateState(card).mes_example).toBe(card.data.mes_example);
    });

    test('flags repeated long replies as an advisory without lowering score or rewriting text', () => {
        const unique = createCard();
        const repeated = createCard([
            '{{user}}: 下雨了。\n{{char}}: 我会始终尊重你的感受。',
            '{{user}}: 忘带伞。\n{{char}}: 我会始终尊重你的感受。',
            '{{user}}: 车来了。\n{{char}}: 我会始终尊重你的感受。',
            '{{user}}: 走了。\n{{char}}: 行。',
        ]);
        const before = repeated.data.mes_example;
        const result = assessCharacterCard(repeated);
        expect(result.warnings.some(item => item.code === 'repeated_dialogue')).toBe(true);
        expect(result.blocking).toEqual([]);
        expect(result.score).toBe(assessCharacterCard(unique).score);
        expect(repeated.data.mes_example).toBe(before);
        const short = createCard(Array.from({ length: 4 }, () => '{{user}}: 好吗？\n{{char}}: 嗯。'));
        expect(assessCharacterCard(short).warnings.some(item => item.code === 'repeated_dialogue')).toBe(false);
    });
});
