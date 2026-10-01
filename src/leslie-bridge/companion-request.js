import { LeslieBridgeRequestError } from './errors.js';
import { LESLIE_BRIDGE_TRANSCRIPTION_MODEL } from './protocol.js';

const VOLCENGINE_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const MAX_TRANSCRIPTION_BYTES = 32 * 1024 * 1024;

function textFromContent(content) {
    if (typeof content === 'string') {
        return content.trim();
    }
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n')
        .trim();
}

/**
 * Read only the latest user input from an OpenAI-compatible AIRI request.
 * DreamLand owns the authoritative prompt and ignores the AIRI history.
 * @param {Record<string, unknown>} [body] AIRI chat request.
 * @returns {string} Latest user input.
 */
export function getCompanionTurnInput(body = {}) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role !== 'user') {
            continue;
        }
        const text = textFromContent(messages[index].content);
        if (text) {
            return text;
        }
    }
    throw new LeslieBridgeRequestError('INPUT_REQUIRED', 'The AIRI request must contain a user message.');
}

/**
 * Use the voice that DreamLand assigned to the active character.
 * @param {Record<string, unknown>} [body] AIRI speech request.
 * @param {Record<string, unknown>} state Current companion state.
 * @returns {Record<string, unknown>} Leslie Volcengine request.
 */
export function toCompanionSpeechRequest(body = {}, state = {}) {
    const input = typeof body.input === 'string' ? body.input.trim() : '';
    if (!input) {
        throw new LeslieBridgeRequestError('INPUT_REQUIRED', 'The speech request must contain text.');
    }

    const voice = state.voice;
    if (!state.connected || !voice?.available || !voice.speakerId || !voice.resourceId) {
        throw new LeslieBridgeRequestError(
            'CHARACTER_VOICE_NOT_READY',
            'Configure a voice for the active character in DreamLand.',
            409,
        );
    }

    return {
        provider_endpoint: VOLCENGINE_TTS_ENDPOINT,
        resource_id: voice.resourceId,
        text: input,
        voice_speaker: voice.speakerId,
        speed: Number(voice.speed) || 0,
        language_mode: voice.languageMode || 'auto',
    };
}

/**
 * Map a private Bridge request to DreamLand's local speech recognizer.
 * The public model id selects the model that DreamLand already configures.
 * @param {Record<string, unknown>} [body] AIRI transcription request.
 * @returns {{audio: string, lang: string, model: string}} Local recognizer request.
 */
export function toCompanionTranscriptionRequest(body = {}) {
    if (body.model !== LESLIE_BRIDGE_TRANSCRIPTION_MODEL) {
        throw new LeslieBridgeRequestError(
            'UNSUPPORTED_TRANSCRIPTION_MODEL',
            `Use the ${LESLIE_BRIDGE_TRANSCRIPTION_MODEL} transcription model.`,
        );
    }

    const contentType = typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
    if (!['audio/wav', 'audio/x-wav'].includes(contentType)) {
        throw new LeslieBridgeRequestError('UNSUPPORTED_AUDIO_FORMAT', 'The transcription request must contain WAV audio.');
    }

    const audio = typeof body.audio === 'string' ? body.audio.trim() : '';
    if (!audio || audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
        throw new LeslieBridgeRequestError('INVALID_AUDIO', 'The transcription request must contain valid base64 audio.');
    }
    const padding = audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0;
    const byteLength = (audio.length * 3 / 4) - padding;
    if (byteLength <= 0 || byteLength > MAX_TRANSCRIPTION_BYTES) {
        throw new LeslieBridgeRequestError(
            'AUDIO_TOO_LARGE',
            `The transcription audio must contain between 1 and ${MAX_TRANSCRIPTION_BYTES} bytes.`,
            413,
        );
    }

    const language = typeof body.language === 'string' ? body.language.trim() : '';
    if (language.length > 32 || (language && !/^[A-Za-z-]+$/.test(language))) {
        throw new LeslieBridgeRequestError('INVALID_LANGUAGE', 'The transcription language is not valid.');
    }

    return {
        audio: `data:${contentType};base64,${audio}`,
        lang: language,
        model: '',
    };
}
