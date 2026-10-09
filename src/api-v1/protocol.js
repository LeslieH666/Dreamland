/**
 * Protocol constants and capability advertisement for the public DreamLand API.
 *
 * `/api/v1` is the versioned public surface for the web client and the React
 * Native app. It is deliberately separate from `/api/leslie/bridge/v1`, which
 * stays as the process-scoped bridge used by the desktop tooling.
 */

import { getVersion } from '../util.js';

export const API_V1_ROOT = '/api/v1';
export const API_V1_VERSION = '1';
export const API_V1_SERVICE = 'dreamland';

/** Stable error codes returned in the OpenAI-compatible error envelope. */
export const API_V1_ERROR_CODES = Object.freeze({
    INVALID_REQUEST: 'invalid_request_error',
    UNAUTHORIZED: 'unauthorized',
    FORBIDDEN: 'forbidden',
    NOT_FOUND: 'not_found',
    CONFLICT: 'conflict',
    RATE_LIMITED: 'rate_limited',
    NOT_IMPLEMENTED: 'not_implemented',
    INTERNAL: 'internal_error',
});

/**
 * Feature advertisement. Kept intentionally flat so clients can gate UI on it
 * without a second round trip.
 */
export const API_V1_CAPABILITIES = Object.freeze({
    service: API_V1_SERVICE,
    protocol: {
        name: 'dreamland-api',
        version: API_V1_VERSION,
    },
    authentication: {
        bearerJwt: true,
        refreshTokens: true,
        pkce: true,
        grantTypes: ['password', 'refresh_token', 'authorization_code'],
    },
    streaming: {
        sse: true,
        // Fixed field contract for every v1 stream (see src/api-v1/sse.js).
        fields: ['id', 'object', 'created', 'model', 'choices'],
        keepAlive: true,
    },
    pagination: {
        style: 'cursor',
        maxLimit: 100,
        defaultLimit: 50,
    },
    rateLimit: {
        enabled: true,
        headers: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    },
    domains: {
        characters: true,
        chats: true,
        groups: true,
        worldinfo: true,
        voice: true,
        memory: true,
        moments: true,
        identity: true,
        workshop: true,
        groupOrchestration: true,
    },
});

/**
 * Build the health payload for `/api/v1/health`.
 * @returns {Promise<{status: string, service: string, version: string}>} Health payload.
 */
export async function getApiHealth() {
    let version = 'unknown';
    try {
        const parsed = await getVersion();
        version = String(parsed?.pkgVersion ?? 'unknown');
    } catch {
        // A version lookup failure must not take the health endpoint down.
    }
    return {
        status: 'ok',
        service: API_V1_SERVICE,
        version,
    };
}
