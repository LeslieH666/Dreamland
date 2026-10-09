/**
 * Error handling for the public DreamLand API.
 *
 * Every failure leaves as the same OpenAI-compatible envelope used by the
 * Leslie Bridge, so a single client-side decoder covers both surfaces:
 *
 *   { "error": { "code": "...", "message": "...", "type": "..." } }
 */

import { API_V1_ERROR_CODES } from './protocol.js';

/**
 * An error that can safely be shown to an API client.
 */
export class ApiError extends Error {
    /**
     * @param {number} status HTTP status code.
     * @param {string} code Stable machine-readable code.
     * @param {string} message Human-readable message. Never include secrets.
     * @param {{type?: string, details?: unknown}} [options] Extra envelope fields.
     */
    constructor(status, code, message, { type = 'invalid_request_error', details } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.type = type;
        this.details = details;
    }
}

/** @param {string} message Message. @returns {ApiError} 400 response. */
export const badRequest = (message, details) => new ApiError(400, API_V1_ERROR_CODES.INVALID_REQUEST, message, { details });

/** @param {string} message Message. @returns {ApiError} 401 response. */
export const unauthorized = (message = 'A valid bearer token is required.') =>
    new ApiError(401, API_V1_ERROR_CODES.UNAUTHORIZED, message, { type: 'authentication_error' });

/** @param {string} message Message. @returns {ApiError} 403 response. */
export const forbidden = (message = 'This account cannot access the requested resource.') =>
    new ApiError(403, API_V1_ERROR_CODES.FORBIDDEN, message, { type: 'permission_error' });

/** @param {string} message Message. @returns {ApiError} 404 response. */
export const notFound = (message = 'The requested resource does not exist.') =>
    new ApiError(404, API_V1_ERROR_CODES.NOT_FOUND, message, { type: 'not_found_error' });

/** @param {string} message Message. @returns {ApiError} 409 response. */
export const conflict = (message) => new ApiError(409, API_V1_ERROR_CODES.CONFLICT, message, { type: 'conflict_error' });

/** @param {string} message Message. @returns {ApiError} 501 response. */
export const notImplemented = (message, details) =>
    new ApiError(501, API_V1_ERROR_CODES.NOT_IMPLEMENTED, message, { type: 'not_implemented_error', details });

/**
 * Send an error using the shared envelope.
 * @param {import('express').Response} response Express response.
 * @param {unknown} error Thrown value.
 * @param {string} fallbackMessage Message used when the error is not an ApiError.
 * @returns {import('express').Response} The response.
 */
export function sendApiError(response, error, fallbackMessage = 'The request could not be completed.') {
    if (response.headersSent) {
        // A stream already started; the client sees the failure inside the stream.
        response.end();
        return response;
    }
    if (error instanceof ApiError) {
        if (error.status >= 500) {
            console.error(`[api-v1] ${error.code}: ${error.message}`);
        }
        return response.status(error.status).send({
            error: {
                code: error.code,
                message: error.message,
                type: error.type,
                ...(error.details === undefined ? {} : { details: error.details }),
            },
        });
    }
    console.error(`[api-v1] ${fallbackMessage}`, error);
    return response.status(500).send({
        error: {
            code: API_V1_ERROR_CODES.INTERNAL,
            message: `${fallbackMessage} Check the server log for details.`,
            type: 'server_error',
        },
    });
}

/**
 * Wrap an async route so a rejected promise becomes a stable error envelope
 * instead of an unhandled rejection.
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<unknown>} handler Route handler.
 * @param {string} [fallbackMessage] Message for unexpected failures.
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>} Express handler.
 */
export function asyncRoute(handler, fallbackMessage) {
    return async (request, response) => {
        try {
            await handler(request, response);
        } catch (error) {
            sendApiError(response, error, fallbackMessage);
        }
    };
}
