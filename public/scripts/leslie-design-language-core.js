/**
 * Presentation-only Leslie design language preferences.
 *
 * This module intentionally has no DOM dependencies so preference migration
 * and fallback behavior can be covered by unit tests.
 */

export const DESIGN_LANGUAGE_PREFERENCE_KEY = 'leslie.design.language';
export const DEFAULT_DESIGN_LANGUAGE = 'dreamland';
export const DESIGN_LANGUAGES = Object.freeze(['dreamland']);

/**
 * Normalize an unknown stored value to a supported design language.
 * @param {unknown} value Stored preference.
 * @returns {'dreamland'} Supported design language.
 */
export function normalizeDesignLanguage(value) {
    return DESIGN_LANGUAGES.includes(value) ? value : DEFAULT_DESIGN_LANGUAGE;
}

/**
 * Read a design language preference from a Storage-compatible object.
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage Storage provider.
 * @returns {'dreamland'} Stored or default design language.
 */
export function readDesignLanguagePreference(storage) {
    try {
        return normalizeDesignLanguage(storage?.getItem(DESIGN_LANGUAGE_PREFERENCE_KEY));
    } catch {
        return DEFAULT_DESIGN_LANGUAGE;
    }
}

/**
 * Persist a normalized design language preference.
 * @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage Storage provider.
 * @param {unknown} value Requested design language.
 * @returns {'dreamland'} Persisted design language.
 */
export function writeDesignLanguagePreference(storage, value) {
    const normalized = normalizeDesignLanguage(value);
    try {
        storage?.setItem(DESIGN_LANGUAGE_PREFERENCE_KEY, normalized);
    } catch {
        // Restricted webviews can disable localStorage. The caller still gets
        // the normalized value and can apply it for the current session.
    }
    return normalized;
}
