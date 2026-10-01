import { describe, expect, jest, test } from '@jest/globals';
import { APPEARANCE_KEYS, readAppearance, writeAppearance } from '../public/scripts/dreamland-appearance-core.js';
import { readDesignLanguagePreference, writeDesignLanguagePreference } from '../public/scripts/leslie-design-language-core.js';

describe('DreamLand appearance isolation and recovery', () => {
    test('restores the saved style independently of legacy design language', () => {
        const values = new Map([['leslie.design.language', 'classic'], [APPEARANCE_KEYS.style, 'blue']]);
        const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
        expect(readDesignLanguagePreference(storage)).toBe('classic');
        expect(readAppearance(storage, 'style')).toBe('blue');
        writeDesignLanguagePreference(storage, 'dreamland');
        writeAppearance(storage, 'style', 'paper');
        writeDesignLanguagePreference(storage, 'cupertino');
        expect(readDesignLanguagePreference(storage)).toBe('cupertino');
        expect(readAppearance(storage, 'style')).toBe('paper');
        expect([...values.keys()]).toEqual(['leslie.design.language', APPEARANCE_KEYS.style]);
    });

    test('rejects corrupted values and defaults to unobstructed plain surfaces', () => {
        const storage = { getItem: () => '<script>corrupt</script>' };
        expect(readAppearance(storage, 'style')).toBe('clear');
        expect(readAppearance(storage, 'background')).toBe('off');
        expect(readAppearance(storage, 'decoration')).toBe('subtle');
    });

    test('can change every style without storage and does not save unrecognized keys', () => {
        const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(readAppearance(storage, 'style')).toBe('clear');
        for (const style of ['clear', 'moon', 'paper', 'blue']) expect(writeAppearance(storage, 'style', style)).toBe(style);
        const setItem = jest.fn();
        expect(writeAppearance({ setItem }, 'unknown', 'anything')).toBeUndefined();
        expect(setItem).not.toHaveBeenCalled();
    });
});
