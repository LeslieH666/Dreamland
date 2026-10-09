import { describe, expect, jest, test } from '@jest/globals';

import { substituteParams, substituteParamsLegacy } from '../src/prompt-assembly/macros.js';

/**
 * Build a macro context whose engine is a spy that records the environment.
 * @param {object} [overrides] Context overrides.
 * @returns {{context: object, evaluateMacros: import('@jest/globals').Mock, env: () => object}} Harness.
 */
function harness(overrides = {}) {
    let captured = null;
    const evaluateMacros = jest.fn((content, environment) => {
        captured = environment;
        return `evaluated:${content}`;
    });
    const context = {
        name1: 'Alex',
        name2: 'Aurora',
        powerUser: { instruct: { enabled: false } },
        characters: [{ avatar: 'aurora.png', name: 'Aurora' }, { avatar: 'borealis.png', name: 'Borealis' }],
        groups: [],
        selectedGroup: null,
        mainApi: 'openai',
        getCardFields: jest.fn(() => ({ description: 'DESC', personality: 'PERS', scenario: 'SCEN', persona: 'PERSONA', system: 'SYS', jailbreak: 'JB', mesExamples: 'EX', version: '1', charDepthPrompt: 'DEPTH', creatorNotes: 'NOTES' })),
        helpers: {
            evaluateMacros,
            parseMesExamples: jest.fn(value => [value]),
            formatInstructModeExamples: jest.fn(() => ['instruct']),
            getGeneratingModel: jest.fn(() => 'fixture-model'),
        },
        ...overrides,
    };
    return { context, evaluateMacros, env: () => captured };
}

describe('substituteParams engine selection', () => {
    test('empty content short-circuits before any engine runs', async () => {
        const { context, evaluateMacros } = harness();
        expect(substituteParams('', context)).toBe('');
        expect(evaluateMacros).not.toHaveBeenCalled();
    });

    test('uses the legacy engine when the experimental engine is off', () => {
        const { context, evaluateMacros } = harness();
        expect(substituteParams('hi', context)).toBe('evaluated:hi');
        expect(evaluateMacros).toHaveBeenCalledTimes(1);
    });

    test('uses the injected extended engine when experimental_macro_engine is on', () => {
        const extended = jest.fn(() => 'extended-result');
        const { context, evaluateMacros } = harness({ powerUser: { experimental_macro_engine: true, instruct: { enabled: false } }, engines: { extended } });
        expect(substituteParams('hi {{x}}', context)).toBe('extended-result');
        expect(extended).toHaveBeenCalledWith('hi {{x}}', context);
        expect(evaluateMacros).not.toHaveBeenCalled();
    });

    test('throws rather than silently diverging when the extended engine is missing', () => {
        const { context } = harness({ powerUser: { experimental_macro_engine: true, instruct: { enabled: false } } });
        expect(() => substituteParams('hi', context)).toThrow(/no implementation was injected/u);
    });

    test('non-string content is coerced and reported through the injected warning sink', () => {
        const warn = jest.fn();
        const { context } = harness({ warn });
        expect(substituteParams(42, context)).toBe('evaluated:42');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('coerced'), 42);
    });

    test('substituteParamsLegacy delegates to the extended engine when it is enabled', () => {
        const extended = jest.fn(() => 'from-extended');
        const { context } = harness({ powerUser: { experimental_macro_engine: true, instruct: { enabled: false } }, engines: { extended } });
        expect(substituteParamsLegacy('x', context)).toBe('from-extended');
        expect(extended).toHaveBeenCalledTimes(1);
    });
});

