/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- jest suite driven over HTTP, not Playwright. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { API_V1_ROOT } from '../src/api-v1/protocol.js';
import { DRAFT_FIELDS, buildWorkshopDraftPrompt, parseWorkshopDraft } from '../src/api-v1/workshop-draft.js';

/**
 * Character workshop tests.
 *
 * The draft-shaping half is unit-tested directly: prompt building and reply parsing are what
 * silently produce a broken card when they are wrong, and they need no model to exercise. The
 * route half runs over a real listener to confirm `POST /workshop/generate` is no longer a
 * 501 and that its failures arrive as mapped envelope errors.
 *
 * No model is called. A freshly registered account has no online API configured, which is
 * exactly the state that must produce a clear 409 rather than a hang or a 500.
 */

const HANDLE = 'workshop-smoke-user';
const PASSWORD = 'correct-horse-battery';

let configRoot;
let dataRoot;
let server;
let baseUrl;
/** Cwd to restore: `process.chdir` is process-wide and leaks across suites in a worker. */
let originalCwd;

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

describe('workshop draft shaping', () => {
    test('a brief is required and bounded', () => {
        expect(() => buildWorkshopDraftPrompt({})).toThrow(/brief/i);
        expect(() => buildWorkshopDraftPrompt({ brief: '   ' })).toThrow(/brief/i);
        expect(() => buildWorkshopDraftPrompt({ brief: 'x'.repeat(4001) })).toThrow(/too long/i);
    });

    test('the prompt names every field the parser expects', () => {
        const { systemPrompt, prompt, responseLength } = buildWorkshopDraftPrompt({ brief: '一位沉默的图书管理员' });
        for (const field of DRAFT_FIELDS) {
            expect(systemPrompt).toContain(field);
        }
        expect(prompt).toContain('一位沉默的图书管理员');
        // `validateMomentsGeneration` rejects anything outside 1..1200.
        expect(responseLength).toBeGreaterThan(0);
        expect(responseLength).toBeLessThanOrEqual(1200);
    });

    test('a JSON reply is read, fenced or not', () => {
        const payload = { name: '林', description: 'd', personality: 'p', scenario: 's', first_mes: '你好', mes_example: '' };
        expect(parseWorkshopDraft(JSON.stringify(payload))).toEqual(payload);
        expect(parseWorkshopDraft('```json\n' + JSON.stringify(payload) + '\n```')).toEqual(payload);
        // Prose around the object is tolerated, because models add it despite instructions.
        expect(parseWorkshopDraft('好的：' + JSON.stringify(payload))).toEqual(payload);
    });

    test('unusable replies fail instead of yielding an empty card', () => {
        expect(() => parseWorkshopDraft('no json here')).toThrow(/JSON/);
        expect(() => parseWorkshopDraft('{ not valid json')).toThrow(/malformed|JSON/i);
        expect(() => parseWorkshopDraft('[1,2,3]')).toThrow(/JSON/);
        // A card without a name or an opening line would save as a broken character.
        expect(() => parseWorkshopDraft(JSON.stringify({ description: 'only a description' }))).toThrow(/name|opening/i);
    });

    test('unknown keys are dropped and long values are capped', () => {
        const draft = parseWorkshopDraft(JSON.stringify({
            name: 'N'.repeat(200),
            first_mes: 'hi',
            character_version: '2.0',
            system_prompt: 'should not survive',
        }));
        expect(Object.keys(draft).sort()).toEqual([...DRAFT_FIELDS].sort());
        expect(draft.name.length).toBeLessThan(200);
        expect(draft).not.toHaveProperty('system_prompt');
    });
});

beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(process.cwd(), '..'));

    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-workshop-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    (await import('../src/util.js')).setConfigFilePath(configPath);

    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-workshop-data-'));
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

describe('the /api/v1 workshop surface over a real listener', () => {
    let token;

    test('register and sign in', async () => {
        await call('POST', '/auth/register', { handle: HANDLE, password: PASSWORD });
        const tokenised = await call('POST', '/auth/token', { grant_type: 'password', handle: HANDLE, password: PASSWORD });
        token = tokenised.body?.access_token;
        expect(typeof token).toBe('string');
        const usersModule = await import('../src/users.js');
        usersModule.ensureUserDirectoriesExist(usersModule.getUserDirectories(HANDLE));
    });

    test('the online model listing answers an envelope', async () => {
        const listed = await call('GET', '/workshop/models', undefined, token);
        expect(listed.status).toBe(200);
        expect(Array.isArray(listed.body?.data)).toBe(true);
    });

    test('generating without a configured model is a 409, not a 501 or a hang', async () => {
        const generated = await call('POST', '/workshop/generate', { brief: '一位沉默的图书管理员' }, token);
        expect(generated.status).not.toBe(501);
        expect(generated.status).not.toBe(500);
        expect(generated.status).toBe(409);
        expect(generated.body?.error?.code).toBe('conflict');
        expect(generated.body?.error?.message).toMatch(/联网|model|API/i);
    });

    test('an empty brief is a 400', async () => {
        const generated = await call('POST', '/workshop/generate', { brief: '   ' }, token);
        expect(generated.status).toBe(400);
    });

    test('the workshop requires a bearer token', async () => {
        expect((await call('POST', '/workshop/generate', { brief: 'x' })).status).toBe(401);
        expect((await call('GET', '/workshop/models')).status).toBe(401);
    });
});
