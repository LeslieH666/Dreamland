/**
 * Token-counting adapter (Phase 2.5.2 step 3).
 *
 * Lifted from `countTokensOpenAIAsync` in public/scripts/tokenizers.js:846. Only
 * the part that is *algorithm* moves here — the count accumulation, the single
 * `claude` promotion to `full`, and the trailing `-2` correction. The two inputs
 * that are environment-specific stay injected:
 *
 *   - `resolveModel()` — the browser's `getTokenizerModel()` (see the note below);
 *   - `countOne(message, model)` — the tokenizer call itself.
 *
 * `countOne` is the reason browser and server counts agree by construction: the
 * browser does not tokenize locally either — it POSTs each message to
 * `/api/tokenizers/openai/count?model=…` (public/scripts/tokenizers.js:847), so
 * both sides reach one implementation. This step therefore verifies the shared
 * *algorithm* rather than re-deriving a tokenizer.
 *
 * Scope note for step 3: `getTokenizerModel()` is ~150 lines of per-source model
 * heuristics (Azure, DeepSeek, OpenRouter, ElectronHub, Chutes, …). It is left in
 * public/scripts/tokenizers.js and injected, so this lift changes no model
 * resolution. Lifting it in full, or narrowing it to the providers in Phase 2.5
 * scope, is a decision recorded in the step 3 report.
 */

/** Tokenizer id that forces full (non-adjusted) counting, mirroring tokenizers.js:858. */
export const CLAUDE_TOKENIZER = 'claude';

/** Correction applied when the count is not "full", mirroring tokenizers.js:884. */
export const NON_FULL_TOKEN_ADJUSTMENT = 2;

/**
 * Coerce input to an array, as the source does.
 * @param {object|object[]} messages Message or messages.
 * @returns {object[]} Array of messages.
 */
function toMessageArray(messages) {
    return Array.isArray(messages) ? messages : [messages];
}

/**
 * Count tokens for one or more chat messages.
 *
 * Reproduces public/scripts/tokenizers.js:846-887 exactly:
 *   - the running total starts at -1 and each message's count is added;
 *   - encountering the `claude` tokenizer flips `full` on for the trailing
 *     adjustment, even when the caller passed `full = false`;
 *   - when `full` is false, 2 tokens are subtracted at the end.
 *
 * Pure with respect to its inputs: `messages` and `cache` are not mutated beyond
 * the caller-supplied cache object, which is filled exactly as the browser fills
 * its own `tokenCache` entry.
 *
 * @param {object|object[]} messages Message or messages to count.
 * @param {object} context Counting context.
 * @param {() => string} context.resolveModel Resolves the tokenizer id.
 * @param {(message: object, model: string) => Promise<number>|number} context.countOne Counts one message.
 * @param {Record<string, number>} [context.cache] Mutable cache keyed by model+hash.
 * @param {(value: string) => string|number} [context.hash] Stable string hash for the cache key.
 * @param {boolean} [context.full] Whether the count is a full (unadjusted) count.
 * @returns {Promise<number>} Token count.
 */
export async function countMessageTokens(messages, context) {
    const {
        resolveModel,
        countOne,
        cache = null,
        hash = value => value,
        full = false,
    } = context;

    const list = toMessageArray(messages);
    let tokenCount = -1;
    let isFull = full;

    for (const message of list) {
        const model = resolveModel();

        if (model === CLAUDE_TOKENIZER) {
            isFull = true;
        }

        const cacheKey = `${model}-${hash(JSON.stringify(message))}`;
        const cached = cache ? cache[cacheKey] : undefined;

        if (typeof cached === 'number') {
            tokenCount += cached;
        } else {
            const counted = Number(await countOne(message, model));
            tokenCount += counted;
            if (cache) {
                cache[cacheKey] = counted;
            }
        }
    }

    if (!isFull) {
        tokenCount -= NON_FULL_TOKEN_ADJUSTMENT;
    }

    return tokenCount;
}

/**
 * Count tokens for a plain string as a system message with a full count.
 * Mirrors `counterWrapperOpenAIAsync` (public/scripts/tokenizers.js:564).
 * @param {string} text Text to count.
 * @param {object} context Counting context, as for {@link countMessageTokens}.
 * @returns {Promise<number>} Token count.
 */
export async function countTextTokens(text, context) {
    return countMessageTokens({ role: 'system', content: text }, { ...context, full: true });
}
