/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- This is a jest suite driven over HTTP, not a Playwright spec. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { API_V1_ROOT } from '../src/api-v1/protocol.js';

/**
 * End-to-end test for the administrator operations dashboard.
 *
 * Boots the real `/api/v1` router on a listener and drives the ops endpoints over the
 * wire: unauthenticated → 401, non-admin → 403, admin → 200 with the expected shape.
 */

let configRoot;
let dataRoot;
let server;
let baseUrl;
let users;
let storage;
let toKey;

const ADMIN_HANDLE = 'ops-admin';
const USER_HANDLE = 'ops-user';
const PASSWORD = 'correct-horse-battery';

/** @param {string} url Absolute URL. @param {object} [body] JSON body. @param {string} [token] Bearer token. */
async function postJson(url, body, token) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
}

/** @param {string} path Path under /api/v1. @param {string} [token] Bearer token. */
async function getJson(path, token) {
    const response = await fetch(`${baseUrl}${API_V1_ROOT}${path}`, {
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
}

/** @param {string} path Path under /api/v1. @param {object} body JSON body. @param {string} [token] Bearer token. */
async function patchJson(path, body, token) {
    const response = await fetch(`${baseUrl}${API_V1_ROOT}${path}`, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
}

/** @param {string} path Path under /api/v1. @param {string} [token] Bearer token. */
async function deleteJson(path, token) {
    const response = await fetch(`${baseUrl}${API_V1_ROOT}${path}`, {
        method: 'DELETE',
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status };
}

beforeAll(async () => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ops-config-'));
    fs.writeFileSync(path.join(configRoot, 'config.yaml'), 'allowKeysExposure: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(path.join(configRoot, 'config.yaml'));

    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ops-data-'));
    globalThis.DATA_ROOT = dataRoot;
    globalThis.COMMAND_LINE_ARGS = { listen: false, basicAuthMode: false, mode: 'server' };

    users = await import('../src/users.js');
    await users.initUserStorage(dataRoot);
    storage = (await import('node-persist')).default;
    ({ toKey } = users);

    const express = (await import('express')).default;
    const bodyParser = (await import('body-parser')).default;
    const { createApiV1Router } = await import('../src/api-v1/router.js');

    const app = express();
    app.use(bodyParser.json({ limit: '10mb' }));
    app.use(API_V1_ROOT, createApiV1Router());

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 30_000);

afterAll(async () => {
    server?.closeAllConnections?.();
    await new Promise(resolve => server?.close(resolve));
    for (const dir of [dataRoot, configRoot]) {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('admin access token carries the admin claim', () => {
    test('sign/verify round-trips the admin flag', async () => {
        const { signAccessToken, verifyAccessToken } = await import('../src/api-v1/auth.js');
        const signed = signAccessToken({ handle: 'alice', accountVersion: 1, admin: true });
        expect(verifyAccessToken(signed.token).admin).toBe(true);
        const signedNonAdmin = signAccessToken({ handle: 'bob', accountVersion: 1, admin: false });
        expect(verifyAccessToken(signedNonAdmin.token).admin).toBe(false);
    });
});

describe('GET /api/v1/ops/* over a real listener', () => {
    test('rejects anonymous, non-admin and admin appropriately', async () => {
        // Register an admin and a normal user through the public API, then flip the
        // admin flag in the shared account store before minting tokens.
        for (const handle of [ADMIN_HANDLE, USER_HANDLE]) {
            const registered = await postJson(`${baseUrl}${API_V1_ROOT}/auth/register`, { handle, password: PASSWORD });
            expect([200, 201]).toContain(registered.status);
            users.ensureUserDirectoriesExist(users.getUserDirectories(handle));
        }
        const adminProfile = await storage.getItem(toKey(ADMIN_HANDLE));
        await storage.setItem(toKey(ADMIN_HANDLE), { ...adminProfile, admin: true });

        const adminToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: ADMIN_HANDLE, password: PASSWORD })).body?.access_token;
        const userToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: USER_HANDLE, password: PASSWORD })).body?.access_token;
        expect(typeof adminToken).toBe('string');
        expect(typeof userToken).toBe('string');

        // Anonymous → 401.
        const anonymous = await getJson('/ops/status');
        expect(anonymous.status).toBe(401);

        // Non-admin → 403.
        const nonAdmin = await getJson('/ops/status', userToken);
        expect(nonAdmin.status).toBe(403);

        // Admin → 200 with uptime/memory/cpu.
        const admin = await getJson('/ops/status', adminToken);
        expect(admin.status).toBe(200);
        expect(typeof admin.body.uptime_seconds).toBe('number');
        expect(typeof admin.body.memory?.total).toBe('number');
        expect(Array.isArray(admin.body.cpu?.loadavg)).toBe(true);
        expect(admin.body.mode).toBe('server');

        // /users returns both accounts with a numeric storage size.
        const usersResponse = await getJson('/ops/users', adminToken);
        expect(usersResponse.status).toBe(200);
        const handles = usersResponse.body.users.map(user => user.handle);
        expect(handles).toContain(ADMIN_HANDLE);
        expect(handles).toContain(USER_HANDLE);
        for (const user of usersResponse.body.users) {
            expect(typeof user.storage_bytes).toBe('number');
            expect(typeof user.admin).toBe('boolean');
        }

        // /gateway returns provider status with masked previews (never plaintext).
        const { setSecret } = await import('../src/api-v1/secrets.js');
        const { SECRET_KEYS } = await import('../src/endpoints/secrets.js');
        const plaintext = 'sk-ops-plaintext-must-not-leak';
        await setSecret(SECRET_KEYS.OPENAI, plaintext, 'ops-test');
        const gateway = await getJson('/ops/gateway', adminToken);
        expect(gateway.status).toBe(200);
        expect(gateway.body).toHaveProperty('source');
        expect(Array.isArray(gateway.body.providers)).toBe(true);
        const openai = gateway.body.providers.find(provider => provider.source === 'openai');
        expect(openai.configured).toBe(true);
        expect(openai.preview).toBeTruthy();
        expect(JSON.stringify(gateway.body)).not.toContain(plaintext);

        // /rate-limits returns the quota shape.
        const rateLimits = await getJson('/ops/rate-limits', adminToken);
        expect(rateLimits.status).toBe(200);
        expect(typeof rateLimits.body.limit).toBe('number');
        expect(Array.isArray(rateLimits.body.accounts)).toBe(true);
    }, 40_000);
});

describe('ops account management', () => {
    test('create, patch, reset password and read user data', async () => {
        const adminToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: ADMIN_HANDLE, password: PASSWORD })).body?.access_token;
        expect(typeof adminToken).toBe('string');

        // Create a new account (default non-admin).
        const created = await postJson(`${baseUrl}${API_V1_ROOT}/ops/users`, { handle: 'ops-new', password: 'new-password-123' }, adminToken);
        expect(created.status).toBe(201);
        expect(created.body.admin).toBe(false);
        expect(created.body.enabled).toBe(true);

        // The new account can log in.
        const newToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: 'ops-new', password: 'new-password-123' })).body?.access_token;
        expect(typeof newToken).toBe('string');

        // Patch admin (keep enabled true so the password-reset login still works).
        const patched = await patchJson('/ops/users/ops-new', { admin: true }, adminToken);
        expect(patched.status).toBe(200);
        expect(patched.body.admin).toBe(true);
        expect(patched.body.enabled).toBe(true);

        // Reset password: old password invalid, new works.
        const reset = await postJson(`${baseUrl}${API_V1_ROOT}/ops/users/ops-new/password`, { password: 'reset-password-456' }, adminToken);
        expect(reset.status).toBe(200);
        const oldLogin = await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: 'ops-new', password: 'new-password-123' });
        expect(oldLogin.status).toBe(401);
        const newLogin = await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: 'ops-new', password: 'reset-password-456' });
        expect(newLogin.status).toBe(200);

        // Patch enabled off; the account can no longer log in.
        const disabled = await patchJson('/ops/users/ops-new', { enabled: false }, adminToken);
        expect(disabled.status).toBe(200);
        expect(disabled.body.enabled).toBe(false);
        const disabledLogin = await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: 'ops-new', password: 'reset-password-456' });
        expect(disabledLogin.status).toBe(401);

        // Read user data (character/chats/moments/settings/storage).
        const data = await getJson('/ops/users/ops-new/data', adminToken);
        expect(data.status).toBe(200);
        expect(Array.isArray(data.body.characters)).toBe(true);
        expect(Array.isArray(data.body.chats)).toBe(true);
        expect(Array.isArray(data.body.group_chats)).toBe(true);
        expect(data.body.moments).toHaveProperty('count');
        expect(data.body.settings).toHaveProperty('present');
        expect(data.body.storage).toHaveProperty('total');
    }, 40_000);
});

