export const LESLIE_GROUP_ORCHESTRATOR_SCHEMA_VERSION = 1;

export const DEFAULT_LESLIE_GROUP_ORCHESTRATOR = Object.freeze({
    schema_version: LESLIE_GROUP_ORCHESTRATOR_SCHEMA_VERSION,
    enabled: false,
    preset: 'balanced',
    max_speakers: 2,
    max_auto_replies: 3,
});

const PRESETS = new Set(['balanced', 'focused', 'lively']);

function clampInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, number));
}

export function normalizeLeslieGroupOrchestrator(value = {}) {
    return {
        schema_version: LESLIE_GROUP_ORCHESTRATOR_SCHEMA_VERSION,
        enabled: value?.schema_version === LESLIE_GROUP_ORCHESTRATOR_SCHEMA_VERSION && value?.enabled === true,
        preset: PRESETS.has(value?.preset) ? value.preset : DEFAULT_LESLIE_GROUP_ORCHESTRATOR.preset,
        max_speakers: clampInteger(value?.max_speakers, 1, 4, DEFAULT_LESLIE_GROUP_ORCHESTRATOR.max_speakers),
        max_auto_replies: clampInteger(value?.max_auto_replies, 1, 8, DEFAULT_LESLIE_GROUP_ORCHESTRATOR.max_auto_replies),
    };
}

export function stripLeslieGroupOrchestrator(group) {
    const result = { ...(group ?? {}) };
    delete result.leslie_group_orchestrator;
    return result;
}
