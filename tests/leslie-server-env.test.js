import { describe, expect, test } from '@jest/globals';

import {
    buildServerAssemblyEnv,
    buildServerPromptManager,
    buildServerTokenHandler,
} from '../src/prompt-assembly/server-env.js';

/** @returns {object} A settings object shaped like the account's settings.json. */
function settings() {
    return {
        oai_settings: {
            chat_completion_source: 'custom',
            custom_model: 'fixture-model',
            openai_max_context: 4096,
            openai_max_tokens: 256,
            prompts: [{ identifier: 'main', content: 'M' }],
            prompt_order: [{ character_id: 1, order: [{ identifier: 'main', enabled: true }] }],
        },
        power_user: { console_log_prompts: false },
    };
}

describe('buildServerTokenHandler', () => {
    test('counts through the shared token counter and accumulates counts', async () => {
        const handler = buildServerTokenHandler(settings().oai_settings);
        expect(typeof handler.countAsync).toBe('function');
        expect(handler.getTotal()).toBe(0);
        await handler.countAsync({ role: 'user', content: 'hello' });
        expect(handler.getTotal()).toBeGreaterThan(0);
    });

    test('fails closed for an unsupported provider instead of guessing a tokenizer', () => {
        expect(() => buildServerTokenHandler({ chat_completion_source: 'groq' })).toThrow(/groq|provider/u);
    });
});

describe('buildServerPromptManager', () => {
    test('exposes the registry surface the shared functions expect', () => {
        const serviceSettings = settings().oai_settings;
        const manager = buildServerPromptManager({
            serviceSettings,
            activeCharacter: { id: 1 },
            tokenHandler: { counts: {} },
            createPromptCollection: () => ({ items: [], add() {} }),
        });
        expect(typeof manager.getPromptById('main')).toBe('object');
        expect(manager.getPromptOrderForCharacter({ id: 1 })).toEqual([{ identifier: 'main', enabled: true }]);
        expect(manager.getPromptOrderEntry({ id: 1 }, 'main')).toEqual({ identifier: 'main', enabled: true });
        expect(manager.preparePrompt({ identifier: 'x' })).toEqual({ identifier: 'x' });
    });

    test('can add a prompt order for an unknown character', () => {
        const manager = buildServerPromptManager({
            serviceSettings: { prompts: [], prompt_order: [] },
            activeCharacter: { id: 2 },
            tokenHandler: { counts: {} },
            createPromptCollection: () => ({ items: [], add() {} }),
        });
        manager.addPromptOrderForCharacter({ id: 2 }, [{ identifier: 'main', enabled: true }]);
        expect(manager.getPromptOrderForCharacter({ id: 2 })).toEqual([{ identifier: 'main', enabled: true }]);
    });

    test('rendering is a no-op because there is no DOM', () => {
        const manager = buildServerPromptManager({
            serviceSettings: { prompts: [], prompt_order: [] },
            activeCharacter: null,
            tokenHandler: { counts: {} },
            createPromptCollection: () => ({ items: [], add() {} }),
        });
        expect(manager.render()).toBeUndefined();
    });
});

describe('buildServerAssemblyEnv', () => {
    test('requires a ChatCompletion implementation', () => {
        expect(() => buildServerAssemblyEnv({ settings: settings() })).toThrow(/ChatCompletion/u);
    });

    test('wires the settings-backed getters and inert media hooks', () => {
        const config = settings();
        const manager = buildServerPromptManager({
            serviceSettings: config.oai_settings,
            activeCharacter: { id: 1 },
            tokenHandler: { counts: {} },
            createPromptCollection: () => ({ items: [], add() {} }),
        });
        const env = buildServerAssemblyEnv({
            settings: config,
            card: { name: 'Aurora' },
            promptManager: manager,
            tokenHandler: { counts: {} },
            ChatCompletion: class {},
        });

        expect(env.getOaiSettings()).toBe(config.oai_settings);
        expect(env.getPowerUser()).toBe(config.power_user);
        expect(env.getPromptManager()).toBe(manager);
        expect(env.isImageInliningSupported()).toBe(false);
        expect(env.toolManager.canPerformToolCalls()).toBe(false);
        expect(env.getGenerationTokenBudget()).toEqual({ contextTokens: 4096, outputTokens: 256 });
        expect(env.injectionPosition).toEqual({ RELATIVE: 0, ABSOLUTE: 1 });
    });

    test('does not pretend a capability the server was not given', () => {
        const env = buildServerAssemblyEnv({
            settings: settings(),
            promptManager: {},
            tokenHandler: { counts: {} },
            ChatCompletion: class {},
        });
        expect(env.isVideoInliningSupported()).toBe(false);
        expect(env.isAudioInliningSupported()).toBe(false);
        expect(env.isReasoningSignatureSupported()).toBe(false);
        expect(env.getExtensionPromptMaxDepth()).toBe(0);
        // A missing macro engine is left undefined so callers fail rather than silently
        // substituting nothing.
        expect(env.substituteParams).toBeUndefined();
    });
});
