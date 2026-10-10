/**
 * `/api/v1/ops/*` — operations dashboard for administrators.
 *
 * Every route here is guarded by `requireOpsAdmin` (mounted in router.js) and reports
 * server-level telemetry, per-account storage, the chat gateway configuration and the
 * in-memory rate-limit state. Secret values are never returned: the gateway report uses
 * the same masked preview the secret API exposes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import storage from 'node-persist';

import { CHAT_COMPLETION_SOURCES } from '../../constants.js';
import { SECRET_KEYS } from '../../endpoints/secrets.js';
import { getRuntimeMode } from '../../runtime-mode.js';
import { getAllUserHandles, getUserDirectories, toKey } from '../../users.js';
import { listSecretIds } from '../secrets.js';
import { asyncRoute } from '../errors.js';

/** Chat-completion source → secret slot holding that provider's API key. */
const CHAT_SOURCE_SECRET_KEY = Object.freeze({
    [CHAT_COMPLETION_SOURCES.OPENAI]: SECRET_KEYS.OPENAI,
    [CHAT_COMPLETION_SOURCES.CLAUDE]: SECRET_KEYS.CLAUDE,
    [CHAT_COMPLETION_SOURCES.OPENROUTER]: SECRET_KEYS.OPENROUTER,
    [CHAT_COMPLETION_SOURCES.AI21]: SECRET_KEYS.AI21,
    [CHAT_COMPLETION_SOURCES.MAKERSUITE]: SECRET_KEYS.MAKERSUITE,
    [CHAT_COMPLETION_SOURCES.VERTEXAI]: SECRET_KEYS.VERTEXAI,
    [CHAT_COMPLETION_SOURCES.MISTRALAI]: SECRET_KEYS.MISTRALAI,
    [CHAT_COMPLETION_SOURCES.CUSTOM]: SECRET_KEYS.CUSTOM,
    [CHAT_COMPLETION_SOURCES.COHERE]: SECRET_KEYS.COHERE,
    [CHAT_COMPLETION_SOURCES.PERPLEXITY]: SECRET_KEYS.PERPLEXITY,
    [CHAT_COMPLETION_SOURCES.GROQ]: SECRET_KEYS.GROQ,
    [CHAT_COMPLETION_SOURCES.CHUTES]: SECRET_KEYS.CHUTES,
    [CHAT_COMPLETION_SOURCES.ELECTRONHUB]: SECRET_KEYS.ELECTRONHUB,
    [CHAT_COMPLETION_SOURCES.NANOGPT]: SECRET_KEYS.NANOGPT,
    [CHAT_COMPLETION_SOURCES.DEEPSEEK]: SECRET_KEYS.DEEPSEEK,
    [CHAT_COMPLETION_SOURCES.AIMLAPI]: SECRET_KEYS.AIMLAPI,
    [CHAT_COMPLETION_SOURCES.XAI]: SECRET_KEYS.XAI,
    [CHAT_COMPLETION_SOURCES.POLLINATIONS]: SECRET_KEYS.POLLINATIONS,
    [CHAT_COMPLETION_SOURCES.MOONSHOT]: SECRET_KEYS.MOONSHOT,
    [CHAT_COMPLETION_SOURCES.FIREWORKS]: SECRET_KEYS.FIREWORKS,
    [CHAT_COMPLETION_SOURCES.COMETAPI]: SECRET_KEYS.COMETAPI,
    [CHAT_COMPLETION_SOURCES.AZURE_OPENAI]: SECRET_KEYS.AZURE_OPENAI,
    [CHAT_COMPLETION_SOURCES.ZAI]: SECRET_KEYS.ZAI,
    [CHAT_COMPLETION_SOURCES.SILICONFLOW]: SECRET_KEYS.SILICONFLOW,
    [CHAT_COMPLETION_SOURCES.MINIMAX]: SECRET_KEYS.MINIMAX,
    [CHAT_COMPLETION_SOURCES.WORKERS_AI]: SECRET_KEYS.WORKERS_AI,
});

/** Model field per source, mirroring src/leslie-bridge/model-chat.js. */
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

/**
 * Recursively sum the byte size of a directory tree.
 * @param {string} directory Directory to measure.
 * @param {object} [fsImpl] Node fs module (injectable for tests).
 * @returns {number} Total bytes, or 0 when the directory is missing/unreadable.
 */
export function duDirectory(directory, fsImpl = fs) {
    let total = 0;
    let entries;
    try {
        entries = fsImpl.readdirSync(directory, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        try {
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                total += duDirectory(full, fsImpl);
            } else if (entry.isFile()) {
                total += fsImpl.statSync(full).size;
            }
        } catch {
            // A file that disappeared mid-walk contributes nothing.
        }
    }
    return total;
}

/**
 * Read the disk usage of the volume holding the data root.
 * @param {string} dataRoot Data root directory.
 * @param {object} [fsImpl] Node fs module.
 * @returns {{total: number, free: number, available: number, dataRoot: string}} Bytes.
 */
