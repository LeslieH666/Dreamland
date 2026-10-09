import { describe, expect, test } from '@jest/globals';

import {
    populationInjectionPromptsCore,
    populateChatHistoryCore,
    preparePromptsForChatCompletionCore,
} from '../src/prompt-assembly/populate.js';

/**
 * Build the environment the populate functions require.
 * @param {object} [overrides] Overrides.
 * @returns {object} Environment.
 */
function env(overrides = {}) {
    return {
        Prompt: class Prompt {
            constructor(message) {
                Object.assign(this, message);
            }
        },
        injectionPosition: { RELATIVE: 0, ABSOLUTE: 1 },
        toolManager: { canPerformToolCalls: () => false },
        mediaDisplay: { IGNORE: 'ignore', DISPLAY: 'display' },
        mediaType: { IMAGE: 'image' },
        getPowerUser: () => ({ experimental_macro_engine: false }),
        personaDescriptionPositions: { IN_PROMPT: 0 },
        getSelectedGroup: () => null,
        getOaiSettings: () => ({ chat_completion_source: 'custom', media_inlining: false }),
        getPromptManager: () => null,
        chatCompletionSources: { CUSTOM: 'custom', OPENROUTER: 'openrouter' },
        tokenHandler: { countAsync: async () => 1 },
        getExtensionPrompt: async () => '',
        getExtensionPromptMaxDepth: () => 0,
        substituteParams: value => value,
        substituteParamsExtended: value => value,
        formatWorldInfo: value => value ?? '',
        getPromptPosition: () => 0,
        getPromptRole: () => 0,
        toolReasoningModes: { DISABLED: 'disabled' },
        interleavedReasoningProviders: [],
        getEffectiveToolReasoningMode: () => 'disabled',
        isImageInliningSupported: () => false,
        isVideoInliningSupported: () => false,
        isAudioInliningSupported: () => false,
        isReasoningSignatureSupported: () => false,
        ...overrides,
    };
}

describe('populate module loads and exposes the moved surface', () => {
    test('the moved functions are exported and callable', () => {
        expect(typeof populationInjectionPromptsCore).toBe('function');
        expect(typeof populateChatHistoryCore).toBe('function');
        expect(typeof preparePromptsForChatCompletionCore).toBe('function');
    });
});

describe('populationInjectionPromptsCore', () => {
    test('works on a copy and leaves the caller array untouched', async () => {
        // A prompt collection whose only entry is an absolute-position prompt that
        // matches depth 0, so one injection is spliced in.
        // populationInjectionPrompts takes the prompt ARRAY (it calls prompts.filter).
        const prompts = [{ identifier: 'inj', position: 1, injection_depth: 0, role: 0, content: 'x' }];
        const messages = [{ role: 'user', content: 'first' }];
        const snapshot = JSON.parse(JSON.stringify(messages));

        const result = await populationInjectionPromptsCore(prompts, messages, env());

        expect(Array.isArray(result)).toBe(true);
        // The caller's array must not have been mutated (step 6b-part-1 guarantee).
        expect(messages).toEqual(snapshot);
    });

    test('reverses through a copy', async () => {
        const messages = [{ content: 'a' }, { content: 'b' }];
        const result = await populationInjectionPromptsCore([], messages, env());
        expect(result.map(item => item.content)).toEqual(['b', 'a']);
        expect(messages.map(item => item.content)).toEqual(['a', 'b']);
    });
});
