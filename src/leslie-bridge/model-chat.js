import fs from 'node:fs';
import path from 'node:path';

import { CHAT_COMPLETION_SOURCES, SETTINGS_FILE } from '../constants.js';
import { LeslieBridgeRequestError } from './errors.js';
import { LESLIE_BRIDGE_CHAT_MODEL } from './protocol.js';

const MODEL_FIELD_BY_SOURCE = Object.freeze({
    [CHAT_COMPLETION_SOURCES.AI21]: 'ai21_model',
    [CHAT_COMPLETION_SOURCES.AIMLAPI]: 'aimlapi_model',
    [CHAT_COMPLETION_SOURCES.AZURE_OPENAI]: 'azure_openai_model',
    [CHAT_COMPLETION_SOURCES.CHUTES]: 'chutes_model',
    [CHAT_COMPLETION_SOURCES.CLAUDE]: 'claude_model',
    [CHAT_COMPLETION_SOURCES.COHERE]: 'cohere_model',
    [CHAT_COMPLETION_SOURCES.COMETAPI]: 'cometapi_model',
    [CHAT_COMPLETION_SOURCES.CUSTOM]: 'custom_model',
    [CHAT_COMPLETION_SOURCES.DEEPSEEK]: 'deepseek_model',
    [CHAT_COMPLETION_SOURCES.ELECTRONHUB]: 'electronhub_model',
    [CHAT_COMPLETION_SOURCES.FIREWORKS]: 'fireworks_model',
    [CHAT_COMPLETION_SOURCES.GROQ]: 'groq_model',
    [CHAT_COMPLETION_SOURCES.MAKERSUITE]: 'google_model',
    [CHAT_COMPLETION_SOURCES.MINIMAX]: 'minimax_model',
    [CHAT_COMPLETION_SOURCES.MISTRALAI]: 'mistralai_model',
    [CHAT_COMPLETION_SOURCES.MOONSHOT]: 'moonshot_model',
    [CHAT_COMPLETION_SOURCES.NANOGPT]: 'nanogpt_model',
    [CHAT_COMPLETION_SOURCES.OPENAI]: 'openai_model',
    [CHAT_COMPLETION_SOURCES.OPENROUTER]: 'openrouter_model',
    [CHAT_COMPLETION_SOURCES.PERPLEXITY]: 'perplexity_model',
    [CHAT_COMPLETION_SOURCES.POLLINATIONS]: 'pollinations_model',
    [CHAT_COMPLETION_SOURCES.SILICONFLOW]: 'siliconflow_model',
    [CHAT_COMPLETION_SOURCES.VERTEXAI]: 'vertexai_model',
    [CHAT_COMPLETION_SOURCES.WORKERS_AI]: 'workers_ai_model',
    [CHAT_COMPLETION_SOURCES.XAI]: 'xai_model',
    [CHAT_COMPLETION_SOURCES.ZAI]: 'zai_model',
});

const SETTINGS_FIELDS = Object.freeze([
    'assistant_prefill',
    'azure_api_version',
    'azure_base_url',
    'azure_deployment_name',
    'custom_exclude_body',
    'custom_include_body',
    'custom_include_headers',
    'custom_prompt_post_processing',
    'minimax_endpoint',
    'nanogpt_payg_override',
    'nanogpt_provider',
    'proxy_password',
    'reverse_proxy',
    'siliconflow_endpoint',
    'use_sysprompt',
    'vertexai_auth_mode',
    'vertexai_express_project_id',
    'vertexai_region',
    'workers_ai_account_id',
    'zai_endpoint',
]);

function optionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * Read the selected Chat Completions connection without returning a secret.
 * @param {Record<string, unknown>} settings Saved SillyTavern settings.
 * @returns {{model: string, source: string, settings: Record<string, unknown>}} Chat connection.
 */
export function getLeslieBridgeChatConfigurationFromSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new LeslieBridgeRequestError('CHAT_SETTINGS_UNAVAILABLE', 'Leslie Tavern chat settings are not available.', 409);
    }
    if (settings.main_api && settings.main_api !== 'openai') {
        throw new LeslieBridgeRequestError(
            'CHAT_SOURCE_NOT_SUPPORTED',
            'Select a Chat Completions provider in Leslie Tavern before using the Leslie Bridge chat gateway.',
            409,
        );
    }

    const chatSettings = settings.oai_settings && typeof settings.oai_settings === 'object'
        ? settings.oai_settings
        : settings;
    const source = optionalString(chatSettings.chat_completion_source);
    const modelField = MODEL_FIELD_BY_SOURCE[source];
    const model = optionalString(modelField ? chatSettings[modelField] : '');
    if (!source || !modelField || !model) {
        throw new LeslieBridgeRequestError(
            'CHAT_MODEL_NOT_CONFIGURED',
            'Select a Chat Completions provider and model in Leslie Tavern before using the Leslie Bridge chat gateway.',
            409,
        );
    }

    return { model, source, settings: chatSettings };
}

