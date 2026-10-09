/**
 * Pure core for the extension-prompt registry (Phase 2.5.2 step 1).
 *
 * Lifted from public/script.js (`getExtensionPromptByName` :3242,
 * `getExtensionPromptMaxDepth` :3266, `getExtensionPrompt` :3286,
 * `getAllExtensionPrompts` :3216) with every module-global read replaced by an
 * explicit argument. The functions here:
 *
 *   - never read the page-global `extension_prompts`, the DOM, or any other
 *     ambient state;
 *   - never mutate `registry` or its entries;
 *   - take macro substitution as an injected function (`opts.substitute`), so the
 *     caller decides which macro engine applies (see macros.js).
 *
 * `public/script.js` keeps the same exported signatures as thin adapters over
 * this module; the server can call the same functions with a registry rebuilt
 * from persisted data.
 */

import { ExtensionPromptType, MAX_INJECTION_DEPTH } from './enums.js';

/**
 * @typedef {object} ExtensionPromptEntry
 * @property {string} value Injected text.
 * @property {number} position ExtensionPromptType.
 * @property {number} [depth] Injection depth.
 * @property {number} [role] ExtensionPromptRole.
 * @property {boolean} [scan] Whether World Info may scan this prompt.
 * @property {() => (Promise<boolean>|boolean)} [filter] Runtime predicate. Only
 *   `getExtensionPromptByName` / `getAllExtensionPrompts` honour its result; see
 *   `applyLegacyFilterSemantics` for the `getExtensionPrompt` behaviour.
 */

/** Identity macro substitution, used when the caller injects none. */
const identitySubstitute = text => text;

/**
 * Invoke a registry entry's runtime predicate, if it has one.
 *
 * The result is **deliberately discarded** to reproduce public/script.js:3300
 * exactly: `Array.prototype.filter` was given an `async` predicate there, which
 * returns a Promise and is therefore always truthy, so a `false` result never
 * removed the entry. The predicate itself is still invoked, which is why this
 * function exists rather than omitting the call.
 * @param {ExtensionPromptEntry} entry Registry entry.
 * @returns {Promise<void>} Resolves once the predicate settled.
 */
async function applyLegacyFilterSemantics(entry) {
    if (typeof entry?.filter === 'function') {
        await entry.filter();
    }
}

/**
 * Whether an entry's runtime predicate passes, awaited properly.
 * @param {ExtensionPromptEntry} entry Registry entry.
 * @returns {Promise<boolean>} True when the entry should be used.
 */
async function passesFilter(entry) {
    if (typeof entry?.filter !== 'function') {
        return true;
    }
    return Boolean(await entry.filter());
}

/**
 * Get the maximum injection depth. Matches public/script.js:3266.
 * @returns {number} Maximum depth.
 */
export function getExtensionPromptMaxDepth() {
    return MAX_INJECTION_DEPTH;
}

/**
 * Fetch one registry entry by key and substitute its macros.
 * @param {Record<string, ExtensionPromptEntry>} registry Extension prompts by key.
 * @param {string} name Registry key.
 * @param {{ substitute?: (text: string) => string }} [opts] Options.
 * @returns {Promise<string>} Substituted value, or '' when absent or filtered out.
 */
export async function getExtensionPromptByName(registry, name, opts = {}) {
    if (!name) {
        return '';
    }

    const prompt = registry?.[name];

    if (!prompt) {
        return '';
    }

    if (!await passesFilter(prompt)) {
        return '';
    }

    const { substitute = identitySubstitute } = opts;
    return substitute(prompt.value);
}

/**
 * Join every non-empty registry entry, in insertion order, then substitute.
 * Matches public/script.js:3216.
 * @param {Record<string, ExtensionPromptEntry>} registry Extension prompts by key.
 * @param {{ substitute?: (text: string) => string }} [opts] Options.
 * @returns {Promise<string>} Joined and substituted text.
 */
export async function getAllExtensionPrompts(registry, opts = {}) {
    const values = [];

    for (const prompt of Object.values(registry ?? {})) {
        const value = prompt?.value?.trim();

        if (!value) {
            continue;
        }

        if (!await passesFilter(prompt)) {
            continue;
        }

        values.push(value);
    }

    const { substitute = identitySubstitute } = opts;
    return substitute(values.join('\n'));
}

/**
 * Select, sort, and join the prompts for one (position, depth, role).
 * Matches public/script.js:3286, including its filter semantics.
 *
 * Selection order (all conditions must hold):
 *   1. `entry.position == position` (loose, as in the source) and `entry.value` truthy;
 *   2. `depth` unspecified, or unspecified on the entry, or exactly equal;
 *   3. `role` unspecified, or unspecified on the entry, or exactly equal.
 *
 * Surviving entries are ordered by **key name, lexicographically**
 * (`Object.keys(...).sort()`, public/script.js:3295), their trimmed values are
 * joined with `separator`, `wrap` adds a leading/trailing separator, and the
 * result is macro-substituted only when non-empty.
 *
 * Pure: reads nothing ambient, writes neither `registry` nor its entries, and
 * returns a new string.
 *
 * @param {Record<string, ExtensionPromptEntry>} registry Extension prompts by key.
 * @param {number} [position] ExtensionPromptType to select.
 * @param {number} [depth] Required depth, or undefined to accept any.
 * @param {{ separator?: string, role?: number, wrap?: boolean, substitute?: (text: string) => string }} [opts] Options.
 * @returns {Promise<string>} Joined, wrapped, substituted text.
 */
export async function getExtensionPrompt(registry, position = ExtensionPromptType.IN_PROMPT, depth = undefined, opts = {}) {
    const { separator = '\n', role = undefined, wrap = true, substitute = identitySubstitute } = opts;

    const candidates = Object.keys(registry ?? {})
        .sort()
        .map(key => registry[key])
        .filter(entry => entry.position == position && entry.value)
        .filter(entry => depth === undefined || entry.depth === undefined || entry.depth === depth)
        .filter(entry => role === undefined || entry.role === undefined || entry.role === role);

    // Preserves the source's latent behaviour: predicates run, results are ignored.
    await Promise.all(candidates.map(entry => applyLegacyFilterSemantics(entry)));

    let values = candidates.map(entry => entry.value.trim()).join(separator);

    if (wrap && values.length && !values.startsWith(separator)) {
        values = separator + values;
    }
    if (wrap && values.length && !values.endsWith(separator)) {
        values = values + separator;
    }
    if (values.length) {
        values = substitute(values);
    }

    return values;
}
