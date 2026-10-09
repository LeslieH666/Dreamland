import { describe, expect, test } from '@jest/globals';

import {
    DIVERGENCE_SOURCE,
    IN_TREE_SCAN_DONE_LISTENERS,
    WORLD_INFO_REGEX_PLACEMENT,
    assertWorldInfoPortable,
    createSeededRandom,
    detectWorldInfoDivergenceSources,
} from '../src/prompt-assembly/world-info-portability.js';
import {
    DEEPSEEK_TOKENIZER,
    TOKENIZER_FALLBACK,
    UnsupportedTokenizerProviderError,
    resolveChatCompletionTokenizerModel,
} from '../src/prompt-assembly/tokenizer-model.js';

/**
 * Build a regex script.
 * @param {number[]} placement Placements.
 * @returns {object} Script.
 */
function script(placement) {
    return { scriptName: 'fixture', placement, disabled: false };
}


/**
 * Run a callback and return the error it threw, so assertions can live outside a
 * catch block (jest/no-conditional-expect).
 * @param {Function} callback Callback expected to throw.
 * @returns {Error} The thrown error.
 */
function captureThrow(callback) {
    try {
        callback();
        return null;
    } catch (error) {
        return error;
    }
}

describe('World Info divergence detection', () => {
    test('the regex placement constant matches the browser enum', () => {
        expect(WORLD_INFO_REGEX_PLACEMENT).toBe(5);
    });

    test('reports nothing for a deployment without the browser-only capabilities', () => {
        expect(detectWorldInfoDivergenceSources()).toEqual([]);
        expect(detectWorldInfoDivergenceSources({ regexScripts: [] })).toEqual([]);
    });

    test('detects a regex script that targets the WORLD_INFO placement', () => {
        expect(detectWorldInfoDivergenceSources({ regexScripts: [script([1, 5])] })).toEqual([DIVERGENCE_SOURCE.WORLD_INFO_REGEX]);
    });

    test('ignores regex scripts that target other placements', () => {
        expect(detectWorldInfoDivergenceSources({ regexScripts: [script([0, 1]), script([2])] })).toEqual([]);
    });

    test('ignores a WORLD_INFO regex script when the regex extension is disabled', () => {
        expect(detectWorldInfoDivergenceSources({ regexScripts: [script([5])], regexDisabled: true })).toEqual([]);
    });

    test('detects the vectors extension', () => {
        expect(detectWorldInfoDivergenceSources({ vectorsEnabled: true })).toEqual([DIVERGENCE_SOURCE.VECTORS]);
    });

    test('detects scan-done listeners and reports every active source', () => {
        const active = detectWorldInfoDivergenceSources({
            regexScripts: [script([5])],
            vectorsEnabled: true,
            scanDoneListenerCount: 2,
        });
        expect(active).toEqual([
            DIVERGENCE_SOURCE.WORLD_INFO_REGEX,
            DIVERGENCE_SOURCE.VECTORS,
            DIVERGENCE_SOURCE.SCAN_DONE_LISTENERS,
        ]);
    });

    test('the in-tree scan-done subscriber count is zero', () => {
        // Only the emit site exists; the check is a no-op today and guards against
        // third-party extensions registering a listener.
        expect(IN_TREE_SCAN_DONE_LISTENERS).toBe(0);
        expect(detectWorldInfoDivergenceSources({ scanDoneListenerCount: IN_TREE_SCAN_DONE_LISTENERS })).toEqual([]);
    });

    test('assertWorldInfoPortable passes when nothing diverges', () => {
        expect(() => assertWorldInfoPortable()).not.toThrow();
        expect(() => assertWorldInfoPortable({ regexScripts: [script([0])] })).not.toThrow();
    });

    test('assertWorldInfoPortable fails closed and names every active source', () => {
        expect(() => assertWorldInfoPortable({ vectorsEnabled: true })).toThrow(/vectors/u);
        expect(() => assertWorldInfoPortable({ regexScripts: [script([5])] })).toThrow(/world_info_regex/u);

        const error = captureThrow(() => assertWorldInfoPortable({ regexScripts: [script([5])], vectorsEnabled: true }));
        expect(error.message).toContain(DIVERGENCE_SOURCE.WORLD_INFO_REGEX);
        expect(error.message).toContain(DIVERGENCE_SOURCE.VECTORS);
        expect(error.message).toMatch(/browser-only/u);
    });
});

describe('seeded World Info randomness', () => {
    test('is deterministic for a given seed and differs across seeds', () => {
        const first = createSeededRandom(42);
        const second = createSeededRandom(42);
        const other = createSeededRandom(43);

        const firstValues = [first(), first(), first()];
        const secondValues = [second(), second(), second()];
        expect(secondValues).toEqual(firstValues);
        expect([other(), other(), other()]).not.toEqual(firstValues);
    });

    test('stays within [0, 1)', () => {
        const random = createSeededRandom(7);
        for (let index = 0; index < 200; index++) {
            const value = random();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    test('drives a probability roll the way the scan does', () => {
        // Mirrors world-info.js verifyProbability: rollValue <= entry.probability
        const random = createSeededRandom(1);
        const roll = random() * 100;
        expect(roll).toBeGreaterThanOrEqual(0);
        expect(roll).toBeLessThanOrEqual(100);
        expect(roll <= 100).toBe(true);
    });
});

describe('narrowed tokenizer-model resolution (附 L Q-c)', () => {
    test('OpenAI returns the configured model verbatim', () => {
        expect(resolveChatCompletionTokenizerModel({ chatCompletionSource: 'openai', openaiModel: 'gpt-4o' })).toBe('gpt-4o');
        expect(resolveChatCompletionTokenizerModel({ chatCompletionSource: 'openai', openaiModel: 'gpt-4.1-mini' })).toBe('gpt-4.1-mini');
    });

    test('Azure falls back to the 3.5 tokenizer', () => {
        expect(resolveChatCompletionTokenizerModel({ chatCompletionSource: 'azure_openai', azureOpenaiModel: 'gpt-4' })).toBe('gpt-4');
        expect(resolveChatCompletionTokenizerModel({ chatCompletionSource: 'azure_openai' })).toBe(TOKENIZER_FALLBACK);
    });

    test('DeepSeek is pinned to its tokenizer', () => {
        expect(resolveChatCompletionTokenizerModel({ chatCompletionSource: 'deepseek' })).toBe(DEEPSEEK_TOKENIZER);
        expect(DEEPSEEK_TOKENIZER).toBe('deepseek');
    });

    test('an OpenAI-compatible custom endpoint uses the default tokenizer', () => {
        expect(resolveChatCompletionTokenizerModel({ chatCompletionSource: 'custom' })).toBe(TOKENIZER_FALLBACK);
        expect(TOKENIZER_FALLBACK).toBe('gpt-3.5-turbo');
    });

    test('fails closed for providers outside the narrowed scope', () => {
        for (const source of ['claude', 'openrouter', 'groq', 'perplexity', 'electronhub', 'chutes', 'mistralai', undefined]) {
            expect(() => resolveChatCompletionTokenizerModel({ chatCompletionSource: source }))
                .toThrow(UnsupportedTokenizerProviderError);
        }
    });

    test('the error names the provider and states why it refuses', () => {
        const error = captureThrow(() => resolveChatCompletionTokenizerModel({ chatCompletionSource: 'groq' }));
        expect(error).toBeInstanceOf(UnsupportedTokenizerProviderError);
        expect(error.chatCompletionSource).toBe('groq');
        expect(error.message).toContain('groq');
        expect(error.message).toMatch(/Refusing to guess/u);
    });
});
