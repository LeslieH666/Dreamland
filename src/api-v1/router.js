/**
 * `/api/v1` — the versioned public API.
 *
 * Mount convention (see src/server-main.js): this router is mounted *before*
 * the cookie-session and CSRF middleware, so the public API never touches the
 * desktop web UI's session and the two authentication tracks cannot interfere
 * with each other.
 *
 * Route groups are registered in this order:
 *   1. per-client rate limit (covers the unauthenticated auth endpoints too)
 *   2. public endpoints (`security: []` in the contract)
 *   3. bearer-token authentication
 *   4. per-account quota
 *   5. authenticated resource endpoints
 *   6. the shared OpenAI-compatible error envelope
 */

import express from 'express';

import { API_V1_CAPABILITIES, getApiHealth } from './protocol.js';
import { asyncRoute } from './errors.js';
import { apiV1AuthenticationMiddleware } from './auth-middleware.js';
import { createApiV1RateLimiters } from './rate-limit.js';
import { authErrorHandler, authProtectedRouter, authRouter } from './routes/auth.js';
import { charactersRouter } from './routes/characters.js';
import { chatsRouter } from './routes/chats.js';
import { groupsRouter } from './routes/groups.js';
import { worldInfoRouter } from './routes/worldinfo.js';
import { voiceRouter } from './routes/voice.js';
import { leslieRouter } from './routes/leslie.js';
import { secretsRouter } from './routes/secrets.js';

/**
 * Build the `/api/v1` router.
 * @param {{rateLimiters?: ReturnType<typeof createApiV1RateLimiters>}} [options] Injected rate limiters (tests).
 * @returns {import('express').Router} Configured router.
 */
export function createApiV1Router({ rateLimiters = createApiV1RateLimiters() } = {}) {
    const router = express.Router();

    // 1. baseline per-client limit
    router.use(rateLimiters.clientLimiter);

    // 2. public endpoints (contract marks these with `security: []`)
    router.get('/health', asyncRoute(async (_request, response) => {
        response.send(await getApiHealth());
    }, 'Health check failed.'));

    router.use('/auth', authRouter);

    // 3. authentication for everything below. The contract applies the global
    //    bearerAuth requirement to /capabilities, so it lives after this line.
    router.use(apiV1AuthenticationMiddleware);

    // 4. per-account quota
    router.use(rateLimiters.accountQuota);

    // 5. authenticated resources
    router.get('/capabilities', (_request, response) => {
        response.send(API_V1_CAPABILITIES);
    });

    router.use('/auth', authProtectedRouter);
    router.use('/characters', charactersRouter);
    router.use('/chats', chatsRouter);
    router.use('/groups', groupsRouter);
    router.use('/worldinfo', worldInfoRouter);
    router.use('/secrets', secretsRouter);
    router.use('/', voiceRouter);
    router.use('/', leslieRouter);

    // 6. any unmatched /api/v1 path must answer with the JSON envelope rather
    //    than falling through to the legacy cookie/CSRF chain.
    router.use((request, response) => {
        response.status(404).send({
            error: {
                code: 'not_found',
                message: `No /api/v1 route matches ${request.method} ${request.path}.`,
                type: 'not_found_error',
            },
        });
    });

    // 7. shared error envelope
    router.use(authErrorHandler);

    return router;
}

export const router = createApiV1Router();
