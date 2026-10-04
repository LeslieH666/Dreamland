import assert from 'node:assert/strict';
import test from 'node:test';

/* eslint-disable playwright/expect-expect */

import {
    assessCharacterCard,
    canonicalizeDialogueRoleLabels,
    cardToCreateState,
    formatAvatarPrompt,
    normalizeAvatarPrompt,
    normalizeCharacterCard,
    normalizeCreativeBrief,
    normalizeKnowledgeCheck,
    parseStructuredResponse,
    protectRoleMacrosForGeneration,
} from '../public/scripts/leslie-character-workshop/core.js';
import {
    buildBriefRequest,
    buildDraftRequest,
    buildKnowledgeCheckRequest,
    buildReviewRequest,
    LESLIE_CHARACTER_WRITING_SKILL,
} from '../public/scripts/leslie-character-workshop/writing-skill.js';
import { parseCharacterCardJsonText } from '../public/scripts/leslie-character-workshop/importer.js';
import {
    assessBlueprintFidelity,
    buildCharacterBlueprintPrompt,
    normalizeCharacterBlueprint,
    summarizeCharacterBlueprint,
} from '../public/scripts/leslie-character-workshop/blueprint.js';

function buildCompleteCard() {
    return {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
            name: '测试角色',
            description: '一名二十四岁的独立书店店员。她不知道玩家没有亲口说出的经历，不能凭空知道场外信息。',
            personality: '警觉但好奇，有自己的计划。关系与信任必须逐步发展。',
            scenario: '她与 {{user}} 刚认识，雨夜里在即将打烊的书店门口相遇。',
            first_mes: '*她扶住门，抬眼看了一下雨幕。* “要进来避一会儿吗？”',
            mes_example: '<START>\n{{user}}: “现在可以进去吗？”\n{{char}}: “先等等。”\n<START>\n{{user}}: “你愿意帮我吗？”\n{{char}}: *她偏开视线。* “我还没想好。”\n<START>\n{{user}}: “你知道我为什么来吗？”\n{{char}}: “这件事我不知道。”\n<START>\n{{user}}: “我把书放这里？”\n{{char}}: *她轻轻点头。* “可以。”',
            creator_notes: '测试卡。',
            system_prompt: '保持角色独立意志和认知边界。不得替用户决定台词、行动、情绪或关系升级。',
            post_history_instructions: '每轮只写一个即时反应，使用短回复，最多两行；不得替用户说话。',
            alternate_greetings: ['“你也是来等雨停的？”'],
            tags: ['原创', '短对话'],
            creator: 'Leslie AI 角色工坊',
            character_version: '1.0',
            extensions: {
                talkativeness: 0.45,
                depth_prompt: {
                    prompt: '保持警觉但好奇；一个反应，最多两行。',
                    depth: 0,
                    role: 'system',
                },
            },
        },
    };
}

test('parses tagged JSON even when the model adds text around it', () => {
    const result = parseStructuredResponse('说明文字\n<leslie-json>{"name":"林"}</leslie-json>\n结束');
    assert.deepEqual(result, { name: '林' });
});

test('normalizes generated data to a stable Character Card V3 shape', () => {
    const normalized = normalizeCharacterCard(buildCompleteCard());
    assert.equal(normalized.spec, 'chara_card_v3');
    assert.equal(normalized.spec_version, '3.0');
    assert.equal(normalized.name, '测试角色');
    assert.equal(normalized.data.extensions.depth_prompt.depth, 0);
    assert.equal(normalized.data.extensions.depth_prompt.role, 'system');
    assert.deepEqual(normalized.data.tags, ['原创', '短对话']);
});

test('normalizes model booleans and caps knowledge questions for the chat API', () => {
    const brief = normalizeCreativeBrief({
        mode: 'adaptation',
        requiresKnowledgeCheck: 'true',
        knowledgeQuestions: ['一', '二', '三', '四'],
        hardFacts: ['  固定事实  '],
    });
    assert.equal(brief.requiresKnowledgeCheck, true);
    assert.deepEqual(brief.knowledgeQuestions, ['一', '二', '三']);
    assert.deepEqual(brief.hardFacts, ['固定事实']);
});

