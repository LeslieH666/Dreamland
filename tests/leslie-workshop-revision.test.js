import { expect, test } from '@jest/globals';
import { prepareRevision, assertRevisionCurrent, buildRevisionRequest } from '../public/scripts/leslie-character-workshop/revision.js';
import { toggleAppearanceChoice } from '../public/scripts/leslie-character-workshop/appearance.js';

const card = { spec: 'chara_card_v3', data: {
    name: '合成角色', description: '24 岁书店店员。黑色短发。蓝色外套。', personality: '嘴硬',
    scenario: '书店', first_mes: '来了？', mes_example: '合成对话', system_prompt: '保持认知边界',
    extensions: { synthetic: { opaque: ['preserve', 42] } }, alternate_greetings: ['你好'],
} };
const avatar = { positive: 'short black hair', negative: 'text', aspectRatio: '2:3' };
const blueprint = { fields: { age: '24 岁', occupation: '书店店员' } };
const payload = () => ({ patches: [{ old: '黑色短发。', new: '银白长发。' }], appearanceFields: { hair: '长发、银白发' }, avatar_prompt: { positive: 'long silver hair', negative: 'text', aspect_ratio: '2:3' } });

test('appearance patches preserve every other card field and never mutate original', () => {
    const original = structuredClone(card);
    const result = prepareRevision(card, avatar, blueprint, 'appearance', payload());
    expect(result.card).toEqual({ ...card, data: { ...card.data, description: '24 岁书店店员。银白长发。蓝色外套。' } });
    expect(card).toEqual(original);
    expect(result.avatar.positive).toBe('long silver hair');
    expect(result.fields.hair).toBe('长发、银白发');
});

test('avatar-only revisions leave the entire card unchanged', () => {
    const input = { ...payload(), patches: [], appearanceFields: {} };
    expect(prepareRevision(card, avatar, blueprint, 'avatar', input).card).toEqual(card);
    expect(() => prepareRevision(card, avatar, blueprint, 'avatar', payload())).toThrow('范围');
});

test('rejects forbidden fields, entire descriptions, ambiguous and overlapping fragments', () => {
    expect(() => prepareRevision(card, avatar, blueprint, 'appearance', { ...payload(), personality: '改了' })).toThrow('范围');
    expect(() => prepareRevision(card, avatar, blueprint, 'appearance', { ...payload(), patches: [{ old: card.data.description, new: '重写' }] })).toThrow('片段');
    const ambiguous = { ...card, data: { ...card.data, description: '黑色短发。黑色短发。' } };
    expect(() => prepareRevision(ambiguous, avatar, blueprint, 'appearance', payload())).toThrow('片段');
    expect(() => prepareRevision(card, avatar, blueprint, 'appearance', { ...payload(), patches: [{ old: '黑色短发。', new: '银发' }, { old: '短发', new: '长发' }] })).toThrow('重叠');
});

test('rejects changes to locked identity and stale proposals', () => {
    expect(() => prepareRevision(card, avatar, blueprint, 'appearance', { ...payload(), patches: [{ old: '24 岁', new: '30 岁' }] })).toThrow('锁定');
    const result = prepareRevision(card, avatar, blueprint, 'appearance', payload());
    expect(() => assertRevisionCurrent(result, card, avatar, blueprint)).not.toThrow();
    expect(() => assertRevisionCurrent(result, card, { ...avatar, positive: 'manual edit' }, blueprint)).toThrow('草稿已变化');
    expect(() => assertRevisionCurrent(result, { ...card, data: { ...card.data, personality: 'new' } }, avatar, blueprint)).toThrow('草稿已变化');
});

test('request limits data and scope to appearance rather than rewriting a whole card', () => {
    const request = buildRevisionRequest(card, avatar, blueprint, 'avatar', '修改构图');
    expect(request.prompt).toContain('patches 返回空数组');
    expect(request.prompt).not.toContain('合成对话');
    expect(request.prompt).not.toContain('opaque');
});

test('appearance presets replace same-group choices and preserve manual additions', () => {
    const hair = toggleAppearanceChoice('手写补充、短发、黑发', 'hair', 0, '长发');
    expect(hair).toBe('手写补充、黑发、长发');
    expect(toggleAppearanceChoice(hair, 'hair', 2, '银白发')).toBe('手写补充、长发、银白发');
    expect(toggleAppearanceChoice('长发、银白发', 'hair', 2, '银白发')).toBe('长发');
    expect(toggleAppearanceChoice('166 cm', 'height', 0, '170 cm')).toBe('170 cm');
    expect(toggleAppearanceChoice('自定义', 'hair', 0, '无效选项')).toBe('自定义');
});
