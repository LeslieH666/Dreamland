import { describe, expect, test } from '@jest/globals';

import { setOpenAIMessageExamples, setOpenAIMessages } from '../src/prompt-assembly/message-shaping.js';

/**
 * Build the page state the shaper reads.
 * @param {object} [overrides] Overrides.
 * @returns {object} Context.
 */
function context(overrides = {}) {
    return {
        oaiSettings: { chat_completion_source: 'custom', names_behavior: 'none' },
        getChatCompletionModel: () => 'fixture-model',
        ignoreSymbol: '__ignore',
        systemMessageTypes: { NARRATOR: 'narrator' },
        characterNamesBehavior: { NONE: 'none', DEFAULT: 'default', CONTENT: 'content', COMPLETION: 'completion' },
        selectedGroup: null,
        name1: 'User',
        name2: 'Aurora',
        getMediaDisplay: () => null,
        getMediaIndex: () => null,
        ...overrides,
    };
}

describe('setOpenAIMessages', () => {
    test('maps each turn to its role', () => {
        // The source walks `j` forward while writing at a descending index, so the
        // written array comes out in reverse input order. That is upstream behaviour and
        // is preserved verbatim; the assertion records it rather than assuming a sort.
        const result = setOpenAIMessages([
            { name: 'Aurora', is_user: false, mes: 'hello' },
            { name: 'User', is_user: true, mes: 'hi' },
        ], context());
        expect(result.map(item => item.role)).toEqual(['user', 'assistant']);
        expect(result.map(item => item.content)).toEqual(['hi', 'hello']);
        expect(result.map(item => item.name)).toEqual(['User', 'Aurora']);
    });

    test('skips an ignored message without leaving a hole', () => {
        // The skipped message is left out entirely. It used to leave a hole (the source
        // advanced a second cursor and `continue`d), which made downstream walks treat the
        // array as shorter than it claimed and shifted depth-based injections by one.
        const result = setOpenAIMessages([
            { name: 'Aurora', is_user: false, mes: 'keep' },
            { name: 'User', is_user: true, mes: 'drop', extra: { __ignore: true } },
        ], context());
        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('keep');
        expect(JSON.stringify(result)).not.toContain('drop');
    });

    test('promotes narrator messages to the system role', () => {
        const result = setOpenAIMessages([
            { name: 'Narrator', is_user: false, mes: 'it rained', extra: { type: 'narrator' } },
        ], context());
        expect(result[0].role).toBe('system');
    });

    test('strips carriage returns', () => {
        const result = setOpenAIMessages([{ name: 'Aurora', is_user: false, mes: 'a\r\nb' }], context());
        expect(result[0].content).toBe('a\nb');
    });

    test('applies the content name behaviour', () => {
        const result = setOpenAIMessages(
            [{ name: 'Aurora', is_user: false, mes: 'hello' }],
            context({ oaiSettings: { chat_completion_source: 'custom', names_behavior: 'content' } }),
        );
        expect(result[0].content).toBe('Aurora: hello');
    });

    test('keeps a thought signature only when the origin matches the current model', () => {
        const matching = setOpenAIMessages(
            [{ name: 'Aurora', is_user: false, mes: 'x', extra: { api: 'custom', model: 'fixture-model', reasoning_signature: 'sig', reasoning: 'why' } }],
            context(),
        );
        expect(matching[0].signature).toBe('sig');
        expect(matching[0].reasoning).toBe('why');

        const mismatched = setOpenAIMessages(
            [{ name: 'Aurora', is_user: false, mes: 'x', extra: { api: 'other', model: 'other-model', reasoning_signature: 'sig', reasoning: 'why' } }],
            context(),
        );
        expect(mismatched[0].signature).toBeNull();
        expect(mismatched[0].reasoning).toBe('');
    });
});

describe('setOpenAIMessageExamples', () => {
    test('splits each block into its example turns', () => {
        const result = setOpenAIMessageExamples(['<START>\nUser: a\nAurora: b'], {
            name1: 'User',
            name2: 'Aurora',
            selectedGroup: null,
            getGroupNames: () => [],
        });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);
        expect(result[0].map(item => item.name)).toEqual(['example_user', 'example_assistant']);
    });

    test('returns one entry per example block', () => {
        const result = setOpenAIMessageExamples([
            '<START>\nUser: a\nAurora: b',
            '<START>\nUser: c\nAurora: d',
        ], { name1: 'User', name2: 'Aurora', selectedGroup: null, getGroupNames: () => [] });
        expect(result.length).toBe(2);
    });

    test('returns an empty array for no examples', () => {
        expect(setOpenAIMessageExamples([], { name1: 'User', name2: 'Aurora', selectedGroup: null, getGroupNames: () => [] })).toEqual([]);
    });
});
