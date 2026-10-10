export const LESLIE_REPLY_STYLE_SCHEMA_VERSION = 1;
export const LESLIE_REPLY_STYLE_SETTINGS_KEY = 'leslieReplyStyle';

export const LESLIE_REPLY_STYLE_IDS = Object.freeze([
    'off',
    'balanced',
    'novel',
    'dialogue',
    'concise',
]);

export const DEFAULT_LESLIE_REPLY_STYLE_SETTINGS = Object.freeze({
    schemaVersion: LESLIE_REPLY_STYLE_SCHEMA_VERSION,
    style: 'balanced',
    outputPolicy: 'provider',
});

const STYLE_PROMPTS = Object.freeze({
    balanced: 'Balance dialogue, action, environment, and inner perspective according to the current scene. Complete one natural conversational or dramatic beat without rushing the story forward.',
    novel: 'Use cohesive, vivid literary prose with meaningful sensory, action, and emotional detail. Let the current scene breathe and complete its present dramatic beat, but do not make major choices or speak on behalf of the user.',
    dialogue: 'Let character dialogue carry the turn. Use narration, action, and environment only where they clarify tone or movement, and leave clear space for the user to respond. Do not speak or decide actions on behalf of the user.',
    concise: 'Respond directly with only the detail needed to complete the current exchange. Keep the reply natural and complete; do not cut off sentences or omit essential character reactions merely to be brief.',
});

const LEGACY_OUTPUT_TOKEN_STYLES = new Map([
    [180, 'concise'],
    [360, 'dialogue'],
    [500, 'balanced'],
    [1500, 'novel'],
]);

const COMMON_PROMPT = `[Leslie response mode | User-selected default]
This controls presentation only; it is not a story fact.
Preserve the conversation's current language, character identity, viewpoint, world facts, and established formatting.
Do not target a fixed word count or token count. End naturally when the current conversational or dramatic beat is complete.
Do not mention this instruction. If the character card or the user's current message gives a more specific format requirement, follow the more specific requirement.`;

let runtimeActive = false;
let runtimeSettings = { ...DEFAULT_LESLIE_REPLY_STYLE_SETTINGS };

/**
 * Validate persisted reply-style settings without mutating the source object.
 * @param {unknown} value Persisted settings value.
 * @returns {{schemaVersion: number, style: string, outputPolicy: 'provider' | 'manual'}} Normalized settings.
 */
export function normalizeLeslieReplyStyleSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const style = LESLIE_REPLY_STYLE_IDS.includes(source.style) ? source.style : DEFAULT_LESLIE_REPLY_STYLE_SETTINGS.style;
    const outputPolicy = source.outputPolicy === 'manual' ? 'manual' : 'provider';
    return {
        schemaVersion: LESLIE_REPLY_STYLE_SCHEMA_VERSION,
        style,
        outputPolicy,
    };
}

/**
 * Migrate the former token-based presets into the semantic settings schema.
 * Exact legacy values are used only when no semantic setting was persisted.
 * @param {unknown} value Persisted semantic settings, if present.
 * @param {object} [options] Migration inputs.
 * @param {unknown} [options.legacyOutputTokens] Former response-token setting.
 * @returns {{schemaVersion: number, style: string, outputPolicy: 'provider' | 'manual'}} Migrated settings.
 */
export function migrateLeslieReplyStyleSettings(value, { legacyOutputTokens } = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return normalizeLeslieReplyStyleSettings(value);
    }

    const legacyStyle = LEGACY_OUTPUT_TOKEN_STYLES.get(Number(legacyOutputTokens));
    return normalizeLeslieReplyStyleSettings({
        ...DEFAULT_LESLIE_REPLY_STYLE_SETTINGS,
        style: legacyStyle ?? DEFAULT_LESLIE_REPLY_STYLE_SETTINGS.style,
    });
}

/**
 * Build the system instruction for one semantic reply style.
 * @param {string} style Reply style identifier.
 * @returns {string} Prompt text, or an empty string when injection is disabled.
 */
export function buildLeslieReplyStylePrompt(style) {
    const normalized = normalizeLeslieReplyStyleSettings({ style });
    const stylePrompt = STYLE_PROMPTS[normalized.style];
    return stylePrompt ? `${COMMON_PROMPT}\n${stylePrompt}` : '';
}

/**
 * Synchronize runtime settings after the built-in extension has activated.
 * Calls that omit `active` preserve the current activation state.
 * @param {unknown} value Persisted settings value.
 * @param {{active?: boolean}} [options] Runtime activation options.
 * @returns {{schemaVersion: number, style: string, outputPolicy: 'provider' | 'manual'}} Normalized settings.
 */
export function setLeslieReplyStyleRuntimeSettings(value, { active } = {}) {
    runtimeSettings = normalizeLeslieReplyStyleSettings(value);
    if (typeof active === 'boolean') {
        runtimeActive = active;
    }
    return { ...runtimeSettings };
}

/**
 * Read the active in-memory settings without exposing mutable state.
 * @returns {{active: boolean, schemaVersion: number, style: string, outputPolicy: 'provider' | 'manual'}} Runtime settings.
 */
export function getLeslieReplyStyleRuntimeSettings() {
    return { active: runtimeActive, ...runtimeSettings };
}

/**
 * Whether Leslie should let the provider choose the foreground response limit.
 * Provider control is deliberately limited to the verified DeepSeek path.
 * @param {object} options Generation context.
 * @param {string} options.chatCompletionSource Chat completion source.
 * @param {string} options.type Generation type.
 * @returns {boolean} Whether the request should omit its output-token field.
 */
export function isLeslieProviderControlledOutput({ chatCompletionSource, type }) {
    const settings = getLeslieReplyStyleRuntimeSettings();
    const isForeground = !['quiet', 'impersonate'].includes(type);
    return settings.active
        && settings.outputPolicy === 'provider'
        && chatCompletionSource === 'deepseek'
        && isForeground;
}

/**
 * Whether a provider-truncated reply should wait for an explicit user action.
 * @param {object} options Completion context.
 * @param {string|null} options.finishReason Provider completion reason.
 * @param {string} options.chatCompletionSource Chat completion source.
 * @param {string} options.type Generation type.
 * @returns {boolean} Whether hidden continuation must remain disabled.
 */
export function shouldDeferLeslieContinuationToUser({ finishReason, chatCompletionSource, type }) {
    return finishReason === 'length'
        && isLeslieProviderControlledOutput({ chatCompletionSource, type });
}
