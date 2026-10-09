import { describe, expect, jest, test } from '@jest/globals';

import { prepareOpenAIMessagesCore } from '../src/prompt-assembly/orchestrate.js';

/**
 * Minimal environment for the orchestration function.
 * @param {object} [overrides] Overrides.
 * @returns {object} Environment.
 */
function env(overrides = {}) {
    const chat = [{ role: 'user', content: 'hi' }];
    const chatCompletion = {
        enableLogging: jest.fn(),
        setTokenBudget: jest.fn(),
        getChat: () => chat,
        log: jest.fn(),
        squashSystemMessages: jest.fn(),
    };
    const promptManager = {
        activeCharacter: { name: 'Fixture' },
        serviceSettings: { chat_completion_source: 'custom', openai_max_context: 4096, openai_max_tokens: 256 },
        tokenHandler: { counts: { prompt: 1 } },
        setChatCompletion: jest.fn(),
        render: jest.fn(),
        error: null,
    };
    return {
        ChatCompletion: jest.fn(() => chatCompletion),
        getPromptManager: () => promptManager,
        getPowerUser: () => ({ console_log_prompts: false }),
        getOaiSettings: () => ({ squash_system_messages: false }),
        getGenerationTokenBudget: () => ({ contextTokens: 4096, outputTokens: 256 }),
        notify: { error: jest.fn(), warning: jest.fn() },
        t: strings => String.raw({ raw: strings }),
        emit: jest.fn(async () => {}),
        eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready' },
        setOpenaiMessagesCount: jest.fn(),
        __chatCompletion: chatCompletion,
        __promptManager: promptManager,
        ...overrides,
    };
}

const input = {
    name2: 'User',
    charDescription: 'd', charPersonality: 'p', scenario: 's',
    worldInfoBefore: '', worldInfoAfter: '', bias: '', type: 'normal',
    quietPrompt: '', quietImage: null, extensionPrompts: {},
    cyclePrompt: null, systemPromptOverride: null, jailbreakPromptOverride: null,
    messages: [{ role: 'user', content: 'hi' }], messageExamples: [],
};

describe('interceptor hook', () => {
    test('is not called when the environment provides none', async () => {
        const environment = env();
        await prepareOpenAIMessagesCore(input, false, environment);
        expect(environment.runInterceptors).toBeUndefined();
    });

    test('is called exactly once when provided', async () => {
        const runInterceptors = jest.fn(async () => {});
        const environment = env({ runInterceptors });
        await prepareOpenAIMessagesCore(input, false, environment);
        expect(runInterceptors).toHaveBeenCalledTimes(1);
        expect(runInterceptors).toHaveBeenCalledWith({ type: 'normal', dryRun: false });
    });
});

describe('prepareOpenAIMessagesCore', () => {
    test('constructs ChatCompletion through the environment', async () => {
        const environment = env();
        await prepareOpenAIMessagesCore(input, false, environment);
        expect(environment.ChatCompletion).toHaveBeenCalledTimes(1);
    });

    test('emits the prompt-ready event and records the message count', async () => {
        const environment = env();
        await prepareOpenAIMessagesCore(input, false, environment);
        expect(environment.emit).toHaveBeenCalledTimes(1);
        expect(environment.emit.mock.calls[0][0]).toBe('chat_completion_prompt_ready');
        expect(environment.setOpenaiMessagesCount).toHaveBeenCalledWith(1);
    });

    test('returns the chat and the token counts', async () => {
        const environment = env();
        const [chat, counts] = await prepareOpenAIMessagesCore(input, false, environment);
        expect(chat).toEqual([{ role: 'user', content: 'hi' }]);
        expect(counts).toEqual({ prompt: 1 });
    });

    test('bails out before building anything when no character is active in dry run', async () => {
        const environment = env();
        environment.getPromptManager().activeCharacter = null;
        const result = await prepareOpenAIMessagesCore(input, true, environment);
        expect(result).toEqual([null, false]);
        expect(environment.ChatCompletion).not.toHaveBeenCalled();
    });
});
