/* global globalThis */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

/**
 * The public web client authenticates with a `/api/v1` bearer token but hits the legacy
 * `/api/*` endpoints. `bearerTokenFallbackMiddleware` binds `request.user` from that token
 * so the cookie-based track accepts both, and stays out of the way when no token is sent.
 */

let configRoot;
let testRoot;
let users;
let registerAccount;
let issueTokenPair;
let bearerTokenFallbackMiddleware;

beforeAll(async () => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-bearer-config-'));
    fs.writeFileSync(path.join(configRoot, 'config.yaml'), 'allowKeysExposure: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(path.join(configRoot, 'config.yaml'));
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-bearer-'));
    globalThis.DATA_ROOT = testRoot;
    globalThis.COMMAND_LINE_ARGS = { listen: false, basicAuthMode: false, mode: 'server' };
    users = await import('../src/users.js');
    await users.initUserStorage(testRoot);
    ({ registerAccount, issueTokenPair } = await import('../src/api-v1/auth.js'));
    ({ bearerTokenFallbackMiddleware } = await import('../src/api-v1/auth-middleware.js'));
});

afterAll(() => {
    for (const dir of [testRoot, configRoot]) {
        if (dir && fs.existsSync(dir) && path.dirname(dir) === os.tmpdir()) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

/** @param {object} nextCalls Collector. @returns {object} A minimal request/response pair. */
function harness(nextCalls) {
    const request = {
        get(name) {
            return name === 'authorization' ? this.authorization : undefined;
        },
        authorization: undefined,
        user: undefined,
        bearerAuthenticated: undefined,
    };
    const response = { headers: {}, set() {} };
    const next = (value) => {
        nextCalls.push(value);
    };
    return { request, response, next };
}

describe('bearerTokenFallbackMiddleware', () => {
    test('falls through to the cookie session when no token is sent', async () => {
        const calls = [];
        const { request, response, next } = harness(calls);
        await bearerTokenFallbackMiddleware(request, response, next);
        expect(calls).toEqual([undefined]);
        expect(request.user).toBeUndefined();
        expect(request.bearerAuthenticated).toBeUndefined();
    });

    test('binds request.user and the bearer flag from a valid token', async () => {
        const user = await registerAccount({ handle: 'bearer-user', password: 'a-good-password' });
        users.ensureUserDirectoriesExist(users.getUserDirectories('bearer-user'));
        const { access_token } = issueTokenPair({ user });

        const calls = [];
        const { request, response, next } = harness(calls);
        request.authorization = `Bearer ${access_token}`;
        await bearerTokenFallbackMiddleware(request, response, next);

        expect(calls).toEqual([undefined]);
        expect(request.user?.profile?.handle).toBe('bearer-user');
        expect(request.user?.directories?.characters).toBeTruthy();
        expect(request.bearerAuthenticated).toBe(true);
    });

    test('fails closed on an invalid token instead of degrading to anonymous', async () => {
        const calls = [];
        const { request, response, next } = harness(calls);
        request.authorization = 'Bearer not-a-real-token';
        await bearerTokenFallbackMiddleware(request, response, next);

        expect(calls.length).toBe(1);
        expect(calls[0]).toBeInstanceOf(Error);
        expect(request.user).toBeUndefined();
        expect(request.bearerAuthenticated).toBeUndefined();
    });
});
