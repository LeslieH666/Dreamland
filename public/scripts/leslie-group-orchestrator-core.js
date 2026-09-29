const SCHEMA_VERSION = 1;

export const GROUP_ORCHESTRATOR_PRESETS = Object.freeze({
    BALANCED: 'balanced',
    FOCUSED: 'focused',
    LIVELY: 'lively',
});

export const DEFAULT_GROUP_ORCHESTRATOR_SETTINGS = Object.freeze({
    schema_version: SCHEMA_VERSION,
    enabled: false,
    preset: GROUP_ORCHESTRATOR_PRESETS.BALANCED,
    max_speakers: 2,
    max_auto_replies: 3,
});

const COLLECTIVE_ADDRESS_PATTERN = /(?:大家|你们|所有人|各位|众人|二位|三位|\b(?:all|everyone|everybody|both)\b)/iu;
const WORD_PATTERN = /[\p{Script=Han}]+|[\p{Letter}\p{Number}_]+/gu;

function clampInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, number));
}

function cleanText(value) {
    return String(value ?? '').trim().toLocaleLowerCase();
}

function normalizeName(value) {
    return cleanText(value).replace(/[\s\p{P}\p{S}]+/gu, '');
}

function addHanTerms(terms, value) {
    if (value.length <= 4) {
        terms.add(value);
    }

    for (let index = 0; index < value.length - 1; index++) {
        terms.add(value.slice(index, index + 2));
    }
}

function getTerms(value) {
    const terms = new Set();
    const matches = cleanText(value).match(WORD_PATTERN) ?? [];

    for (const match of matches) {
        if (/^[\p{Script=Han}]+$/u.test(match)) {
            addHanTerms(terms, match);
        } else if (match.length >= 2) {
            terms.add(match);
        }
    }

    return terms;
}

function countOverlap(left, right) {
    let overlap = 0;
    for (const term of left) {
        if (right.has(term)) {
            overlap++;
        }
    }
    return overlap;
}

function getSpeakerKey(message) {
    return cleanText(message?.original_avatar || message?.name);
}

function getRecentState(messages, isUserInput) {
    const recentAssistantCounts = new Map();
    const spokenSinceUser = new Set();
    let assistantMessagesSinceUser = 0;

    for (const message of messages.slice(-12).reverse()) {
        if (message?.is_user) {
            break;
        }
        if (message?.is_system) {
            continue;
        }

        const speakerKey = getSpeakerKey(message);
        if (!speakerKey) {
            continue;
        }

        assistantMessagesSinceUser++;
        spokenSinceUser.add(speakerKey);
        recentAssistantCounts.set(speakerKey, (recentAssistantCounts.get(speakerKey) ?? 0) + 1);
    }

    if (isUserInput) {
        assistantMessagesSinceUser = 0;
        spokenSinceUser.clear();
    }

    return { recentAssistantCounts, spokenSinceUser, assistantMessagesSinceUser };
}

function getCandidateContext(character) {
    return [
        character?.name,
        character?.description,
        character?.personality,
        character?.scenario,
        character?.data?.description,
        character?.data?.personality,
        character?.data?.scenario,
    ].filter(Boolean).join('\n').slice(0, 6_000);
}

function getMentionedNames(input, character) {
    const normalizedInput = normalizeName(input);
    const aliases = [character?.name, ...(Array.isArray(character?.aliases) ? character.aliases : [])]
        .map(normalizeName)
        .filter(Boolean);

    return aliases.filter(alias => normalizedInput.includes(alias));
}

/**
 * Returns validated Leslie group-orchestrator settings without mutating the source object.
 * Missing or malformed settings deliberately keep the feature disabled.
 * @param {object} [value] Persisted settings.
 */
export function normalizeGroupOrchestratorSettings(value = {}) {
    const presetValues = Object.values(GROUP_ORCHESTRATOR_PRESETS);
    const preset = presetValues.includes(value?.preset) ? value.preset : DEFAULT_GROUP_ORCHESTRATOR_SETTINGS.preset;

    return {
        schema_version: SCHEMA_VERSION,
        enabled: value?.schema_version === SCHEMA_VERSION && value?.enabled === true,
        preset,
        max_speakers: clampInteger(value?.max_speakers, 1, 4, DEFAULT_GROUP_ORCHESTRATOR_SETTINGS.max_speakers),
        max_auto_replies: clampInteger(value?.max_auto_replies, 1, 8, DEFAULT_GROUP_ORCHESTRATOR_SETTINGS.max_auto_replies),
    };
}

/**
 * Produces a bounded, deterministic speaker plan for existing group members.
 * It does not generate dialogue and never mutates the group, characters, or chat.
 * @param {object} input Planning input.
 * @param {object} input.group Current group definition.
 * @param {object[]} input.characters Loaded character definitions.
 * @param {object[]} input.chat Current chat messages.
 * @param {string} input.activationText Text that triggered this plan.
 * @param {boolean} input.isUserInput Whether a new user message triggered generation.
 * @param {boolean} input.byAutoMode Whether the group auto worker triggered generation.
 * @param {number} input.talkativenessDefault Native fallback talkativeness.
 */