test('quality gate rewards complete short-dialogue cards and blocks missing fields', () => {
    const complete = assessCharacterCard(buildCompleteCard());
    assert.equal(complete.blocking.length, 0);
    assert.ok(complete.score >= 90);

    const incomplete = assessCharacterCard({ data: { name: '只有名字' } });
    assert.ok(incomplete.blocking.length >= 7);
    assert.ok(incomplete.score < complete.score);
});

test('quality gate accepts natural user-control wording and flags incomplete dialogue roles', () => {
    const naturalBoundary = buildCompleteCard();
    naturalBoundary.data.system_prompt = '保持角色独立意志和认知边界。不替玩家决定台词、行动、情绪或关系升级。';
    const accepted = assessCharacterCard(naturalBoundary);
    assert.equal(accepted.warnings.some(item => item.code === 'user_control'), false);

    const incompleteExamples = buildCompleteCard();
    incompleteExamples.data.mes_example = incompleteExamples.data.mes_example.replaceAll(/\{\{user\}\}:[^\n]*\n/g, '');
    const flagged = assessCharacterCard(incompleteExamples);
    assert.equal(flagged.warnings.some(item => item.code === 'dialogue_roles'), true);

    const silentGreeting = buildCompleteCard();
    silentGreeting.data.first_mes = '*她抬头看向门口，又把书放回桌面。*';
    const silentReview = assessCharacterCard(silentGreeting);
    assert.equal(silentReview.warnings.some(item => item.code === 'silent_greeting'), true);

    const unquotedDialogue = buildCompleteCard();
    unquotedDialogue.data.first_mes = '你就是临时派来的翻译？先把术语表给我。';
    const spokenReview = assessCharacterCard(unquotedDialogue);
    assert.equal(spokenReview.warnings.some(item => item.code === 'silent_greeting'), false);

    const premature = buildCompleteCard();
    premature.data.mes_example += '\n<START>\n{{user}}: “谢谢。”\n{{char}}: “你能来这里，也算缘分。我会在这等你。”';
    const pacingReview = assessCharacterCard(premature, { brief: { relationshipStart: '两人第一次见面，彼此陌生。' } });
    assert.equal(pacingReview.warnings.some(item => item.code === 'premature_intimacy'), true);

    const workCondition = buildCompleteCard();
    workCondition.data.first_mes = '“只要你能把术语翻对，我们就能省掉一半麻烦。”';
    const workConditionReview = assessCharacterCard(workCondition, { brief: { relationshipStart: '两人第一次见面，彼此陌生。' } });
    assert.equal(workConditionReview.warnings.some(item => item.code === 'premature_intimacy'), false);
});

test('maps only the reviewed draft into SillyTavern existing create state', () => {
    const createState = cardToCreateState(buildCompleteCard());
    assert.equal(createState.name, '测试角色');
    assert.equal(createState.first_message.includes('书店'), false);
    assert.equal(createState.depth_prompt_depth, 0);
    assert.deepEqual(createState.alternate_greetings, ['“你也是来等雨停的？”']);
    assert.deepEqual(createState.extra_books, []);
});

test('normalizes chat-model knowledge checks without accepting fabricated source fields', () => {
    const knowledge = normalizeKnowledgeCheck({
        knowledge_check: {
            summary: '模型知识核对，不代表实时联网。',
            facts: [
                { claim: '固定事实', confidence: 'high', basis: '用户明确提供', url: 'https://not-persisted.example' },
                { claim: '推断', confidence: 'unknown', basis: '合理推断' },
            ],
            uncertainties: ['版本时间点待确认'],
            requiresUserConfirmation: true,
        },
    });
    assert.equal(knowledge.facts.length, 2);
    assert.equal(knowledge.facts[1].confidence, 'low');
    assert.equal('url' in knowledge.facts[0], false);
    assert.equal(knowledge.requiresUserConfirmation, true);
});

test('normalizes and formats a manual avatar prompt without touching the character card', () => {
    const prompt = normalizeAvatarPrompt({
        avatar_prompt: {
            positive: '  adult woman,   quiet bookstore  ',
            negative: 'text, watermark',
            aspect_ratio: '16:9:bad',
            notes: '手动生成',
        },
    });
    assert.equal(prompt.positive, 'adult woman, quiet bookstore');
    assert.equal(prompt.aspectRatio, '2:3');
    assert.match(formatAvatarPrompt(prompt), /正向提示词/);
    assert.equal(normalizeCharacterCard(buildCompleteCard()).avatar, 'none');
});

