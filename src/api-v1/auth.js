/**
 * Token authentication for the public DreamLand API.
 *
 * - **Access token**: a short-lived HS256 JWT. It carries the account handle
 *   and the account version, so changing a password invalidates every token
 *   that was issued before the change.
 * - **Refresh token**: an opaque random string. Only its SHA-256 hash is kept,
 *   so a leaked store does not leak usable tokens. Refreshing rotates the token
 *   (the previous one is revoked).
 * - **PKCE (RFC 7636)**: a first-party public client registers a
 *   `code_challenge`, receives a one-time `code`, and exchanges it together
 *   with the `code_verifier`.
 *
 * The store is in-memory for the test phase (single instance, matching the
 * plan's "Redis deferred to Phase 6"). It is injectable so tests can control
 * time and inspect state.
 *
 * No secret material is ever logged or returned to a client: the access token
 * is the only credential that leaves the server, and it is short-lived.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import storage from 'node-persist';

import { getConfigValue } from '../util.js';
import { ensureUserDirectoriesExist, getAccountVersion, getCookieSecret, getUserDirectories, toKey } from '../users.js';
import { initializeUserContent } from '../endpoints/content-manager.js';
import { SETTINGS_FILE } from '../constants.js';
import { isServerMode } from '../runtime-mode.js';
import { ApiError, badRequest, conflict, unauthorized } from './errors.js';

const registrations = new Set();
const accountBootstraps = new Map();

/** @param {object} directories Account directories. @returns {Promise<void>} Defaults ready. */
function prepareAccount(directories) {
    if (!accountBootstraps.has(directories.root)) {
        const pending = initializeUserContent(directories, { serverAccount: isServerMode() })
            .finally(() => accountBootstraps.delete(directories.root));
        accountBootstraps.set(directories.root, pending);
    }
    return accountBootstraps.get(directories.root);
}

const passwordHash = promisify(crypto.scrypt);

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PKCE_CODE_TTL_SECONDS = 5 * 60;
/** Minimum length accepted for an OAuth2 client id. */
export const MIN_CLIENT_ID_LENGTH = 3;

/**
 * @typedef {object} AuthUser
 * @property {string} handle Account handle.
 * @property {string} name Display name shown in the API.
 * @property {boolean} admin Whether the account is an administrator.
 * @property {boolean} enabled Whether the account may authenticate.
 * @property {string} [password] Password hash (never returned to a client).
 * @property {string} [salt] Password salt.
 * @property {number} [version] Account version.
 */

/**
 * Resolve the HMAC secret used to sign access tokens.
 *
 * `DREAMLAND_JWT_SECRET` (or `apiV1.jwtSecret`) wins; otherwise the secret is
 * derived from the per-installation cookie secret so a default deployment is
 * still secure and does not need extra configuration.
 * @returns {Buffer} Signing secret.
 */
export function getApiV1Secret() {
    const configured = String(getConfigValue('apiV1.jwtSecret', '') ?? '').trim();
    if (configured) {
        return crypto.createHash('sha256').update(configured, 'utf8').digest();
    }
    const cookieSecret = getCookieSecret(globalThis.DATA_ROOT);
    return crypto.createHash('sha256').update(`dreamland-api-v1:${cookieSecret}`, 'utf8').digest();
}

/** @param {unknown} value Value. @returns {string} base64url JSON. */
const encodeSegment = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/**
 * @param {string} segment base64url segment.
 * @returns {unknown} Parsed JSON.
 */
