/**
 * World Info scan state: the key-matching buffer and the timed-effect store
 * (Phase 2.5.2 step 4, substep 1).
 *
 * Moved verbatim from public/scripts/world-info.js with every ambient read turned
 * into an explicit input:
 *   - the three scan settings arrive as `context.settings`;
 *   - `escapeRegex` arrives as `context.escapeRegex`;
 *   - the live chat metadata object arrives as `context.getChatMetadata()`, a
 *     getter rather than a captured value because the browser reassigns
 *     `chat_metadata` when a chat is loaded (public/script.js).
 *
 * Behaviour is unchanged; public/scripts/world-info.js imports these classes and
 * supplies the browser bindings.
 */

import { MAX_SCAN_DEPTH, scan_state, world_info_logic } from './world-info-enums.js';

function isValidRegex(input) {
    return parseRegexFromString(input) !== null;
}

export function parseRegexFromString(input) {
    // Extracting the regex pattern and flags
    let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null; // Not a valid regex format
    }

    let [, pattern, flags] = match;

    // If we find any unescaped slash delimiter, we also exit out.
    // JS doesn't care about delimiters inside regex patterns, but for this to be a valid regex outside of our implementation,
    // we have to make sure that our delimiter is correctly escaped. Or every other engine would fail.
    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }

    // Now we need to actually unescape the slash delimiters, because JS doesn't care about delimiters
    pattern = pattern.replace('\\/', '/');

    // Then we return the regex. If it fails, it was invalid syntax.
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}

const defaultGlobalScanData = Object.freeze({
    trigger: 'normal',
    personaDescription: '',
    characterDescription: '',
    characterPersonality: '',
    characterDepthPrompt: '',
    scenario: '',
    creatorNotes: '',
});

class WorldInfoBuffer {
    /**
     * @type {Map<string, object>} Map of entries that need to be activated no matter what
     */
    static externalActivations = new Map();

    /**
     * @type {WIGlobalScanData} Chat independent data to be scanned, such as persona and character descriptions
     */
    #globalScanData = null;

    /**
     * @type {string[]} Array of messages sorted by ascending depth
     */
    #depthBuffer = [];

    /**
     * @type {string[]} Array of strings added by recursive scanning
     */
    #recurseBuffer = [];

    /**
     * @type {string[]} Array of strings added by prompt injections that are valid for the current scan
     */
    #injectBuffer = [];

    /**
     * @type {number} The skew of the global scan depth. Used in "min activations"
     */
    #skew = 0;

    /**
     * @type {number} The starting depth of the global scan depth.
     */
    #startDepth = 0;

    /**
     * Initialize the buffer with the given messages.
     * @param {string[]} messages Array of messages to add to the buffer
     * @param {WIGlobalScanData} globalScanData Chat independent context to be scanned
     */
    constructor(messages, globalScanData, context) {
        if (!context || typeof context.escapeRegex !== 'function' || !context.settings) {
            throw new Error('WorldInfoBuffer requires a context { settings, escapeRegex }.');
        }

        this.context = context;
        this.settings = context.settings;

        this.#initDepthBuffer(messages);
        this.#globalScanData = globalScanData;
    }

