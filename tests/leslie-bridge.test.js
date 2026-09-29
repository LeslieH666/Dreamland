import { describe, expect, jest, test } from '@jest/globals';

import {
    createLeslieBridgeAuthenticationMiddleware,
    getLeslieBridgeTokenConfiguration,
    isLeslieBridgeRequestAuthenticated,
    leslieBridgeTokensMatch,
    parseLeslieBridgeBearerToken,
} from '../src/leslie-bridge/auth.js';
import {
    LeslieBridgeRequestError,
    openAISpeedToVolcengineRate,
    toVolcengineSpeechRequest,
} from '../src/leslie-bridge/openai-audio.js';
import {
    getLeslieBridgeChatConfigurationFromSettings,
    toSillyTavernChatCompletionRequest,
} from '../src/leslie-bridge/model-chat.js';
import { createCompanionSession } from '../src/leslie-bridge/companion-session.js';
import {
    getCompanionTurnInput,
    toCompanionSpeechRequest,
    toCompanionTranscriptionRequest,
} from '../src/leslie-bridge/companion-request.js';
import {
    LESLIE_BRIDGE_API_ROOT,
    LESLIE_BRIDGE_CAPABILITIES,
    LESLIE_BRIDGE_CHAT_MODEL,
    LESLIE_BRIDGE_PROTOCOL_VERSION,
    LESLIE_BRIDGE_TRANSCRIPTION_MODEL,
    LESLIE_BRIDGE_TTS_MODEL,
} from '../src/leslie-bridge/protocol.js';

const VALID_TOKEN = '0123456789abcdef0123456789abcdef';

