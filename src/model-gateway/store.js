/**
 * Server-managed model gateway — authoritative configuration store.
 *
 * The Web and mobile clients no longer carry provider keys/endpoints. The administrator
 * configures providers and a model catalog here (under the server data root, not per
 * account); clients pick a `model_id` from `listAvailableModels()` and the adapter resolves
 * it to a provider + api key + real model name via `resolveModelConfig`.
 *
 * Provider API keys are stored in the global secrets file through `SecretManager`; only a
 * key id is referenced here, never a plaintext value.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { SecretManager } from '../endpoints/secrets.js';
import { isServerMode } from '../runtime-mode.js';

export const MODEL_GATEWAY_FILE = 'model-gateway.json';
export const MODEL_GATEWAY_SCHEMA_VERSION = 1;

/**
 * Provider presets: picking one auto-fills the endpoint and auto-brings its models into
 * the catalog. `models` is empty for 火山引擎 (its model ids are per-account inference
 * endpoints) and 自定义 (both endpoint and models are entered by hand).
 */
export const PROVIDER_PRESETS = Object.freeze({
    openai: Object.freeze({ id: 'openai', name: 'OpenAI', source: 'openai', endpoint: 'https://api.openai.com/v1', models: Object.freeze(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1']) }),
    deepseek: Object.freeze({ id: 'deepseek', name: 'DeepSeek', source: 'deepseek', endpoint: 'https://api.deepseek.com/v1', models: Object.freeze(['deepseek-chat', 'deepseek-reasoner']) }),
    volcengine: Object.freeze({ id: 'volcengine', name: '火山引擎', source: 'custom', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', models: Object.freeze([]) }),
    custom: Object.freeze({ id: 'custom', name: '自定义', source: 'custom', endpoint: '', models: Object.freeze([]) }),
});

/**
 * The provider presets, with mutable arrays for the caller.
 * @returns {{id: string, name: string, source: string, endpoint: string, models: string[]}[]} Presets.
 */
export function listProviderPresets() {
    return Object.values(PROVIDER_PRESETS).map(preset => ({
        id: preset.id,
        name: preset.name,
        source: preset.source,
        endpoint: preset.endpoint,
        models: [...preset.models],
    }));
}

/**
 * Look up one provider preset by id.
 * @param {string} id Preset id.
 * @returns {{id: string, name: string, source: string, endpoint: string, models: string[]} | null} Preset or null.
 */
export function getProviderPreset(id) {
    const preset = PROVIDER_PRESETS[id];
    if (!preset) return null;
    return { id: preset.id, name: preset.name, source: preset.source, endpoint: preset.endpoint, models: [...preset.models] };
}

/** Global secrets manager (server-scoped, not per account). */
function globalSecretManager() {
    const root = String(globalThis.DATA_ROOT ?? '');
    return new SecretManager({
        root,
        backups: path.join(root, 'backups'),
        characters: '',
        chats: '',
        groups: '',
        groupChats: '',
        worlds: '',
        avatars: '',
        user: '',
        vectors: '',
    });
}

/** @returns {string} Absolute path of the gateway config file. */
export function modelGatewayFilePath() {
    return path.join(String(globalThis.DATA_ROOT ?? ''), MODEL_GATEWAY_FILE);
}

/** @returns {object} The default (empty) gateway document. */
export function createDefaultGateway() {
    return { schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION, providers: [], models: [] };
}

/**
 * Read the gateway document, creating an empty one on first use.
 * @param {object} [fsImpl] Node fs module (injectable for tests).
 * @returns {{schemaVersion: number, providers: object[], models: object[]}} Gateway config.
 */
export function readModelGateway(fsImpl = fs) {
    const file = modelGatewayFilePath();
    try {
        const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
        return {
            schemaVersion: Number(parsed.schemaVersion ?? MODEL_GATEWAY_SCHEMA_VERSION),
            providers: Array.isArray(parsed.providers) ? parsed.providers : [],
            models: Array.isArray(parsed.models) ? parsed.models : [],
        };
    } catch {
        return createDefaultGateway();
    }
}

/**
 * Persist the gateway document atomically.
 * @param {object} config Gateway config.
 * @param {object} [fsImpl] Node fs module.
 * @returns {object} The saved config.
 */
export function writeModelGateway(config, fsImpl = fs) {
    const file = modelGatewayFilePath();
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomicSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return config;
}

/**
 * Read the active gateway config for server-side use.
 * @returns {{schemaVersion: number, providers: object[], models: object[]}} Gateway config.
 */
export function getServerModelGateway() {
    return readModelGateway();
}

/** @returns {object[]} Providers, with secret references left as key ids (no plaintext). */
export function listProviders() {
    return readModelGateway().providers;
}

/**
 * Mask a secret for display: keep the first 4 and last 4 characters.
 * @param {string} value Plaintext secret.
 * @returns {string} Masked preview, or '' when empty.
 */
export function maskSecret(value) {
    const v = String(value ?? '');
    if (!v) return '';
    if (v.length <= 8) return '••••••••';
    return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/**
 * Describe one provider for the ops panel: secret kept out, only a masked preview and
 * a configured flag are exposed.
 * @param {object} provider Provider entry.
 * @returns {object} Provider with `apiKeyPreview` / `apiKeyConfigured` added.
 */
export function describeProvider(provider) {
    const apiKey = provider?.apiKeySecretId ? globalSecretManager().readSecret(provider.apiKeySecretId) : '';
    return {
        id: String(provider?.id ?? ''),
        name: String(provider?.name ?? provider?.id ?? ''),
        source: String(provider?.source ?? 'custom'),
        endpoint: String(provider?.endpoint ?? ''),
        apiKeySecretId: String(provider?.apiKeySecretId ?? ''),
        enabled: provider?.enabled !== false,
        apiKeyPreview: maskSecret(apiKey),
        apiKeyConfigured: Boolean(apiKey),
    };
}

/**
 * Providers for the ops panel, with secrets masked.
 * @returns {object[]} Masked provider list.
 */
export function listProvidersMasked() {
    return listProviders().map(describeProvider);
}

/** @param {string} id Provider id. @returns {object | undefined} Provider entry. */
export function getProviderById(id) {
    return readModelGateway().providers.find(provider => provider.id === id);
}

/** @returns {object[]} All models (admin view), including disabled ones. */
export function listAllModels() {
    return readModelGateway().models;
}

/**
 * The client-visible model catalog: only id/name/enabled, no provider details or secrets.
 * @returns {{id: string, name: string, enabled: boolean}[]} Enabled models.
 */
export function listAvailableModels() {
    const gateway = readModelGateway();
    return gateway.models
        .filter(model => model.enabled !== false && gateway.providers.some(provider => provider.id === model.provider && provider.enabled !== false))
        .map(model => ({ id: String(model.id), name: String(model.name ?? model.id), enabled: true }));
}

/**
 * Look up one model entry by id.
 * @param {string} id Model id.
 * @returns {object | undefined} Full model entry.
 */
export function getModelById(id) {
    return readModelGateway().models.find(model => model.id === id);
}

/**
 * The server's default model id: the first enabled catalog model, used when a client
 * does not send an explicit model_id.
 * @returns {string | null} Default model id, or null when the catalog has no enabled model.
 */
export function getDefaultModelId() {
    const entry = listAvailableModels()[0];
    return entry ? String(entry.id) : null;
}

/**
 * Resolve a Web request against the catalog; only desktop mode may use personal APIs.
 * @param {string | undefined} modelId Requested catalog id.
 * @returns {ReturnType<typeof resolveModelConfig> | null} Gateway configuration.
 */
export function resolveWebModelConfig(modelId) {
    const effectiveId = modelId || getDefaultModelId();
    if (effectiveId) return resolveModelConfig(effectiveId);
    if (isServerMode()) throw new Error('管理员尚未配置可用模型，请联系管理员。');
    return null;
}

/**
 * Resolve a catalog model id to a concrete provider + api key + real model name.
 * @param {string} modelId Model id.
 * @returns {{source: string, model: string, endpoint: string, apiKey: string, params: object, providerId: string}}
 * @throws {Error} When the model or provider is missing/disabled.
 */
export function resolveModelConfig(modelId) {
    const model = getModelById(modelId);
    if (!model) {
        throw new Error(`Model "${modelId}" is not in the server model catalog.`);
    }
    if (model.enabled === false) {
        throw new Error(`Model "${modelId}" is disabled.`);
    }
    const provider = getProviderById(model.provider);
    if (!provider) {
        throw new Error(`Provider "${model.provider}" for model "${modelId}" does not exist.`);
    }
    if (provider.enabled === false) {
        throw new Error(`Provider "${model.provider}" is disabled.`);
    }
    let apiKey = '';
    if (provider.apiKeySecretId) {
        apiKey = globalSecretManager().readSecret(provider.apiKeySecretId);
    }
    return {
        source: String(provider.source ?? provider.id ?? 'custom'),
        model: String(model.apiModel ?? model.id),
        endpoint: String(provider.endpoint ?? ''),
        apiKey,
        params: model.params && typeof model.params === 'object' ? model.params : {},
        providerId: String(provider.id),
    };
}

/**
 * Replace the whole gateway document (admin write).
 * @param {object} config Gateway config.
 * @returns {object} The saved config.
 */
export function saveServerModelGateway(config) {
    const normalized = {
        schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
        providers: Array.isArray(config?.providers) ? config.providers : [],
        models: Array.isArray(config?.models) ? config.models : [],
    };
    return writeModelGateway(normalized);
}

/**
 * Add or replace a provider. When `apiKey` is provided, it is written to the global
 * secrets file and only its key id is stored on the provider.
 * @param {object} provider Provider input (id, name, source, endpoint, enabled, apiKey?).
 * @returns {object} The saved provider (no plaintext key).
 */
export function upsertProvider(provider) {
    const config = readModelGateway();
    const id = String(provider.id ?? '').trim();
    if (!id) {
        throw new Error('A provider id is required.');
    }
    const secretId = provider.apiKeySecretId ?? `provider:${id}`;
    if (typeof provider.apiKey === 'string' && provider.apiKey.length > 0) {
        globalSecretManager().writeSecret(secretId, provider.apiKey, String(provider.name ?? id));
    }
    const existing = config.providers.findIndex(entry => entry.id === id);
    const next = {
        id,
        name: String(provider.name ?? id),
        source: String(provider.source ?? 'custom'),
        endpoint: String(provider.endpoint ?? ''),
        apiKeySecretId: secretId,
        enabled: provider.enabled !== false,
    };
    if (existing === -1) {
        config.providers.push(next);
    } else {
        config.providers[existing] = { ...config.providers[existing], ...next };
    }
    writeModelGateway(config);
    return next;
}

/**
 * Remove a provider and, when `alsoDeleteSecret` is true, its stored API key.
 * @param {string} id Provider id.
 * @param {boolean} [alsoDeleteSecret] Delete the referenced secret too.
 * @returns {{deleted: boolean}} Result.
 */
export function deleteProvider(id, alsoDeleteSecret = false) {
    const config = readModelGateway();
    const index = config.providers.findIndex(entry => entry.id === id);
    if (index === -1) {
        return { deleted: false };
    }
    const [removed] = config.providers.splice(index, 1);
    if (alsoDeleteSecret && removed?.apiKeySecretId) {
        globalSecretManager().deleteSecret(removed.apiKeySecretId, null);
    }
    // Drop models that referenced the removed provider.
    config.models = config.models.filter(model => model.provider !== id);
    writeModelGateway(config);
    return { deleted: true };
}

/**
 * Add or replace a model in the catalog.
 * @param {object} model Model input (id, name, provider, apiModel, enabled, params).
 * @returns {object} The saved model.
 */
export function upsertModel(model) {
    const config = readModelGateway();
    const id = String(model.id ?? '').trim();
    if (!id) {
        throw new Error('A model id is required.');
    }
    const provider = getProviderById(model.provider);
    if (!provider) {
        throw new Error(`Provider "${model.provider}" does not exist.`);
    }
    const next = {
        id,
        name: String(model.name ?? id),
        provider: String(model.provider),
        apiModel: String(model.apiModel ?? id),
        enabled: model.enabled !== false,
        params: model.params && typeof model.params === 'object' ? model.params : {},
    };
    const existing = config.models.findIndex(entry => entry.id === id);
    if (existing === -1) {
        config.models.push(next);
    } else {
        config.models[existing] = next;
    }
    writeModelGateway(config);
    return next;
}

/**
 * Remove a model from the catalog.
 * @param {string} id Model id.
 * @returns {{deleted: boolean}} Result.
 */
export function deleteModel(id) {
    const config = readModelGateway();
    const index = config.models.findIndex(entry => entry.id === id);
    if (index === -1) {
        return { deleted: false };
    }
    config.models.splice(index, 1);
    writeModelGateway(config);
    return { deleted: true };
}
