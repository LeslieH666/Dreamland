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
