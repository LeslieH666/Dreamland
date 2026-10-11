/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- This is a jest suite driven over HTTP, not a Playwright spec. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { API_V1_ROOT } from '../src/api-v1/protocol.js';

/**
 * End-to-end smoke test for `PUT /api/v1/characters/{id}/avatar`.
 *
 * The route used to answer 501. Its own comment explained why: a character card stores its
 * JSON in a PNG `tEXt` chunk, so overwriting the image bytes naively would drop the card.
 * The endpoint now re-embeds through the same `writeCharacterData` helper the legacy router
 * uses, and this suite is here to prove the card survives — the failure mode it guards
 * against is silent card loss, which no type checker would catch.
 *
 * The upload payload is a real PNG: the avatar the create route assigns to a new character,
 * read back over `GET /characters/{id}/avatar` and posted as base64.
 */

const HANDLE = 'avatar-smoke-user';
const PASSWORD = 'correct-horse-battery';
const CHARACTER_NAME = 'Avatar Smoke Fixture';

/** @type {string} */
let configRoot;
/** @type {string} */
let dataRoot;
/** @type {http.Server} */
let server;
/** @type {string} */
let baseUrl;
/** Cwd to restore: `process.chdir` is process-wide and leaks across suites. */
let originalCwd;

/**
 * Send a JSON request and parse the body regardless of status.
 * @param {string} method HTTP method.
 * @param {string} route Path below the API root.
 * @param {object} [body] Request body.
 * @param {string} [token] Bearer token.
 * @returns {Promise<{status: number, body: any}>} Result.
 */
async function call(method, route, body, token) {
    const response = await fetch(`${baseUrl}${API_V1_ROOT}${route}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = text;
    }
    return { status: response.status, body: parsed };
}

beforeAll(async () => {
    originalCwd = process.cwd();
    // The legacy character handler resolves './public/img/ai4.png' relative to the process
    // cwd, so it must sit at the repository root. Jest runs suites from tests/.
    process.chdir(path.resolve(process.cwd(), '..'));

    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-avatar-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    (await import('../src/util.js')).setConfigFilePath(configPath);

    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-avatar-data-'));
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
}, 30_000);

afterAll(async () => {
    if (originalCwd) process.chdir(originalCwd);
    server?.closeAllConnections?.();
    await new Promise(resolve => server?.close(resolve));
    for (const dir of [dataRoot, configRoot]) {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('PUT /api/v1/characters/{id}/avatar over a real listener', () => {
    /** @type {string} */
    let token;
    /** @type {string} */
    let characterId;

    test('register, sign in and create a character', async () => {
        await call('POST', '/auth/register', { handle: HANDLE, password: PASSWORD });
        const tokenised = await call('POST', '/auth/token', { grant_type: 'password', handle: HANDLE, password: PASSWORD });
        token = tokenised.body?.access_token;
        expect(typeof token).toBe('string');

        const usersModule = await import('../src/users.js');
        usersModule.ensureUserDirectoriesExist(usersModule.getUserDirectories(HANDLE));

        const created = await call('POST', '/characters', { name: CHARACTER_NAME, description: 'A fixture.' }, token);
        expect([200, 201]).toContain(created.status);

        const list = await call('GET', '/characters', undefined, token);
        expect(list.status).toBe(200);
        const entry = (list.body?.data ?? []).find(item => item.name === CHARACTER_NAME);
        expect(entry).toBeTruthy();
        characterId = entry.id;
    });

    test('the avatar is served and is a PNG', async () => {
        const response = await fetch(`${baseUrl}${API_V1_ROOT}/characters/${encodeURIComponent(characterId)}/avatar`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes.length).toBeGreaterThan(8);
        // PNG magic, so the payload we post back below is a genuine image.
        expect(bytes.readUInt32BE(0)).toBe(0x89504e47);
    });

    test('uploading a new avatar keeps the character card intact', async () => {
        const before = await fetch(`${baseUrl}${API_V1_ROOT}/characters/${encodeURIComponent(characterId)}/avatar`, {
            headers: { authorization: `Bearer ${token}` },
        });
        const bytes = Buffer.from(await before.arrayBuffer());

        const uploaded = await call(
            'PUT',
            `/characters/${encodeURIComponent(characterId)}/avatar`,
            { image_base64: bytes.toString('base64') },
            token,
        );
        expect(uploaded.status).toBe(204);

        // The regression this suite exists for: re-embedding must not drop the card JSON.
        const card = await call('GET', `/characters/${encodeURIComponent(characterId)}`, undefined, token);
        expect(card.status).toBe(200);
        expect(card.body?.name).toBe(CHARACTER_NAME);

        // And the avatar is still a readable PNG after the rewrite.
        const after = await fetch(`${baseUrl}${API_V1_ROOT}/characters/${encodeURIComponent(characterId)}/avatar`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(after.status).toBe(200);
        const rewritten = Buffer.from(await after.arrayBuffer());
        expect(rewritten.length).toBeGreaterThan(8);
        expect(rewritten.readUInt32BE(0)).toBe(0x89504e47);
    });

    test('a non-PNG payload is rejected', async () => {
        const rejected = await call(
            'PUT',
            `/characters/${encodeURIComponent(characterId)}/avatar`,
            { image_base64: Buffer.from('not a png at all').toString('base64') },
            token,
        );
        expect(rejected.status).toBe(400);
        expect(rejected.body?.error?.code).toBe('invalid_request_error');
    });

    test('a bogus character id fails as a mapped error, not an unmapped 500', async () => {
        const missing = await call('PUT', '/characters/does-not-exist/avatar', { image_base64: 'AAAA' }, token);
        expect([400, 404]).toContain(missing.status);
        expect(missing.body?.error?.code).toBeTruthy();
    });
});
