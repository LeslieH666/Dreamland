/**
 * World Info portability guard + seeded RNG (Phase 2.5.2 step 4).
 *
 * The World Info scan can be reproduced server-side, but three sources in the
 * browser change the activated text in ways the server cannot replicate:
 *
 *   1. the regex engine, which rewrites every activated entry's content and can
 *      drop it entirely (public/scripts/world-info.js:5086, empty content is
 *      skipped);
 *   2. the vectors extension, which force-activates entries through
 *      `WORLDINFO_FORCE_ACTIVATE` (public/scripts/extensions/vectors/index.js:1725);
 *   3. `WORLDINFO_SCAN_DONE` listeners, which may rewrite the activated text,
 *      budget and recursion state (public/scripts/world-info.js:5056-5067).
 *
 * Per 附 L these stay browser-only. Rather than silently producing different
 * prompt text, the server checks for them and fails closed with a message naming
 * the active source. The third source had **no in-tree subscriber** when this was
 * written (only the emit site exists), so its check is a no-op today and exists
 * for third-party extensions.
 */

/** `regex_placement.WORLD_INFO` (public/scripts/extensions/regex/engine.js:290). */
export const WORLD_INFO_REGEX_PLACEMENT = 5;

/** Identifier for each divergence source, used in error messages. */
export const DIVERGENCE_SOURCE = Object.freeze({
    WORLD_INFO_REGEX: 'world_info_regex',
    VECTORS: 'vectors',
    SCAN_DONE_LISTENERS: 'worldinfo_scan_done_listeners',
});

/**
 * Number of in-tree `WORLDINFO_SCAN_DONE` subscribers, measured by grepping
 * public/ and src/ for the event name: only the emit site in world-info.js
 * matches. Kept as a constant so the documented boundary is testable.
 */
export const IN_TREE_SCAN_DONE_LISTENERS = 0;

/** Human-readable explanation per source. */
const SOURCE_EXPLANATION = Object.freeze({
    [DIVERGENCE_SOURCE.WORLD_INFO_REGEX]: 'a regex script targets the WORLD_INFO placement, so it can rewrite or drop activated entries',
    [DIVERGENCE_SOURCE.VECTORS]: 'the vectors extension force-activates World Info entries through WORLDINFO_FORCE_ACTIVATE',
    [DIVERGENCE_SOURCE.SCAN_DONE_LISTENERS]: 'a WORLDINFO_SCAN_DONE listener may rewrite the activated text, budget or recursion state',
});

/**
 * Whether any script applies to the WORLD_INFO placement.
 * Mirrors public/scripts/extensions/regex/engine.js:374 (`script.placement.includes(placement)`).
 * @param {object[]} regexScripts Regex scripts.
 * @returns {boolean} True when a script targets World Info.
 */
function hasWorldInfoRegexScript(regexScripts) {
    if (!Array.isArray(regexScripts)) {
        return false;
    }
    return regexScripts.some(script => Array.isArray(script?.placement) && script.placement.includes(WORLD_INFO_REGEX_PLACEMENT));
}

/**
 * List the divergence sources that are active for this deployment.
 * @param {object} [context] Deployment facts.
 * @param {object[]} [context.regexScripts] Scripts that would run (`availableOnly` already applied).
 * @param {boolean} [context.regexDisabled] Whether the regex extension is disabled.
 * @param {boolean} [context.vectorsEnabled] Whether the vectors extension is enabled.
 * @param {number} [context.scanDoneListenerCount] Registered WORLDINFO_SCAN_DONE listeners.
 * @returns {string[]} Active source identifiers.
 */
export function detectWorldInfoDivergenceSources(context = {}) {
    const {
        regexScripts = [],
        regexDisabled = false,
        vectorsEnabled = false,
        scanDoneListenerCount = 0,
    } = context;

    const active = [];

    // engine.js:342 returns the input untouched when the regex extension is off.
    if (!regexDisabled && hasWorldInfoRegexScript(regexScripts)) {
        active.push(DIVERGENCE_SOURCE.WORLD_INFO_REGEX);
    }
    if (vectorsEnabled) {
        active.push(DIVERGENCE_SOURCE.VECTORS);
    }
    if (Number(scanDoneListenerCount) > 0) {
        active.push(DIVERGENCE_SOURCE.SCAN_DONE_LISTENERS);
    }

    return active;
}

/**
 * Fail closed when the browser's World Info result cannot be reproduced.
 * @param {object} [context] Deployment facts, as for {@link detectWorldInfoDivergenceSources}.
 * @returns {void}
 * @throws {Error} When any divergence source is active.
 */
export function assertWorldInfoPortable(context = {}) {
    const active = detectWorldInfoDivergenceSources(context);

    if (active.length === 0) {
        return;
    }

    const detail = active.map(source => `${source} (${SOURCE_EXPLANATION[source]})`).join('; ');
    throw new Error(
        'World Info cannot be assembled server-side for this deployment because the browser result would differ: '
        + `${detail}. These are documented browser-only capabilities (Phase 2.5 scope); `
        + 'disable them, or keep prompt assembly on the browser for this account.',
    );
}

/**
 * Deterministic RNG for the World Info probability roll, so a seeded run is
 * reproducible. Uses mulberry32; production keeps `Math.random`.
 * @param {number} seed Seed (any number; only the low 32 bits matter).
 * @returns {() => number} Function returning [0, 1).
 */
export function createSeededRandom(seed) {
    let state = (Number(seed) || 0) >>> 0;
    return function seededRandom() {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
