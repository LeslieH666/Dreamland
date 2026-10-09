export const LESLIE_BRIDGE_API_ROOT = '/api/leslie/bridge/v1';
export const LESLIE_BRIDGE_PROTOCOL_NAME = 'leslie-bridge';
export const LESLIE_BRIDGE_PROTOCOL_VERSION = '1';
export const LESLIE_BRIDGE_CHAT_MODEL = 'leslie-current-chat';
export const LESLIE_BRIDGE_TTS_MODEL = 'leslie-volcengine-tts';

export const LESLIE_BRIDGE_CAPABILITIES = Object.freeze({
    service: 'leslie-tavern',
    protocol: {
        name: LESLIE_BRIDGE_PROTOCOL_NAME,
        version: LESLIE_BRIDGE_PROTOCOL_VERSION,
    },
    capabilities: {
        authentication: {
            bearerToken: true,
            tokenSource: 'process-environment',
        },
        chat: {
            available: true,
            authoritativeStore: 'leslie-tavern',
            binding: 'active-leslie-character',
            protocol: 'openai-chat-completions',
        },
        modelGateway: {
            available: true,
            authoritativeStore: 'leslie-tavern',
            model: LESLIE_BRIDGE_CHAT_MODEL,
            protocol: 'openai-chat-completions',
        },
        characters: {
            available: true,
            binding: 'active-leslie-character',
        },
        speech: {
            available: true,
            protocol: 'openai-audio-speech',
            provider: 'volcengine',
            model: LESLIE_BRIDGE_TTS_MODEL,
            responseFormats: ['mp3'],
        },
    },
});
