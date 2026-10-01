import fs from 'node:fs';
import path from 'node:path';

import { SETTINGS_FILE } from '../constants.js';

const PROVIDERS = Object.freeze({
    deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/beta/chat/completions', secret: 'api_key_deepseek', modelField: 'deepseek_model', format: 'deepseek' },
    openai: { label: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', secret: 'api_key_openai', modelField: 'openai_model', format: 'openai' },
    openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', secret: 'api_key_openrouter', modelField: 'openrouter_model', format: 'openai' },
    claude: { label: 'Claude', url: 'https://api.anthropic.com/v1/messages', secret: 'api_key_claude', modelField: 'claude_model', format: 'claude' },
    makersuite: { label: 'Google AI Studio', secret: 'api_key_makersuite', modelField: 'google_model', format: 'gemini' },
});

function validModel(value) {
    const model = String(value ?? '').trim();
    return model && model.length <= 150 && !/[\r\n\x00-\x1f]/.test(model) && model !== 'OR_Website' ? model : '';
}

export async function getConfiguredMomentsOnlineModels({ directories, settings, readSecretImpl }) {
    let savedSettings = settings;
    if (!savedSettings) {
        try {
            savedSettings = JSON.parse(fs.readFileSync(path.join(directories.root, SETTINGS_FILE), 'utf8'));
        } catch {
            return [];
        }
    }
    const chatSettings = savedSettings?.oai_settings ?? savedSettings;
    const readSavedSecret = readSecretImpl ?? (await import('../endpoints/secrets.js')).readSecret;
    const available = [];
    for (const [providerId, provider] of Object.entries(PROVIDERS)) {
        const model = validModel(chatSettings?.[provider.modelField]);
        if (!model) continue;
        try {
            if (readSavedSecret(directories, provider.secret)) {
                available.push({ provider: providerId, model, label: provider.label });
            }
        } catch {
            // A locked or unreadable key is not a configured API choice.
        }
    }
    return available;
}

export class MomentsOnlineModelError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export function validateMomentsGeneration(value) {
    const systemPrompt = String(value?.systemPrompt ?? '');
    const prompt = String(value?.prompt ?? '');
    const responseLength = Number(value?.responseLength ?? 500);
    if (!systemPrompt.trim() || !prompt.trim() || systemPrompt.length > 8000 || prompt.length > 30000
        || !Number.isInteger(responseLength) || responseLength < 1 || responseLength > 1200) {
        throw new MomentsOnlineModelError('INVALID_INPUT', '朋友圈模型请求内容或长度无效。');
    }
    return { systemPrompt, prompt, responseLength };
}

export async function generateMomentsOnline({ directories, onlineModel, input, signal, fetchImpl = fetch, readSecretImpl }) {
    const provider = PROVIDERS[onlineModel?.provider];
    const model = validModel(onlineModel?.model);
    if (!provider || !model) {
        throw new MomentsOnlineModelError('MODEL_NOT_CONFIGURED', '请先在朋友圈权限中选择联网 API 和模型。');
    }
    const readSavedSecret = readSecretImpl ?? (await import('../endpoints/secrets.js')).readSecret;
    const key = readSavedSecret(directories, provider.secret);
    if (!key) {
        throw new MomentsOnlineModelError('MODEL_NOT_CONFIGURED', '所选联网 API 尚未保存密钥，请先到模型连接中配置。');
    }
    const { systemPrompt, prompt, responseLength } = validateMomentsGeneration(input);
    const system = `${systemPrompt}\n只返回一个有效的 JSON 对象。`;
    const request = provider.format === 'claude'
        ? {
            url: provider.url,
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: { model, system, messages: [{ role: 'user', content: prompt }], max_tokens: responseLength, stream: false },
        }
        : provider.format === 'gemini'
            ? {
                url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: responseLength } },
            }
            : {
                url: provider.url,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: {
                    model,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
                    max_tokens: responseLength,
                    stream: false,
                    ...(provider.format === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
                },
            };
    let response;
    try {
        response = await fetchImpl(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(45000)]),
        });
    } catch {
        throw new MomentsOnlineModelError('MODEL_UNAVAILABLE', '朋友圈联网 API 请求超时或连接失败。');
    }
    if (!response.ok) {
        throw new MomentsOnlineModelError('MODEL_UNAVAILABLE', `朋友圈联网 API 返回 ${response.status}；请检查模型和密钥。`);
    }
    const data = await response.json().catch(() => null);
    const content = provider.format === 'claude'
        ? data?.content?.filter(block => block?.type === 'text').map(block => block.text).join('')
        : provider.format === 'gemini'
            ? data?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('')
            : data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim() || content.length > 20000) {
        throw new MomentsOnlineModelError('MODEL_UNAVAILABLE', '朋友圈联网 API 没有返回有效内容。');
    }
    return content;
}
