/**
 * Pure macro substitution core (Phase 2.5.2 step 2).
 *
 * This is a **lift of the existing engine**, not a rewrite: the algorithm of
 * `substituteParams` and `substituteParamsLegacy` in public/script.js
 * (:2962-2992 and :2812-2942) is reproduced statement for statement, with every
 * module-global read replaced by an explicit `context` field and every browser
 * side effect replaced by an injected callback. Nothing here imports the page,
 * the DOM, or the worker-global state.
 *
 * Engine selection is preserved by `context.powerUser.experimental_macro_engine`,
 * exactly as in the browser. The experimental engine itself stays in the browser
 * (its macro definitions import script.js, power-user.js and events.js, so it
 * cannot be loaded from Node); callers inject it through `context.engines.extended`.
 */

/** Identity post-processor used when the caller supplies none. */
const identityPostProcess = text => text;

/**
 * @typedef {object} MacroContext
 * @property {string} [name1] User display name (browser `name1`).
 * @property {string} [name2] Character display name (browser `name2`).
 * @property {string} [name1Override] Per-call user name override.
 * @property {string} [name2Override] Per-call character name override.
 * @property {string} [original] Original message for `{{original}}`.
 * @property {string} [groupOverride] Group member list for `{{group}}`.
 * @property {boolean} [replaceCharacterCard] Whether card macros are replaced.
 * @property {Record<string, unknown>} [dynamicMacros] Extra environment values.
 * @property {(text: string) => string} [postProcessFn] Per-macro post-processing.
 * @property {object} [powerUser] Browser `power_user` (engine switch + instruct).
 * @property {object[]} [characters] Browser `characters` array.
 * @property {object[]} [groups] Browser `groups` array.
 * @property {string|null} [selectedGroup] Browser `selected_group`.
 * @property {string} [mainApi] Browser `main_api`.
 * @property {() => object} [getCardFields] Lazily resolves `getCharacterCardFields()`.
 * @property {object} [helpers] `{ evaluateMacros, parseMesExamples, formatInstructModeExamples, getGeneratingModel }`.
 * @property {object} [engines] `{ extended }` experimental engine implementation.
 * @property {() => boolean} [shouldAnnounceExperimentalFeature] Gate for the onboarding hint.
 * @property {(feature: string) => void} [onExperimentalMacroFeature] Onboarding hint sink.
 * @property {(message: string, value?: unknown) => void} [warn] Warning sink.
 */

/**
 * Substitute `{{macro}}` parameters using the legacy engine.
 *
 * Mirrors public/script.js:2812. The environment it builds is the same, in the
 * same order, including the "substituted last" comment on `user`/`char`.
 *
 * @param {string} content Text to substitute.
 * @param {MacroContext} [context] Explicit environment.
 * @returns {string} Substituted text.
 */