describe('GET /api/v1/models', () => {
    test('returns the catalog without secrets and rejects anonymous access', async () => {
        const { upsertProvider, upsertModel } = await import('../src/model-gateway/store.js');
        upsertProvider({ id: 'model-p', name: 'P', source: 'custom', endpoint: 'http://127.0.0.1:1', apiKey: 'sk-secret-do-not-leak', enabled: true });
        upsertModel({ id: 'model-a', name: 'Model A', provider: 'model-p', apiModel: 'model-a', enabled: true });

        const anonymous = await getJson('/models');
        expect(anonymous.status).toBe(401);

        const userToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: USER_HANDLE, password: PASSWORD })).body?.access_token;
        const authed = await getJson('/models', userToken);
        expect(authed.status).toBe(200);
        expect(Array.isArray(authed.body.models)).toBe(true);
        expect(JSON.stringify(authed.body)).not.toContain('sk-secret-do-not-leak');
        const entry = authed.body.models.find(model => model.id === 'model-a');
        expect(entry).toEqual({ id: 'model-a', name: 'Model A', enabled: true });
    });
});

describe('ops model gateway', () => {
    test('lists provider presets with DeepSeek endpoint and models', async () => {
        const adminToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: ADMIN_HANDLE, password: PASSWORD })).body?.access_token;
        const presets = await getJson('/ops/model-gateway/presets', adminToken);
        expect(presets.status).toBe(200);
        expect(Array.isArray(presets.body.presets)).toBe(true);
        const deepseek = presets.body.presets.find(p => p.id === 'deepseek');
        expect(deepseek).toBeTruthy();
        expect(deepseek.endpoint).toBe('https://api.deepseek.com/v1');
        expect(deepseek.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
        expect(presets.body.presets.map(p => p.id)).toEqual(expect.arrayContaining(['openai', 'deepseek', 'volcengine', 'custom']));
    });

    test('creates providers/models, masks keys and resolves the config', async () => {
        const adminToken = (await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, { grant_type: 'password', handle: ADMIN_HANDLE, password: PASSWORD })).body?.access_token;
        expect(typeof adminToken).toBe('string');

        const provider = await postJson(`${baseUrl}${API_V1_ROOT}/ops/model-gateway/providers`, {
            id: 'mg-prov', name: 'MG Prov', source: 'custom', endpoint: 'http://127.0.0.1:1', apiKey: 'sk-mg-secret-key-1234', enabled: true,
        }, adminToken);
        expect(provider.status).toBe(201);

        const model = await postJson(`${baseUrl}${API_V1_ROOT}/ops/model-gateway/models`, {
            id: 'mg-model', name: 'MG Model', provider: 'mg-prov', apiModel: 'real-model', enabled: true, params: { temperature: 0.7, max_tokens: 500 },
        }, adminToken);
        expect(model.status).toBe(201);

        const gateway = await getJson('/ops/model-gateway', adminToken);
        expect(gateway.status).toBe(200);
        const listedProvider = gateway.body.providers.find(p => p.id === 'mg-prov');
        expect(listedProvider.apiKeyConfigured).toBe(true);
        expect(listedProvider.apiKeyPreview).toBeTruthy();
        expect(JSON.stringify(gateway.body)).not.toContain('sk-mg-secret-key-1234');
        expect(gateway.body.models.some(m => m.id === 'mg-model')).toBe(true);

        const { resolveModelConfig } = await import('../src/model-gateway/store.js');
        expect(resolveModelConfig('mg-model').apiKey).toBe('sk-mg-secret-key-1234');
        expect(resolveModelConfig('mg-model').model).toBe('real-model');
        expect(resolveModelConfig('mg-model').params.temperature).toBe(0.7);

        const delModel = await deleteJson('/ops/model-gateway/models/mg-model', adminToken);
        expect(delModel.status).toBe(204);
        const delProvider = await deleteJson('/ops/model-gateway/providers/mg-prov', adminToken);
        expect(delProvider.status).toBe(204);
    });
});

describe('duDirectory', () => {
    test('sums a directory tree and tolerates a missing root', async () => {
        const { duDirectory } = await import('../src/api-v1/routes/ops.js');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ops-du-'));
        fs.writeFileSync(path.join(root, 'a.txt'), 'hello'); // 5 bytes
        fs.mkdirSync(path.join(root, 'sub'));
        fs.writeFileSync(path.join(root, 'sub', 'b.txt'), '12345678'); // 8 bytes
        expect(duDirectory(root)).toBe(13);
        expect(duDirectory(path.join(root, 'missing'))).toBe(0);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