export function planSmartGroupTurn({
    group,
    characters,
    chat,
    activationText,
    isUserInput,
    byAutoMode,
    talkativenessDefault,
}) {
    const settings = normalizeGroupOrchestratorSettings(group?.leslie_group_orchestrator);
    const members = Array.isArray(group?.members) ? group.members : [];
    const disabledMembers = new Set(Array.isArray(group?.disabled_members) ? group.disabled_members : []);
    const messages = Array.isArray(chat) ? chat : [];
    const characterList = Array.isArray(characters) ? characters : [];
    const recentState = getRecentState(messages, isUserInput);

    if (!settings.enabled) {
        return { enabled: false, stop: false, speakerAvatars: [], decisions: [] };
    }

    if (byAutoMode && recentState.assistantMessagesSinceUser >= settings.max_auto_replies) {
        return {
            enabled: true,
            stop: true,
            speakerAvatars: [],
            decisions: [],
            reason: 'auto-reply-limit',
        };
    }

    const inputTerms = getTerms(activationText);
    const lastMessage = messages.at(-1);
    const lastSpeaker = getSpeakerKey(lastMessage);
    const allowSelfResponses = group?.allow_self_responses === true;
    const collectiveAddress = COLLECTIVE_ADDRESS_PATTERN.test(String(activationText ?? ''));
    const candidates = [];

    for (let rosterIndex = 0; rosterIndex < members.length; rosterIndex++) {
        const avatar = members[rosterIndex];
        if (disabledMembers.has(avatar)) {
            continue;
        }

        const character = characterList.find(item => item?.avatar === avatar);
        if (!character) {
            continue;
        }

        const speakerKey = cleanText(avatar || character.name);
        if (!isUserInput && !allowSelfResponses && lastSpeaker && speakerKey === lastSpeaker) {
            continue;
        }

        const mentionedNames = getMentionedNames(activationText, character);
        const mentioned = mentionedNames.length > 0;
        const relevance = countOverlap(inputTerms, getTerms(getCandidateContext(character)));
        const recentCount = recentState.recentAssistantCounts.get(speakerKey) ?? 0;
        const rawTalkativeness = Number(character.talkativeness);
        const talkativeness = Number.isFinite(rawTalkativeness) ? rawTalkativeness : Number(talkativenessDefault);
        let score = Math.max(0, Math.min(1, Number.isFinite(talkativeness) ? talkativeness : 0.5)) * 10;
        const reasons = [];

        if (mentioned) {
            score += 1_000;
            reasons.push('explicit-mention');
        }
        if (relevance > 0) {
            score += Math.min(30, relevance * 6);
            reasons.push('context-relevance');
        }
        if (!recentState.spokenSinceUser.has(speakerKey)) {
            score += 10;
            reasons.push('turn-balance');
        }
        if (recentCount > 0) {
            score -= recentCount * 8;
            reasons.push('recent-speaker-penalty');
        }

        score += (members.length - rosterIndex) / 1_000;
        candidates.push({ avatar, name: character.name, score, mentioned, relevance, rosterIndex, reasons });
    }

    candidates.sort((left, right) => right.score - left.score || left.rosterIndex - right.rosterIndex || String(left.avatar).localeCompare(String(right.avatar)));

    if (candidates.length === 0) {
        return {
            enabled: true,
            stop: byAutoMode,
            speakerAvatars: [],
            decisions: [],
            reason: 'no-candidates',
        };
    }

    const selected = [];
    const mentionedCandidates = candidates.filter(candidate => candidate.mentioned);
    for (const candidate of mentionedCandidates.slice(0, settings.max_speakers)) {
        selected.push(candidate);
    }

    if (selected.length === 0) {
        selected.push(candidates[0]);
    }

    const targetCount = settings.preset === GROUP_ORCHESTRATOR_PRESETS.FOCUSED
        ? 1
        : settings.preset === GROUP_ORCHESTRATOR_PRESETS.LIVELY
            ? Math.min(2, settings.max_speakers)
            : collectiveAddress
                ? settings.max_speakers
                : 1;

    if (settings.preset === GROUP_ORCHESTRATOR_PRESETS.BALANCED && selected.length === 1 && settings.max_speakers > 1) {
        const second = candidates.find(candidate => !selected.includes(candidate));
        const first = selected[0];
        if (second && second.score >= 18 && second.score >= first.score * 0.8) {
            selected.push(second);
        }
    }

    for (const candidate of candidates) {
        if (selected.length >= Math.min(targetCount, settings.max_speakers)) {
            break;
        }
        if (!selected.includes(candidate)) {
            selected.push(candidate);
        }
    }

    const bounded = selected.slice(0, settings.max_speakers);
    return {
        enabled: true,
        stop: false,
        speakerAvatars: bounded.map(candidate => candidate.avatar),
        decisions: bounded.map(candidate => ({
            avatar: candidate.avatar,
            name: candidate.name,
            score: Number(candidate.score.toFixed(3)),
            reasons: candidate.reasons,
        })),
        reason: 'planned',
    };
}
