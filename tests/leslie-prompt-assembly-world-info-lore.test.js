import { describe, expect, jest, test } from '@jest/globals';

import {
    KNOWN_DECORATORS,
    getSortedEntries,
    loadWorldInfo,
    parseDecorators,
} from '../src/prompt-assembly/world-info-lore.js';

/**
 * Build a hermetic lore context.
 * @param {object} [overrides] Overrides.
 * @returns {object} Context.
 */
function loreContext(overrides = {}) {
    const cache = new Map();
    const context = {
        getWorldInfo: () => ({ charLore: [] }),
        getSelectedWorldInfo: () => [],
        getCharacterStrategy: () => 1,
        getInsertionStrategy: () => ({ evenly: 0, character_first: 1, global_first: 2 }),
        getPersonaLorebook: () => '',
        getChatMetadata: () => ({}),
        getCharacters: () => [],
        getThisChid: () => undefined,
        getCharaFilename: () => '',
        getStringHash: value => `h${String(value).length}`,
        getRequestHeaders: () => ({ 'content-type': 'application/json' }),
        cache,
        sortFn: (left, right) => right.order - left.order,
        metadataKey: 'world_info',
        // A URL that would fail loudly if the loader ever tried to fetch.
        worldInfoUrl: 'http://127.0.0.1:9/never',
        emitEntriesLoaded: jest.fn(),
        ...overrides,
    };
    return context;
}

describe('parseDecorators', () => {
    test('the decorator vocabulary is the moved constant', () => {
        expect(KNOWN_DECORATORS).toEqual(['@@activate', '@@dont_activate']);
    });

    test('returns the content unchanged when there is no decorator', () => {
        expect(parseDecorators('plain content')).toEqual([[], 'plain content']);
    });

    test('reports a known decorator and returns string content', () => {
        const [decorators, content] = parseDecorators('@@activate hello there');
        expect(decorators.length).toBeGreaterThan(0);
        expect(JSON.stringify(decorators)).toContain('@@activate');
        expect(typeof content).toBe('string');
        expect(content).toContain('hello');
    });
});

describe('loadWorldInfo', () => {
    test('an empty name yields nothing', async () => {
        await expect(loadWorldInfo('', loreContext())).resolves.toBeUndefined();
        await expect(loadWorldInfo(undefined, loreContext())).resolves.toBeUndefined();
    });

    test('a cached book is returned without any HTTP call', async () => {
        const context = loreContext();
        const book = { entries: { 0: { uid: 0, content: 'cached', order: 1 } } };
        context.cache.set('book', book);

        await expect(loadWorldInfo('book', context)).resolves.toBe(book);
    });
});

describe('getSortedEntries', () => {
    test('reports empty lore and notifies listeners when nothing is selected', async () => {
        const context = loreContext();
        const entries = await getSortedEntries(context);
        expect(entries).toEqual([]);
        expect(context.emitEntriesLoaded).toHaveBeenCalledTimes(1);
    });

    test('collects global lore and orders it by the injected sorter', async () => {
        const context = loreContext({ getSelectedWorldInfo: () => ['book'] });
        context.cache.set('book', {
            entries: {
                0: { uid: 0, content: 'low', order: 10, disable: false, key: ['alpha'] },
                1: { uid: 1, content: 'high', order: 90, disable: false, key: ['beta'] },
            },
        });

        const entries = await getSortedEntries(context);
        expect(entries.length).toBeGreaterThan(0);

        const orders = entries.map(entry => Number(entry.order));
        expect(orders).toEqual([...orders].sort((left, right) => right - left));
        expect(orders[0]).toBe(90);
        expect(context.emitEntriesLoaded).toHaveBeenCalledTimes(1);
        expect(context.emitEntriesLoaded.mock.calls[0][0]).toHaveProperty('globalLore');
    });

    test('collection keeps disabled entries; the scan is what filters them', async () => {
        // getSortedEntries only collects, decorates and orders. The `disable` check
        // lives in the scan loop (world-info.js checkWorldInfo), so asserting a
        // filter here would encode behaviour the moved code does not have.
        const context = loreContext({ getSelectedWorldInfo: () => ['book'] });
        context.cache.set('book', { entries: { 0: { uid: 0, content: 'off', order: 5, disable: true } } });
        const entries = await getSortedEntries(context);
        expect(entries.map(entry => entry.content)).toContain('off');
    });
});
