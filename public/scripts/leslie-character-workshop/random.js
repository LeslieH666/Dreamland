import { CHARACTER_BLUEPRINT_SECTIONS, normalizeCharacterBlueprint } from './blueprint.js';

export const RANDOM_PREFERENCE_KEY = 'leslieWorkshopRandomPreferences';
const KEYS = ['gender', 'ageStage', 'species', 'occupationCategory', 'bodyType', 'coreTraits', 'familiarity', 'worldType'];
export const RANDOM_FIELDS = CHARACTER_BLUEPRINT_SECTIONS.flatMap(section => section.fields).filter(field => KEYS.includes(field.key));

export function normalizeRandomPreferences(value) {
    if (!value || typeof value !== 'object' || (value.version !== undefined && value.version !== 1)) value = {};
    const fields = {};
    for (const field of RANDOM_FIELDS) {
        const text = typeof value.fields?.[field.key] === 'string' ? value.fields[field.key].trim().slice(0, 300) : '';
        if (text && (!field.options || field.options.includes(text))) fields[field.key] = text;
    }
    return {
        version: 1, fields,
        mustInclude: typeof value.mustInclude === 'string' ? value.mustInclude.trim().slice(0, 1200) : '',
        exclude: typeof value.exclude === 'string' ? value.exclude.trim().slice(0, 1200) : '',
    };
}

export function readRandomPreferences(storage) {
    try { return normalizeRandomPreferences(JSON.parse(storage.getItem(RANDOM_PREFERENCE_KEY))); } catch { return normalizeRandomPreferences({}); }
}

export function saveRandomPreferences(storage, value) {
    const previous = storage.getItem(RANDOM_PREFERENCE_KEY);
    if (previous !== null) storage.setItem(RANDOM_PREFERENCE_KEY + '.previous', previous);
    const normalized = normalizeRandomPreferences(value);
    storage.setItem(RANDOM_PREFERENCE_KEY, JSON.stringify(normalized));
    return normalized;
}

export function buildRandomWorkshopInput(value, variation) {
    const preferences = normalizeRandomPreferences(value);
    return {
        blueprint: normalizeCharacterBlueprint(preferences.fields),
        mode: 'original',
        freeform: [
            '随机创作一位全新的原创角色，输出一个完整候选；在未限定的身份、经历、性格矛盾、世界与开场上主动构思，避免模板重复。',
            '已选择的偏好是硬约束，其余字段由你随机构思。只生成文字角色卡及头像提示词，不生成或调用图片。',
            preferences.mustInclude ? '必须包含：' + preferences.mustInclude : '',
            preferences.exclude ? '必须排除：' + preferences.exclude : '',
            '本次创意变化标记：' + variation + '。标记仅用于区分本次构思，不写进角色卡。',
        ].filter(Boolean).join('\n'),
    };
}