function createResponse() {
    return {
        body: undefined,
        headers: {},
        statusCode: 200,
        set(name, value) {
            this.headers[name] = value;
            return this;
        },
        status(statusCode) {
            this.statusCode = statusCode;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };
}

describe('Leslie Bridge protocol foundation', () => {
    test('declares LeslieTavern as the authoritative companion store', () => {
        expect(LESLIE_BRIDGE_API_ROOT).toBe('/api/leslie/bridge/v1');
        expect(LESLIE_BRIDGE_CAPABILITIES.protocol.version).toBe(LESLIE_BRIDGE_PROTOCOL_VERSION);
        expect(LESLIE_BRIDGE_CAPABILITIES.capabilities.chat).toMatchObject({
            available: true,
            authoritativeStore: 'leslie-tavern',
        });
        expect(LESLIE_BRIDGE_CAPABILITIES.capabilities.characters).toMatchObject({
            available: true,
            binding: 'active-leslie-character',
        });
        expect(LESLIE_BRIDGE_CAPABILITIES.capabilities.sessions).toMatchObject({
            available: true,
            authoritativeStore: 'leslie-tavern',
        });
        expect(LESLIE_BRIDGE_CAPABILITIES.capabilities.speech).toMatchObject({
            available: true,
            model: LESLIE_BRIDGE_TTS_MODEL,
            responseFormats: ['mp3'],
        });
        expect(LESLIE_BRIDGE_CAPABILITIES.capabilities.transcription).toMatchObject({
            available: true,
            model: LESLIE_BRIDGE_TRANSCRIPTION_MODEL,
            provider: 'leslie-local-transformers',
        });
    });

    test('keeps the bridge disabled for missing or weak process tokens', () => {
        expect(getLeslieBridgeTokenConfiguration({})).toEqual({ enabled: false, reason: 'missing' });
        expect(getLeslieBridgeTokenConfiguration({ LESLIE_BRIDGE_TOKEN: 'too-short' })).toEqual({ enabled: false, reason: 'invalid' });
        expect(getLeslieBridgeTokenConfiguration({ LESLIE_BRIDGE_TOKEN: VALID_TOKEN })).toMatchObject({
            enabled: true,
            reason: 'configured',
        });
    });

    test('accepts bearer authentication and marks only successful requests for CSRF bypass', () => {
        const middleware = createLeslieBridgeAuthenticationMiddleware({
            environment: { LESLIE_BRIDGE_TOKEN: VALID_TOKEN },
        });
        const headers = { authorization: `Bearer ${VALID_TOKEN}` };
        const request = {
            get: name => headers[name],
        };
        const response = createResponse();
        const next = jest.fn();

        middleware(request, response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(isLeslieBridgeRequestAuthenticated(request)).toBe(true);
        expect(response.headers['Cache-Control']).toBe('no-store');
    });

    test('rejects incorrect tokens without returning either secret', () => {
        const supplied = 'fedcba9876543210fedcba9876543210';
        const middleware = createLeslieBridgeAuthenticationMiddleware({
            environment: { LESLIE_BRIDGE_TOKEN: VALID_TOKEN },
        });
        const request = { get: () => `Bearer ${supplied}` };
        const response = createResponse();
        const next = jest.fn();

        middleware(request, response, next);

        expect(next).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(401);
        expect(response.headers['WWW-Authenticate']).toContain('Bearer');
        expect(JSON.stringify(response.body)).not.toContain(VALID_TOKEN);
        expect(JSON.stringify(response.body)).not.toContain(supplied);
        expect(isLeslieBridgeRequestAuthenticated(request)).toBe(false);
    });

    test('parses one bearer token and compares equal-length secrets safely', () => {
        expect(parseLeslieBridgeBearerToken(`Bearer ${VALID_TOKEN}`)).toBe(VALID_TOKEN);
        expect(parseLeslieBridgeBearerToken(`Basic ${VALID_TOKEN}`)).toBeNull();
        expect(parseLeslieBridgeBearerToken(`Bearer ${VALID_TOKEN} extra`)).toBeNull();
        expect(leslieBridgeTokensMatch(VALID_TOKEN, VALID_TOKEN)).toBe(true);
        expect(leslieBridgeTokensMatch('short', VALID_TOKEN)).toBe(false);
    });
});

describe('Leslie Bridge authoritative companion session', () => {
    const snapshot = {
        userSpaceId: 'synthetic-space-a',
        binding: {
            characterId: '4',
            characterName: 'Feixiao',
            chatId: 'Feixiao - 2026-08-11',
            personaName: 'Leslie',
        },
        characters: [
            { id: '4', name: 'Feixiao', avatar: 'Feixiao.png' },
            { id: '9', name: 'Yichui', avatar: 'Yichui.png' },
        ],
        generating: false,
        voice: {
            available: true,
            speakerId: 'zh_female_feixiao',
            resourceId: 'volc.service_type.10029',
            speed: 0,
            languageMode: 'auto',
        },
    };

    test('binds AIRI to the current Leslie character and queues one authoritative turn', async () => {
        let now = 1_000;
        const session = createCompanionSession({
            createId: () => 'turn-1',
            now: () => now,
        });

        session.updateHost('host-1', snapshot);
        expect(session.getState()).toMatchObject({
            connected: true,
            binding: snapshot.binding,
            voice: snapshot.voice,
        });

        const turn = session.createTurn('Hello, Feixiao.');
        const command = await session.pollHost({
            hostId: 'host-1',
            snapshot,
            timeoutMs: 1,
        });

        expect(turn.id).toBe('turn-1');
        expect(turn.binding).toEqual(snapshot.binding);
        expect(command).toEqual({
            id: 'turn-1',
            type: 'turn',
            input: 'Hello, Feixiao.',
            binding: snapshot.binding,
            userSpaceId: 'synthetic-space-a',
        });

        const events = [];
        turn.subscribe(event => events.push(event));
        session.publishHostEvent({
            hostId: 'host-1',
            requestId: 'turn-1',
            event: { type: 'delta', text: 'Hello' },
        });
        session.publishHostEvent({
            hostId: 'host-1',
            requestId: 'turn-1',
            event: { type: 'complete', text: 'Hello, Leslie.' },
        });

        expect(events).toEqual([
            { type: 'delta', text: 'Hello' },
            { type: 'complete', text: 'Hello, Leslie.' },
        ]);

        now += 20_000;
        expect(session.getState()).toMatchObject({ connected: false });
    });

    test('rejects a turn when no Leslie page owns an active character', () => {
        const session = createCompanionSession({ createId: () => 'turn-2' });

        expect(() => session.createTurn('Hello.')).toThrow('Open LeslieTavern and select a character');

        session.updateHost('host-1', { ...snapshot, binding: null });
        expect(() => session.createTurn('Hello.')).toThrow('Select a character in LeslieTavern');
    });

    test('replaces stale bindings when the browser changes user space', async () => {
        const session = createCompanionSession({ createId: () => 'turn-space' });
        session.updateHost('host-1', snapshot);
        const turn = session.createTurn('Message for space A.');
        const events = [];
        turn.subscribe(event => events.push(event));

        session.updateHost('host-1', {
            ...snapshot,
            userSpaceId: 'synthetic-space-b',
            binding: { ...snapshot.binding, characterName: 'Space B character' },
            characters: [{ id: '4', name: 'Space B character', avatar: 'space-b.png' }],
        });

        expect(events).toEqual([expect.objectContaining({
            type: 'error',
            code: 'COMPANION_HOST_REPLACED',
        })]);
        expect(session.getState()).toMatchObject({
            connected: true,
            binding: { characterName: 'Space B character' },
            characters: [{ name: 'Space B character' }],
        });
        expect(session.getState()).not.toHaveProperty('userSpaceId');
        await expect(session.pollHost({
            hostId: 'host-1',
            snapshot: { ...snapshot, userSpaceId: 'synthetic-space-b' },
            timeoutMs: 1,
        })).resolves.toBeNull();
    });

    test('uses only the latest AIRI user input and the bound Leslie voice', () => {
        expect(getCompanionTurnInput({
            messages: [
                { role: 'system', content: 'AIRI system prompt that Leslie must ignore.' },
                { role: 'user', content: 'Old AIRI history.' },
                { role: 'assistant', content: 'Old AIRI reply.' },
                { role: 'user', content: [{ type: 'text', text: 'Current user input.' }] },
            ],
        })).toBe('Current user input.');

        expect(toCompanionSpeechRequest({ input: ' Speak as Feixiao. ', voice: 'ignored-airi-voice' }, {
            connected: true,
            voice: snapshot.voice,
        })).toEqual({
            provider_endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            resource_id: 'volc.service_type.10029',
            text: 'Speak as Feixiao.',
            voice_speaker: 'zh_female_feixiao',
            speed: 0,
            language_mode: 'auto',
        });
    });

    test('maps AIRI WAV audio to the Leslie local speech recognizer', () => {
        expect(toCompanionTranscriptionRequest({
            audio: 'UklGRg==',
            content_type: 'audio/wav',
            language: 'zh',
            model: LESLIE_BRIDGE_TRANSCRIPTION_MODEL,
        })).toEqual({
            audio: 'data:audio/wav;base64,UklGRg==',
            lang: 'zh',
            model: '',
        });

        expect(() => toCompanionTranscriptionRequest({
            audio: 'not base64',
            content_type: 'audio/wav',
            model: LESLIE_BRIDGE_TRANSCRIPTION_MODEL,
        })).toThrow('valid base64');
        expect(() => toCompanionTranscriptionRequest({
            audio: 'UklGRg==',
            content_type: 'audio/webm',
            model: LESLIE_BRIDGE_TRANSCRIPTION_MODEL,
        })).toThrow('WAV audio');
    });
});

describe('Leslie Bridge AIRI chat model gateway', () => {
    const savedSettings = {
        main_api: 'openai',
        oai_settings: {
            chat_completion_source: 'openrouter',
            openrouter_model: 'synthetic/model-a',
            openrouter_allow_fallbacks: false,
            openrouter_middleout: 'off',
            openrouter_providers: ['Synthetic Provider'],
            openrouter_quantizations: ['fp16'],
            openrouter_use_fallback: true,
            temp_openai: 0.7,
            freq_pen_openai: 0.1,
            pres_pen_openai: 0.2,
            top_p_openai: 0.9,
            openai_max_tokens: 512,
            show_thoughts: true,
            reasoning_effort: 'medium',
        },
    };

    test('reads the active Leslie Chat Completions source and model', () => {
        const configuration = getLeslieBridgeChatConfigurationFromSettings(savedSettings);

        expect(configuration.source).toBe('openrouter');
        expect(configuration.model).toBe('synthetic/model-a');
        expect(configuration.settings).toBe(savedSettings.oai_settings);
    });

    test('maps AIRI messages to the existing model proxy without prompt assembly', () => {
        const configuration = getLeslieBridgeChatConfigurationFromSettings(savedSettings);
        const messages = [{ role: 'user', content: 'Synthetic test message.' }];
        const tools = [{ type: 'function', function: { name: 'synthetic_tool', parameters: { type: 'object' } } }];
        const request = toSillyTavernChatCompletionRequest({
            model: LESLIE_BRIDGE_CHAT_MODEL,
            messages,
            stream: true,
            temperature: 0.4,
            tools,
            tool_choice: 'auto',
        }, configuration);

        expect(request.messages).toBe(messages);
        expect(request.model).toBe('synthetic/model-a');
        expect(request.chat_completion_source).toBe('openrouter');
        expect(request.temperature).toBe(0.4);
        expect(request.max_tokens).toBe(512);
        expect(request.stream).toBe(true);
        expect(request.tools).toBe(tools);
        expect(request.tool_choice).toBe('auto');
        expect(request.include_reasoning).toBe(true);
        expect(request.reasoning_effort).toBe('medium');
        expect(request.use_fallback).toBe(true);
        expect(request.provider).toEqual(['Synthetic Provider']);
        expect(request.quantizations).toEqual(['fp16']);
        expect(request.allow_fallbacks).toBe(false);
        expect(request.middleout).toBe('off');
    });

    test('rejects unsupported settings, models, and empty message lists', () => {
        expect(() => getLeslieBridgeChatConfigurationFromSettings({
            main_api: 'textgenerationwebui',
        })).toThrow('Select a Chat Completions provider');
        const configuration = getLeslieBridgeChatConfigurationFromSettings(savedSettings);
        expect(() => toSillyTavernChatCompletionRequest({
            model: 'different-model',
            messages: [{ role: 'user', content: 'Synthetic test message.' }],
        }, configuration)).toThrow('Unsupported chat model');
        expect(() => toSillyTavernChatCompletionRequest({
            model: LESLIE_BRIDGE_CHAT_MODEL,
            messages: [],
        }, configuration)).toThrow('messages must contain');
    });
});

describe('Leslie Bridge OpenAI-compatible speech mapping', () => {
    test('maps AIRI speech fields to the existing Volcengine boundary', () => {
        expect(toVolcengineSpeechRequest({
            model: LESLIE_BRIDGE_TTS_MODEL,
            input: ' Hello, Leslie. ',
            voice: 'zh_female_example',
            speed: 1.25,
            response_format: 'mp3',
            resource_id: 'volc.service_type.example',
        })).toEqual({
            resource_id: 'volc.service_type.example',
            text: 'Hello, Leslie.',
            voice_speaker: 'zh_female_example',
            speed: 25,
            language_mode: undefined,
        });
    });

    test('uses a process resource ID and accepts the common tts-1 alias', () => {
        expect(toVolcengineSpeechRequest({
            model: 'tts-1',
            input: 'Test',
            voice: 'voice-a',
        }, {
            LESLIE_BRIDGE_VOLCENGINE_RESOURCE_ID: 'resource-from-process',
        })).toMatchObject({
            resource_id: 'resource-from-process',
            speed: 0,
        });
    });

    test('clamps provider speed and rejects unsupported or incomplete requests', () => {
        expect(openAISpeedToVolcengineRate(0.1)).toBe(-50);
        expect(openAISpeedToVolcengineRate(4)).toBe(100);
        expect(() => openAISpeedToVolcengineRate(0)).toThrow(LeslieBridgeRequestError);
        expect(() => toVolcengineSpeechRequest({
            model: 'unknown-model',
            input: 'Test',
            voice: 'voice-a',
            resource_id: 'resource-a',
        })).toThrow('Unsupported speech model');
        expect(() => toVolcengineSpeechRequest({
            input: '',
            voice: 'voice-a',
            resource_id: 'resource-a',
        })).toThrow('input must contain text');
        expect(() => toVolcengineSpeechRequest({
            input: 'Test',
            voice: 'voice-a',
            resource_id: 'resource-a',
            response_format: 'wav',
        })).toThrow('Only the mp3');
    });
});
