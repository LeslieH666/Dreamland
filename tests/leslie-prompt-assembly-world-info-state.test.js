import { describe, expect, test } from '@jest/globals';

import {
    DEFAULT_DEPTH,
    MAX_SCAN_DEPTH,
    scan_state,
    world_info_logic,
} from '../src/prompt-assembly/world-info-enums.js';
import {
    WorldInfoBuffer,
    WorldInfoTimedEffects,
    defaultGlobalScanData,
    isValidRegex,
    parseRegexFromString,
} from '../src/prompt-assembly/world-info-state.js';

/**
 * Build a buffer context.
 * @param {object} [settings] Setting overrides.
 * @returns {object} Context.
 */
function context(settings = {}) {
    return {
        settings: {
            worldInfoDepth: 2,
            worldInfoCaseSensitive: false,
            worldInfoMatchWholeWords: false,
            ...settings,
        },
        escapeRegex: value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    };
}

describe('world-info enums moved verbatim', () => {
    test('keep the original values', () => {
        expect(DEFAULT_DEPTH).toBe(4);
        expect(MAX_SCAN_DEPTH).toBe(1000);
        expect(scan_state).toEqual({ NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 });
        expect(world_info_logic).toEqual({ AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 });
    });

    test('the default global scan data keeps its shape', () => {
        expect(defaultGlobalScanData.trigger).toBe('normal');
        expect(Object.isFrozen(defaultGlobalScanData)).toBe(true);
    });
});

describe('regex helpers', () => {
    test('parses a delimited pattern with flags', () => {
        expect(parseRegexFromString('/foo/i')).toBeInstanceOf(RegExp);
        expect(parseRegexFromString('/foo/i').flags).toBe('i');
        expect(parseRegexFromString('/foo/i').source).toBe('foo');
    });

    test('rejects anything that is not a delimited pattern', () => {
        for (const input of ['foo', '', 'foo/bar', '/foo', 'foo/']) {
            expect(parseRegexFromString(input)).toBeNull();
        }
    });

    test('rejects an unescaped inner delimiter and bad flags', () => {
        expect(parseRegexFromString('/a/b/')).toBeNull();
        expect(parseRegexFromString('/foo/gg')).toBeNull();
    });

    test('isValidRegex follows parseRegexFromString', () => {
        expect(isValidRegex('/bar/')).toBe(true);
        expect(isValidRegex('bar')).toBe(false);
    });
});

