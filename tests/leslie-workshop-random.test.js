import { expect, test } from '@jest/globals';
import { buildRandomWorkshopInput, normalizeRandomPreferences, readRandomPreferences, saveRandomPreferences, RANDOM_PREFERENCE_KEY } from '../public/scripts/leslie-character-workshop/random.js';

test('random preferences validate known fields, lengths and versions without accepting unknown fields', () => {
    const result = normalizeRandomPreferences({ version: 1, fields: { gender: 'invalid', coreTraits: 'x'.repeat(400), secret: 'ignore' }, exclude: '  不要模板  ' });
    expect(result.fields.gender).toBeUndefined();
    expect(result.fields.secret).toBeUndefined();
    expect(result.fields.coreTraits).toHaveLength(300);
    expect(result.exclude).toBe('不要模板');
    expect(normalizeRandomPreferences({ version: 2, mustInclude: 'future' }).mustInclude).toBe('');
});

test('account-scoped optional preferences recover from corruption and retain exact prior data for rollback', () => {
    const values = new Map([[RANDOM_PREFERENCE_KEY, '{corrupt']]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    expect(readRandomPreferences(storage).fields).toEqual({});
    saveRandomPreferences(storage, { fields: { gender: '女性' } });
    expect(values.get(RANDOM_PREFERENCE_KEY + '.previous')).toBe('{corrupt');
    expect(readRandomPreferences(storage).fields.gender).toBe('女性');
    saveRandomPreferences(storage, {});
    expect(readRandomPreferences(storage).fields).toEqual({});
    values.set(RANDOM_PREFERENCE_KEY, values.get(RANDOM_PREFERENCE_KEY + '.previous'));
    expect(readRandomPreferences(storage).fields.gender).toBe('女性');
});

test('random generation locks the chosen blueprint, excludes rejected content and varies only unconstrained facts', () => {
    const input = buildRandomWorkshopInput({ fields: { species: '精灵' }, mustInclude: '书店', exclude: '王室' }, 'synthetic-seed');
    expect(input.blueprint.fields.species).toBe('精灵');
    expect(input.mode).toBe('original');
    expect(input.freeform).toContain('必须包含：书店');
    expect(input.freeform).toContain('必须排除：王室');
    expect(input.freeform).toContain('synthetic-seed');
    expect(input.freeform).toContain('不生成或调用图片');
});
