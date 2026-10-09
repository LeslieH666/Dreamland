/**
 * `/api/v1/voices` and `/api/v1/audio/speech` — character voice.
 *
 * Both handlers in `src/endpoints/volcengine.js` are exported and take an
 * Express request/response, so they are invoked directly. The bridge already
 * proves this pattern (`src/leslie-bridge/router.js`), including the
 * `toVolcengineSpeechRequest` body mapping, which is reused here verbatim.
 *
 * The legacy handlers answer failures with plain-text Chinese messages and
 * statuses such as 403/502/504; this module translates them into the shared
 * v1 error envelope so clients only ever decode one shape.
 */

import express from 'express';

import { handleGenerateVolcengineVoice, handleListVolcengineVoices } from '../../endpoints/volcengine.js';
import { toVolcengineSpeechRequest } from '../../leslie-bridge/openai-audio.js';
import { ApiError, asyncRoute } from '../errors.js';
import { invokeWithRequest } from '../adapters/express.js';
import { toApiList, toApiVoice } from '../presenters.js';

export const voiceRouter = express.Router();

/**
 * Map a legacy plain-text failure onto the v1 error envelope.
 * @param {number} status Legacy status.
 * @param {unknown} body Legacy body.
 * @param {string} fallbackMessage Fallback message.
 * @returns {ApiError} Mapped error.
 */
function toApiError(status, body, fallbackMessage) {
    const message = typeof body === 'string' && body.trim() ? body.trim().slice(0, 300) : fallbackMessage;
    if (status === 403) {
        return new ApiError(403, 'forbidden', message, { type: 'permission_error' });
    }
    if (status >= 500) {
        return new ApiError(502, 'upstream_error', message, { type: 'server_error' });
    }
    return new ApiError(status >= 400 ? status : 502, 'upstream_error', message, { type: 'server_error' });
}

voiceRouter.get('/voices', asyncRoute(async (request, response) => {
    const captured = await invokeWithRequest(handleListVolcengineVoices, request, { method: 'GET', path: '/voices' });
    if (captured.status !== 200 || !captured.body || typeof captured.body !== 'object') {
        throw toApiError(captured.status, captured.body, 'The voice catalog is unavailable.');
    }
    const voices = Array.isArray(captured.body.voices) ? captured.body.voices : [];
    response.set('Cache-Control', 'private, max-age=3600');
    response.send(toApiList(voices.map(voice => toApiVoice(voice))));
}, 'Listing voices failed.'));

voiceRouter.post('/audio/speech', asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    if (!body.input || String(body.input).trim() === '') {
        throw new ApiError(400, 'invalid_request_error', 'input is required.');
    }
    if (!body.voice || String(body.voice).trim() === '') {
        throw new ApiError(400, 'invalid_request_error', 'voice is required.');
    }

    // Reuse the bridge's OpenAI -> Volcengine mapping so both API surfaces
    // accept the same speech payload.
    let legacyBody;
    try {
        legacyBody = toVolcengineSpeechRequest({
            input: String(body.input),
            voice: String(body.voice),
            model: body.model ?? 'leslie-volcengine-tts',
            speed: body.speed,
            response_format: body.response_format ?? 'mp3',
            resource_id: body.resource_id,
        });
    } catch (error) {
        // A request-shape problem is a client error, not a 500.
        throw new ApiError(400, 'invalid_request_error', String(error?.message ?? 'Invalid speech request.'));
    }

    const captured = await invokeWithRequest(handleGenerateVolcengineVoice, request, {
        method: 'POST',
        path: '/generate-voice',
        body: legacyBody,
    });
    if (captured.status !== 200 || !Buffer.isBuffer(captured.raw)) {
        throw toApiError(captured.status, captured.body ?? captured.raw, 'Speech generation failed.');
    }
    response.set('Content-Type', 'audio/mpeg');
    response.set('Cache-Control', 'no-store');
    response.send(captured.raw);
}, 'Speech generation failed.'));
