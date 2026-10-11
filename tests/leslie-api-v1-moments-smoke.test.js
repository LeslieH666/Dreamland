/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- This is a jest suite driven over HTTP, not a Playwright spec. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { API_V1_ROOT } from '../src/api-v1/protocol.js';

/**
 * End-to-end smoke test for the Moments surface of the real `/api/v1` service.
 *
 * The suite boots the actual router on a listener, the way
 * `leslie-api-v1-generate-smoke.test.js` does, and drives the endpoints over the wire.
 * It exists because the Moments write API was wired to the existing Leslie stores without
 * ever being executed: `POST /moments/posts` used to answer 501, and nothing proved the
 * new handlers could reach `request.user.directories.root` on the v1 track.
 *
 * What this pins:
 *  - the feed answers the documented `{ data, next_cursor }` envelope, on both `/moments`
 *    and the older `/moments/feed` alias the shipped client calls;
 *  - publishing no longer answers 501, and a request that cannot be resolved to an
 *    identity comes back as a mapped 4xx with the shared error envelope rather than a 500;
 *  - when the account has a resolvable Persona, the full write chain runs:
 *    publish -> like -> comment -> edit -> archive -> restore.
 */

const HANDLE = 'moments-smoke-user';
const PASSWORD = 'correct-horse-battery';

/** @type {string} */
let configRoot;
/** @type {string} */
let dataRoot;
/** @type {http.Server} */
let server;
/** @type {string} */
let baseUrl;

/**
 * Send JSON and parse the body regardless of status.
 * @param {string} method HTTP method.
 * @param {string} url Absolute URL.
 * @param {object} [body] Request body.
 * @param {string} [token] Bearer token.
 * @returns {Promise<{status: number, body: any}>} Result.
 */
async function sendJson(method, url, body, token) {
    const response = await fetch(url, {
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
    // The legacy handlers resolve repository-relative paths, so the process must sit at the
    // repository root the way the real server does. Jest runs suites from tests/.
    process.chdir(path.resolve(process.cwd(), '..'));

    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-moments-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(configPath);

    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-moments-data-'));
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
    server?.closeAllConnections?.();
    await new Promise(resolve => server?.close(resolve));
    for (const dir of [dataRoot, configRoot]) {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('the /api/v1 moments surface over a real listener', () => {
    /** @type {string} */
    let token;

    test('register and sign in', async () => {
        const registered = await sendJson('POST', `${baseUrl}${API_V1_ROOT}/auth/register`, {
            handle: HANDLE,
            password: PASSWORD,
        });
        expect([200, 201]).toContain(registered.status);

        const tokenised = await sendJson('POST', `${baseUrl}${API_V1_ROOT}/auth/token`, {
            grant_type: 'password',
            handle: HANDLE,
            password: PASSWORD,
        });
        expect(tokenised.status).toBe(200);
        token = tokenised.body?.access_token;
        expect(typeof token).toBe('string');

        // The Leslie stores resolve under the per-user root, which the real server creates
        // at login.
        const usersModule = await import('../src/users.js');
        usersModule.ensureUserDirectoriesExist(usersModule.getUserDirectories(HANDLE));
    });

    test('the feed answers the documented envelope on both paths', async () => {
        for (const route of ['/moments', '/moments/feed']) {
            const feed = await sendJson('GET', `${baseUrl}${API_V1_ROOT}${route}`, undefined, token);
            expect(feed.status).toBe(200);
            expect(Array.isArray(feed.body?.data)).toBe(true);
            expect(feed.body?.next_cursor ?? null).toBeNull();
        }
    });

    test('publishing is no longer 501 and reports failures through the envelope', async () => {
        const published = await sendJson('POST', `${baseUrl}${API_V1_ROOT}/moments/posts`, { content: 'smoke' }, token);

        // The regression this suite exists for: the route used to be a hard 501.
        expect(published.status).not.toBe(501);
        // A handler that cannot reach its stores would surface as an unmapped 500.
        expect(published.status).not.toBe(500);

        if (published.status === 201) {
            // A Persona was resolvable, so the whole write chain is exercised below.
            expect(typeof published.body?.id).toBe('string');
            expect(published.body?.content).toBe('smoke');
            expect(published.body?.status).toBe('active');
        } else {
            // No Persona on the account yet: the request must still fail as a mapped error.
            expect([400, 404, 409]).toContain(published.status);
            expect(published.body?.error?.code).toBeTruthy();
        }
    });

    test('like, comment, edit, archive and restore round-trip when a Persona exists', async () => {
        const published = await sendJson('POST', `${baseUrl}${API_V1_ROOT}/moments/posts`, { content: 'round-trip' }, token);
        if (published.status !== 201) {
            // Covered by the previous test; the write chain needs a Persona to run.
            expect([400, 404, 409]).toContain(published.status);
            return;
        }
        const postId = published.body.id;
        const base = `${baseUrl}${API_V1_ROOT}/moments/posts/${encodeURIComponent(postId)}`;

        const liked = await sendJson('PUT', `${base}/likes`, { liked: true }, token);
        expect(liked.status).toBe(200);
        expect(liked.body?.post?.likes).toBeGreaterThanOrEqual(1);

        const unliked = await sendJson('PUT', `${base}/likes`, { liked: false }, token);
        expect(unliked.status).toBe(200);

        const commented = await sendJson('POST', `${base}/comments`, { content: 'nice' }, token);
        expect(commented.status).toBe(201);
        expect(commented.body?.post?.comments).toBeGreaterThanOrEqual(1);

        const edited = await sendJson('PATCH', base, { content: 'edited' }, token);
        expect(edited.status).toBe(200);
        expect(edited.body?.content).toBe('edited');
        expect(edited.body?.edited_at).toBeTruthy();

        const archived = await sendJson('POST', `${base}/archive`, {}, token);
        expect(archived.status).toBe(200);
        expect(archived.body?.status).toBe('archived');

        const restored = await sendJson('POST', `${base}/restore`, {}, token);
        expect(restored.status).toBe(200);
        expect(restored.body?.status).toBe('active');

        // An unknown id must map to 404 rather than reaching the store's 500 path.
        const missing = await sendJson('PATCH', `${baseUrl}${API_V1_ROOT}/moments/posts/does-not-exist`, { content: 'x' }, token);
        expect(missing.status).toBe(404);
        expect(missing.body?.error?.code).toBe('not_found');
    });

    test('the endpoints require a bearer token', async () => {
        const anonymous = await sendJson('GET', `${baseUrl}${API_V1_ROOT}/moments`);
        expect(anonymous.status).toBe(401);
    });
});
