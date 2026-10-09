/**
 * Server-side assembly environment (Phase 2.5.3).
 *
 * The shared prompt-assembly modules take their inputs through an `env` object that
 * the browser fills from live page state. This module builds the server's equivalent
 * from what is persisted under the user's data root, so `prepareOpenAIMessagesCore`
 * and the world-info core can run without a browser.
 *
 * It is deliberately separate from authoritative-turn.js: building the environment is
 * testable on its own, and the turn assembly only flips from failing closed once this
 * is complete enough to reproduce the browser byte for byte.
 *
 * Hooks that only exist in the page - tool calls, media inlining, provider capability
 * probes - are injected rather than faked, so a caller that needs them must supply
 * them and the server never silently pretends a capability is present.
 */

import { countMessageTokens } from './token-counting.js';
import { resolveChatCompletionTokenizerModel } from './tokenizer-model.js';
import { INJECTION_POSITION } from './enums.js';

// The server never inlines media and never performs tool calls, so these are inert
// stand-ins rather than reimplementations: the populate cluster only reads them to
// decide whether to do something the server must not do anyway.
const MEDIA_DISPLAY = Object.freeze({ LIST: 'list', GALLERY: 'gallery' });
const MEDIA_TYPE = Object.freeze({ IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio' });
const EXTENSION_PROMPT_TYPES = Object.freeze({ NONE: -1, IN_PROMPT: 0, IN_CHAT: 1 });

/** A tool manager that reports no available tools. */
const TOOL_MANAGER_STUB = Object.freeze({
    canPerformToolCalls: () => false,
    getTools: () => [],
});

/**
 * Approximate a message's token count.
 *
 * The exact count needs the page's tokenizer, which the server does not have. Counts are
 * reported to callers but never change the assembled messages, and the model is still
 * resolved through the shared resolver so an unsupported provider fails closed rather
 * than being counted under the wrong tokenizer. Callers that need exact counts must not
 * rely on the server's.
 *
 * @param {object} message Message.
 * @returns {number} Estimated tokens.
 */
function estimateMessageTokens(message) {
    const content = message?.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    return Math.ceil(String(text).length / 4);
}

/** Fallback OpenAI-compatible model name used when a source has no explicit model. */
const FALLBACK_TOKENIZER_MODEL = 'gpt-3.5-turbo';

/**
 * Build the token handler the assembly reports counts through.
 *
 * The model name comes from the account's chat settings, resolved through the shared
 * tokenizer resolver so an unsupported provider fails closed instead of silently
 * counting with the wrong tokenizer.
 *
 * @param {object} oaiSettings Chat-completion settings.
 * @returns {{countAsync: (message: object) => Promise<number>, counts: object, getCounts: () => object, getTotal: () => number}} Token handler.
 */
export function buildServerTokenHandler(oaiSettings = {}) {
    const source = String(oaiSettings.chat_completion_source ?? '');
    const model = resolveChatCompletionTokenizerModel({
        chatCompletionSource: source,
        openaiModel: oaiSettings.openai_model,
        azureOpenaiModel: oaiSettings.azure_openai_model,
        customModel: oaiSettings.custom_model,
        fallbackModel: FALLBACK_TOKENIZER_MODEL,
    });

    const counts = {};
    return {
        counts,
        getCounts: () => counts,
        getTotal: () => Object.values(counts).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0),
        countAsync: async message => countMessageTokens([message], {
            resolveModel: () => model,
            countOne: async item => estimateMessageTokens(item),
        }),
    };
}

/**
 * Build a prompt-manager facade over the shared registry functions.
 *
 * The registry functions in registry.js were written to take the browser's
 * PromptManager instance as their `env`; this object provides the same small surface
 * from persisted state, so the same code paths run on both sides.
 *
 * @param {object} options Options.
 * @param {object} options.serviceSettings Persisted `oai_settings` (prompts + prompt_order).
 * @param {object} options.activeCharacter Character card as the browser would see it.
 * @param {object} options.tokenHandler Token handler.
 * @param {() => object} options.createPromptCollection Collection factory.
 * @param {object} [options.configuration] Prompt-order configuration.
 * @returns {object} Prompt-manager facade.
 */
export function buildServerPromptManager({ serviceSettings, activeCharacter, tokenHandler, createPromptCollection, configuration }) {
    const state = {
        serviceSettings,
        activeCharacter,
        tokenHandler,
        configuration: configuration ?? {
            version: 1,
            prefix: '',
            containerIdentifier: '',
            listIdentifier: '',
            listItemTemplateIdentifier: '',
            toggleDisabled: [],
            promptOrder: { strategy: 'global', dummyId: 100000 },
        },
        error: null,
    };
    const logs = [];
    let chatCompletion = null;

    return {
        ...state,
        get logs() {
            return logs;
        },
        get chatCompletion() {
            return chatCompletion;
        },
        createPromptCollection,
        getPromptById(identifier) {
            return this.serviceSettings.prompts?.find(prompt => prompt?.identifier === identifier);
        },
        getPromptOrderEntry(character, identifier) {
            const order = this.serviceSettings.prompt_order?.find(entry => entry?.character_id === character?.id);
            return order?.order?.find(item => item.identifier === identifier);
        },
        addPromptOrderForCharacter(character, order) {
            if (!Array.isArray(this.serviceSettings.prompt_order)) {
                this.serviceSettings.prompt_order = [];
            }
            this.serviceSettings.prompt_order.push({ character_id: character?.id, order: structuredClone(order) });
        },
        getPromptOrderForCharacter(character) {
            const order = this.serviceSettings.prompt_order?.find(entry => entry?.character_id === character?.id);
            return order?.order ?? [];
        },
        setPrompts(prompts) {
            this.serviceSettings.prompts = structuredClone(prompts);
        },
        preparePrompt(prompt) {
            return prompt;
        },
        log(message) {
            logs.push(String(message));
        },
        getUuidv4() {
            return globalThis.crypto.randomUUID();
        },
        setChatCompletion(value) {
            chatCompletion = value;
        },
        /** No DOM on the server, so rendering is intentionally a no-op. */
        render() {},
    };
}

/**
 * Build the environment the shared assembly cores expect.
 *
 * @param {object} options Options.
 * @param {object} options.settings Full account settings (`settings.json`).
 * @param {object} options.card Character card.
 * @param {object} options.promptManager Prompt-manager facade.
 * @param {object} options.tokenHandler Token handler.
 * @param {object} options.ChatCompletion ChatCompletion class.
 * @param {object} options.deps Injected page-only hooks.
 * @returns {object} Assembly environment.
 */
export function buildServerAssemblyEnv({ settings, card, promptManager, tokenHandler, ChatCompletion, deps = {} }) {
    if (!ChatCompletion) {
        throw new Error('buildServerAssemblyEnv: ChatCompletion is required.');
    }
    const oaiSettings = settings?.oai_settings ?? {};
    const powerUser = settings?.power_user ?? {};

    return {
        // --- cross-cutting -------------------------------------------------
        ChatCompletion,
        tokenHandler,
        promptManager,
        getPromptManager: () => promptManager,
        getOaiSettings: () => oaiSettings,
        getDefaultSettings: () => settings?.default_settings ?? {},
        getPowerUser: () => powerUser,
        chatCompletionSources: settings?.chat_completion_sources ?? {},
        t: deps.t ?? (value => String(value)),
        notify: deps.notify ?? { error: () => {}, warning: () => {} },
        emit: deps.emit ?? (async () => {}),
        eventTypes: deps.eventTypes ?? {},
        getGenerationTokenBudget: deps.getGenerationTokenBudget ?? (() => ({ contextTokens: oaiSettings.openai_max_context ?? 4096, outputTokens: oaiSettings.openai_max_tokens ?? 256 })),
        setOpenaiMessagesCount: deps.setOpenaiMessagesCount ?? (() => {}),

        // --- prompt/registry group ----------------------------------------
        Prompt: deps.Prompt,
        createPromptCollection: deps.createPromptCollection,
        injectionPosition: INJECTION_POSITION,

        // --- provider enums the populate cluster reads ---------------------
        toolReasoningModes: deps.toolReasoningModes ?? {},
        interleavedReasoningProviders: deps.interleavedReasoningProviders ?? [],
        getEffectiveToolReasoningMode: deps.getEffectiveToolReasoningMode ?? (() => 'disabled'),
        toolManager: deps.toolManager ?? TOOL_MANAGER_STUB,

        // --- media: the server never inlines ------------------------------
        mediaDisplay: MEDIA_DISPLAY,
        mediaType: MEDIA_TYPE,
        isImageInliningSupported: deps.isImageInliningSupported ?? (() => false),
        isVideoInliningSupported: deps.isVideoInliningSupported ?? (() => false),
        isAudioInliningSupported: deps.isAudioInliningSupported ?? (() => false),
        isReasoningSignatureSupported: deps.isReasoningSignatureSupported ?? (() => false),

        // --- persona / world info -----------------------------------------
        personaDescriptionPositions: deps.personaDescriptionPositions ?? {},
        getSelectedGroup: deps.getSelectedGroup ?? (() => null),

        // --- macro engine and extension-prompt core ------------------------
        substituteParams: deps.substituteParams,
        substituteParamsExtended: deps.substituteParamsExtended,
        getExtensionPrompt: deps.getExtensionPrompt,
        getExtensionPromptMaxDepth: deps.getExtensionPromptMaxDepth ?? (() => 0),

        // --- helpers that stayed in openai.js on the browser side ----------
        formatWorldInfo: deps.formatWorldInfo ?? (value => (value === undefined || value === null ? '' : String(value))),
        getPromptPosition: deps.getPromptPosition ?? (() => 0),
        getPromptRole: deps.getPromptRole ?? (() => 0),

        // Extension prompt types are re-exported so callers need not import enums.
        extensionPromptTypes: EXTENSION_PROMPT_TYPES,
    };
}
