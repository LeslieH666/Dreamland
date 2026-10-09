import { LESLIE_LOCAL_MODEL, getLeslieLocalSettings, isLocalModelLoadingEnabled } from '../../leslie-local-model-core.js';

export const MEMORY_MODEL_PROVIDER = Object.freeze({
    CHAT: 'chat',
    LOCAL: 'local',
    DEEPSEEK: 'deepseek',
    OPENAI_COMPATIBLE: 'openai-compatible',
});

const DEFAULT_LOCAL_MODEL = `koboldcpp/${LESLIE_LOCAL_MODEL.modelFile.replace(/\.gguf$/i, '')}`;
const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const PROVIDERS = new Set(Object.values(MEMORY_MODEL_PROVIDER));

function trimTrailingSlash(value) {
    return String(value ?? '').trim().replace(/\/+$/, '');
}

function normalizeEndpoint(value) {
    return trimTrailingSlash(value)
        .replace(/\/(?:chat\/completions|models)$/i, '');
}

function cleanString(value, maximumLength) {
    return String(value ?? '').trim().slice(0, maximumLength);
}

function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function normalizeMemoryModelSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const local = getLeslieLocalSettings('koboldcpp');
    const provider = PROVIDERS.has(source.provider) ? source.provider : MEMORY_MODEL_PROVIDER.CHAT;
    const endpointFallback = provider === MEMORY_MODEL_PROVIDER.LOCAL
        ? local.endpoint
        : provider === MEMORY_MODEL_PROVIDER.DEEPSEEK
            ? DEEPSEEK_API_ENDPOINT
            : '';
    const modelFallback = provider === MEMORY_MODEL_PROVIDER.LOCAL
        ? DEFAULT_LOCAL_MODEL
        : provider === MEMORY_MODEL_PROVIDER.DEEPSEEK
            ? DEFAULT_DEEPSEEK_MODEL
            : '';
    return {
        provider,
        endpoint: normalizeEndpoint(source.endpoint || endpointFallback),
        model: cleanString(source.model || modelFallback, 500),
        apiKey: cleanString(source.apiKey, 1000),
        temperature: clampNumber(source.temperature, 0, 1, 0.2),
        responseTokens: Math.round(clampNumber(source.responseTokens, 256, 4096, 1400)),
    };
}

export function getMemoryModelLabel(settings) {
    const normalized = normalizeMemoryModelSettings(settings);
    if (normalized.provider === MEMORY_MODEL_PROVIDER.LOCAL) {
        return `本地模型 · ${normalized.model || LESLIE_LOCAL_MODEL.modelName}`;
    }
    if (normalized.provider === MEMORY_MODEL_PROVIDER.DEEPSEEK) {
        return `DeepSeek API · ${normalized.model || '未指定模型'}`;
    }
    if (normalized.provider === MEMORY_MODEL_PROVIDER.OPENAI_COMPATIBLE) {
        return `独立接口 · ${normalized.model || '未指定模型'}`;
    }
    return '跟随当前聊天 API';
}

export function getMemoryModelCompletionUrl(settings) {
    const endpoint = normalizeEndpoint(normalizeMemoryModelSettings(settings).endpoint);
    if (!endpoint) {
        throw new Error('记忆整理模型还没有填写接口地址。');
    }
    return `${endpoint}${/\/v1$/i.test(endpoint) ? '' : '/v1'}/chat/completions`;
}

export function getMemoryModelModelsUrl(settings) {
    const endpoint = normalizeEndpoint(normalizeMemoryModelSettings(settings).endpoint);
    if (!endpoint) {
        throw new Error('记忆整理模型还没有填写接口地址。');
    }
    return `${endpoint}${/\/v1$/i.test(endpoint) ? '' : '/v1'}/models`;
}

