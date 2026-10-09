/**
 * `/api/v1/auth/*` — account and token endpoints.
 *
 * Reuses the existing account store (`src/users.js` + the node-persist user
 * records the web UI writes) rather than introducing a second credential
 * system. Registering through the API therefore produces an account that the
 * desktop web UI can also sign in to.
 */

import express from 'express';

import { badRequest } from '../errors.js';
import { asyncRoute, sendApiError } from '../errors.js';
import { toApiUser } from '../presenters.js';
import {
    consumeAuthorizationCode,
    createAuthorizationCode,
    issueTokenPair,
    registerAccount,
    revokeAllRefreshTokens,
    revokeRefreshToken,
    rotateRefreshToken,
    verifyCredentials,
} from '../auth.js';

export const authRouter = express.Router();

authRouter.post('/register', asyncRoute(async (request, response) => {
    const { handle, password, email } = request.body ?? {};
    if (email !== undefined && email !== null && String(email).trim() !== '') {
        // Accounts have no email column yet; rejecting is better than silently
        // dropping a value the client believes it stored.
        throw badRequest('Email is not supported by this API version yet.');
    }
    const user = await registerAccount({ handle, password });
    return response.status(201).send(toApiUser(user));
}, 'Account registration failed.'));

authRouter.post('/token', asyncRoute(async (request, response) => {
    const grantType = String(request.body?.grant_type ?? '').trim();
    const handle = request.body?.handle;
    const password = request.body?.password;

    if (grantType === 'password') {
        const user = await verifyCredentials(handle, password);
        return response.send(issueTokenPair({ user, clientId: request.body?.client_id ?? null }));
    }

    if (grantType === 'authorization_code') {
        // Password + PKCE: the credentials authenticate the account, the code
        // binding proves the token request comes from the client that
        // registered the code_challenge.
        const { clientId } = consumeAuthorizationCode({
            code: request.body?.code,
            codeVerifier: request.body?.code_verifier,
            clientId: request.body?.client_id,
        });
        const user = await verifyCredentials(handle, password);
        return response.send(issueTokenPair({ user, clientId }));
    }

    throw badRequest('Unsupported grant_type. Use "password" or "authorization_code".');
}, 'Token issuance failed.'));

authRouter.post('/pkce', asyncRoute(async (request, response) => {
    const result = createAuthorizationCode({
        clientId: request.body?.client_id,
        codeChallenge: request.body?.code_challenge,
        codeChallengeMethod: request.body?.code_challenge_method,
    });
    return response.status(201).send(result);
}, 'PKCE registration failed.'));

authRouter.post('/refresh', asyncRoute(async (request, response) => {
    const tokens = await rotateRefreshToken({ refreshToken: request.body?.refresh_token });
    return response.send(tokens);
}, 'Token refresh failed.'));

export const authProtectedRouter = express.Router();

authProtectedRouter.post('/logout', (request, response) => {
    const refreshToken = request.body?.refresh_token;
    if (refreshToken) {
        revokeRefreshToken({ refreshToken });
    } else {
        // No token supplied: this is a "sign out everywhere" request.
        revokeAllRefreshTokens({ handle: request.apiAuth.handle });
    }
    return response.sendStatus(204);
});

authProtectedRouter.get('/me', (request, response) => {
    return response.send(toApiUser(request.user.profile));
});

/**
 * Error handler for the auth router. Mounted inside `/api/v1` so failures use
 * the shared envelope instead of the legacy `.error` string shape.
 * @param {unknown} error Thrown value.
 * @param {import('express').Request} _request Express request.
 * @param {import('express').Response} response Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @returns {void}
 */
export function authErrorHandler(error, _request, response, next) {
    if (response.headersSent) {
        return next(error);
    }
    return sendApiError(response, error, 'The authentication request failed.');
}
