import { describe, expect, jest, test } from '@jest/globals';

import {
    CLAUDE_TOKENIZER,
    NON_FULL_TOKEN_ADJUSTMENT,
    countMessageTokens,
    countTextTokens,
} from '../src/prompt-assembly/token-counting.js';

/**
 * Build a counting context with a deterministic counter.
 * @param {object} [overrides] Context overrides.
 * @returns {object} Context.
 */
function context(overrides = {}) {
    return {
        resolveModel: () => 'gpt-3.5-turbo',
        countOne: jest.fn(async () => 10),
        ...overrides,
    };
}

describe('token-counting constants', () => {
    test('mirror the browser literals', () => {
        expect(CLAUDE_TOKENIZER).toBe('claude');
        expect(NON_FULL_TOKEN_ADJUSTMENT).toBe(2);
    });
});

describe('countMessageTokens accumulation', () => {
    test('starts at -1 and subtracts 2 more when the count is not full', async () => {
        const ctx = context();
        // -1 + 10 = 9, then -2 => 7
        await expect(countMessageTokens([{ role: 'user', content: 'a' }], ctx)).resolves.toBe(7);
    });

    test('a full count skips the trailing adjustment', async () => {
        // -1 + 10 = 9, and with full there is no -2
        await expect(countMessageTokens([{ role: 'user', content: 'a' }], context({ full: true }))).resolves.toBe(9);
    });

    test('sums every message in order', async () => {
        const countOne = jest.fn(async message => (message.content === 'a' ? 10 : 20));
        // -1 + 10 + 20 = 29, -2 => 27
        await expect(countMessageTokens([{ content: 'a' }, { content: 'b' }], context({ countOne }))).resolves.toBe(27);
        expect(countOne).toHaveBeenCalledTimes(2);
    });

    test('a single non-array message is wrapped', async () => {
        await expect(countMessageTokens({ role: 'system', content: 'x' }, context())).resolves.toBe(7);
    });

    test('the claude tokenizer promotes the call to a full count', async () => {
        const ctx = context({ resolveModel: () => CLAUDE_TOKENIZER });
        // claude sets full regardless of the caller's false, so no -2
        await expect(countMessageTokens([{ content: 'a' }], ctx)).resolves.toBe(9);
    });

    test('a cached count is reused and the counter is not called', async () => {
        const cache = {};
        const countOne = jest.fn(async () => 10);
        const ctx = context({ countOne, cache, hash: () => 'H' });
        await expect(countMessageTokens([{ content: 'a' }], ctx)).resolves.toBe(7);
        expect(cache['gpt-3.5-turbo-H']).toBe(10);

        countOne.mockClear();
        await expect(countMessageTokens([{ content: 'a' }], ctx)).resolves.toBe(7);
        expect(countOne).not.toHaveBeenCalled();
    });

    test('the cache key is model + hash of the serialized message', async () => {
        const cache = {};
        const hash = jest.fn(() => 'HASH');
        await countMessageTokens([{ role: 'user', content: 'a' }], context({ cache, hash }));
        expect(hash).toHaveBeenCalledWith(JSON.stringify({ role: 'user', content: 'a' }));
        expect(Object.keys(cache)).toEqual(['gpt-3.5-turbo-HASH']);
    });

    test('a missing cache disables caching without changing the total', async () => {
        const countOne = jest.fn(async () => 5);
        // -1 + 5 + 5 = 9, then -2 => 7
        await expect(countMessageTokens([{ content: 'a' }, { content: 'b' }], context({ countOne, cache: null }))).resolves.toBe(7);
        expect(countOne).toHaveBeenCalledTimes(2);
    });

    test('the model is resolved once per message', async () => {
        const resolveModel = jest.fn(() => 'gpt-4');
        await countMessageTokens([{ content: 'a' }, { content: 'b' }], context({ resolveModel }));
        expect(resolveModel).toHaveBeenCalledTimes(2);
    });
});

describe('countTextTokens', () => {
    test('counts a string as a full system message, matching counterWrapperOpenAIAsync', async () => {
        const countOne = jest.fn(async () => 12);
        const ctx = context({ countOne });
        // -1 + 12, full => no adjustment
        await expect(countTextTokens('hello', ctx)).resolves.toBe(11);
        expect(countOne).toHaveBeenCalledWith({ role: 'system', content: 'hello' }, 'gpt-3.5-turbo');
    });
});

describe('purity', () => {
    test('the input message array is not mutated', async () => {
        const messages = [{ role: 'user', content: 'a' }];
        const snapshot = JSON.stringify(messages);
        await countMessageTokens(messages, context());
        expect(JSON.stringify(messages)).toBe(snapshot);
    });
});