test('canonicalizes neutral and active chat dialogue labels to portable card macros', () => {
    const card = buildCompleteCard();
    card.data.mes_example = '<START>\n[USER]: “第一句。”\n[CHAR]: “回应。”\n<START>\n春日野悠： “第二句。”\nSillyTavern System: “再回应。”';
    card.data.scenario = '[CHAR] 与 [USER] 第一次见面。';
    const normalized = canonicalizeDialogueRoleLabels(card, {
        userLabel: '春日野悠',
        characterLabels: ['SillyTavern System'],
    });
    assert.equal((normalized.data.mes_example.match(/\{\{user\}\}:/g) || []).length, 2);
    assert.equal((normalized.data.mes_example.match(/\{\{char\}\}:/g) || []).length, 2);
    assert.doesNotMatch(normalized.data.mes_example, /春日野悠|SillyTavern System/);
    assert.equal(normalized.data.scenario, '{{char}} 与 {{user}} 第一次见面。');
    assert.equal(protectRoleMacrosForGeneration('让 {{user}} 与 {{ CHAR }} 初次见面'), '让 [USER] 与 [CHAR] 初次见面');
});

test('versioned writing skill uses one chat API for four quality-first stages', () => {
    const brief = buildBriefRequest('写一个警觉但好奇的成年角色', 'original');
    const knowledge = buildKnowledgeCheckRequest({ mode: 'adaptation', knowledgeQuestions: ['角色身份'] });
    const blueprint = normalizeCharacterBlueprint({ age: '24 岁', occupation: '书店店员' });
    const draft = buildDraftRequest({ mode: 'original' }, {}, blueprint);
    const review = buildReviewRequest({ mode: 'original' }, buildCompleteCard(), {}, { score: 100 }, { positive: 'adult portrait' }, blueprint);

    assert.equal(LESLIE_CHARACTER_WRITING_SKILL.version, '1.5.0');
    assert.match(brief.prompt, /阶段 1\/4/);
    assert.match(knowledge.prompt, /阶段 2\/4/);
    assert.match(knowledge.systemPrompt, /严禁编造网址/);
    assert.match(draft.prompt, /只创作一张/);
    assert.match(draft.prompt, /6～8 组正例/);
    assert.match(draft.prompt, /avatar_prompt/);
    assert.match(draft.prompt, /不生成图片数据/);
    assert.match(draft.prompt, /structuredInput/);
    assert.match(draft.prompt, /24 岁/);
    assert.doesNotMatch(draft.prompt, /固定成年外观/);
    assert.match(draft.systemPrompt, /\[USER\].*\[CHAR\]/);
    assert.match(review.prompt, /审校并修订/);
    assert.match(review.prompt, /手动头像提示词/);
    assert.match(review.prompt, /用户指定年龄一致/);
    assert.match(review.systemPrompt, /不要因为原稿来自另一个模型而宽松评分/);
    assert.match(review.systemPrompt, /0～100/);
});

test('builds a structured blueprint where blank fields are delegated to AI', () => {
    const blueprint = normalizeCharacterBlueprint({
        name: '林雾遥',
        age: '24 岁',
        occupation: '独立书店夜班店员',
        personalityTension: '警觉但好奇',
        height: '168 cm',
        unknownField: '不会被保留',
    });
    const summary = summarizeCharacterBlueprint(blueprint);
    const prompt = JSON.parse(buildCharacterBlueprintPrompt({
        blueprint,
        freeform: '开场发生在停电后的书店。',
        mode: 'original',
    }));

    assert.equal(blueprint.version, 1);
    assert.equal(blueprint.fields.name, '林雾遥');
    assert.equal('unknownField' in blueprint.fields, false);
    assert.equal(summary.lockedFacts.some(item => item.key === 'height' && item.value === '168 cm'), true);
    assert.equal(summary.aiFillFields.some(item => item.key === 'hair'), true);
    assert.equal(prompt.schema, 'leslie-character-blueprint-v1');
    assert.equal(prompt.freeformNotes, '开场发生在停电后的书店。');
    assert.match(prompt.rules.join('\n'), /空白不是缺陷/);
});

