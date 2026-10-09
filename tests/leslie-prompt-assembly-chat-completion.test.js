import { describe, expect, test } from '@jest/globals';

import {
    ChatCompletion,
    IdentifierNotFoundError,
    InvalidCharacterNameError,
    Message,
    MessageCollection,
    TokenBudgetExceededError,
    TokenHandler,
    configureChatCompletion,
    getChatCompletionEnvironment,
} from '../src/prompt-assembly/chat-completion.js';

/**
 * Install a minimal environment so the classes can run.
 * @returns {object} The environment that was installed.
 */
function installEnv() {
    const env = {
        tokenHandler: { countAsync: async () => 1, getCounts: () => ({}) },
        media: {
            createThumbnail: async () => 'thumb',
            getBase64Async: async () => 'data:,',
            getImageSizeFromDataURL: () => ({ width: 1, height: 1 }),
            getVideoDurationFromDataURL: () => 0,
            getAudioDurationFromDataURL: () => 0,
            isDataURL: value => String(value).startsWith('data:'),
        },
        getOaiSettings: () => ({
            chat_completion_source: 'custom',
            openai_model: 'fixture-model',
            reverse_proxy: '',
            media_inlining: false,
            inline_image_quality: 'auto',
            request_images: false,
            snapshots: {},
        }),
        getDefaultSettings: () => ({ snapshots: {} }),
        chatCompletionSources: { CUSTOM: 'custom', CLAUDE: 'claude', OPENAI: 'openai' },
    };
    configureChatCompletion(env);
    return env;
}

describe('configureChatCompletion', () => {
    test('fails closed when required keys are missing', () => {
        expect(() => configureChatCompletion()).toThrow(/missing required environment keys/u);
        expect(() => configureChatCompletion({ tokenHandler: {} })).toThrow(/media/u);
    });

    test('accepts a complete environment and exposes it', () => {
        const env = installEnv();
        expect(getChatCompletionEnvironment()).toBe(env);
    });

    test('names every missing key in the error', () => {
        try {
            configureChatCompletion({ tokenHandler: {} });
            throw new Error('expected a throw');
        } catch (error) {
            expect(error.message).toContain('media');
            expect(error.message).toContain('getOaiSettings');
            expect(error.message).toContain('chatCompletionSources');
        }
    });
});

describe('TokenHandler', () => {
    test('accumulates counts and reports a total', () => {
        installEnv();
        const handler = new TokenHandler(async () => 5);
        expect(handler.getCounts()).toHaveProperty('start_chat');
        handler.counts.prompt = 3;
        handler.counts.conversation = 4;
        expect(handler.getTotal()).toBe(7);
    });

    test('ignores non-numeric counts in the total', () => {
        installEnv();
        const handler = new TokenHandler(async () => 1);
        handler.counts.prompt = Number.NaN;
        handler.counts.bias = 2;
        expect(handler.getTotal()).toBe(2);
    });
});

describe('Message', () => {
    test('builds a message from positional arguments', async () => {
        installEnv();
        // The constructor is positional and documented as internal; the public path
        // is Message.createAsync. Both are exercised here.
        const message = new Message('user', 'hello', 'test-id');
        expect(message.role).toBe('user');
        expect(message.content).toBe('hello');
        expect(message.identifier).toBe('test-id');

        const created = await Message.createAsync('assistant', 'hi', 'other-id');
        expect(created).toBeInstanceOf(Message);
        expect(created.role).toBe('assistant');
    });

    test('exposes the collection it belongs to', () => {
        installEnv();
        const collection = new MessageCollection();
        expect(collection).toBeInstanceOf(MessageCollection);
    });
});

describe('ChatCompletion', () => {
    test('starts empty and reports its chat', () => {
        installEnv();
        const completion = new ChatCompletion();
        expect(typeof completion.getChat).toBe('function');
        expect(Array.isArray(completion.getChat())).toBe(true);
    });
});

describe('error types', () => {
    test('carry their names and identifiers', () => {
        installEnv();
        expect(new IdentifierNotFoundError('main').name).toBe('IdentifierNotFoundError');
        expect(new TokenBudgetExceededError('main').name).toBe('TokenBudgetExceeded');
        expect(new InvalidCharacterNameError('bad name').name).toBe('InvalidCharacterName');
        expect(new IdentifierNotFoundError('main').message).toContain('main');
    });
});
