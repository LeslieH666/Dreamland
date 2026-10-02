// Only presentation choices belong here. Credentials and drafts never do.
export const PREFERENCE_OPTIONS = Object.freeze({
    'dreamland.appearance.style': ['clear', 'moon', 'paper', 'blue'],
    'dreamland.appearance.decoration': ['full', 'subtle', 'off'],
    'dreamland.appearance.background': ['off', 'soft', 'visible'],
    'leslie.design.language': ['dreamland', 'cupertino', 'classic'],
    'leslie.theme.preference': ['auto', 'light', 'dark'],
    'leslie.color.palette': ['rose', 'jade', 'iris', 'clay', 'slate'],
    'leslie-local-model-loading-enabled': ['true', 'false'],
    'leslie-story-choice-mode': ['free', 'guided'],
    'leslie-plot-compass-duration': ['true', 'false'],
    'leslie-plot-compass-intensity': ['grounded', 'emotional', 'bold'],
    language: null,
    'leslie.privacy-mode.v1': null,
});
export const LOGIN_APPEARANCE_KEY = 'dreamland.login.appearance';
export const PREFERENCES_OWNER_KEY = 'leslie.preferences.owner';

// Accept known v1 selections for older clients, but never activate old layouts.
export function normalizePreference(key, value) {
    if (value === null || !validPreference(key, value)) return value;
    if (key === 'dreamland.appearance.style') return 'blue';
    if (key === 'leslie.design.language') return 'dreamland';
    if (key === 'dreamland.appearance.decoration' && value === 'full') return 'subtle';
    return value;
}

export function validPreference(key, value) {
    if (!Object.hasOwn(PREFERENCE_OPTIONS, key)) return false;
    if (value === null) return true;
    if (typeof value !== 'string' || value.length > 1024) return false;
    if (PREFERENCE_OPTIONS[key]) return PREFERENCE_OPTIONS[key].includes(value);
    if (key === 'language') return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(value);
    try {
        const state = JSON.parse(value);
        return typeof state.enabled === 'boolean' && state.blocks && typeof state.blocks === 'object' && !Array.isArray(state.blocks)
            && Object.entries(state.blocks).every(([block, enabled]) => ['conversations', 'header', 'messages', 'composer', 'connection'].includes(block) && typeof enabled === 'boolean')
            && Object.keys(state).every(field => ['enabled', 'blocks'].includes(field));
    } catch { return false; }
}

export function loginAppearance(values = {}) {
    return Object.fromEntries(['dreamland.appearance.style', 'dreamland.appearance.decoration', 'leslie.design.language', 'leslie.theme.preference', 'leslie.color.palette']
        .filter(key => values[key] != null && validPreference(key, values[key])).map(key => [key, normalizePreference(key, values[key])]));
}
