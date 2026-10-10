/**
 * Bearer-token authentication middleware for `/api/v1`.
 *
 * This is the second track of the dual authentication model: the desktop web
 * UI keeps its cookie session, while `/api/v1` (the React Native app and the
 * public web client) authenticates with a JWT access token only. The two never
 * share state, so neither can break the other.
 */

import storage from 'node-persist';

import { getAccountVersion, toKey } from '../users.js';
import { forbidden, unauthorized } from './errors.js';
import { resolveRequestUser, verifyAccessToken } from './auth.js';

/**
 * Parse an `Authorization: Bearer <token>` header.
 * @param {string | undefined} header Raw header value.
 * @returns {string | null} The token, if present.
 */
export function parseBearerToken(header) {
    const value = String(header ?? '').trim();
    if (!value) {
        return null;
    }
    const [scheme, token, ...rest] = value.split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
        return null;
    }
    return token;
}

/**
 * Authenticate a `/api/v1` request and bind `request.user`.
 *
 * A route can opt out by being registered before this middleware (the public
 * endpoints `/health`, `/capabilities`, `/auth/register`, `/auth/token`,
 * `/auth/refresh` and `/auth/pkce` do exactly that).
 * @param {import('express').Request} request Express request.
 * @param {import('express').Response} response Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @returns {Promise<void>} Resolves when the request continues.
 */
export async function apiV1AuthenticationMiddleware(request, response, next) {
    response.set('Cache-Control', 'no-store');

    const token = parseBearerToken(request.get('authorization'));
    if (!token) {
        return next(unauthorized('Provide an access token in the Authorization header.'));
    }

    let payload;
    try {
        payload = verifyAccessToken(token);
    } catch (error) {
        return next(error);
    }

    /** @type {import('./auth.js').AuthUser | undefined} */
    const profile = await storage.getItem(toKey(payload.sub));
    if (!profile) {
        return next(unauthorized('The account for this token no longer exists.'));
    }
    if (!profile.enabled) {
        return next(unauthorized('This account is disabled.'));
    }
    if (getAccountVersion(profile) !== payload.ver) {
        return next(unauthorized('The credentials changed after this token was issued. Sign in again.'));
    }

    const user = await resolveRequestUser(profile.handle);
    if (!user) {
        return next(unauthorized('The account for this token no longer exists.'));
    }

    request.user = user;
    request.apiAuth = {
        handle: profile.handle,
        admin: payload.admin === true,
        tokenId: payload.jti,
        expiresAt: payload.exp,
    };
    return next();
}

/**
 * Attach the authentication check to every subsequently registered route.
 * @param {import('express').Router} router Express router.
 * @returns {void}
 */
export function requireApiV1Auth(router) {
    router.use(apiV1AuthenticationMiddleware);
}

/**
 * Guard for the operations dashboard: the request must be authenticated as an
 * administrator. The check reads the freshly loaded account profile (authoritative) rather
 * than trusting the token claim alone, because the account version does not change when
 * an account's admin flag is toggled.
 *
 * @param {import('express').Request} request Express request.
 * @param {import('express').Response} response Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @returns {void}
 */
export function requireOpsAdmin(request, response, next) {
    if (request.user?.profile?.admin !== true) {
        return next(forbidden('This endpoint requires an administrator account.'));
    }
    return next();
}

/**
 * Optional bearer-token authentication for the legacy cookie track.
 *
 * The desktop web UI authenticates with its cookie session. The public web client
 * (DREAMLAND_MODE=server) authenticates with a `/api/v1` access token instead, but its
 * data operations still hit the same legacy `/api/*` endpoints. This middleware binds
 * `request.user` from a valid bearer token when one is present, and otherwise falls
 * through to the cookie session untouched. A token that is present but invalid fails
 * closed so an expired session cannot silently degrade into an unauthenticated request.
 *
 * @param {import('express').Request} request Express request.
 * @param {import('express').Response} response Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @returns {Promise<void>} Resolves when the request continues.
 */
export async function bearerTokenFallbackMiddleware(request, response, next) {
    const token = parseBearerToken(request.get('authorization'));
    if (!token) {
        return next();
    }

    let payload;
    try {
        payload = verifyAccessToken(token);
    } catch (error) {
        return next(error);
    }

    const profile = await storage.getItem(toKey(payload.sub));
    if (!profile || !profile.enabled || getAccountVersion(profile) !== payload.ver) {
        return next(unauthorized('The account for this token is unavailable. Sign in again.'));
    }

    const user = await resolveRequestUser(profile.handle);
    if (!user) {
        return next(unauthorized('The account for this token no longer exists.'));
    }

    request.user = user;
    request.bearerAuthenticated = true;
    request.apiAuth = {
        handle: profile.handle,
        admin: payload.admin === true,
        tokenId: payload.jti,
        expiresAt: payload.exp,
    };
    return next();
}