export function substituteParamsLegacy(content, context = {}) {
    if (!content) {
        return '';
    }

    const {
        name1,
        name2,
        name1Override,
        name2Override,
        original,
        groupOverride,
        replaceCharacterCard = true,
        dynamicMacros = {},
        postProcessFn = identityPostProcess,
        powerUser = {},
        characters = [],
        groups = [],
        selectedGroup = null,
        mainApi,
        getCardFields,
        helpers = {},
        shouldAnnounceExperimentalFeature,
        onExperimentalMacroFeature,
    } = context;

    const { evaluateMacros, parseMesExamples, formatInstructModeExamples, getGeneratingModel } = helpers;

    // If experimental macro engine is enabled, use it. This code will be cleaned up in the future.
    if (powerUser?.experimental_macro_engine) {
        return substituteParams(content, context);
    }

    // Try to roughly detect experimental macro features to show the onboarding if needed.
    // This does not have to be 100% accurate, only best effort what we can quickly check.
    // Only do this if the warning wasn't shown yet, to prevent needless regex checks.
    if (typeof shouldAnnounceExperimentalFeature === 'function' ? shouldAnnounceExperimentalFeature() : false) {
        let feature = /** @type {string|null} */ (null);
        if (/{{\s*if/.test(content)) feature = '{{if}} macro';
        else if (/{{\s*\//.test(content)) feature = 'scoped macro';
        else if (/{{\s*[!?~#/]/.test(content)) feature = 'macro flags';
        else if (/{{\s*[.$]/.test(content)) feature = 'variable shorthands';
        else if (/\{\{(?:(?!\}\}).)*\{\{(?=[\s\S]*?\}\}[\s\S]*?\}\})/.test(content)) feature = 'nested macro';
        else if (/{{(?:greeting|charFirstMessage)(?:::\d+)?}}/i.test(content)) feature = 'greeting macro';

        if (feature) {
            onExperimentalMacroFeature?.(feature);
        }
    }

    const environment = {};

    if (typeof original === 'string') {
        let originalSubstituted = false;
        environment.original = () => {
            if (originalSubstituted) {
                return '';
            }

            originalSubstituted = true;
            return original;
        };
    }

    const getGroupValue = (includeMuted) => {
        if (typeof groupOverride === 'string') {
            return groupOverride;
        }

        if (selectedGroup) {
            const group = groups.find(x => x.id === selectedGroup);
            const members = group?.members;
            /** @type {string[]} */
            const disabledMembers = group?.disabled_members ?? [];
            const isMuted = x => includeMuted ? true : !disabledMembers.includes(x);
            const names = Array.isArray(members)
                ? members.filter(isMuted).map(m => characters.find(c => c.avatar === m)?.name).filter(Boolean).join(', ')
                : '';
            return names;
        } else {
            return name2Override ?? name2;
        }
    };

    const getNotCharValue = () => {
        const currentUser = name1Override ?? name1;
        const currentSpeaker = name2Override ?? name2;

        // Single character chat
        if (!selectedGroup) {
            return currentUser;
        }

        // Group chat
        const members = groups.find(x => x.id === selectedGroup)?.members;

        if (!Array.isArray(members)) {
            return currentUser;
        }

        const memberNames = members
            .map(m => characters.find(c => c.avatar === m)?.name)
            .filter(Boolean); // Filter out any null/undefined names

        // Filter out the current speaker and add the user
        const otherMembers = memberNames.filter(name => name !== currentSpeaker);
        otherMembers.push(currentUser);

        return otherMembers.join(', ');
    };

    if (replaceCharacterCard) {
        const fields = getCardFields();
        environment.charPrompt = fields.system || '';
        environment.charInstruction = environment.charJailbreak = fields.jailbreak || '';
        environment.description = fields.description || '';
        environment.personality = fields.personality || '';
        environment.scenario = fields.scenario || '';
        environment.persona = fields.persona || '';
        environment.mesExamples = () => {
            const isInstruct = powerUser.instruct.enabled && mainApi !== 'openai';
            const mesExamplesArray = parseMesExamples(fields.mesExamples, isInstruct);
            if (isInstruct) {
                const instructExamples = formatInstructModeExamples(mesExamplesArray, name1, name2);
                return instructExamples.join('');
            }
            return mesExamplesArray.join('');
        };
        environment.mesExamplesRaw = fields.mesExamples || '';
        environment.charVersion = fields.version || '';
        environment.char_version = fields.version || '';
        environment.charDepthPrompt = fields.charDepthPrompt || '';
        environment.creatorNotes = fields.creatorNotes || '';
    }

    // Must be substituted last so that they're replaced inside {{description}}
    environment.user = name1Override ?? name1;
    environment.char = name2Override ?? name2;
    environment.group = environment.charIfNotGroup = getGroupValue(true);
    environment.groupNotMuted = getGroupValue(false);
    environment.notChar = getNotCharValue();
    environment.model = getGeneratingModel();

    if (dynamicMacros && typeof dynamicMacros === 'object') {
        Object.assign(environment, dynamicMacros);
    }

    return evaluateMacros(content, environment, postProcessFn);
}

/**
 * Substitute `{{macro}}` parameters, selecting the engine exactly as the browser
 * does. Mirrors public/script.js:2962.
 *
 * @param {string} content Text to substitute.
 * @param {MacroContext} [context] Explicit environment.
 * @returns {string} Substituted text.
 */
export function substituteParams(content, context = {}) {
    if (!content) return '';

    if (typeof content !== 'string') {
        (context.warn ?? (() => {}))('substituteParams: content will be coerced to string', content);
        content = String(content);
    }

    // Keep the new macro engine behind a feature switch for now
    if (!context.powerUser?.experimental_macro_engine) {
        return substituteParamsLegacy(content, context);
    }

    const extended = context.engines?.extended;

    if (typeof extended !== 'function') {
        // The experimental engine's macro definitions import browser modules, so
        // it cannot live in this shared module. Failing loudly beats silently
        // returning different prompt text than the browser.
        throw new Error('substituteParams: the experimental macro engine is enabled but no implementation was injected (context.engines.extended).');
    }

    return extended(content, context);
}
