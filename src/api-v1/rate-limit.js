/**
 * Rate limiting for the public API.
 *
 * Two layers, both backed by `rate-limiter-flexible` (already a dependency and
 * already used by the account endpoints):
 *   - a per-client baseline keyed by IP, applied to every request including the
 *     unauthenticated `/auth/*` endpoints (which are the brute-force targets);
 *   - a per-account quota keyed by the authenticated handle, applied after
 *     authentication so one noisy client cannot exhaust another account's
 *     allowance.
 *
 * Standard `RateLimit-*` headers plus `Retry-After` are always sent so clients
 * can back off without guessing.
 */

import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

import { getConfigValue } from '../util.js';
import { getIpAddress } from '../express-common.js';
import { ApiError, sendApiError } from './errors.js';

/** Requests per minute from one client address. */
export const DEFAULT_CLIENT_POINTS = 120;
/** Requests per minute for one authenticated account. */
export const DEFAULT_ACCOUNT_POINTS = 600;

/**
 * Read a positive integer from configuration.
 * @param {string} key Config key.
 * @param {number} fallback Default value.
 * @returns {number} Effective value.
 */
function readPoints(key, fallback) {
    const configured = Number(getConfigValue(key, fallback, 'number'));
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

/**
 * Send the standard rate-limit headers.
 * @param {import('express').Response} response Express response.
 * @param {{points: number, remaining: number, msBeforeNext: number}} state Limit state.
 * @returns {void}
 */
export function setRateLimitHeaders(response, { points, remaining, msBeforeNext }) {
    const retryAfterSeconds = Math.max(1, Math.ceil(msBeforeNext / 1000));
    response.set('X-RateLimit-Limit', String(points));
    response.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));
    response.set('X-RateLimit-Reset', String(retryAfterSeconds));
}

/**
 * @param {unknown} rejection Value thrown by a limiter.
 * @returns {boolean} Whether it is a rate-limit rejection.
 */
function isRateLimitRejection(rejection) {
    return rejection instanceof RateLimiterRes || (typeof rejection === 'object' && rejection !== null && 'msBeforeNext' in rejection);
}

/**
 * Build the `/api/v1` rate limiting middlewares.
 * @param {{clientLimiter?: object, accountLimiter?: object, preferRealIpHeader?: boolean}} [options] Overrides for tests.
 * @returns {{clientLimiter: (req, res, next) => Promise<void>, accountQuota: (req, res, next) => Promise<void>, limiters: {client: object, account: object}}} Middlewares and their limiters.
 */
export function createApiV1RateLimiters({
    clientLimiter = new RateLimiterMemory({
        points: readPoints('rateLimiting.apiV1MaxRequests', DEFAULT_CLIENT_POINTS),
        duration: 60,
    }),
    accountLimiter = new RateLimiterMemory({
        points: readPoints('rateLimiting.apiV1AccountMaxRequests', DEFAULT_ACCOUNT_POINTS),
        duration: 60,
    }),
    preferRealIpHeader = Boolean(getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean')),
} = {}) {
    const clientPoints = clientLimiter.points ?? DEFAULT_CLIENT_POINTS;
    const accountPoints = accountLimiter.points ?? DEFAULT_ACCOUNT_POINTS;

    /**
     * @param {import('express').Response} response Express response.
     * @param {object} rejection Limiter rejection.
     * @param {number} points Effective limit.
     * @param {string} message Client-facing message.
     * @returns {import('express').Response} Response.
     */
    const reject = (response, rejection, points, message) => {
        setRateLimitHeaders(response, {
            points,
            remaining: rejection.remainingPoints ?? 0,
            msBeforeNext: rejection.msBeforeNext ?? 1000,
        });
        response.set('Retry-After', String(Math.max(1, Math.ceil((rejection.msBeforeNext ?? 1000) / 1000))));
        return sendApiError(response, new ApiError(429, 'rate_limited', message, { type: 'rate_limit_error' }));
    };

    return {
        limiters: { client: clientLimiter, account: accountLimiter },

        /** Per-client baseline. Runs before authentication. */
        async clientLimiter(request, response, next) {
            const clientKey = getIpAddress(request, preferRealIpHeader);
            try {
                const result = await clientLimiter.consume(clientKey);
                setRateLimitHeaders(response, {
                    points: clientPoints,
                    remaining: result.remainingPoints,
                    msBeforeNext: result.msBeforeNext,
                });
                return next();
            } catch (rejection) {
                if (isRateLimitRejection(rejection)) {
                    return reject(response, rejection, clientPoints, 'Too many requests. Retry later.');
                }
                return next(rejection);
            }
        },

        /** Per-account quota. Runs after authentication. */
        async accountQuota(request, response, next) {
            const handle = request.apiAuth?.handle;
            if (!handle) {
                return next();
            }
            try {
                const result = await accountLimiter.consume(handle);
                setRateLimitHeaders(response, {
                    points: accountPoints,
                    remaining: result.remainingPoints,
                    msBeforeNext: result.msBeforeNext,
                });
                return next();
            } catch (rejection) {
                if (isRateLimitRejection(rejection)) {
                    return reject(response, rejection, accountPoints, 'Account quota exceeded. Retry later.');
                }
                return next(rejection);
            }
        },
    };
}
