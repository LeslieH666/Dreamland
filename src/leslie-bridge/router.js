import express from 'express';

import {
    handleGenerateVolcengineVoice,
    handleListVolcengineVoices,
} from '../endpoints/volcengine.js';
import { handleChatCompletionGenerate } from '../endpoints/backends/chat-completions.js';
import { recognizeSpeech } from '../endpoints/speech.js';
import { LeslieBridgeRequestError } from './errors.js';
import {
    getLeslieBridgeChatConfiguration,
    toSillyTavernChatCompletionRequest,
} from './model-chat.js';
import { toVolcengineSpeechRequest } from './openai-audio.js';
import {
    getCompanionTurnInput,
    toCompanionSpeechRequest,
    toCompanionTranscriptionRequest,
} from './companion-request.js';
import { companionSession } from './companion-session.js';
import {
    LESLIE_BRIDGE_CAPABILITIES,
    LESLIE_BRIDGE_CHAT_MODEL,
    LESLIE_BRIDGE_PROTOCOL_VERSION,
    LESLIE_BRIDGE_TTS_MODEL,
} from './protocol.js';

export const router = express.Router();

router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Leslie-Bridge-Version', LESLIE_BRIDGE_PROTOCOL_VERSION);
    next();
});

router.get('/health', (_request, response) => {
    return response.send({
        status: 'ok',
        service: LESLIE_BRIDGE_CAPABILITIES.service,
        protocol: LESLIE_BRIDGE_CAPABILITIES.protocol,
    });
});

router.get('/capabilities', (_request, response) => {
    return response.send(LESLIE_BRIDGE_CAPABILITIES);
});

router.get('/companion/state', (_request, response) => {
    return response.send(companionSession.getState());
});

router.get('/models', (_request, response) => {
    return response.send({
        object: 'list',
        data: [{
            id: LESLIE_BRIDGE_TTS_MODEL,
            object: 'model',
            created: 0,
            owned_by: 'leslie-tavern',
        }],
    });
});

router.get('/voices', handleListVolcengineVoices);

router.get('/model/chat/models', (request, response) => {
    try {
        const configuration = getLeslieBridgeChatConfiguration(request.user.directories);
        return response.send({
            object: 'list',
            data: [{
                id: LESLIE_BRIDGE_CHAT_MODEL,
                object: 'model',
                created: 0,
                owned_by: 'leslie-tavern',
                leslie_source: configuration.source,
                leslie_upstream_model: configuration.model,
            }],
        });
    } catch (error) {
        return sendBridgeError(response, error, 'Leslie Bridge chat model discovery failed.');
    }
});

router.post('/model/chat/completions', async (request, response) => {
    try {
        const configuration = getLeslieBridgeChatConfiguration(request.user.directories);
        request.body = toSillyTavernChatCompletionRequest(request.body, configuration);
        request.leslieBridge.modelGateway = true;
        return await handleChatCompletionGenerate(request, response);
    } catch (error) {
        return sendBridgeError(response, error, 'Leslie Bridge chat model request failed.');
    }
});

router.post('/chat/completions', (request, response) => {
    try {
        const input = getCompanionTurnInput(request.body);
        const turn = companionSession.createTurn(input);
        let sentText = '';
        let closed = false;
        let unsubscribe = () => {};

        response.status(200);
        response.set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
        });
        response.flushHeaders();

        const writeChunk = (delta, finishReason = null) => {
            response.write(`data: ${JSON.stringify({
                id: turn.id,
                object: 'chat.completion.chunk',
                created: 0,
                model: LESLIE_BRIDGE_CHAT_MODEL,
                choices: [{
                    index: 0,
                    delta: delta ? { content: delta } : {},
                    finish_reason: finishReason,
                }],
            })}\n\n`);
        };
        const finish = () => {
            if (closed) {
                return;
            }
            closed = true;
            unsubscribe();
            writeChunk('', 'stop');
            response.end('data: [DONE]\n\n');
        };

        unsubscribe = turn.subscribe((event) => {
            if (closed) {
                return;
            }
            if (event.type === 'delta' || event.type === 'complete') {
                const text = String(event.text ?? '');
                const delta = text.startsWith(sentText) ? text.slice(sentText.length) : text;
                sentText = text;
                if (delta) {
                    writeChunk(delta);
                }
            }
            if (event.type === 'complete') {
                finish();
            } else if (event.type === 'error' || event.type === 'canceled') {
                closed = true;
                unsubscribe();
                response.end(`data: ${JSON.stringify({ error: {
                    code: event.code || 'COMPANION_TURN_FAILED',
                    message: event.message || 'The DreamLand turn failed.',
                } })}\n\n`);
            }
        });

        response.on('close', () => {
            if (!closed) {
                closed = true;
                unsubscribe();
                turn.cancel();
            }
        });
    } catch (error) {
        return sendBridgeError(response, error, 'Leslie companion turn failed.');
    }
});

router.post('/companion/audio/speech', async (request, response) => {
    try {
        request.body = toCompanionSpeechRequest(request.body, companionSession.getState());
        return await handleGenerateVolcengineVoice(request, response);
    } catch (error) {
        return sendBridgeError(response, error, 'Leslie companion speech failed.');
    }
});

router.post('/companion/audio/transcriptions', async (request, response) => {
    try {
        const transcription = toCompanionTranscriptionRequest(request.body);
        return response.send(await recognizeSpeech(transcription));
    } catch (error) {
        return sendBridgeError(response, error, 'Leslie companion transcription failed.');
    }
});

router.post('/audio/speech', async (request, response) => {
    try {
        request.body = toVolcengineSpeechRequest(request.body);
        return await handleGenerateVolcengineVoice(request, response);
    } catch (error) {
        if (error instanceof LeslieBridgeRequestError) {
            return response.status(error.status).send({
                error: {
                    code: error.code,
                    message: error.message,
                    type: 'invalid_request_error',
                },
            });
        }
        console.error('Leslie Bridge speech request failed.', error);
        return response.status(500).send({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Leslie Bridge speech request failed. Check the server log for details.',
                type: 'server_error',
            },
        });
    }
});

function sendBridgeError(response, error, fallbackMessage) {
    if (error instanceof LeslieBridgeRequestError) {
        return response.status(error.status).send({
            error: {
                code: error.code,
                message: error.message,
                type: 'invalid_request_error',
            },
        });
    }
    console.error(fallbackMessage, error);
    return response.status(500).send({
        error: {
            code: 'INTERNAL_ERROR',
            message: `${fallbackMessage} Check the server log for details.`,
            type: 'server_error',
        },
    });
}
