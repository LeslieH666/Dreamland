import { describe, expect, jest, test } from '@jest/globals';
import { APPEARANCE_KEYS, readAppearance, writeAppearance } from '../public/scripts/dreamland-appearance-core.js';
import { readDesignLanguagePreference, writeDesignLanguagePreference } from '../public/scripts/leslie-design-language-core.js';

describe('DreamLand appearance isolation and recovery', () => {
    test('normalizes old layouts while preserving unrelated preferences', () => {
        const values = new Map([['leslie.design.language', 'classic'], [APPEARANCE_KEYS.style, 'blue']]);
        const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
        expect(readDesignLanguagePreference(storage)).toBe('dreamland');
        expect(readAppearance(storage, 'style')).toBe('blue');
        writeDesignLanguagePreference(storage, 'dreamland');
        writeAppearance(storage, 'style', 'paper');
        writeDesignLanguagePreference(storage, 'cupertino');
        expect(readDesignLanguagePreference(storage)).toBe('dreamland');
        expect(readAppearance(storage, 'style')).toBe('blue');
        expect([...values.keys()]).toEqual(['leslie.design.language', APPEARANCE_KEYS.style]);
    });

    test('rejects corrupted values and defaults to unobstructed plain surfaces', () => {
        const storage = { getItem: () => '<script>corrupt</script>' };
        expect(readAppearance(storage, 'style')).toBe('blue');
        expect(readAppearance(storage, 'background')).toBe('off');
        expect(readAppearance(storage, 'decoration')).toBe('subtle');
    });

    test('migrates every old style without storage and does not save unrecognized keys', () => {
        const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(readAppearance(storage, 'style')).toBe('blue');
        for (const style of ['clear', 'moon', 'paper', 'blue']) expect(writeAppearance(storage, 'style', style)).toBe('blue');
        const setItem = jest.fn();
        expect(writeAppearance({ setItem }, 'unknown', 'anything')).toBeUndefined();
        expect(setItem).not.toHaveBeenCalled();
    });
});