test('checks concrete user-locked blueprint facts against the generated card', () => {
    const blueprint = normalizeCharacterBlueprint({
        name: '林雾遥',
        age: '24 岁',
        height: '168 cm',
        occupation: '独立书店夜班店员',
        personalityTension: '警觉但好奇',
        replyLength: '简短',
    });
    const card = buildCompleteCard();
    card.data.name = '林雾遥';
    card.data.description = '林雾遥，24 岁，身高 168 厘米，是一名独立书店夜班店员。她不知道玩家没有亲口说出的经历。';
    card.data.personality = '她警觉但好奇，有自己的计划。关系与信任必须逐步发展。';

    const complete = assessBlueprintFidelity(card, blueprint);
    assert.equal(complete.total, 6);
    assert.deepEqual(complete.missing, []);

    card.data.description = '她在书店工作，外貌没有明确记录。';
    const incomplete = assessBlueprintFidelity(card, blueprint);
    assert.equal(incomplete.missing.some(item => item.key === 'height'), true);
    assert.equal(incomplete.missing.some(item => item.key === 'occupation'), true);
    assert.equal(incomplete.missing.some(item => item.key === 'replyLength'), false);
});

test('accepts faithful paraphrases across stable character-card fields', () => {
    const blueprint = normalizeCharacterBlueprint({
        clothing: '浅灰连帽卫衣、深色牛仔裤',
        coreTraits: '认真、敏锐、慢热',
        personalityTension: '理性克制，但对未知事物非常好奇',
        goals: '完成学期项目并争取实验室实习',
        likes: '天文摄影、独立游戏、冰美式',
        boundaries: '不替玩家说话或行动；不读心；不强行升级亲密关系',
        addressUser: '先用你，熟悉后才根据玩家自我介绍改用名字',
        forbiddenStyle: '不说教，不连环追问，不用大段抽象抒情',
    });
    const card = buildCompleteCard();
    card.data.description = [
        '她常穿浅灰连帽卫衣和深色牛仔裤。',
        '当前目标是完成学期项目并争取实验室实习。',
        '核心性格认真负责、观察敏锐，但表达慢热。',
        '她理性克制，但对未知事物非常好奇。',
        '她喜欢天文摄影、独立游戏和冰美式。',
    ].join('\n');
    card.data.personality = '她不替玩家说话或行动，不读心，也不强行升级亲密关系。';
    card.data.system_prompt = '先用“你”称呼用户，熟悉后才根据用户自我介绍改用名字。';
    card.data.post_history_instructions = '不说教，不连环追问，不用大段抽象抒情。';

    const result = assessBlueprintFidelity(card, blueprint);
    assert.equal(result.total, 8);
    assert.deepEqual(result.missing, []);
});

test('imports Clarix Character Card V2 JSON and preserves its personalization extension', () => {
    const source = buildCompleteCard().data;
    const personalization = { tone: 'restrained', reply_length: 'short' };
    const json = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        clarix_personalization: personalization,
        data: {
            ...source,
            extensions: {
                ...source.extensions,
                clarix_personalization: personalization,
            },
        },
    });
    const imported = parseCharacterCardJsonText(json);

    assert.equal(imported.sourceLabel, 'Clarix 公益角色网站');
    assert.equal(imported.sourceSpec, 'chara_card_v2');
    assert.equal(imported.card.spec, 'chara_card_v3');
    assert.deepEqual(imported.card.data.extensions.clarix_personalization, personalization);
    assert.deepEqual(cardToCreateState(imported.card).extensions.clarix_personalization, personalization);
    assert.match(imported.notices.join('\n'), /保留 Clarix/);
});

test('rejects batch JSON and advanced fields that the lightweight paste flow would lose', () => {
    assert.throws(
        () => parseCharacterCardJsonText('[{"name":"甲"},{"name":"乙"}]'),
        /只能导入一张/,
    );
    assert.throws(
        () => parseCharacterCardJsonText(JSON.stringify({
            spec: 'chara_card_v3',
            data: {
                ...buildCompleteCard().data,
                character_book: { entries: [{ keys: ['秘密'], content: '不可丢失' }] },
            },
        })),
        /嵌入式世界书/,
    );
});
