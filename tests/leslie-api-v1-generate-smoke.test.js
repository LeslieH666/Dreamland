/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- This is a jest suite driven over HTTP, not a Playwright spec. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { API_V1_ROOT } from '../src/api-v1/protocol.js';

/**
 * End-to-end smoke test for the real `/api/v1` service.
 *
 * Unlike the other api-v1 suites, which call modules directly, this one boots the
 * actual router on a real HTTP listener and drives the chain over the wire:
 * register -> log in -> create a character -> create a chat -> stream a generation
 * from a local mock provider.
 *
 * It pins the three SSE contract points the route promises: ordered
 * chat.completion.chunk frames, a terminating [DONE], and X-Accel-Buffering: no.
 */

const HANDLE = 'smoke-user';
const PASSWORD = 'correct-horse-battery';

/** @type {string} */
let configRoot;
/** @type {string} */
let dataRoot;
/** @type {http.Server} */
let server;
/** @type {http.Server} */
let mockProvider;
/** @type {string} */
let baseUrl;
/** @type {string} */
let mockProviderUrl;
/** @type {Array<object>} */
const providerRequests = [];

/**
 * Split an SSE payload into its `data:` values, in order.
 * @param {string} text Raw SSE text.
 * @returns {string[]} Data values.
 */
function parseSse(text) {
    return text
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice('data:'.length).trim());
}

/**
 * POST JSON and parse the envelope.
 * @param {string} url Absolute URL.
 * @param {object} body Request body.
 * @param {string} [token] Bearer token.
 * @returns {Promise<{status: number, body: any}>} Result.
 */
async function postJson(url, body, token) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = text;
    }
    return { status: response.status, body: parsed };
}

beforeAll(async () => {
    // The legacy character handler resolves its default avatar as
    // './public/img/ai4.png', so the process must sit at the repository root the way
    // the real server does. Jest runs suites from tests/.
    process.chdir(path.resolve(process.cwd(), '..'));

    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-smoke-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(configPath);

    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-smoke-data-'));
    globalThis.DATA_ROOT = dataRoot;
    globalThis.COMMAND_LINE_ARGS = { listen: false, basicAuthMode: false, mode: 'server' };

    const users = await import('../src/users.js');
    await users.initUserStorage(dataRoot);

    const express = (await import('express')).default;
    const bodyParser = (await import('body-parser')).default;
    const { createApiV1Router } = await import('../src/api-v1/router.js');

    const app = express();
    app.use(bodyParser.json({ limit: '10mb' }));
    app.use(API_V1_ROOT, createApiV1Router());

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    mockProvider = http.createServer((request, response) => {
        let raw = '';
        request.on('data', chunk => {
            raw += chunk;
        });
        request.on('end', () => {
            console.log('PROVIDER CALLED', request.url);
            try {
                providerRequests.push(JSON.parse(raw));
            } catch {
                providerRequests.push({ raw });
            }
            response.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
            });
            for (const piece of ['Hel', 'lo']) {
                response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
            }
            response.write('data: [DONE]\n\n');
            response.end();
        });
    });
    await new Promise(resolve => mockProvider.listen(0, '127.0.0.1', resolve));
    mockProviderUrl = `http://127.0.0.1:${mockProvider.address().port}`;
}, 30_000);

afterAll(async () => {
    // SSE responses keep their sockets alive; without this close() never settles.
    server?.closeAllConnections?.();
    mockProvider?.closeAllConnections?.();
    await new Promise(resolve => server?.close(resolve));
    await new Promise(resolve => mockProvider?.close(resolve));
    for (const dir of [dataRoot, configRoot]) {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('POST /api/v1/chats/{id}/generate over a real listener', () => {
    test('register -> login -> character -> chat -> streamed generation', async () => {
        const usersModule = await import('../src/users.js');

        // 1. register + log in
        const registered = await postJson(`${baseUrl}${API_V1_ROOT}/auth/register`, { handle: HANDLE, password: PASSWORD });
        expect([200, 201]).toContain(registered.status);

        const tokenResponse = await postJson(`${baseUrl}${API_V1_ROOT}/auth/token`, {
            grant_type: 'password',
            handle: HANDLE,
            password: PASSWORD,
        });
        expect(tokenResponse.status).toBe(200);
        const token = tokenResponse.body?.access_token ?? tokenResponse.body?.accessToken ?? tokenResponse.body?.token;
        expect(typeof token).toBe('string');

        // The legacy handlers assume the per-user directories exist, which the real
        // server guarantees at login.
        const directories = usersModule.getUserDirectories(HANDLE);
        usersModule.ensureUserDirectoriesExist(directories);

        // 2. create a character
        const created = await postJson(`${baseUrl}${API_V1_ROOT}/characters`, {
            name: 'Smoke Fixture',
            description: 'A fixture.',
            first_message: 'Hello there.',
            example_dialogue: '<START>\n{{user}}: hi\n{{char}}: hello',
        }, token);
        expect(created.status).toBe(201);
        const characterId = created.body?.id;
        expect(typeof characterId).toBe('string');

        // 3. create a solo chat
        const chat = await postJson(`${baseUrl}${API_V1_ROOT}/chats`, { character_id: characterId, title: 'smoke-chat' }, token);
        expect([200, 201]).toContain(chat.status);
        const chatId = chat.body?.id;
        expect(typeof chatId).toBe('string');

        // 4. keep a minimal per-account settings.json for prompt assembly (the model
        // config itself is no longer read from here), then configure the server model
        // gateway with a custom provider + catalog model pointing at the mock provider.
        fs.mkdirSync(directories.root, { recursive: true });
        fs.writeFileSync(path.join(directories.root, 'settings.json'), JSON.stringify({ main_api: 'openai', oai_settings: { chat_completion_source: 'custom' } }));
        const { upsertProvider, upsertModel } = await import('../src/model-gateway/store.js');
        upsertProvider({ id: 'smoke', name: 'Smoke', source: 'custom', endpoint: mockProviderUrl, apiKey: 'fixture-key', enabled: true });
        upsertModel({ id: 'smoke-model', name: 'Smoke Model', provider: 'smoke', apiModel: 'fixture-model', enabled: true });

        // 5. stream a generation using a catalog model_id
        const response = await fetch(`${baseUrl}${API_V1_ROOT}/chats/${encodeURIComponent(chatId)}/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: 'Say hello.', stream: true, model_id: 'smoke-model' }),
            signal: AbortSignal.timeout(20_000),
        });

        expect(response.headers.get('x-accel-buffering')).toBe('no');
        expect(String(response.headers.get('content-type') ?? '')).toContain('text/event-stream');
        expect(response.status).toBe(200);

        const text = await response.text();
        const frames = parseSse(text);
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.at(-1)).toBe('[DONE]');

        const payloads = frames.slice(0, -1);
        for (const payload of payloads) {
            expect(() => JSON.parse(payload)).not.toThrow();
        }
        expect(payloads.map(payload => JSON.parse(payload)?.choices?.[0]?.delta?.content ?? '').join('')).toBe('Hello');

        // The route really reached the provider, with the stored conversation.
        expect(providerRequests.length).toBeGreaterThan(0);
        const providerBody = providerRequests.at(-1);
        expect(providerBody.model).toBe('fixture-model');
        expect(JSON.stringify(providerBody.messages)).toContain('Say hello.');
    }, 40_000);
});
