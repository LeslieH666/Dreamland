/* global globalThis */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

// Everything under src/ that reaches the config loader (directly or through
// src/users.js) must be imported dynamically *after* setConfigFilePath(), which
// is why this block only declares bindings and beforeAll() fills them in.
let ACCESS_TOKEN_TTL_SECONDS;
let computeS256Challenge;
let consumeAuthorizationCode;
let createAuthorizationCode;
let createInMemoryAuthStore;
let issueTokenPair;
let registerAccount;
let revokeAllRefreshTokens;
let revokeRefreshToken;
let rotateRefreshToken;
let signAccessToken;
let verifyAccessToken;
let verifyCredentials;
let verifyPkce;
let decodeCompositeId;
let decodeId;
let encodeCompositeId;
let encodeId;
let createApiV1RateLimiters;
let readPageWindow;
let paginate;
let ApiError;
let createMockResponse;
let invokeExpressHandler;
let createMockRequest;

const TEST_SECRET = crypto.createHash('sha256').update('unit-test-secret').digest();

let testRoot;
let configRoot;
let storage;
let users;
let SECRET_KEYS;
let setSecret;
let listSecretIds;
let getSecret;
let deleteSecret;

beforeAll(async () => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-api-v1-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(configPath);
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-api-v1-'));
    globalThis.DATA_ROOT = testRoot;
    globalThis.COMMAND_LINE_ARGS = { listen: false, basicAuthMode: false, mode: 'server' };
    users = await import('../src/users.js');
    await users.initUserStorage(testRoot);
    storage = (await import('node-persist')).default;
    ({ SECRET_KEYS } = await import('../src/endpoints/secrets.js'));
    ({ setSecret, listSecretIds, getSecret, deleteSecret } = await import('../src/api-v1/secrets.js'));

    const auth = await import('../src/api-v1/auth.js');
    ({
        ACCESS_TOKEN_TTL_SECONDS, computeS256Challenge, consumeAuthorizationCode, createAuthorizationCode,
        createInMemoryAuthStore, issueTokenPair, registerAccount, revokeAllRefreshTokens, revokeRefreshToken,
        rotateRefreshToken, signAccessToken, verifyAccessToken, verifyCredentials, verifyPkce,
    } = auth);
    const ids = await import('../src/api-v1/ids.js');
    ({ decodeCompositeId, decodeId, encodeCompositeId, encodeId } = ids);
    ({ createApiV1RateLimiters } = await import('../src/api-v1/rate-limit.js'));
    ({ readPageWindow, paginate } = await import('../src/api-v1/pagination.js'));
    ({ ApiError } = await import('../src/api-v1/errors.js'));
    const adapter = await import('../src/api-v1/adapters/express.js');
    ({ createMockResponse, invokeExpressHandler, createMockRequest } = adapter);
});