export function readDiskUsage(dataRoot, fsImpl = fs) {
    try {
        const stats = fsImpl.statfsSync(dataRoot);
        const bsize = Number(stats.bsize) || 0;
        return {
            total: Number(stats.blocks) * bsize,
            free: Number(stats.bfree) * bsize,
            available: Number(stats.bavail) * bsize,
            dataRoot,
        };
    } catch {
        return { total: 0, free: 0, available: 0, dataRoot };
    }
}

/**
 * Read the saved settings object for a user, or null.
 * @param {string} rootDir User root directory.
 * @param {object} [fsImpl] Node fs module.
 * @returns {Record<string, unknown> | null} Settings, or null.
 */
function readSettings(rootDir, fsImpl = fs) {
    try {
        return JSON.parse(fsImpl.readFileSync(path.join(rootDir, 'settings.json'), 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Build the operations router.
 * @param {object} [options] Options.
 * @param {import('rate-limiter-flexible').RateLimiterMemory} [options.accountLimiter] The per-account quota limiter, for reading current usage.
 * @returns {import('express').Router} Configured router.
 */
export function createOpsRouter({ accountLimiter } = {}) {
    const opsRouter = express.Router();

    opsRouter.get('/status', asyncRoute(async (request, response) => {
        const processMemory = process.memoryUsage();
        const dataRoot = String(globalThis.DATA_ROOT ?? request.user?.directories?.root ?? '');
        response.send({
            uptime_seconds: Math.floor(process.uptime()),
            node_version: process.version,
            mode: getRuntimeMode(),
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                process: {
                    rss: processMemory.rss,
                    heap_total: processMemory.heapTotal,
                    heap_used: processMemory.heapUsed,
                    external: processMemory.external,
                },
            },
            cpu: {
                loadavg: os.loadavg(),
                cores: os.cpus().length,
            },
            disk: readDiskUsage(dataRoot),
        });
    }, 'Reading server status failed.'));

    opsRouter.get('/users', asyncRoute(async (_request, response) => {
        const handles = await getAllUserHandles();
        const users = [];
        for (const handle of handles) {
            const profile = await storage.getItem(toKey(handle));
            const directories = getUserDirectories(handle);
            users.push({
                handle,
                admin: Boolean(profile?.admin),
                enabled: profile?.enabled !== false,
                storage_bytes: duDirectory(directories.root),
            });
        }
        users.sort((left, right) => left.handle.localeCompare(right.handle));
        response.send({ users });
    }, 'Reading the account list failed.'));

    opsRouter.get('/gateway', asyncRoute(async (request, response) => {
        const settings = readSettings(request.user.directories.root);
        const oaiSettings = settings?.oai_settings && typeof settings.oai_settings === 'object'
            ? settings.oai_settings
            : {};
        const source = String(oaiSettings.chat_completion_source ?? '');
        const modelField = MODEL_FIELD_BY_SOURCE[source];
        const model = modelField ? String(oaiSettings[modelField] ?? '') : '';

        // The secret preview is already masked by SecretManager; only configured/masked
        // status is exposed, never plaintext.
        const secretSlots = new Map(listSecretIds(request.user.directories).map(entry => [entry.key_id, entry]));
        const providers = Object.entries(CHAT_SOURCE_SECRET_KEY).map(([providerSource, keyId]) => {
            const slot = secretSlots.get(keyId);
            return {
                source: providerSource,
                key_id: keyId,
                configured: Boolean(slot?.configured),
                preview: slot?.preview ?? null,
                secret_source: slot?.source ?? null,
                active: providerSource === source,
            };
        });

        response.send({
            main_api: String(settings?.main_api ?? 'openai'),
            source: source || null,
            model: model || null,
            providers,
        });
    }, 'Reading the gateway configuration failed.'));

    opsRouter.get('/rate-limits', asyncRoute(async (_request, response) => {
        // The account limiter is injected from createApiV1Router so this can read current
        // usage without consuming quota.
        if (!accountLimiter) {
            response.send({ limit: 0, accounts: [] });
            return;
        }
        const handles = await getAllUserHandles();
        const accounts = [];
        for (const handle of handles) {
            const state = await accountLimiter.get(handle);
            accounts.push({
                handle,
                used: Number(state?.consumedPoints ?? 0),
                remaining: Number(state?.remainingPoints ?? accountLimiter.points ?? 0),
                reset_in_ms: Number(state?.msBeforeNext ?? 0),
            });
        }
        accounts.sort((left, right) => left.handle.localeCompare(right.handle));
        response.send({
            limit: Number(accountLimiter.points ?? 0),
            window_seconds: 60,
            accounts,
        });
    }, 'Reading rate-limit usage failed.'));

    return opsRouter;
}

export const opsRouter = createOpsRouter();
