/**
 * Chat-completion tokenizer-model resolution (Phase 2.5.2 step 4, 附 L Q-c).
 *
 * A narrowed lift of `getTokenizerModel()` (public/scripts/tokenizers.js:569).
 * The browser version is ~150 lines of per-provider model-name heuristics for
 * every chat-completion source it supports. Phase 2.5 needs the providers in
 * scope — OpenAI, DeepSeek and the OpenAI-compatible custom endpoint — and must
 * not guess for the rest: guessing would silently produce a different token
 * count, and therefore a different prompt whenever budget trimming engages.
 *
 * Unsupported providers raise {@link UnsupportedTokenizerProviderError} so the
 * caller fails closed, matching the project-wide decision for browser-only
 * capabilities.
 *
 * The provider values mirror `chat_completion_sources` (public/scripts/openai.js:176).
 */

/** Tokenizer id used when the source does not pin one, mirroring tokenizers.js:575 and the :793 fallback. */
export const TOKENIZER_FALLBACK = 'gpt-3.5-turbo';

/** Tokenizer id the browser returns for DeepSeek (tokenizers.js:597). */
export const DEEPSEEK_TOKENIZER = 'deepseek';

/** Chat-completion sources whose tokenizer this module resolves. */
export const SUPPORTED_CHAT_COMPLETION_SOURCES = Object.freeze(['openai', 'azure_openai', 'deepseek', 'custom']);

/** Raised when a provider's tokenizer is outside the narrowed Phase 2.5 scope. */
export class UnsupportedTokenizerProviderError extends Error {
    /**
     * @param {string} chatCompletionSource Source identifier.
     */
    constructor(chatCompletionSource) {
        super(
            `The tokenizer for chat completion source "${chatCompletionSource}" is not implemented server-side `
            + `(Phase 2.5 covers: ${SUPPORTED_CHAT_COMPLETION_SOURCES.join(', ')}). `
            + 'Refusing to guess a token count, which would change prompt trimming.',
        );
        this.name = 'UnsupportedTokenizerProviderError';
        this.chatCompletionSource = chatCompletionSource;
    }
}

/**
 * Resolve the tokenizer id for a chat-completion request.
 *
 * Mirrors the browser's ordering: the OpenAI source returns its configured model
 * verbatim (tokenizers.js:571-573), Azure falls back to the 3.5 tokenizer
 * (:592-594), DeepSeek is pinned (:596-598), and an OpenAI-compatible custom
 * endpoint falls through to the default (:793).
 *
 * @param {object} context Resolution inputs.
 * @param {string} context.chatCompletionSource `chat_completion_sources` value.
 * @param {string} [context.openaiModel] `oai_settings.openai_model`.
 * @param {string} [context.azureOpenaiModel] `oai_settings.azure_openai_model`.
 * @returns {string} Tokenizer id (a model name for OpenAI/Azure).
 * @throws {UnsupportedTokenizerProviderError} When the provider is out of scope.
 */
export function resolveChatCompletionTokenizerModel({ chatCompletionSource, openaiModel, azureOpenaiModel } = {}) {
    switch (chatCompletionSource) {
        case 'openai':
            // The browser returns the configured model as-is, even when empty.
            return openaiModel;
        case 'azure_openai':
            return azureOpenaiModel || TOKENIZER_FALLBACK;
        case 'deepseek':
            return DEEPSEEK_TOKENIZER;
        case 'custom':
            return TOKENIZER_FALLBACK;
        default:
            throw new UnsupportedTokenizerProviderError(String(chatCompletionSource));
    }
}
