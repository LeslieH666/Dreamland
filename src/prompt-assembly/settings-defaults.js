/**
 * Browser settings defaults for prompt assembly, resolved to pure data (2.5.3, plan A).
 *
 * The page builds power_user from defaults and only overlays what was persisted, so the
 * server has to merge the same defaults - without them, assembly read
 * power_user.context.example_separator off an object that never had one.
 *
 * Scope is deliberately the subset assembly reads: the context block, the instruct block
 * and the persona fields. oai_settings is taken from settings.json as-is for now; a field
 * is added here only when the replay oracle shows assembly needs its default. The browser
 * files are untouched, so there is no second copy to drift - these blocks were extracted
 * from power-user.js and every reference was resolved to a literal or a shared enum.
 */

import { ExtensionPromptRole, ExtensionPromptType } from './enums.js';
import { NAMES_BEHAVIOR_TYPES } from './macro-helpers.js';

export const PERSONA_DESCRIPTION_POSITIONS = Object.freeze({
    IN_PROMPT: 0,
    /**
     * @deprecated Use PERSONA_DESCRIPTION_POSITIONS.IN_PROMPT instead.
     */
    AFTER_CHAR: 1,
    TOP_AN: 2,
    BOTTOM_AN: 3,
    AT_DEPTH: 4,
    NONE: 9,
});

/** Default story-string template, extracted from power-user.js. */
const DEFAULT_STORY_STRING = '{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{char}}\'s personality: {{personality}}\n{{/if}}{{#if scenario}}Scenario: {{scenario}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}';

/** power_user.context defaults. */
export const POWER_USER_CONTEXT_DEFAULTS = Object.freeze({
    preset: 'Default',
    story_string: DEFAULT_STORY_STRING,
    chat_start: '***',
    example_separator: '***',
    use_stop_strings: true,
    names_as_stop_strings: true,
    story_string_position: ExtensionPromptType.IN_PROMPT,
    story_string_role: ExtensionPromptRole.SYSTEM,
    story_string_depth: 1,
});

/** power_user.instruct defaults. */
export const POWER_USER_INSTRUCT_DEFAULTS = Object.freeze({
    enabled: false,
    preset: 'Alpaca',
    input_sequence: '### Instruction:',
    input_suffix: '',
    output_sequence: '### Response:',
    output_suffix: '',
    system_sequence: '',
    system_suffix: '',
    last_system_sequence: '',
    first_input_sequence: '',
    first_output_sequence: '',
    last_input_sequence: '',
    last_output_sequence: '',
    story_string_prefix: '',
    story_string_suffix: '',
    stop_sequence: '',
    wrap: true,
    macro: true,
    names_behavior: NAMES_BEHAVIOR_TYPES.FORCE,
    activation_regex: '',
    bind_to_context: false,
    user_alignment_message: '',
    system_same_as_user: false,
    /** @deprecated Use output_suffix instead */
    separator_sequence: '',
    sequences_as_stop_strings: true,
});

/** Persona-related power_user defaults. */
export const POWER_USER_PERSONA_DEFAULTS = Object.freeze({
    // Controls whether dialogue examples are added before the chat history (page default).
    pin_examples: false,
    persona_descriptions: {},
    persona_description: '',
    persona_description_position: PERSONA_DESCRIPTION_POSITIONS.IN_PROMPT,
    persona_description_role: 0,
    persona_description_depth: 2,
    persona_description_lorebook: '',
});

/**
 * Deep-merge persisted values over defaults: plain objects merge recursively, arrays and
 * scalars are replaced, matching how the page loads its settings.
 * @param {object} defaults Default shape.
 * @param {object} persisted Persisted values.
 * @returns {object} Merged copy.
 */
export function mergeSettings(defaults, persisted) {
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
        return structuredClone(defaults);
    }
    const result = structuredClone(defaults);
    for (const [key, value] of Object.entries(persisted)) {
        const isPlainObject = value && typeof value === 'object' && !Array.isArray(value);
        if (isPlainObject && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = mergeSettings(result[key], value);
        } else {
            result[key] = structuredClone(value);
        }
    }
    return result;
}

/**
 * Build the power_user shape assembly expects from what was persisted.
 * @param {object} persisted Persisted power_user.
 * @returns {object} Merged power_user.
 */
export function buildServerPowerUser(persisted) {
    return mergeSettings({
        context: structuredClone(POWER_USER_CONTEXT_DEFAULTS),
        instruct: structuredClone(POWER_USER_INSTRUCT_DEFAULTS),
        ...structuredClone(POWER_USER_PERSONA_DEFAULTS),
    }, persisted);
}

/**
 * The chat-completion defaults assembly actually reads.
 *
 * Extracted from openai.js default_settings with every reference resolved, so the server
 * starts from the same prompt formats and caps the page does. Kept to the fields the
 * assembly touches rather than the whole 107-line default object.
 */
export const OAI_SETTINGS_ASSEMBLY_DEFAULTS = Object.freeze({
    new_chat_prompt: '[Start a new Chat]',
    new_example_chat_prompt: '[Example Chat]',
    new_group_chat_prompt: '[Start a new group chat. Group members: {{group}}]',
    continue_nudge_prompt: '[Continue your last message without repeating its original content.]',
    // The page stores this as a string ('', ' ', '\n', '\n\n'); its select writes a number
    // but the loader repairs any non-string back to the string default.
    continue_postfix: ' ',
    group_nudge_prompt: '[Write the next reply only as {{char}}.]',
    impersonation_prompt: '[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don\'t write as {{char}} or system. Don\'t describe actions of {{char}}.]',
    scenario_format: '{{scenario}}',
    personality_format: '{{personality}}',
    wi_format: '{0}',
    names_behavior: 0,
    squash_system_messages: false,
    openai_max_context: 4095,
    openai_max_tokens: 300,
    continue_prefill: false,
    stream_openai: false,
    media_inlining: true,
    request_images: false,
    custom_prompt_post_processing: '',
});