describe('WorldInfoBuffer', () => {
    test('requires an explicit context', () => {
        expect(() => new WorldInfoBuffer([], defaultGlobalScanData)).toThrow(/requires a context/u);
        expect(() => new WorldInfoBuffer([], defaultGlobalScanData, { settings: {} })).toThrow(/requires a context/u);
    });

    test('matches plain keys case-insensitively by default', () => {
        const buffer = new WorldInfoBuffer([], defaultGlobalScanData, context());
        expect(buffer.matchKeys('The Quick Brown Fox', 'quick brown', {})).toBe(true);
        expect(buffer.matchKeys('The Quick Brown Fox', 'slow', {})).toBe(false);
    });

    test('honours case sensitivity from the injected settings', () => {
        const sensitive = new WorldInfoBuffer([], defaultGlobalScanData, context({ worldInfoCaseSensitive: true }));
        expect(sensitive.matchKeys('The Quick Brown Fox', 'quick brown', {})).toBe(false);
        expect(sensitive.matchKeys('The Quick Brown Fox', 'Quick Brown', {})).toBe(true);
    });

    test('honours whole-word matching for a single word', () => {
        const whole = new WorldInfoBuffer([], defaultGlobalScanData, context({ worldInfoMatchWholeWords: true }));
        expect(whole.matchKeys('a cat sat', 'cat', {})).toBe(true);
        expect(whole.matchKeys('a cat sat', 'at', {})).toBe(false);
    });

    test('an entry-level flag overrides the setting', () => {
        const buffer = new WorldInfoBuffer([], defaultGlobalScanData, context({ worldInfoMatchWholeWords: true }));
        expect(buffer.matchKeys('a cat sat', 'at', { matchWholeWords: false })).toBe(true);
    });

    test('a regex needle overrides the other options', () => {
        const buffer = new WorldInfoBuffer([], defaultGlobalScanData, context());
        expect(buffer.matchKeys('a cat sat', '/c.t/', {})).toBe(true);
        expect(buffer.matchKeys('a cat sat', '/dog/', {})).toBe(false);
    });

    test('the recursion buffer accumulates and depth advances with skew', () => {
        const buffer = new WorldInfoBuffer([], defaultGlobalScanData, context({ worldInfoDepth: 2 }));
        expect(buffer.hasRecurse()).toBe(false);
        buffer.addRecurse('memory one');
        buffer.addRecurse('memory two');
        expect(buffer.hasRecurse()).toBe(true);

        // advanceScan() widens the scan range; it deliberately does NOT drain the
        // recursion buffer (the scan loop decides when to consume it).
        expect(buffer.getDepth()).toBe(2);
        buffer.advanceScan();
        expect(buffer.getDepth()).toBe(3);
        expect(buffer.hasRecurse()).toBe(true);
    });

    test('externally activated entries are looked up by world and uid', () => {
        const buffer = new WorldInfoBuffer([], defaultGlobalScanData, context());
        WorldInfoBuffer.externalActivations = new Map();
        expect(buffer.getExternallyActivated({ world: 'lore', uid: 7 })).toBeUndefined();

        const entry = { world: 'lore', uid: 7, content: 'x' };
        WorldInfoBuffer.externalActivations.set('lore.7', entry);
        expect(buffer.getExternallyActivated({ world: 'lore', uid: 7 })).toBe(entry);

        buffer.resetExternalEffects();
        expect(buffer.getExternallyActivated({ world: 'lore', uid: 7 })).toBeUndefined();
    });
});

describe('WorldInfoTimedEffects', () => {
    test('requires a chat-metadata getter', () => {
        expect(() => new WorldInfoTimedEffects([])).toThrow(/requires a context/u);
        expect(() => new WorldInfoTimedEffects([], [], false, {})).toThrow(/requires a context/u);
    });

    test('reads chat metadata through the getter on every access', () => {
        // The browser reassigns `chat_metadata` when a chat loads, so a captured
        // value would go stale; each read must go through the getter.
        let metadata = { timedWorldInfo: { sticky: { 'lore.1': { end: 5 } } } };
        const effects = new WorldInfoTimedEffects([], [], false, { getChatMetadata: () => metadata });

        expect(effects.getEffectMetadata('sticky', { world: 'lore', uid: 1 })).toEqual({ end: 5 });

        metadata = { timedWorldInfo: { sticky: { 'lore.1': { end: 9 } } } };
        expect(effects.getEffectMetadata('sticky', { world: 'lore', uid: 1 })).toEqual({ end: 9 });
        expect(effects.getEffectMetadata('sticky', { world: 'lore', uid: 2 })).toBeUndefined();
        expect(effects.getEffectMetadata('nope', { world: 'lore', uid: 1 })).toBeNull();
    });

    test('recognises the timed effect types', () => {
        const metadata = {};
        const effects = new WorldInfoTimedEffects([], [], false, { getChatMetadata: () => metadata });
        expect(effects.isValidEffectType('sticky')).toBe(true);
        expect(effects.isValidEffectType('cooldown')).toBe(true);
        expect(effects.isValidEffectType('delay')).toBe(true);
        expect(effects.isValidEffectType('nope')).toBe(false);
    });

    test('a dry run does not throw while checking effects', () => {
        const metadata = {};
        const effects = new WorldInfoTimedEffects([], [], true, { getChatMetadata: () => metadata });
        expect(() => effects.checkTimedEffects()).not.toThrow();
    });
});