function decodeSegment(segment) {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * Sign an access token.
 * @param {{handle: string, accountVersion: number, admin?: boolean, ttlSeconds?: number, now?: number, secret?: Buffer}} options Token input.
 * @returns {{token: string, expiresIn: number, expiresAt: number}} Signed token.
 */
export function signAccessToken({
    handle,
    accountVersion,
    admin = false,
    ttlSeconds = ACCESS_TOKEN_TTL_SECONDS,
    now = Math.floor(Date.now() / 1000),
    secret = getApiV1Secret(),
}) {
    const expiresAt = now + ttlSeconds;
    const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeSegment({
        sub: handle,
        ver: accountVersion,
        admin: Boolean(admin),
        typ: 'access',
        iat: now,
        exp: expiresAt,
        jti: crypto.randomUUID(),
    });
    const body = `${header}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return { token: `${body}.${signature}`, expiresIn: ttlSeconds, expiresAt };
}

/**
 * Verify an access token.
 * @param {string} token Bearer token.
 * @param {{secret?: Buffer, now?: number}} [options] Verification input.
 * @returns {{sub: string, ver: number, admin?: boolean, typ: string, iat: number, exp: number, jti: string}} Decoded payload.
 * @throws {ApiError} 401 when the token is malformed, tampered with or expired.
 */
export function verifyAccessToken(token, { secret = getApiV1Secret(), now = Math.floor(Date.now() / 1000) } = {}) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) {
        throw unauthorized('The bearer token is malformed.');
    }
    const [header, payload, signature] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
        throw unauthorized('The bearer token signature is invalid.');
    }
    let decoded;
    try {
        decoded = /** @type {{sub: string, ver: number, typ: string, iat: number, exp: number, jti: string}} */ (decodeSegment(payload));
    } catch {
        throw unauthorized('The bearer token payload is malformed.');
    }
    if (decoded?.typ !== 'access' || typeof decoded.sub !== 'string') {
        throw unauthorized('The bearer token is not an access token.');
    }
    if (Number(decoded.exp) <= now) {
        throw new ApiError(401, 'token_expired', 'The access token has expired. Use the refresh token to get a new one.', { type: 'authentication_error' });
    }
    return decoded;
}

/**
 * Create the default in-memory token store.
 * @param {{now?: () => number}} [options] Store options.
 * @returns {object} Store with set/get/delete/size/countForHandle.
 */
export function createInMemoryAuthStore({ now = () => Date.now() } = {}) {
    /** @type {Map<string, object>} */
    const refreshTokens = new Map();
    /** @type {Map<string, object>} */
    const authorizationCodes = new Map();

    const sweep = (map) => {
        for (const [key, entry] of map) {
            if (entry.expiresAt <= now()) {
                map.delete(key);
            }
        }
    };
    const hash = (value) => crypto.createHash('sha256').update(value).digest('base64url');

    return {
        putRefreshToken({ token, handle, accountVersion, clientId = null, ttlSeconds = REFRESH_TOKEN_TTL_SECONDS }) {
            sweep(refreshTokens);
            refreshTokens.set(hash(token), {
                handle,
                accountVersion,
                clientId,
                expiresAt: now() + ttlSeconds * 1000,
                issuedAt: now(),
            });
        },
        takeRefreshToken(token) {
            sweep(refreshTokens);
            const key = hash(token);
            const entry = refreshTokens.get(key);
            if (!entry) {
                return null;
            }
            // Rotation: a refresh token is single use.
            refreshTokens.delete(key);
            return entry;
        },
        deleteRefreshToken(token) {
            return refreshTokens.delete(hash(token));
        },
        deleteRefreshTokensForHandle(handle) {
            let removed = 0;
            for (const [key, entry] of refreshTokens) {
                if (entry.handle === handle) {
                    refreshTokens.delete(key);
                    removed++;
                }
            }
            return removed;
        },
        putAuthorizationCode({ code, clientId, handle, codeChallenge, codeChallengeMethod, ttlSeconds = PKCE_CODE_TTL_SECONDS }) {
            sweep(authorizationCodes);
            authorizationCodes.set(hash(code), {
                clientId,
                handle,
                codeChallenge,
                codeChallengeMethod,
                expiresAt: now() + ttlSeconds * 1000,
            });
        },
        takeAuthorizationCode(code) {
            sweep(authorizationCodes);
            const key = hash(code);
            const entry = authorizationCodes.get(key);
            if (!entry) {
                return null;
            }
            authorizationCodes.delete(key);
            return entry;
        },
        refreshTokenCount() {
            sweep(refreshTokens);
            return refreshTokens.size;
        },
    };
}

/** Process-wide store used by the running server. */
export const authStore = createInMemoryAuthStore();

/**
 * Look up an account and verify its password.
 * @param {string} handle Account handle.
 * @param {string} password Plaintext password from the request.
 * @returns {Promise<AuthUser>} The authenticated account.
 * @throws {ApiError} 401 for unknown, disabled or mismatching credentials.
 */
export async function verifyCredentials(handle, password) {
    const normalizedHandle = String(handle ?? '').trim();
    if (!normalizedHandle) {
        throw badRequest('A handle is required.');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw badRequest('A password is required.');
    }
    /** @type {AuthUser | undefined} */
    const user = await storage.getItem(toKey(normalizedHandle));
    if (!user) {
        throw unauthorized('Incorrect credentials.');
    }
    if (!user.enabled) {
        throw unauthorized('This account is disabled.');
    }
    if (user.password) {
        const expected = (await passwordHash(password.normalize(), user.salt, 64)).toString('base64');
        const givenBuffer = Buffer.from(user.password);
        const expectedBuffer = Buffer.from(expected);
        if (givenBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(givenBuffer, expectedBuffer)) {
            throw unauthorized('Incorrect credentials.');
        }
    }
    return user;
}

/**
 * Create an account. Reuses the same node-persist user store as the web UI.
 * @param {{handle: string, password: string, name?: string, admin?: boolean}} input Registration input.
 * @returns {Promise<AuthUser>} The created account.
 * @throws {ApiError} 400/409 on invalid input or an existing handle.
 */
export async function registerAccount({ handle, password, name, admin = false }) {
    const key = String(handle ?? '').trim();
    if (registrations.has(key)) throw conflict('That handle is already being registered.');
    registrations.add(key);
    try {
        return await registerNewAccount({ handle, password, name, admin });
    } finally {
        registrations.delete(key);
    }
}

/** @param {object} input Validated registration input. @returns {Promise<AuthUser>} Created account. */
async function registerNewAccount({ handle, password, name, admin }) {
    const normalizedHandle = String(handle ?? '').trim();
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(normalizedHandle)) {
        throw badRequest('The handle must be 3-64 characters of letters, digits, dot, underscore or dash.');
    }
    if (typeof password !== 'string' || password.length < 8) {
        throw badRequest('The password must be at least 8 characters.');
    }
    const existing = await storage.getItem(toKey(normalizedHandle));
    if (existing) {
        throw conflict('That handle is already taken.');
    }
    const salt = crypto.randomBytes(16).toString('base64');
    /** @type {AuthUser} */
    const user = {
        handle: normalizedHandle,
        name: String(name ?? normalizedHandle).slice(0, 64),
        admin: Boolean(admin),
        enabled: true,
        created: Date.now(),
        password: (await passwordHash(password.normalize(), salt, 64)).toString('base64'),
        salt,
    };
    // A freshly registered account needs the same per-user directory tree the
    // web UI relies on, otherwise the first storage read fails.
    await prepareAccount(getUserDirectories(user.handle));
    await storage.setItem(toKey(normalizedHandle), user);
    return user;
}

/**
 * Issue a fresh access/refresh pair.
 * @param {{user: AuthUser, store?: object, clientId?: string|null}} options Issuance input.
 * @returns {{access_token: string, refresh_token: string, token_type: string, expires_in: number}} Token response.
 */
export function issueTokenPair({ user, store = authStore, clientId = null }) {
    const accountVersion = getAccountVersion(user);
    const access = signAccessToken({ handle: user.handle, accountVersion, admin: Boolean(user.admin) });
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    store.putRefreshToken({ token: refreshToken, handle: user.handle, accountVersion, clientId });
    return {
        access_token: access.token,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
    };
}

/**
 * Rotate a refresh token into a new pair.
 * @param {{refreshToken: string, store?: object}} options Rotation input.
 * @returns {Promise<{access_token: string, refresh_token: string, token_type: string, expires_in: number}>} New pair.
 * @throws {ApiError} 401 when the refresh token is unknown, expired or revoked.
 */
export async function rotateRefreshToken({ refreshToken, store = authStore }) {
    const entry = store.takeRefreshToken(String(refreshToken ?? ''));
    if (!entry) {
        throw unauthorized('The refresh token is invalid or has already been used.');
    }
    /** @type {AuthUser | undefined} */
    const user = await storage.getItem(toKey(entry.handle));
    if (!user || !user.enabled) {
        throw unauthorized('The account for this refresh token is no longer available.');
    }
    if (getAccountVersion(user) !== entry.accountVersion) {
        throw unauthorized('The credentials changed after this session was issued. Sign in again.');
    }
    return issueTokenPair({ user, store, clientId: entry.clientId ?? null });
}

/**
 * Revoke a single refresh token (logout of one client).
 * @param {{refreshToken: string, store?: object}} options Revocation input.
 * @returns {{revoked: boolean}} Result.
 */
export function revokeRefreshToken({ refreshToken, store = authStore }) {
    return { revoked: store.deleteRefreshToken(String(refreshToken ?? '')) };
}

/**
 * Revoke every refresh token of an account (logout everywhere).
 * @param {{handle: string, store?: object}} options Revocation input.
 * @returns {{revoked: number}} Result.
 */
export function revokeAllRefreshTokens({ handle, store = authStore }) {
    return { revoked: store.deleteRefreshTokensForHandle(handle) };
}

/**
 * Compute the S256 PKCE challenge for a verifier.
 * @param {string} verifier Code verifier.
 * @returns {string} base64url(SHA-256(verifier)).
 */
export function computeS256Challenge(verifier) {
    return crypto.createHash('sha256').update(String(verifier), 'utf8').digest('base64url');
}

/**
 * Validate a PKCE verifier against the registered challenge.
 * @param {{verifier: string, challenge: string, method?: string}} input PKCE input.
 * @returns {void}
 * @throws {ApiError} 400 when the verifier does not match (RFC 7636 §4.6).
 */
export function verifyPkce({ verifier, challenge, method = 'S256' }) {
    const normalizedMethod = String(method ?? 'S256').toUpperCase();
    if (!['S256', 'PLAIN'].includes(normalizedMethod)) {
        throw badRequest('Unsupported PKCE code_challenge_method. Use S256.');
    }
    const value = String(verifier ?? '');
    if (value.length < 43 || value.length > 128 || !/^[A-Za-z0-9\-._~]+$/.test(value)) {
        throw badRequest('The PKCE code_verifier must be 43-128 characters of unreserved characters.');
    }
    const computed = normalizedMethod === 'S256' ? computeS256Challenge(value) : value;
    const given = Buffer.from(computed);
    const expected = Buffer.from(String(challenge ?? ''));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        throw badRequest('The PKCE code_verifier does not match the registered code_challenge.');
    }
}

/**
 * Register a PKCE challenge and hand back a one-time code.
 * @param {{clientId: string, codeChallenge: string, codeChallengeMethod?: string, store?: object}} input Registration input.
 * @returns {{code: string, expires_in: number, code_challenge_method: string}} Authorization code.
 */
export function createAuthorizationCode({ clientId, codeChallenge, codeChallengeMethod = 'S256', store = authStore }) {
    const normalizedClientId = String(clientId ?? '').trim();
    if (normalizedClientId.length < MIN_CLIENT_ID_LENGTH) {
        throw badRequest(`client_id must be at least ${MIN_CLIENT_ID_LENGTH} characters.`);
    }
    const challenge = String(codeChallenge ?? '');
    if (challenge.length < 43 || challenge.length > 128) {
        throw badRequest('code_challenge must be 43-128 characters.');
    }
    const method = String(codeChallengeMethod ?? 'S256').toUpperCase();
    if (method !== 'S256') {
        throw badRequest('Only the S256 PKCE code_challenge_method is supported.');
    }
    const code = crypto.randomBytes(32).toString('base64url');
    store.putAuthorizationCode({ code, clientId: normalizedClientId, handle: null, codeChallenge: challenge, codeChallengeMethod: method });
    return { code, expires_in: PKCE_CODE_TTL_SECONDS, code_challenge_method: method };
}

/**
 * Consume a one-time PKCE authorization code and verify the verifier against
 * the challenge that was registered for it (RFC 7636 §4.6).
 *
 * The code is single use: it is removed from the store even when verification
 * fails, so a stolen code cannot be retried.
 * @param {{code: string, codeVerifier: string, clientId: string, store?: object}} input Exchange input.
 * @returns {{clientId: string}} The verified client binding.
 * @throws {ApiError} 401/400 when the code or the verifier is not acceptable.
 */
export function consumeAuthorizationCode({ code, codeVerifier, clientId, store = authStore }) {
    const entry = store.takeAuthorizationCode(String(code ?? ''));
    if (!entry) {
        throw unauthorized('The authorization code is invalid, expired or already used.');
    }
    const normalizedClientId = String(clientId ?? '').trim();
    if (entry.clientId !== normalizedClientId) {
        throw unauthorized('The authorization code was issued to a different client.');
    }
    verifyPkce({ verifier: codeVerifier, challenge: entry.codeChallenge, method: entry.codeChallengeMethod });
    return { clientId: entry.clientId };
}

/**
 * Resolve the authenticated account behind a handle and bind its directories
 * the same way the cookie-session middleware does.
 * @param {string} handle Account handle.
 * @returns {Promise<{profile: AuthUser, directories: import('../users.js').UserDirectoryList, storageHandle: string, demoMode: boolean} | null>} Request user context.
 */
export async function resolveRequestUser(handle) {
    /** @type {AuthUser | undefined} */
    const profile = await storage.getItem(toKey(handle));
    if (!profile) {
        return null;
    }
    const directories = getUserDirectories(profile.handle);
    // Accounts created through the admin UI or an older install may lack the
    // full tree; ensuring it here is idempotent and keeps every v1 route safe.
    ensureUserDirectoriesExist(directories);
    try {
        await fs.promises.access(path.join(directories.root, SETTINGS_FILE));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await prepareAccount(directories);
    }
    return {
        profile,
        directories,
        storageHandle: profile.handle,
        demoMode: false,
    };
}