function toMessages(prompt, systemPrompt) {
    const messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: String(systemPrompt) });
    }
    if (Array.isArray(prompt)) {
        messages.push(...prompt.map(message => ({
            role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
            content: String(message?.content ?? ''),
        })));
    } else if (prompt !== undefined && prompt !== null) {
        messages.push({ role: 'user', content: String(prompt) });
    }
    return messages;
}

export function buildMemoryModelRequest({ prompt, systemPrompt, responseLength } = {}, settings) {
    const normalized = normalizeMemoryModelSettings(settings);
    const request = {
        model: normalized.model || 'local-model',
        messages: toMessages(prompt, systemPrompt),
        max_tokens: Math.round(clampNumber(responseLength ?? normalized.responseTokens, 256, 4096, normalized.responseTokens)),
        temperature: Math.min(0.35, normalized.temperature),
        top_p: 0.9,
        stream: false,
    };
    if (normalized.provider === MEMORY_MODEL_PROVIDER.DEEPSEEK) {
        request.thinking = { type: 'disabled' };
        request.response_format = { type: 'json_object' };
    }
    return request;
}

function getHeaders(settings) {
    const normalized = normalizeMemoryModelSettings(settings);
    return {
        'Content-Type': 'application/json',
        ...(normalized.apiKey ? { Authorization: `Bearer ${normalized.apiKey}` } : {}),
    };
}

function extractContent(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(item => extractContent(item)).filter(Boolean).join('');
    }
    if (value && typeof value === 'object') {
        return extractContent(value.text ?? value.content ?? value.value);
    }
    return '';
}

export function extractMemoryModelText(payload) {
    if (typeof payload === 'string') {
        return payload;
    }
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    const text = extractContent(choice?.message?.content)
        || extractContent(choice?.text)
        || extractContent(payload?.results?.[0])
        || extractContent(payload?.output)
        || extractContent(payload?.response)
        || extractContent(payload?.content);
    if (!text.trim()) {
        throw new Error('记忆整理模型没有返回文本结果。');
    }
    return text;
}

export async function probeMemoryModel({ settings, fetchImpl = globalThis.fetch, signal } = {}) {
    const normalized = normalizeMemoryModelSettings(settings);
    if (normalized.provider === MEMORY_MODEL_PROVIDER.CHAT) {
        return { connected: true, model: getMemoryModelLabel(normalized), provider: normalized.provider };
    }
    if (normalized.provider === MEMORY_MODEL_PROVIDER.LOCAL && !isLocalModelLoadingEnabled()) {
        throw new Error('本地模型加载已关闭，请先在“设置 → 模型连接”中打开。');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境不支持检测独立记忆整理模型。');
    }
    const response = await fetchImpl(getMemoryModelModelsUrl(normalized), {
        method: 'GET',
        headers: getHeaders(normalized),
        signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `记忆整理模型检测失败（${response.status}）`);
    }
    const model = payload?.data?.[0]?.id || payload?.models?.[0]?.id || normalized.model || '已连接';
    return { connected: true, model: String(model), provider: normalized.provider };
}

export async function generateMemoryModelResponse({ settings, request, generateChat, fetchImpl = globalThis.fetch, signal } = {}) {
    const normalized = normalizeMemoryModelSettings(settings);
    if (normalized.provider === MEMORY_MODEL_PROVIDER.CHAT) {
        if (typeof generateChat !== 'function') {
            throw new Error('当前聊天 API 生成器不可用。');
        }
        return generateChat(request);
    }
    if (normalized.provider === MEMORY_MODEL_PROVIDER.LOCAL && !isLocalModelLoadingEnabled()) {
        throw new Error('本地模型加载已关闭，请先在“设置 → 模型连接”中打开。');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境不支持调用独立记忆整理模型。');
    }
    const response = await fetchImpl(getMemoryModelCompletionUrl(normalized), {
        method: 'POST',
        headers: getHeaders(normalized),
        body: JSON.stringify(buildMemoryModelRequest(request, normalized)),
        signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `记忆整理模型请求失败（${response.status}）`);
    }
    return extractMemoryModelText(payload);
}