afterAll(() => {
    for (const dir of [testRoot, configRoot]) {
        if (dir && fs.existsSync(dir) && path.dirname(dir) === os.tmpdir()) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

let handleCounter = 0;
/** @returns {string} A unique handle per test. */
function nextHandle(prefix = 'api-user') {
    handleCounter += 1;
    return `${prefix}-${handleCounter}`;
}

describe('API v1 opaque ids', () => {
    test('round-trips an internal key without exposing it', () => {
        const id = encodeId('character', 'Feixiao.png');
        expect(id.startsWith('v1_c_')).toBe(true);
        expect(id).not.toContain('Feixiao');
        expect(decodeId('character', id)).toBe('Feixiao.png');
    });

    test('rejects a wrong type, a malformed body and an empty key', () => {
        const characterId = encodeId('character', 'Card.png');
        expect(() => decodeId('chat', characterId)).toThrow(ApiError);
        expect(() => decodeId('character', 'not-an-id')).toThrow(ApiError);
        expect(() => decodeId('character', 'v1_c_!!!!')).toThrow(ApiError);
        expect(() => encodeId('character', '')).toThrow(TypeError);
    });

    test('round-trips composite ids used by chats and world info', () => {
        const id = encodeCompositeId('chat', ['solo', 'Feixiao', 'Chat 1']);
        expect(decodeCompositeId('chat', id)).toEqual(['solo', 'Feixiao', 'Chat 1']);
        const wi = encodeCompositeId('worldinfo', ['Lore', '12']);
        expect(decodeCompositeId('worldinfo', wi)).toEqual(['Lore', '12']);
    });
});

describe('API v1 access tokens', () => {
    test('signs and verifies an access token', () => {
        const { token, expiresIn } = signAccessToken({ handle: 'alice', accountVersion: 7, secret: TEST_SECRET });
        expect(expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
        const payload = verifyAccessToken(token, { secret: TEST_SECRET });
        expect(payload).toMatchObject({ sub: 'alice', ver: 7, typ: 'access' });
        expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
        expect(typeof payload.jti).toBe('string');
    });

    test('rejects an expired token with a distinct code', () => {
        const now = Math.floor(Date.now() / 1000);
        const { token } = signAccessToken({ handle: 'alice', accountVersion: 1, ttlSeconds: 60, now: now - 120, secret: TEST_SECRET });
        expect(() => verifyAccessToken(token, { secret: TEST_SECRET })).toThrow(/expired/i);
        const thrown = (() => {
            try {
                verifyAccessToken(token, { secret: TEST_SECRET });
                return null;
            } catch (error) {
                return error;
            }
        })();
        expect(thrown?.status).toBe(401);
        expect(thrown?.code).toBe('token_expired');
    });

    test('rejects a tampered payload and a foreign signature', () => {
        const { token } = signAccessToken({ handle: 'alice', accountVersion: 1, secret: TEST_SECRET });
        const [header, , signature] = token.split('.');
        const forgedPayload = Buffer.from(JSON.stringify({ sub: 'mallory', ver: 1, typ: 'access', iat: 0, exp: 9999999999, jti: 'x' })).toString('base64url');
        expect(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`, { secret: TEST_SECRET })).toThrow(/signature/i);
        const otherSecret = crypto.createHash('sha256').update('other').digest();
        expect(() => verifyAccessToken(token, { secret: otherSecret })).toThrow(/signature/i);
    });

    test('rejects a malformed token', () => {
        expect(() => verifyAccessToken('nope', { secret: TEST_SECRET })).toThrow(ApiError);
        expect(() => verifyAccessToken('', { secret: TEST_SECRET })).toThrow(ApiError);
    });
});

describe('API v1 accounts and refresh rotation', () => {
    test('registers an account, verifies the password and rejects a wrong one', async () => {
        const handle = nextHandle();
        const user = await registerAccount({ handle, password: 'correct-horse-battery' });
        expect(user.handle).toBe(handle);
        expect(user.password).not.toContain('correct-horse-battery');

        const authenticated = await verifyCredentials(handle, 'correct-horse-battery');
        expect(authenticated.handle).toBe(handle);

        await expect(verifyCredentials(handle, 'wrong-password')).rejects.toMatchObject({ status: 401 });
        await expect(verifyCredentials('no-such-account', 'whatever')).rejects.toMatchObject({ status: 401 });
    });

    test('rejects a duplicate handle, a weak password and an invalid handle', async () => {
        const handle = nextHandle('dup');
        await registerAccount({ handle, password: 'a-good-password' });
        await expect(registerAccount({ handle, password: 'a-good-password' })).rejects.toMatchObject({ status: 409 });
        await expect(registerAccount({ handle: nextHandle(), password: 'short' })).rejects.toMatchObject({ status: 400 });
        await expect(registerAccount({ handle: 'a b', password: 'a-good-password' })).rejects.toMatchObject({ status: 400 });
    });

    test('refuses a disabled account', async () => {
        const handle = nextHandle('disabled');
        const user = await registerAccount({ handle, password: 'a-good-password' });
        await storage.setItem(users.toKey(handle), { ...user, enabled: false });
        await expect(verifyCredentials(handle, 'a-good-password')).rejects.toMatchObject({ status: 401 });
    });

    test('rotates a refresh token and refuses to reuse the old one', async () => {
        const handle = nextHandle('rotate');
        const user = await registerAccount({ handle, password: 'a-good-password' });
        const store = createInMemoryAuthStore();
        const first = issueTokenPair({ user, store });
        expect(first.token_type).toBe('Bearer');
        expect(store.refreshTokenCount()).toBe(1);

        const second = await rotateRefreshToken({ refreshToken: first.refresh_token, store });
        expect(second.refresh_token).not.toBe(first.refresh_token);
        await expect(rotateRefreshToken({ refreshToken: first.refresh_token, store })).rejects.toMatchObject({ status: 401 });
    });

    test('invalidates a refresh token after a password change', async () => {
        const handle = nextHandle('version');
        const user = await registerAccount({ handle, password: 'a-good-password' });
        const store = createInMemoryAuthStore();
        const tokens = issueTokenPair({ user, store });
        // Simulate a password change: the account version changes.
        await storage.setItem(users.toKey(handle), { ...user, password: 'different-hash', salt: 'different-salt' });
        await expect(rotateRefreshToken({ refreshToken: tokens.refresh_token, store })).rejects.toMatchObject({ status: 401 });
    });

    test('revokes one token, or every token of an account', async () => {
        const handle = nextHandle('logout');
        const user = await registerAccount({ handle, password: 'a-good-password' });
        const store = createInMemoryAuthStore();
        const first = issueTokenPair({ user, store });
        const second = issueTokenPair({ user, store });
        expect(store.refreshTokenCount()).toBe(2);
        expect(revokeRefreshToken({ refreshToken: first.refresh_token, store }).revoked).toBe(true);
        expect(store.refreshTokenCount()).toBe(1);
        expect(revokeAllRefreshTokens({ handle, store }).revoked).toBe(1);
        expect(store.refreshTokenCount()).toBe(0);
        void second;
    });
});

describe('API v1 PKCE (RFC 7636)', () => {
    // Appendix B test vector from RFC 7636.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    test('computes the documented S256 challenge', () => {
        expect(computeS256Challenge(verifier)).toBe(challenge);
    });

    test('accepts a matching verifier and rejects a mismatch', () => {
        expect(() => verifyPkce({ verifier, challenge })).not.toThrow();
        expect(() => verifyPkce({ verifier, challenge: 'x'.repeat(43) })).toThrow(ApiError);
        expect(() => verifyPkce({ verifier: 'too-short', challenge })).toThrow(ApiError);
        expect(() => verifyPkce({ verifier, challenge, method: 'MD5' })).toThrow(ApiError);
    });

    test('issues a one-time code and exchanges it exactly once', () => {
        const store = createInMemoryAuthStore();
        const { code } = createAuthorizationCode({ clientId: 'dreamland-app', codeChallenge: challenge, store });
        expect(consumeAuthorizationCode({ code, codeVerifier: verifier, clientId: 'dreamland-app', store }))
            .toEqual({ clientId: 'dreamland-app' });
        expect(() => consumeAuthorizationCode({ code, codeVerifier: verifier, clientId: 'dreamland-app', store }))
            .toThrow(/already used/i);
    });

    test('rejects a code presented by another client or with a wrong verifier', () => {
        const store = createInMemoryAuthStore();
        const { code } = createAuthorizationCode({ clientId: 'client-a', codeChallenge: challenge, store });
        expect(() => consumeAuthorizationCode({ code, codeVerifier: verifier, clientId: 'client-b', store }))
            .toThrow(/different client/i);

        const second = createAuthorizationCode({ clientId: 'client-a', codeChallenge: challenge, store });
        expect(() => consumeAuthorizationCode({ code: second.code, codeVerifier: `${verifier}x`, clientId: 'client-a', store }))
            .toThrow(ApiError);
    });

    test('requires a long enough challenge and client id', () => {
        const store = createInMemoryAuthStore();
        expect(() => createAuthorizationCode({ clientId: 'ab', codeChallenge: challenge, store })).toThrow(ApiError);
        expect(() => createAuthorizationCode({ clientId: 'client-a', codeChallenge: 'short', store })).toThrow(ApiError);
        expect(() => createAuthorizationCode({ clientId: 'client-a', codeChallenge: challenge, codeChallengeMethod: 'plain', store })).toThrow(ApiError);
    });
});

describe('API v1 rate limiting', () => {
    /**
     * Build a request/response pair for the limiter.
     * @returns {{request: object, response: object, finished: () => object}} Harness.
     */
    function harness() {
        const { response, captured } = createMockResponse();
        const request = { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' }, apiAuth: undefined };
        return { request, response, captured, finished: () => captured };
    }

    test('rejects a client that exceeds the baseline with 429 and Retry-After', async () => {
        const { RateLimiterMemory } = await import('rate-limiter-flexible');
        const limiters = createApiV1RateLimiters({
            clientLimiter: new RateLimiterMemory({ points: 2, duration: 60 }),
            accountLimiter: new RateLimiterMemory({ points: 100, duration: 60 }),
        });
        for (let attempt = 0; attempt < 2; attempt++) {
            const { request, response } = harness();
            let called = false;
            await limiters.clientLimiter(request, response, () => { called = true; });
            expect(called).toBe(true);
        }
        const { request, response, finished } = harness();
        await limiters.clientLimiter(request, response, () => {});
        expect(finished().status).toBe(429);
        expect(finished().headers['retry-after']).toBeDefined();
        expect(finished().body).toMatchObject({ error: { code: 'rate_limited' } });
    });

    test('applies the per-account quota only to authenticated requests', async () => {
        const { RateLimiterMemory } = await import('rate-limiter-flexible');
        const limiters = createApiV1RateLimiters({
            clientLimiter: new RateLimiterMemory({ points: 100, duration: 60 }),
            accountLimiter: new RateLimiterMemory({ points: 1, duration: 60 }),
        });

        const anonymous = harness();
        await limiters.accountQuota(anonymous.request, anonymous.response, () => {});
        expect(anonymous.finished().sent).toBe(false);

        const first = harness();
        first.request.apiAuth = { handle: 'alice' };
        await limiters.accountQuota(first.request, first.response, () => {});
        expect(first.finished().sent).toBe(false);

        const second = harness();
        second.request.apiAuth = { handle: 'alice' };
        await limiters.accountQuota(second.request, second.response, () => {});
        expect(second.finished().status).toBe(429);

        // A different account is unaffected by alice's quota.
        const other = harness();
        other.request.apiAuth = { handle: 'bob' };
        await limiters.accountQuota(other.request, other.response, () => {});
        expect(other.finished().sent).toBe(false);
    });

    test('sends the standard rate-limit headers on success', async () => {
        const { RateLimiterMemory } = await import('rate-limiter-flexible');
        const limiters = createApiV1RateLimiters({
            clientLimiter: new RateLimiterMemory({ points: 5, duration: 60 }),
        });
        const { request, response, finished } = harness();
        await limiters.clientLimiter(request, response, () => {});
        expect(finished().headers['x-ratelimit-limit']).toBe('5');
        expect(finished().headers['x-ratelimit-remaining']).toBe('4');
    });
});

describe('API v1 pagination', () => {
    test('reads limit and cursor, and rejects invalid values', () => {
        expect(readPageWindow({ query: {} })).toEqual({ offset: 0, limit: 50 });
        expect(readPageWindow({ query: { limit: '10' } })).toEqual({ offset: 0, limit: 10 });
        const cursor = Buffer.from('20', 'utf8').toString('base64url');
        expect(readPageWindow({ query: { cursor } })).toEqual({ offset: 20, limit: 50 });
        expect(() => readPageWindow({ query: { limit: '0' } })).toThrow(ApiError);
        expect(() => readPageWindow({ query: { limit: '500' } })).toThrow(ApiError);
        expect(() => readPageWindow({ query: { cursor: '!!' } })).toThrow(ApiError);
    });

    test('returns the next cursor only when more rows exist', () => {
        const items = Array.from({ length: 5 }, (_, index) => index);
        expect(paginate(items, { offset: 0, limit: 2 })).toEqual({ page: [0, 1], nextCursor: expect.any(String) });
        const last = paginate(items, { offset: 4, limit: 2 });
        expect(last.page).toEqual([4]);
        expect(last.nextCursor).toBeNull();
    });
});

describe('API v1 secret key ids', () => {
    test('stores a secret and lists only masked metadata', () => {
        const keyId = SECRET_KEYS.OPENAI;
        const { entry_id } = setSecret(keyId, 'sk-super-secret-value', 'unit');
        expect(entry_id).toBeTruthy();

        const listing = listSecretIds().find(entry => entry.key_id === keyId);
        expect(listing.configured).toBe(true);
        expect(listing.label).toBe('unit');
        expect(JSON.stringify(listing)).not.toContain('sk-super-secret-value');
        expect(listing.preview).not.toContain('secret-value');

        // Server-side callers can still read the plaintext.
        expect(getSecret(keyId)).toBe('sk-super-secret-value');

        expect(deleteSecret(keyId)).toEqual({ deleted: true });
        expect(getSecret(keyId)).toBe('');
    });

    test('rejects an unknown key id, an empty value and a missing entry', () => {
        expect(() => setSecret('not_a_key', 'value')).toThrow(ApiError);
        expect(() => setSecret(SECRET_KEYS.OPENAI, '  ')).toThrow(ApiError);
        expect(() => deleteSecret(SECRET_KEYS.OPENAI)).toThrow(ApiError);
    });
});

describe('API v1 legacy adapter', () => {
    test('captures a json response and settles for async handlers', async () => {
        const handler = (_request, response) => {
            response.status(201).json({ ok: true });
        };
        const captured = await invokeExpressHandler(handler, createMockRequest({ headers: {} }));
        expect(captured.status).toBe(201);
        expect(captured.body).toEqual({ ok: true });
    });

    test('settles for a handler that answers asynchronously', async () => {
        const handler = async (_request, response) => {
            await new Promise(resolve => setTimeout(resolve, 5));
            response.status(200).send('done');
        };
        const captured = await invokeExpressHandler(handler, createMockRequest({ headers: {} }));
        expect(captured.status).toBe(200);
        expect(captured.body).toBe('done');
    });

    test('propagates an error passed to next()', async () => {
        const handler = (_request, _response, next) => {
            next(new Error('legacy failure'));
        };
        await expect(invokeExpressHandler(handler, createMockRequest({ headers: {} }))).rejects.toThrow('legacy failure');
    });
});

describe('API v1 resource isolation', () => {
    test('two accounts resolve to different user roots', async () => {
        const handleA = nextHandle('iso-a');
        const handleB = nextHandle('iso-b');
        await registerAccount({ handle: handleA, password: 'a-good-password' });
        await registerAccount({ handle: handleB, password: 'a-good-password' });
        const dirsA = users.getUserDirectories(handleA);
        const dirsB = users.getUserDirectories(handleB);
        expect(dirsA.root).not.toBe(dirsB.root);

        // A resource written into A's tree is not reachable from B's tree: the
        // same opaque id resolves to different files, and B has no such file.
        const id = encodeCompositeId('chat', ['solo', 'Card', 'Session']);
        const parts = decodeCompositeId('chat', id);
        const pathA = path.join(dirsA.chats, parts[1], `${parts[2]}.jsonl`);
        const pathB = path.join(dirsB.chats, parts[1], `${parts[2]}.jsonl`);
        users.ensureUserDirectoriesExist(dirsA);
        users.ensureUserDirectoriesExist(dirsB);
        fs.mkdirSync(path.dirname(pathA), { recursive: true });
        fs.writeFileSync(pathA, '{"user_name":"A"}\n');
        expect(fs.existsSync(pathA)).toBe(true);
        expect(fs.existsSync(pathB)).toBe(false);
        expect(path.resolve(pathA)).not.toBe(path.resolve(pathB));
    });
});
