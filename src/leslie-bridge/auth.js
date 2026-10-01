import { timingSafeEqual } from 'node:crypto';

import { LESLIE_BRIDGE_PROTOCOL_VERSION } from './protocol.js';

export const LESLIE_BRIDGE_TOKEN_ENV = 'LESLIE_BRIDGE_TOKEN';
export const LESLIE_BRIDGE_TOKEN_MIN_BYTES = 32;
const LESLIE_BRIDGE_TOKEN_MAX_BYTES = 512;

/**
 * Read the process-scoped token used by the AIRI companion process.
 * The token is intentionally not persisted by DreamLand.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] Environment source.
 * @returns {{enabled: boolean, reason: 'configured' | 'missing' | 'invalid', token?: string}} Token state.
 */
export function getLeslieBridgeTokenConfiguration(environment = process.env) {
    const token = String(environment?.[LESLIE_BRIDGE_TOKEN_ENV] ?? '').trim();
    if (!token) {
        return { enabled: false, reason: 'missing' };
    }

    const tokenBytes = Buffer.byteLength(token, 'utf8');
    if (tokenBytes < LESLIE_BRIDGE_TOKEN_MIN_BYTES || tokenBytes > LESLIE_BRIDGE_TOKEN_MAX_BYTES) {
        return { enabled: false, reason: 'invalid' };
    }

    return { enabled: true, reason: 'configured', token };
}

/**
 * Parse an Authorization header without accepting tokens from URLs or cookies.
 * @param {unknown} header Authorization header.
 * @returns {string | null} Bearer token.
 */
export function parseLeslieBridgeBearerToken(header) {
    if (typeof header !== 'string') {
        return null;
    }

    const match = /^Bearer\s+([^\s]+)$/iu.exec(header.trim());
    return match?.[1] ?? null;
}

/**
 * Compare secret values without an early-exit string comparison.
 * @param {string} supplied Token supplied by the client.
 * @param {string} configured Configured process token.
 * @returns {boolean} Whether the values match.
 */
export function leslieBridgeTokensMatch(supplied, configured) {
    const suppliedBuffer = Buffer.from(supplied, 'utf8');
    const configuredBuffer = Buffer.from(configured, 'utf8');
    if (suppliedBuffer.length !== configuredBuffer.length) {
        return false;
    }
    return timingSafeEqual(suppliedBuffer, configuredBuffer);
}

/**
 * @param {import('express').Request} request Express request.
 * @returns {boolean} Whether Bridge bearer authentication has completed.
 */
export function isLeslieBridgeRequestAuthenticated(request) {
    return request.leslieBridge?.authenticated === true;
}

/**
 * Create the middleware mounted before CSRF protection. Only a successfully
 * authenticated Bridge request receives the CSRF exemption marker.
 * @param {{environment?: NodeJS.ProcessEnv | Record<string, string | undefined>}} [options] Middleware options.
 * @returns {import('express').RequestHandler} Express middleware.
 */
export function createLeslieBridgeAuthenticationMiddleware(options = {}) {
    return (request, response, next) => {
        const configuration = getLeslieBridgeTokenConfiguration(options.environment ?? process.env);
        response.set('Cache-Control', 'no-store');

        if (!configuration.enabled) {
            const invalid = configuration.reason === 'invalid';
            return response.status(503).send({
                error: {
                    code: invalid ? 'BRIDGE_TOKEN_INVALID' : 'BRIDGE_DISABLED',
                    message: invalid
                        ? `The ${LESLIE_BRIDGE_TOKEN_ENV} value must contain between ${LESLIE_BRIDGE_TOKEN_MIN_BYTES} and ${LESLIE_BRIDGE_TOKEN_MAX_BYTES} UTF-8 bytes.`
                        : `Set ${LESLIE_BRIDGE_TOKEN_ENV} before starting DreamLand to enable the AIRI bridge.`,
                },
            });
        }

        const suppliedToken = parseLeslieBridgeBearerToken(request.get('authorization'));
        if (!suppliedToken || !leslieBridgeTokensMatch(suppliedToken, configuration.token)) {
            response.set('WWW-Authenticate', 'Bearer realm="leslie-bridge"');
            return response.status(401).send({
                error: {
                    code: 'BRIDGE_UNAUTHORIZED',
                    message: 'A valid Leslie Bridge bearer token is required.',
                },
            });
        }

        request.leslieBridge = {
            authenticated: true,
            protocolVersion: LESLIE_BRIDGE_PROTOCOL_VERSION,
        };
        return next();
    };
}

export const leslieBridgeAuthenticationMiddleware = createLeslieBridgeAuthenticationMiddleware();

