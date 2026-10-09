import { describe, expect, jest, test } from '@jest/globals';

import {
    getAllExtensionPrompts,
    getExtensionPrompt,
    getExtensionPromptByName,
    getExtensionPromptMaxDepth,
} from '../src/prompt-assembly/extension-prompts.js';
import { ExtensionPromptRole, ExtensionPromptType, MAX_INJECTION_DEPTH } from '../src/prompt-assembly/enums.js';

/**
 * Build a registry entry.
 * @param {object} overrides Entry fields.
 * @returns {object} Entry.
 */
function entry(overrides) {
    return { value: 'value', position: ExtensionPromptType.IN_PROMPT, depth: 0, role: ExtensionPromptRole.SYSTEM, ...overrides };
}

describe('prompt-assembly enums', () => {
    test('mirror the browser definitions bit for bit', () => {
        expect(ExtensionPromptType).toEqual({ NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 });
        expect(ExtensionPromptRole).toEqual({ SYSTEM: 0, USER: 1, ASSISTANT: 2 });
        expect(MAX_INJECTION_DEPTH).toBe(10000);
        expect(getExtensionPromptMaxDepth()).toBe(MAX_INJECTION_DEPTH);
    });
});

describe('getExtensionPrompt selection semantics', () => {
    test('orders surviving entries by key name, lexicographically', async () => {
        const registry = {
            zeta: entry({ value: 'Z' }),
            alpha: entry({ value: 'A' }),
            // '10' sorts before '2' as a string, exactly like Object.keys().sort()
            '10_memory': entry({ value: 'TEN' }),
            '2_floating_prompt': entry({ value: 'TWO' }),
        };
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0, { wrap: false })).resolves.toBe('TEN\nTWO\nA\nZ');
    });

    test('trims values and joins with the separator', async () => {
        const registry = { a: entry({ value: '  padded  ' }), b: entry({ value: 'plain' }) };
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0, { separator: ' | ', wrap: false })).resolves.toBe('padded | plain');
    });

    test('wrap surrounds the joined value with the separator once', async () => {
        const registry = { a: entry({ value: 'x' }) };
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0)).resolves.toBe('\nx\n');
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0, { wrap: false })).resolves.toBe('x');
    });

    test('an empty selection stays empty even with wrap enabled', async () => {
        await expect(getExtensionPrompt({}, ExtensionPromptType.IN_PROMPT, 0)).resolves.toBe('');
        await expect(getExtensionPrompt({ a: entry({ value: '   ' }) }, ExtensionPromptType.IN_PROMPT, 0)).resolves.toBe('');
    });

    test('selects by position with the source loose comparison and a truthy value', async () => {
        const registry = {
            match: entry({ value: 'kept', position: 1 }),
            other: entry({ value: 'dropped', position: 0 }),
            empty: entry({ value: '', position: 1 }),
        };
        await expect(getExtensionPrompt(registry, 1, undefined, { wrap: false })).resolves.toBe('kept');
    });

    test('depth accepts unspecified on either side', async () => {
        const registry = {
            noDepth: entry({ value: 'any', depth: undefined }),
            depth3: entry({ value: 'three', depth: 3 }),
            depth0: entry({ value: 'zero', depth: 0 }),
        };
        // keys sort depth0 < depth3 < noDepth
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 3, { wrap: false })).resolves.toBe('three\nany');
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, undefined, { wrap: false })).resolves.toBe('zero\nthree\nany');
    });

    test('role accepts unspecified on either side and rejects a mismatch', async () => {
        const registry = {
            noRole: entry({ value: 'any', role: undefined }),
            system: entry({ value: 'system', role: ExtensionPromptRole.SYSTEM }),
            user: entry({ value: 'user', role: ExtensionPromptRole.USER }),
        };
        // keys sort noRole < system < user
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, undefined, { role: ExtensionPromptRole.USER, wrap: false })).resolves.toBe('any\nuser');
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, undefined, { role: ExtensionPromptRole.SYSTEM, wrap: false })).resolves.toBe('any\nsystem');
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, undefined, { wrap: false })).resolves.toBe('any\nsystem\nuser');
    });

    test('injects macro substitution and applies it only when non-empty', async () => {
        const substitute = jest.fn((text) => text.replace('{{user}}', 'Alex'));
        const registry = { a: entry({ value: 'hi {{user}}' }) };
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0, { substitute, wrap: false })).resolves.toBe('hi Alex');
        substitute.mockClear();
        await expect(getExtensionPrompt({}, ExtensionPromptType.IN_PROMPT, 0, { substitute })).resolves.toBe('');
        expect(substitute).not.toHaveBeenCalled();
    });
});

describe('getExtensionPrompt filter semantics (preserved browser behaviour)', () => {
    test('invokes the predicate but ignores a false result, matching script.js:3300', async () => {
        const filter = jest.fn(async () => false);
        const registry = { a: entry({ value: 'kept anyway', filter }) };
        await expect(getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0, { wrap: false })).resolves.toBe('kept anyway');
        expect(filter).toHaveBeenCalledTimes(1);
    });

    test('getExtensionPromptByName and getAllExtensionPrompts do honour the predicate', async () => {
        const registry = { a: entry({ value: 'secret', filter: async () => false }) };
        await expect(getExtensionPromptByName(registry, 'a')).resolves.toBe('');
        await expect(getAllExtensionPrompts(registry)).resolves.toBe('');
    });
});

describe('getExtensionPromptByName and getAllExtensionPrompts', () => {
    test('by-name returns the substituted value and tolerates missing keys', async () => {
        const registry = { greet: entry({ value: 'hello {{user}}' }) };
        const substitute = text => text.replace('{{user}}', 'Sam');
        await expect(getExtensionPromptByName(registry, 'greet', { substitute })).resolves.toBe('hello Sam');
        await expect(getExtensionPromptByName(registry, 'absent')).resolves.toBe('');
        await expect(getExtensionPromptByName(registry, '')).resolves.toBe('');
        await expect(getExtensionPromptByName(undefined, 'greet')).resolves.toBe('');
    });

    test('all-prompts uses insertion order and skips blank values', async () => {
        const registry = {
            b: entry({ value: 'second' }),
            a: entry({ value: 'first' }),
            blank: entry({ value: '   ' }),
        };
        await expect(getAllExtensionPrompts(registry)).resolves.toBe('second\nfirst');
    });
});

describe('purity', () => {
    test('neither the registry nor its entries are mutated', async () => {
        const filter = jest.fn(async () => true);
        const registry = { a: entry({ value: '  keep  ', filter }) };
        const before = JSON.parse(JSON.stringify({ a: { ...registry.a } })).a;

        await getExtensionPrompt(registry, ExtensionPromptType.IN_PROMPT, 0);
        await getExtensionPromptByName(registry, 'a');
        await getAllExtensionPrompts(registry);

        expect(registry.a.value).toBe(before.value);
        expect(registry.a.position).toBe(before.position);
        expect(registry.a.depth).toBe(before.depth);
        expect(registry.a.role).toBe(before.role);
        expect(Object.keys(registry)).toEqual(['a']);
    });

    test('an empty or missing registry is handled without throwing', async () => {
        await expect(getExtensionPrompt(undefined, ExtensionPromptType.IN_PROMPT, 0)).resolves.toBe('');
        await expect(getAllExtensionPrompts(undefined)).resolves.toBe('');
    });
});
