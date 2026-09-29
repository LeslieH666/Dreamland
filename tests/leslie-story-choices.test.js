/* eslint-disable playwright/no-standalone-expect */
import { describe, expect, test } from '@jest/globals';

import {
    buildStoryChoicePrompt,
    createStoryChoiceContextKey,
    getStoryChoiceSchema,
    normalizeStoryChoices,
} from '../public/scripts/leslie-story-choices-core.js';

describe('Leslie story choices', () => {
    const identity = {
        userName: '管理员',
        aiNames: ['洛茜'],
        lastAssistantName: '洛茜',
    };

    test('normalizes exactly three structured user-Persona choices', () => {
        expect(normalizeStoryChoices({
            choices: [
                { title: '主动追问', perspective: 'user', speaker: '管理员', userMessage: '我向前一步，追问她刚才那句话的真正含义。' },
                { title: '暂时观察', perspective: 'user', speaker: '管理员', userMessage: '我没有立刻回应，只留意她接下来的动作。' },
                { title: '轻松试探', perspective: 'user', speaker: '管理员', userMessage: '我用一句玩笑试探她此刻的态度。' },
                { title: '不会采用', perspective: 'user', speaker: '管理员', userMessage: '这是多余的第四项。' },
            ],
        }, identity)).toEqual([
            { title: '主动追问', userMessage: '我向前一步，追问她刚才那句话的真正含义。' },
            { title: '暂时观察', userMessage: '我没有立刻回应，只留意她接下来的动作。' },
            { title: '轻松试探', userMessage: '我用一句玩笑试探她此刻的态度。' },
        ]);
    });

    test('recovers JSON wrapped in model commentary and code fences', () => {
        const raw = '```json\n{"choices":[{"title":"一","message":"行动一"},{"title":"二","message":"行动二"},{"title":"三","message":"行动三"}]}\n```';
        expect(normalizeStoryChoices(raw)).toHaveLength(3);
    });

    test('falls back to numbered plain-text lines', () => {
        const choices = normalizeStoryChoices('1. 先保持沉默\n2、直接说明来意\n- 转身查看身后的声音');
        expect(choices.map(choice => choice.userMessage)).toEqual([
            '先保持沉默',
            '直接说明来意',
            '转身查看身后的声音',
        ]);
    });

    test('rejects slash commands and duplicate messages', () => {
        const choices = normalizeStoryChoices({
            choices: [
                { title: '危险命令', message: '/delete 10' },
                { title: '正常', message: '我先观察四周。' },
                { title: '重复', message: '我先观察四周。' },
                { title: '另一个', message: '我询问她是否愿意同行。' },
            ],
        });
        expect(choices).toEqual([
            { title: '正常', userMessage: '我先观察四周。' },
            { title: '另一个', userMessage: '我询问她是否愿意同行。' },
        ]);
    });

    test('anchors the prompt to the administrator instead of the AI character', () => {
        const prompt = buildStoryChoicePrompt(identity);
        expect(prompt).toContain('下一条消息的唯一作者和发送者是用户 Persona“管理员”');
        expect(prompt).toContain('“洛茜”属于 AI 一方');
        expect(prompt).toContain('"perspective":"user"');
        expect(prompt).toContain('"speaker":"管理员"');
        expect(prompt).toContain('"userMessage"');
        expect(buildStoryChoicePrompt(identity, { correction: true })).toContain('上一轮候选没有通过用户视角校验');
    });

    test('uses an active pinned plot as guidance without treating it as completed fact', () => {
        const prompt = buildStoryChoicePrompt(identity, {
            activePlan: {
                status: 'active',
                title: '追查匿名来信',
                goal: '找出寄信者。',
                beats: ['检查信封', '寻找目击者'],
            },
        });
        expect(prompt).toContain('用户已经明确固定当前主线');
        expect(prompt).toContain('追查匿名来信');
        expect(prompt).toContain('不能替用户放弃主线');
        expect(prompt).toContain('不要把规划文字当作已经发生的剧情事实');
        expect(buildStoryChoicePrompt(identity, {
            activePlan: { status: 'paused', title: '暂停主线', goal: '暂不推进。' },
        })).not.toContain('暂停主线');
    });

    test('rejects AI-side speakers and narration before choices become clickable', () => {
        const choices = normalizeStoryChoices({
            choices: [
                { title: '错误角色', perspective: 'assistant', speaker: '洛茜', userMessage: '我会照做，管理员。' },
                { title: '伪造标签', perspective: 'user', speaker: '洛茜', userMessage: '我会照做，管理员。' },
                { title: '角色前缀', perspective: 'user', speaker: '管理员', userMessage: '洛茜：我会照做。' },
                { title: '角色动作', perspective: 'user', speaker: '管理员', userMessage: '洛茜低下头：“我会照做。”' },
                { title: '管理员回复', perspective: 'user', speaker: '管理员', userMessage: '我看向洛茜：“先把异常记录调出来。”' },
            ],
        }, identity);
        expect(choices).toEqual([
            { title: '管理员回复', userMessage: '我看向洛茜：“先把异常记录调出来。”' },
        ]);
    });

    test('allows the user Persona to address or discuss an AI character', () => {
        const choices = normalizeStoryChoices({
            choices: [
                { title: '直接称呼', perspective: 'user', speaker: '管理员', userMessage: '洛茜，把刚才的记录给我看看。' },
                { title: '表达判断', perspective: 'user', speaker: '管理员', userMessage: '洛茜说得对，但我还需要核对日志。' },
            ],
        }, identity);
        expect(choices).toHaveLength(2);
    });

    test('enforces the same user boundary against every AI member in a group', () => {
        const groupIdentity = {
            userName: '管理员',
            aiNames: ['洛茜', '米娅'],
            lastAssistantName: '米娅',
        };
        const choices = normalizeStoryChoices({
            choices: [
                { title: '错误群员', perspective: 'user', speaker: '管理员', userMessage: '米娅转身看向洛茜，示意她保持安静。' },
                { title: '用户行动', perspective: 'user', speaker: '管理员', userMessage: '我示意洛茜和米娅先保持安静。' },
            ],
        }, groupIdentity);
        expect(choices).toEqual([
            { title: '用户行动', userMessage: '我示意洛茜和米娅先保持安静。' },
        ]);
        expect(buildStoryChoicePrompt(groupIdentity)).toContain('“洛茜、米娅”属于 AI 一方');
    });

    test('requires explicit user perspective metadata in live generation mode', () => {
        expect(normalizeStoryChoices({
            choices: [{ title: '缺少身份', userMessage: '我先检查日志。' }],
        }, identity)).toEqual([]);
    });

    test('invalidates the context key after a message edit or swipe', () => {
        const base = {
            entityType: 'character',
            entityId: 2,
            chatId: 'synthetic-chat',
            messageCount: 8,
            lastMessageIndex: 7,
            lastMessage: { mes: '原始回复', swipe_id: 0 },
            userName: '管理员',
            aiNames: ['洛茜'],
        };
        const original = createStoryChoiceContextKey(base);
        const edited = createStoryChoiceContextKey({ ...base, lastMessage: { ...base.lastMessage, mes: '编辑后的回复' } });
        const swiped = createStoryChoiceContextKey({ ...base, lastMessage: { ...base.lastMessage, swipe_id: 1 } });
        const personaChanged = createStoryChoiceContextKey({ ...base, userName: '值班经理' });
        expect(edited).not.toBe(original);
        expect(swiped).not.toBe(original);
        expect(personaChanged).not.toBe(original);
        expect(original).not.toContain('原始回复');
        expect(original).not.toContain('管理员');
        expect(original).not.toContain('洛茜');
    });

    test('requests a bounded three-item structured response', () => {
        const schema = getStoryChoiceSchema(identity);
        expect(schema.value.properties.choices.minItems).toBe(3);
        expect(schema.value.properties.choices.maxItems).toBe(3);
        expect(schema.value.properties.choices.items.required).toEqual(['title', 'perspective', 'speaker', 'userMessage']);
        expect(schema.value.properties.choices.items.properties.speaker.enum).toEqual(['管理员']);
    });
});