    /**
     * Populates the buffer with the given messages.
     * @param {string[]} messages Array of messages to add to the buffer
     * @returns {void} Hardly seen nothing down here
     */
    #initDepthBuffer(messages) {
        for (let depth = 0; depth < MAX_SCAN_DEPTH; depth++) {
            if (messages[depth]) {
                this.#depthBuffer[depth] = messages[depth].trim();
            }
            // break if last message is reached
            if (depth === messages.length - 1) {
                break;
            }
        }
    }

    /**
     * Gets a string that respects the case sensitivity setting
     * @param {string} str The string to transform
     * @param {WIScanEntry} entry The entry that triggered the scan
     * @returns {string} The transformed string
    */
    #transformString(str, entry) {
        const caseSensitive = entry.caseSensitive ?? this.settings.worldInfoCaseSensitive;
        return caseSensitive ? str : str.toLowerCase();
    }

    /**
     * Gets all messages up to the given depth + recursion buffer.
     * @param {WIScanEntry} entry The entry that triggered the scan
     * @param {number} scanState The state of the scan
     * @returns {string} A slice of buffer until the given depth (inclusive)
     */
    get(entry, scanState) {
        let depth = entry.scanDepth ?? this.getDepth();
        if (depth <= this.#startDepth) {
            return '';
        }

        if (depth < 0) {
            console.error(`[WI] Invalid WI scan depth ${depth}. Must be >= 0`);
            return '';
        }

        if (depth > MAX_SCAN_DEPTH) {
            console.warn(`[WI] Invalid WI scan depth ${depth}. Truncating to ${MAX_SCAN_DEPTH}`);
            depth = MAX_SCAN_DEPTH;
        }

        const MATCHER = '\x01';
        const JOINER = '\n' + MATCHER;
        let result = MATCHER + this.#depthBuffer.slice(this.#startDepth, depth).join(JOINER);

        if (entry.matchPersonaDescription && this.#globalScanData.personaDescription) {
            result += JOINER + this.#globalScanData.personaDescription;
        }
        if (entry.matchCharacterDescription && this.#globalScanData.characterDescription) {
            result += JOINER + this.#globalScanData.characterDescription;
        }
        if (entry.matchCharacterPersonality && this.#globalScanData.characterPersonality) {
            result += JOINER + this.#globalScanData.characterPersonality;
        }
        if (entry.matchCharacterDepthPrompt && this.#globalScanData.characterDepthPrompt) {
            result += JOINER + this.#globalScanData.characterDepthPrompt;
        }
        if (entry.matchScenario && this.#globalScanData.scenario) {
            result += JOINER + this.#globalScanData.scenario;
        }
        if (entry.matchCreatorNotes && this.#globalScanData.creatorNotes) {
            result += JOINER + this.#globalScanData.creatorNotes;
        }

        if (this.#injectBuffer.length > 0) {
            result += JOINER + this.#injectBuffer.join(JOINER);
        }

        // Min activations should not include the recursion buffer
        if (this.#recurseBuffer.length > 0 && scanState !== scan_state.MIN_ACTIVATIONS) {
            result += JOINER + this.#recurseBuffer.join(JOINER);
        }

        return result;
    }

    /**
     * Matches the given string against the buffer.
     * @param {string} haystack The string to search in
     * @param {string} needle The string to search for
     * @param {WIScanEntry} entry The entry that triggered the scan
     * @returns {boolean} True if the string was found in the buffer
     */
    matchKeys(haystack, needle, entry) {
        // If the needle is a regex, we do regex pattern matching and override all the other options
        const keyRegex = parseRegexFromString(needle);
        if (keyRegex) {
            return keyRegex.test(haystack);
        }

        // Otherwise we do normal matching of plaintext with the chosen entry settings
        haystack = this.#transformString(haystack, entry);
        const transformedString = this.#transformString(needle, entry);
        const matchWholeWords = entry.matchWholeWords ?? this.settings.worldInfoMatchWholeWords;

        if (matchWholeWords) {
            const keyWords = transformedString.split(/\s+/);

            if (keyWords.length > 1) {
                return haystack.includes(transformedString);
            } else {
                // Use custom boundaries to include punctuation and other non-alphanumeric characters
                const regex = new RegExp(`(?:^|\\W)(${this.context.escapeRegex(transformedString)})(?:$|\\W)`);
                if (regex.test(haystack)) {
                    return true;
                }
            }
        } else {
            return haystack.includes(transformedString);
        }

        return false;
    }

    /**
     * Adds a message to the recursion buffer.
     * @param {string} message The message to add
     */
    addRecurse(message) {
        this.#recurseBuffer.push(message);
    }

    /**
     * Adds an injection to the buffer.
     * @param {string} message The injection to add
     */
    addInject(message) {
        this.#injectBuffer.push(message);
    }

    /**
     * Checks if the recursion buffer is not empty.
     * @returns {boolean} Returns true if the recursion buffer is not empty, otherwise false
     */
    hasRecurse() {
        return this.#recurseBuffer.length > 0;
    }

    /**
     * Increments skew to advance the scan range.
     */
    advanceScan() {
        this.#skew++;
    }

    /**
     * @returns {number} Settings' depth + current skew.
     */
    getDepth() {
        return this.settings.worldInfoDepth + this.#skew;
    }

    /**
     * Get the externally activated version of the entry, if there is one.
     * @param {object} entry WI entry to check
     * @returns {object|undefined} the external version if the entry is forcefully activated, undefined otherwise
     */
    getExternallyActivated(entry) {
        return WorldInfoBuffer.externalActivations.get(`${entry.world}.${entry.uid}`);
    }

    /**
     * Clean-up the external effects for entries.
     */
    resetExternalEffects() {
        WorldInfoBuffer.externalActivations = new Map();
    }

    /**
     * Gets the match score for the given entry.
     * @param {WIScanEntry} entry Entry to check
     * @param {number} scanState The state of the scan
     * @returns {number} The number of key activations for the given entry
     */
    getScore(entry, scanState) {
        const bufferState = this.get(entry, scanState);
        let numberOfPrimaryKeys = 0;
        let numberOfSecondaryKeys = 0;
        let primaryScore = 0;
        let secondaryScore = 0;

        // Increment score for every key found in the buffer
        if (Array.isArray(entry.key)) {
            numberOfPrimaryKeys = entry.key.length;
            for (const key of entry.key) {
                if (this.matchKeys(bufferState, key, entry)) {
                    primaryScore++;
                }
            }
        }

        // Increment score for every secondary key found in the buffer
        if (Array.isArray(entry.keysecondary)) {
            numberOfSecondaryKeys = entry.keysecondary.length;
            for (const key of entry.keysecondary) {
                if (this.matchKeys(bufferState, key, entry)) {
                    secondaryScore++;
                }
            }
        }

        // No keys == no score
        if (!numberOfPrimaryKeys) {
            return 0;
        }

        // Only positive logic influences the score
        if (numberOfSecondaryKeys > 0) {
            switch (entry.selectiveLogic) {
                // AND_ANY: Add both scores
                case world_info_logic.AND_ANY:
                    return primaryScore + secondaryScore;
                // AND_ALL: Add both scores if all secondary keys are found, otherwise only primary score
                case world_info_logic.AND_ALL:
                    return secondaryScore === numberOfSecondaryKeys ? primaryScore + secondaryScore : primaryScore;
            }
        }

        return primaryScore;
    }
}