/**
 * Read the selected Chat Completions connection for the active user.
 * @param {{root: string}} userDirectories Active user directories.
 * @returns {{model: string, source: string, settings: Record<string, unknown>}} Chat connection.
 */
export function getLeslieBridgeChatConfiguration(userDirectories) {
    try {
        const settingsPath = path.join(userDirectories.root, SETTINGS_FILE);
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return getLeslieBridgeChatConfigurationFromSettings(settings);
    } catch (error) {
        if (error instanceof LeslieBridgeRequestError) {
            throw error;
        }
        throw new LeslieBridgeRequestError('CHAT_SETTINGS_UNAVAILABLE', 'Leslie Tavern chat settings are not available.', 409);
    }
}

/**
 * Convert one OpenAI request into the existing SillyTavern model-proxy request.
 * The API client owns the messages in this gateway mode. This function does not
 * build a SillyTavern character prompt and does not save a SillyTavern chat.
 * @param {Record<string, unknown>} body OpenAI-compatible request.
 * @param {{model: string, source: string, settings: Record<string, unknown>}} configuration Chat connection.
 * @returns {Record<string, unknown>} SillyTavern Chat Completions request.
 */
export function toSillyTavernChatCompletionRequest(body, configuration) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new LeslieBridgeRequestError('CHAT_REQUEST_INVALID', 'The chat request must be a JSON object.');
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 500) {
        throw new LeslieBridgeRequestError('CHAT_MESSAGES_INVALID', 'messages must contain between 1 and 500 entries.');
    }
    if (body.messages.some(message => !message || typeof message !== 'object' || Array.isArray(message))) {
        throw new LeslieBridgeRequestError('CHAT_MESSAGES_INVALID', 'Each messages entry must be a JSON object.');
    }

    const requestedModel = optionalString(body.model);
    if (requestedModel && ![LESLIE_BRIDGE_CHAT_MODEL, configuration.model].includes(requestedModel)) {
        throw new LeslieBridgeRequestError('CHAT_MODEL_NOT_SUPPORTED', `Unsupported chat model: ${requestedModel}.`);
    }

    const settings = configuration.settings;
    const request = {
        messages: body.messages,
        model: configuration.model,
        temperature: finiteNumber(body.temperature, finiteNumber(settings.temp_openai, 1)),
        frequency_penalty: finiteNumber(body.frequency_penalty, finiteNumber(settings.freq_pen_openai, 0)),
        presence_penalty: finiteNumber(body.presence_penalty, finiteNumber(settings.pres_pen_openai, 0)),
        top_p: finiteNumber(body.top_p, finiteNumber(settings.top_p_openai, 1)),
        top_k: finiteNumber(body.top_k, finiteNumber(settings.top_k_openai, undefined)),
        min_p: finiteNumber(body.min_p, finiteNumber(settings.min_p_openai, undefined)),
        repetition_penalty: finiteNumber(body.repetition_penalty, finiteNumber(settings.repetition_penalty_openai, undefined)),
        max_tokens: finiteNumber(body.max_tokens, finiteNumber(settings.openai_max_tokens, 300)),
        max_completion_tokens: finiteNumber(body.max_completion_tokens, undefined),
        stream: body.stream !== false,
        stop: Array.isArray(body.stop) ? body.stop : undefined,
        seed: finiteNumber(body.seed, finiteNumber(settings.seed, undefined)),
        tools: Array.isArray(body.tools) ? body.tools : undefined,
        tool_choice: body.tool_choice,
        chat_completion_source: configuration.source,
        include_reasoning: Boolean(settings.show_thoughts),
        reasoning_effort: optionalString(body.reasoning_effort) || optionalString(settings.reasoning_effort) || undefined,
        verbosity: optionalString(body.verbosity) || optionalString(settings.verbosity) || undefined,
        enable_web_search: Boolean(settings.enable_web_search),
    };

    for (const field of SETTINGS_FIELDS) {
        if (settings[field] !== undefined) {
            request[field] = settings[field];
        }
    }

    request.use_fallback = settings.openrouter_use_fallback;
    request.provider = settings.openrouter_providers;
    request.quantizations = settings.openrouter_quantizations;
    request.allow_fallbacks = settings.openrouter_allow_fallbacks;
    request.middleout = settings.openrouter_middleout;
    return request;
}