describe('legacy environment build', () => {
    test('builds user/char/group/notChar/model and card fields', () => {
        const { context, env } = harness();
        substituteParams('x', context);
        const built = env();
        expect(built.user).toBe('Alex');
        expect(built.char).toBe('Aurora');
        expect(built.group).toBe('Aurora');
        expect(built.charIfNotGroup).toBe('Aurora');
        expect(built.groupNotMuted).toBe('Aurora');
        expect(built.notChar).toBe('Alex');
        expect(built.model).toBe('fixture-model');
        expect(built.description).toBe('DESC');
        expect(built.charPrompt).toBe('SYS');
        expect(built.charJailbreak).toBe('JB');
        expect(built.charInstruction).toBe('JB');
        expect(built.mesExamplesRaw).toBe('EX');
        expect(built.charVersion).toBe('1');
        expect(built.char_version).toBe('1');
        expect(built.charDepthPrompt).toBe('DEPTH');
        expect(built.creatorNotes).toBe('NOTES');
    });

    test('per-call name overrides win over the ambient names', () => {
        const { context, env } = harness({ name1Override: 'OverrideUser', name2Override: 'OverrideChar' });
        substituteParams('x', context);
        expect(env().user).toBe('OverrideUser');
        expect(env().char).toBe('OverrideChar');
        expect(env().notChar).toBe('OverrideUser');
    });

    test('group chat exposes members and excludes the current speaker from notChar', () => {
        const { context, env } = harness({
            selectedGroup: 'g1',
            groups: [{ id: 'g1', members: ['aurora.png', 'borealis.png'], disabled_members: ['borealis.png'] }],
        });
        substituteParams('x', context);
        expect(env().group).toBe('Aurora, Borealis');
        expect(env().groupNotMuted).toBe('Aurora');
        expect(env().notChar).toBe('Borealis, Alex');
    });

    test('a string groupOverride short-circuits both group values', () => {
        const { context, env } = harness({ selectedGroup: 'g1', groups: [{ id: 'g1', members: ['aurora.png'] }], groupOverride: 'CUSTOM' });
        substituteParams('x', context);
        expect(env().group).toBe('CUSTOM');
        expect(env().groupNotMuted).toBe('CUSTOM');
    });

    test('card fields are resolved lazily and skipped entirely when disabled', () => {
        const { context } = harness();
        substituteParams('x', context);
        expect(context.getCardFields).toHaveBeenCalledTimes(1);

        const off = harness({ replaceCharacterCard: false });
        substituteParams('x', off.context);
        expect(off.context.getCardFields).not.toHaveBeenCalled();
        expect(off.env().description).toBeUndefined();
    });

    test('mesExamples is lazy and switches to instruct formatting', () => {
        const { context, env } = harness();
        substituteParams('x', context);
        expect(context.helpers.parseMesExamples).not.toHaveBeenCalled();
        expect(env().mesExamples()).toBe('EX');
        expect(context.helpers.parseMesExamples).toHaveBeenCalledWith('EX', false);

        const instruct = harness({ powerUser: { instruct: { enabled: true } }, mainApi: 'textgenerationwebui' });
        substituteParams('x', instruct.context);
        expect(instruct.env().mesExamples()).toBe('instruct');
        expect(instruct.context.helpers.parseMesExamples).toHaveBeenCalledWith('EX', true);
    });

    test('original yields once and then becomes empty', () => {
        const { context, env } = harness({ original: 'ORIGINAL' });
        substituteParams('x', context);
        const original = env().original;
        expect(original()).toBe('ORIGINAL');
        expect(original()).toBe('');
    });

    test('dynamicMacros override the built environment and are applied last', () => {
        const { context, env } = harness({ dynamicMacros: { user: 'DYNAMIC', extra: 'E' } });
        substituteParams('x', context);
        expect(env().user).toBe('DYNAMIC');
        expect(env().extra).toBe('E');
    });

    test('postProcessFn is passed through to the engine', () => {
        const postProcessFn = value => value.toUpperCase();
        const { context, evaluateMacros } = harness({ postProcessFn });
        substituteParams('x', context);
        expect(evaluateMacros).toHaveBeenCalledWith('x', expect.any(Object), postProcessFn);
    });
});

describe('purity of the macro core', () => {
    test('the context object is not mutated', () => {
        const { context } = harness({ dynamicMacros: { a: 1 } });
        const snapshot = JSON.stringify({ ...context, getCardFields: null, helpers: null });
        substituteParams('x', context);
        expect(JSON.stringify({ ...context, getCardFields: null, helpers: null })).toBe(snapshot);
    });
});