class WorldInfoTimedEffects {
    /**
     * Array of chat messages.
     * @type {string[]}
     */
    #chat = [];

    /**
     * Array of entries.
     * @type {WIScanEntry[]}
     */
    #entries = [];

    /**
     * Is this a dry run?
     * @type {boolean}
     */
    #isDryRun = false;

    /**
     * Buffer for active timed effects.
     * @type {Record<TimedEffectType, WIScanEntry[]>}
     */
    #buffer = {
        'sticky': [],
        'cooldown': [],
        'delay': [],
    };

    /**
     * Callbacks for effect types ending.
     * @type {Record<TimedEffectType, (entry: WIScanEntry) => void>}
     */
    #onEnded = {
        /**
         * Callback for when a sticky entry ends.
         * Sets an entry on cooldown immediately if it has a cooldown.
         * @param {WIScanEntry} entry Entry that ended sticky
         */
        'sticky': (entry) => {
            if (!entry.cooldown) {
                return;
            }

            const key = this.#getEntryKey(entry);
            const effect = this.#getEntryTimedEffect('cooldown', entry, true);
            this.context.getChatMetadata().timedWorldInfo.cooldown[key] = effect;
            console.log(`[WI] Adding cooldown entry ${key} on ended sticky: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
            // Set the cooldown immediately for this evaluation
            this.#buffer.cooldown.push(entry);
        },

        /**
         * Callback for when a cooldown entry ends.
         * No-op, essentially.
         * @param {WIScanEntry} entry Entry that ended cooldown
         */
        'cooldown': (entry) => {
            console.debug('[WI] Cooldown ended for entry', entry.uid);
        },

        'delay': () => { },
    };

    /**
     * Initialize the timed effects with the given messages.
     * @param {string[]} chat Array of chat messages
     * @param {WIScanEntry[]} entries Array of entries
     * @param {boolean} isDryRun Whether the operation is a dry run
     */
    constructor(chat, entries, isDryRun = false, context) {
        if (!context || typeof context.getChatMetadata !== 'function') {
            throw new Error('WorldInfoTimedEffects requires a context { getChatMetadata }.');
        }

        this.context = context;

        this.#chat = chat;
        this.#entries = entries;
        this.#isDryRun = isDryRun;
        this.#ensureChatMetadata();
    }

    /**
     * Verify correct structure of chat metadata.
     */
    #ensureChatMetadata() {
        if (!this.context.getChatMetadata().timedWorldInfo) {
            this.context.getChatMetadata().timedWorldInfo = {};
        }

        ['sticky', 'cooldown'].forEach(type => {
            // Ensure the property exists and is an object
            if (!this.context.getChatMetadata().timedWorldInfo[type] || typeof this.context.getChatMetadata().timedWorldInfo[type] !== 'object') {
                this.context.getChatMetadata().timedWorldInfo[type] = {};
            }

            // Clean up invalid entries
            Object.entries(this.context.getChatMetadata().timedWorldInfo[type]).forEach(([key, value]) => {
                if (!value || typeof value !== 'object') {
                    delete this.context.getChatMetadata().timedWorldInfo[type][key];
                }
            });
        });
    }

    /**
    * Gets a hash for a WI entry.
    * @param {WIScanEntry} entry WI entry
    * @returns {number} String hash
    */
    #getEntryHash(entry) {
        return entry.hash;
    }

    /**
     * Gets a unique-ish key for a WI entry.
     * @param {WIScanEntry} entry WI entry
     * @returns {string} String key for the entry
     */
    #getEntryKey(entry) {
        return `${entry.world}.${entry.uid}`;
    }

    /**
     * Gets a timed effect for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry
     * @param {boolean} isProtected If the effect should be protected
     * @returns {WITimedEffect} Timed effect for the entry
     */
    #getEntryTimedEffect(type, entry, isProtected) {
        return {
            hash: this.#getEntryHash(entry),
            start: this.#chat.length,
            end: this.#chat.length + Number(entry[type]),
            protected: !!isProtected,
        };
    }

    /**
     * Processes entries for a given type of timed effect.
     * @param {TimedEffectType} type Identifier for the type of timed effect
     * @param {WIScanEntry[]} buffer Buffer to store the entries
     * @param {(entry: WIScanEntry) => void} onEnded Callback for when a timed effect ends
     */
    #checkTimedEffectOfType(type, buffer, onEnded) {
        /** @type {[string, WITimedEffect][]} */
        const effects = Object.entries(this.context.getChatMetadata().timedWorldInfo[type]);
        for (const [key, value] of effects) {
            console.log(`[WI] Processing ${type} entry ${key}`, value);
            const entry = this.#entries.find(x => String(this.#getEntryHash(x)) === String(value.hash));

            if (this.#chat.length <= Number(value.start) && !value.protected) {
                console.log(`[WI] Removing ${type} entry ${key} from timedWorldInfo: chat not advanced`, value);
                delete this.context.getChatMetadata().timedWorldInfo[type][key];
                continue;
            }

            // Missing entries (they could be from another character's lorebook)
            if (!entry) {
                if (this.#chat.length >= Number(value.end)) {
                    console.log(`[WI] Removing ${type} entry from timedWorldInfo: entry not found and interval passed`, entry);
                    delete this.context.getChatMetadata().timedWorldInfo[type][key];
                }
                continue;
            }

            // Ignore invalid entries (not configured for timed effects)
            if (!entry[type]) {
                console.log(`[WI] Removing ${type} entry from timedWorldInfo: entry not ${type}`, entry);
                delete this.context.getChatMetadata().timedWorldInfo[type][key];
                continue;
            }

            if (this.#chat.length >= Number(value.end)) {
                console.log(`[WI] Removing ${type} entry from timedWorldInfo: ${type} interval passed`, entry);
                delete this.context.getChatMetadata().timedWorldInfo[type][key];
                if (typeof onEnded === 'function') {
                    onEnded(entry);
                }
                continue;
            }

            buffer.push(entry);
            console.log(`[WI] Timed effect "${type}" applied to entry`, entry);
        }
    }

    /**
     * Processes entries for the "delay" timed effect.
     * @param {WIScanEntry[]} buffer Buffer to store the entries
     */
    #checkDelayEffect(buffer) {
        for (const entry of this.#entries) {
            if (!entry.delay) {
                continue;
            }

            if (this.#chat.length < entry.delay) {
                buffer.push(entry);
                console.log('[WI] Timed effect "delay" applied to entry', entry);
            }
        }
    }

    /**
     * Checks for timed effects on chat messages.
     */
    checkTimedEffects() {
        if (!this.#isDryRun) {
            this.#checkTimedEffectOfType('sticky', this.#buffer.sticky, this.#onEnded.sticky.bind(this));
            this.#checkTimedEffectOfType('cooldown', this.#buffer.cooldown, this.#onEnded.cooldown.bind(this));
        }
        this.#checkDelayEffect(this.#buffer.delay);
    }

    /**
     * Gets raw timed effect metadatum for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry
     * @returns {WITimedEffect} Timed effect for the entry
     */
    getEffectMetadata(type, entry) {
        if (!this.isValidEffectType(type)) {
            return null;
        }

        const key = this.#getEntryKey(entry);
        return this.context.getChatMetadata().timedWorldInfo[type][key];
    }

    /**
     * Sets a timed effect for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry to check
     */
    #setTimedEffectOfType(type, entry) {
        // Skip if entry does not have the type (sticky or cooldown)
        if (!entry[type]) {
            return;
        }

        const key = this.#getEntryKey(entry);

        if (!this.context.getChatMetadata().timedWorldInfo[type][key]) {
            const effect = this.#getEntryTimedEffect(type, entry, false);
            this.context.getChatMetadata().timedWorldInfo[type][key] = effect;

            console.log(`[WI] Adding ${type} entry ${key}: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
        }
    }

    /**
     * Sets timed effects on chat messages.
     * @param {WIScanEntry[]} activatedEntries Entries that were activated
     */
    setTimedEffects(activatedEntries) {
        if (this.#isDryRun) return;
        for (const entry of activatedEntries) {
            this.#setTimedEffectOfType('sticky', entry);
            this.#setTimedEffectOfType('cooldown', entry);
        }
    }

    /**
     * Force set a timed effect for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry
     * @param {boolean} newState The state of the effect
     */
    setTimedEffect(type, entry, newState) {
        if (!this.isValidEffectType(type)) {
            return;
        }
        if (this.#isDryRun && type !== 'delay') {
            return;
        }

        const key = this.#getEntryKey(entry);
        delete this.context.getChatMetadata().timedWorldInfo[type][key];

        if (newState) {
            const effect = this.#getEntryTimedEffect(type, entry, false);
            this.context.getChatMetadata().timedWorldInfo[type][key] = effect;
            console.log(`[WI] Adding ${type} entry ${key}: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
        }
    }

    /**
     * Check if the string is a valid timed effect type.
     * @param {string} type Name of the timed effect
     * @returns {boolean} Is recognized type
     */
    isValidEffectType(type) {
        return typeof type === 'string' && ['sticky', 'cooldown', 'delay'].includes(type.trim().toLowerCase());
    }

    /**
     * Check if the current entry is sticky activated.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry to check
     * @returns {boolean} True if the entry is active
     */
    isEffectActive(type, entry) {
        if (!this.isValidEffectType(type)) {
            return false;
        }

        return this.#buffer[type]?.some(x => this.#getEntryHash(x) === this.#getEntryHash(entry)) ?? false;
    }

    /**
     * Clean-up previously set timed effects.
     */
    cleanUp() {
        for (const buffer of Object.values(this.#buffer)) {
            buffer.splice(0, buffer.length);
        }
    }
}

// parseRegexFromString is already exported by its own declaration.
export { WorldInfoBuffer, WorldInfoTimedEffects, defaultGlobalScanData, isValidRegex };
