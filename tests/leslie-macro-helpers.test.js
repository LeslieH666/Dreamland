import { describe, expect, test } from '@jest/globals';

import {
    NAMES_BEHAVIOR_TYPES,
    formatInstructModeExamples,
    parseExampleIntoIndividual,
    parseMesExamples,
} from '../src/prompt-assembly/macro-helpers.js';

/**
 * Build the context the helpers read from the page.
 * @param {object} [overrides] Overrides.
 * @returns {object} Context.
 */
function context(overrides = {}) {
    const basePowerUser = {
        context: { example_separator: '' },
        instruct: {
            skip_examples: false,
            names_behavior: NAMES_BEHAVIOR_TYPES.NONE,
            input_sequence: 'USER:',
            output_sequence: 'BOT:',
            input_suffix: '',
            output_suffix: '',
            macro: false,
            wrap: false,
        },
    };
    const powerUser = {
        ...basePowerUser,
        ...(overrides.powerUser ?? {}),
        context: { ...basePowerUser.context, ...(overrides.powerUser?.context ?? {}) },
        instruct: { ...basePowerUser.instruct, ...(overrides.powerUser?.instruct ?? {}) },
    };
    const rest = { ...overrides };
    delete rest.powerUser;
    return {
        powerUser,
        substituteParams: value => value,
        mainApi: 'openai',
        selectedGroup: null,
        namesBehaviorTypes: NAMES_BEHAVIOR_TYPES,
        parseExampleIntoIndividual: (text, append) => parseExampleIntoIndividual(text, append, {
            name1: 'User',
            name2: 'Aurora',
            selectedGroup: null,
            getGroupNames: () => [],
        }),
        // Spread last so an override actually overrides.
        ...rest,
    };
}

describe('parseMesExamples', () => {
    test('returns nothing for an empty or placeholder-only field', () => {
        expect(parseMesExamples('', false, context())).toEqual([]);
        expect(parseMesExamples('<START>', false, context())).toEqual([]);
    });

    test('prepends <START> when the field does not begin with it', () => {
        const result = parseMesExamples('User: hi\nAurora: yo', false, context());
        expect(result.length).toBe(1);
        expect(result[0].startsWith('<START>\n')).toBe(true);
    });

    test('splits on every <START> marker', () => {
        const result = parseMesExamples('<START>\nUser: a\nAurora: b\n<START>\nUser: c\nAurora: d', false, context());
        expect(result.length).toBe(2);
        expect(result.every(block => block.startsWith('<START>\n'))).toBe(true);
    });

    test('uses the instruct heading when the page is not on the openai api', () => {
        const result = parseMesExamples('<START>\nUser: a', false, context({ mainApi: 'kobold' }));
        expect(result.length).toBe(1);
        expect(result[0]).not.toContain('<START>');
    });
});

describe('parseExampleIntoIndividual', () => {
    test('splits one block into user and assistant turns', () => {
        const result = parseExampleIntoIndividual('<START>\nUser: hello\nAurora: hi there', true, {
            name1: 'User',
            name2: 'Aurora',
            selectedGroup: null,
            getGroupNames: () => [],
        });
        expect(result.map(item => item.name)).toEqual(['example_user', 'example_assistant']);
        expect(result[0].content).toContain('hello');
        expect(result[1].content).toContain('hi there');
        expect(result.every(item => item.role === 'system')).toBe(true);
    });

    test('keeps names when the caller asks for group-style names', () => {
        // Names are appended only when a group is selected - that is what the flag means.
        const withNames = parseExampleIntoIndividual('<START>\nUser: hello', true, {
            name1: 'User', name2: 'Aurora', selectedGroup: 'group-1', getGroupNames: () => [],
        });
        const without = parseExampleIntoIndividual('<START>\nUser: hello', false, {
            name1: 'User', name2: 'Aurora', selectedGroup: null, getGroupNames: () => [],
        });
        expect(withNames[0].content).toContain('User');
        expect(without[0].content).not.toContain('User:');
    });

    test('returns nothing when the block has no recognisable turns', () => {
        expect(parseExampleIntoIndividual('<START>\nonly narration', true, {
            name1: 'User', name2: 'Aurora', selectedGroup: null, getGroupNames: () => [],
        })).toEqual([]);
    });
});

describe('formatInstructModeExamples', () => {
    test('replaces the <START> heading when examples are skipped', () => {
        const ctx = context({ powerUser: { instruct: { skip_examples: true } } });
        const result = formatInstructModeExamples(['<START>\nUser: a'], 'User', 'Aurora', ctx);
        expect(result.length).toBe(1);
        expect(result[0]).not.toContain('<START>');
    });

    test('prefixes user and assistant turns with their sequences', () => {
        const result = formatInstructModeExamples(['<START>\nUser: hello\nAurora: hi'], 'User', 'Aurora', context());
        expect(result.some(line => line.includes('USER:'))).toBe(true);
        expect(result.some(line => line.includes('BOT:'))).toBe(true);
    });
});
