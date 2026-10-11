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
 *
 * It exists because the Moments API was wired to the existing Leslie stores and then pushed
 * without the write path ever being executed: only lint and the pre-existing suites ran, and
 * `POST /moments/posts` had previously been a hard 501.
 *
 * The whole chain runs: publish -> like -> unlike -> comment -> edit -> archive -> restore,
 * asserting the feed after each reaction so a client-visible regression is caught. Two
 * behaviours worth knowing when reading the expectations:
 *
 *  - Publishing resolves the author through `LeslieIdentityStore.resolveEntities`, which
 *    **creates** the entity when it is keyed by `sourceKey`, so a body `author` is what makes
 *    the request resolvable. Without one the route answers a mapped 4xx rather than 501.
 *  - Reactions are **revision-scoped**: `decoratePosts` only folds in activity whose
 *    `postRevision` matches the post's current revision. Editing a post bumps that revision,
 *    so likes and comments raised before an edit are deliberately not reported afterwards.
 */

const HANDLE = 'moments-smoke-user';
const PASSWORD = 'correct-horse-battery';
/** Identity the Persona is keyed by; `resolveEntities` creates it on first use. */
const PERSONA = { sourceKey: 'smoke-persona', label: 'Smoke Persona' };

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
    // The legacy handlers resolve repository-relative paths, so the process must sit at the
    // repository root the way the real server does. Jest runs suites from tests/.
    process.chdir(path.resolve(process.cwd(), '..'));

    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-moments-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    (await import('../src/util.js')).setConfigFilePath(configPath);

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
    /** @type {string} */
    let postId;

    /**
     * Read the feed and return one row.
     * @param {string} id Moment id.
     * @returns {Promise<any>} The row, or undefined.
     */
    async function feedRow(id) {
        const feed = await call('GET', '/moments', undefined, token);
        expect(feed.status).toBe(200);
        return (feed.body?.data ?? []).find(item => item.id === id);
    }

    test('register and sign in', async () => {
        const registered = await call('POST', '/auth/register', { handle: HANDLE, password: PASSWORD });
        expect([200, 201]).toContain(registered.status);

        const tokenised = await call('POST', '/auth/token', { grant_type: 'password', handle: HANDLE, password: PASSWORD });
        expect(tokenised.status).toBe(200);
        token = tokenised.body?.access_token;
        expect(typeof token).toBe('string');

        // The Leslie stores resolve under the per-user root, which the real server creates at login.
        const usersModule = await import('../src/users.js');
        usersModule.ensureUserDirectoriesExist(usersModule.getUserDirectories(HANDLE));
    });

    test('the feed answers the documented envelope on both paths', async () => {
        for (const route of ['/moments', '/moments/feed']) {
            const feed = await call('GET', route, undefined, token);
            expect(feed.status).toBe(200);
            expect(Array.isArray(feed.body?.data)).toBe(true);
            expect(feed.body?.next_cursor ?? null).toBeNull();
        }
    });

    test('the endpoints require a bearer token', async () => {
        const anonymous = await call('GET', '/moments');
        expect(anonymous.status).toBe(401);
    });

    test('publishing resolves the Persona and returns the created Moment', async () => {
        const published = await call('POST', '/moments/posts', { content: 'smoke', author: PERSONA }, token);
        expect(published.status).toBe(201);
        expect(typeof published.body?.id).toBe('string');
        expect(published.body?.content).toBe('smoke');
        expect(published.body?.status).toBe('active');
        expect(published.body?.author_label).toBe(PERSONA.label);
        postId = published.body.id;
    });

    test('likes round-trip and reach the feed', async () => {
        const base = `/moments/posts/${encodeURIComponent(postId)}`;

        const liked = await call('PUT', `${base}/likes`, { liked: true, author: PERSONA }, token);
        expect(liked.status).toBe(200);
        expect((await feedRow(postId))?.likes).toBe(1);

        // The unlike call needs the same author: `resolveEntities` cannot resolve an identity
        // from an empty body and would answer 400.
        const unliked = await call('PUT', `${base}/likes`, { liked: false, author: PERSONA }, token);
        expect(unliked.status).toBe(200);
        expect((await feedRow(postId))?.likes).toBe(0);
    });

    test('comments round-trip and reach the feed', async () => {
        const base = `/moments/posts/${encodeURIComponent(postId)}`;
        const commented = await call('POST', `${base}/comments`, { content: 'nice', author: PERSONA }, token);
        expect(commented.status).toBe(201);
        expect(commented.body?.comment).toBeTruthy();
        expect((await feedRow(postId))?.comments).toBe(1);
    });

    test('editing bumps the revision and retires the older reactions', async () => {
        const base = `/moments/posts/${encodeURIComponent(postId)}`;
        const edited = await call('PATCH', base, { content: 'edited', author: PERSONA }, token);
        expect(edited.status).toBe(200);
        expect(edited.body?.content).toBe('edited');
        expect(edited.body?.edited_at).toBeTruthy();

        // Reactions are scoped to the revision they were raised against, so the comment above
        // no longer counts against the edited post.
        const row = await feedRow(postId);
        expect(row?.content).toBe('edited');
        expect(row?.likes).toBe(0);
        expect(row?.comments).toBe(0);
    });

    test('archive and restore flip the status', async () => {
        const base = `/moments/posts/${encodeURIComponent(postId)}`;
        const archived = await call('POST', `${base}/archive`, {}, token);
        expect(archived.status).toBe(200);
        expect(archived.body?.status).toBe('archived');

        const restored = await call('POST', `${base}/restore`, {}, token);
        expect(restored.status).toBe(200);
        expect(restored.body?.status).toBe('active');
    });

    test('an unknown id maps to 404 rather than an unmapped 500', async () => {
        const missing = await call('PATCH', '/moments/posts/does-not-exist', { content: 'x', author: PERSONA }, token);
        expect(missing.status).toBe(404);
        expect(missing.body?.error?.code).toBe('not_found');
    });
});
