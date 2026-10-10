/**
 * Shared enums for the prompt-assembly modules (Phase 2.5.2).
 *
 * Values are bit-identical to the browser definitions so the same source can run
 * in `public/` and in `src/` without translation:
 *   - `ExtensionPromptType` / `ExtensionPromptRole` / `MAX_INJECTION_DEPTH`
 *     mirror public/script.js.
 */

/** Injection position of an extension prompt (public/script.js:511-516). */
export const ExtensionPromptType = Object.freeze({
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
});

/** Message role an extension prompt is injected as (public/script.js:521-525). */
export const ExtensionPromptRole = Object.freeze({
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
});

/** Upper bound used when walking injection depths (public/script.js:527). */
export const MAX_INJECTION_DEPTH = 10000;

/**
 * Where an injected extension prompt is placed.
 * @readonly
 * @enum {number}
 */
export const INJECTION_POSITION = Object.freeze({
    RELATIVE: 0,
    ABSOLUTE: 1,
});

/**
 * Chat-message `extra.type` values the assembly can treat specially, mirrored from
 * public/scripts/system-messages.js. Only NARRATOR is read by the shared message
 * shaping; the full set is mirrored so callers compare against the real values.
 * @readonly
 * @enum {string}
 */
export const SYSTEM_MESSAGE_TYPES = Object.freeze({
    HELP: 'help',
    WELCOME: 'welcome',
    EMPTY: 'empty',
    GENERIC: 'generic',
    NARRATOR: 'narrator',
    COMMENT: 'comment',
    SLASH_COMMANDS: 'slash_commands',
    FORMATTING: 'formatting',
    HOTKEYS: 'hotkeys',
    MACROS: 'macros',
    WELCOME_PROMPT: 'welcome_prompt',
    ASSISTANT_NOTE: 'assistant_note',
    ASSISTANT_MESSAGE: 'assistant_message',
});

/**
 * How a speaker name is attached to a chat-completion message
 * (public/scripts/openai.js:223).
 * @readonly
 * @enum {number}
 */
export const CHARACTER_NAMES_BEHAVIOR = Object.freeze({
    NONE: -1,
    DEFAULT: 0,
    COMPLETION: 1,
    CONTENT: 2,
});
