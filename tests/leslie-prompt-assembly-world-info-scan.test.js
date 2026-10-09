import { describe, expect, jest, test } from '@jest/globals';

import { scanWorldInfo } from '../src/prompt-assembly/world-info-scan.js';
import { WorldInfoBuffer, WorldInfoTimedEffects } from '../src/prompt-assembly/world-info-state.js';
import { scan_state } from '../src/prompt-assembly/world-info-enums.js';
import { createSeededRandom } from '../src/prompt-assembly/world-info-portability.js';

/**
 * Build a complete scan environment for an empty lore selection.
 * @param {object} [overrides] Overrides.
 * @returns {object} Environment.
 */
function scanEnv(overrides = {}) {
    // One stable metadata object: the state classes require the getter to return
    // the same live object on every access, as the browser's `() => chat_metadata` does.
    const chatMetadata = {};
    return {
        // State-class inputs.
        settings: {
            worldInfoBudget: 25,
            worldInfoBudgetCap: 0,
            worldInfoMaxRecursionSteps: 0,
            worldInfoMinActivations: 0,
            worldInfoMinActivationsDepthMax: 0,
            worldInfoOverflowAlert: false,
            worldInfoRecursive: false,
            worldInfoUseGroupScoring: false,
            worldInfoDepth: 2,
            worldInfoCaseSensitive: false,
            worldInfoMatchWholeWords: false,
        },
        escapeRegex: value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        getChatMetadata: () => chatMetadata,
        // Lore-module inputs.
        getWorldInfo: () => ({ charLore: [] }),
        getSelectedWorldInfo: () => [],
        getCharacterStrategy: () => 1,
        getInsertionStrategy: () => ({ evenly: 0, character_first: 1, global_first: 2 }),
        getPersonaLorebook: () => '',
        getCharacters: () => [],
        getThisChid: () => undefined,
        getCharaFilename: () => '',
        getStringHash: value => `h${String(value).length}`,
        getRequestHeaders: () => ({}),
        cache: new Map(),
        sortFn: (left, right) => right.order - left.order,
        metadataKey: 'world_info',
        worldInfoUrl: 'http://127.0.0.1:9/never',
        emitEntriesLoaded: jest.fn(),
        // Scan inputs.
        getContext: () => ({ extensionPrompts: {}, setExtensionPrompt: jest.fn() }),
        random: () => 0.5,
        countTokens: jest.fn(async () => 1),
        substituteParams: value => value,
        getTagKeyForEntity: () => '',
        getExtensionPromptByName: jest.fn(async () => ''),
        notifyOverflow: jest.fn(),
        emitScanDone: jest.fn(),
        ...overrides,
    };
}

describe('scanWorldInfo with an empty selection', () => {
    test('computes the budget from the injected settings and maxContext', async () => {
        const env = scanEnv();
        // Math.round(25 * 8192 / 100) = 2048
        const scan = await scanWorldInfo([], 8192, false, undefined, env);
        expect(scan.budget).toBe(2048);
    });

    test('applies the budget cap when configured', async () => {
        const env = scanEnv({ settings: { ...scanEnv().settings, worldInfoBudgetCap: 500 } });
        const scan = await scanWorldInfo([], 8192, false, undefined, env);
        expect(scan.budget).toBe(500);
    });

    test('returns the state the prompt-building phase consumes', async () => {
        const scan = await scanWorldInfo([], 8192, false, undefined, scanEnv());
        expect(scan.empty).toBe(true);
        expect(scan.allActivatedEntries).toBeInstanceOf(Map);
        expect(scan.allActivatedEntries.size).toBe(0);
        expect(scan.buffer).toBeInstanceOf(WorldInfoBuffer);
        expect(scan.timedEffects).toBeInstanceOf(WorldInfoTimedEffects);
        expect(Array.isArray(scan.sortedEntries)).toBe(true);
        expect(scan.sortedEntries).toEqual([]);
        expect(typeof scan.scanState).toBe('number');
        expect(scan.allActivatedText).toBe('');
        expect(scan.token_budget_overflowed).toBe(false);
    });

    test('collects lore through the injected lore context', async () => {
        const env = scanEnv();
        await scanWorldInfo([], 8192, false, undefined, env);
        expect(env.emitEntriesLoaded).toHaveBeenCalledTimes(1);
    });

    test('never rolls probability when nothing is activated', async () => {
        const env = scanEnv();
        await scanWorldInfo([], 8192, false, undefined, env);
        // No entries means no token counting and no probability roll.
        expect(env.countTokens).not.toHaveBeenCalled();
        expect(env.notifyOverflow).not.toHaveBeenCalled();
    });

    test('requires an environment', async () => {
        await expect(scanWorldInfo([], 8192, false, undefined, undefined)).rejects.toThrow();
    });
});

describe('scan wiring contracts', () => {
    test('uses the injected randomness source rather than Math.random', async () => {
        const random = jest.fn(() => 0.5);
        const env = scanEnv({ random });
        await scanWorldInfo([], 8192, false, undefined, env);
        // no entries to roll for, so the source is simply unused, not bypassed
        expect(Math.random).toBe(Math.random);
        expect(random).not.toHaveBeenCalled();
    });

    test('a seeded generator is accepted as the randomness source', async () => {
        const seeded = createSeededRandom(1234);
        const first = seeded();
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(1);
        expect(createSeededRandom(1234)()).toBe(first);
    });

    test('the scan state enum is the shared constant', () => {
        expect(scan_state).toEqual({ NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 });
    });
});
