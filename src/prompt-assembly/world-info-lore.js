/**
 * World Info corpus loading and entry ordering (Phase 2.5.2 step 4, substep 2).
 *
 * Moved verbatim from public/scripts/world-info.js: loadWorldInfo, the four lore
 * collectors (character/global/chat/persona), getSortedEntries and
 * parseDecorators, plus KNOWN_DECORATORS. Every ambient read is now an explicit
 * `context` input:
 *   - mutable browser bindings (this_chid, characters, chat_metadata, world_info,
 *     selected_world_info, world_info_character_strategy) arrive as getters,
 *     because the browser reassigns them while the app runs;
 *   - loadWorldInfo's cache and HTTP headers are injected, and the endpoint URL is
 *     `context.worldInfoUrl` so the server can point at its own route;
 *   - the WORLDINFO_ENTRIES_LOADED emit is `context.emitEntriesLoaded`, which the
 *     server omits (events are not part of the authoritative turn).
 */

const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];

async function loadWorldInfo(name, context) {
    if (!name) {
        return;
    }

    if (context.cache.has(name)) {
        return context.cache.get(name);
    }

    // The server has no world-info HTTP route to call: it reads the book straight off
    // disk. The browser omits this hook and keeps using the endpoint below.
    if (typeof context.readWorldInfo === 'function') {
        const data = await context.readWorldInfo(name);
        if (data) {
            context.cache.set(name, data);
        }
        return data ?? null;
    }

    const response = await fetch(context.worldInfoUrl, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ name: name }),
        cache: 'no-cache',
    });

    if (response.ok) {
        const data = await response.json();
        context.cache.set(name, data);
        return data;
    }

    return null;
}

async function getCharacterLore(context) {
    const character = context.getCharacters()[context.getThisChid()];
    const name = character?.name;
    /** @type {Set<string>} */
    let worldsToSearch = new Set();

    const baseWorldName = character?.data?.extensions?.world;
    if (baseWorldName) {
        worldsToSearch.add(baseWorldName);
    }

    // TODO: Maybe make the utility function not use the window context?
    const fileName = context.getCharaFilename(context.getThisChid());
    const extraCharLore = context.getWorldInfo().charLore?.find((e) => e.name === fileName);
    if (extraCharLore) {
        worldsToSearch = new Set([...worldsToSearch, ...extraCharLore.extraBooks]);
    }

    if (!worldsToSearch.size) {
        return [];
    }

    let entries = [];
    for (const worldName of worldsToSearch) {
        if (context.getSelectedWorldInfo().includes(worldName)) {
            console.debug(`[WI] Character ${name}'s world ${worldName} is already activated in global world info! Skipping...`);
            continue;
        }

        if (context.getChatMetadata()[context.metadataKey] === worldName) {
            console.debug(`[WI] Character ${name}'s world ${worldName} is already activated in chat lore! Skipping...`);
            continue;
        }

        if (context.getPersonaLorebook() === worldName) {
            console.debug(`[WI] Character ${name}'s world ${worldName} is already activated in persona lore! Skipping...`);
            continue;
        }

        const data = await loadWorldInfo(worldName, context);
        const newEntries = data ? Object.keys(data.entries).map((x) => data.entries[x]).map(({ uid, ...rest }) => ({ uid, world: worldName, ...rest })) : [];
        entries = entries.concat(newEntries);

        if (!newEntries.length) {
            console.debug(`[WI] Character ${name}'s world ${worldName} could not be found or is empty`);
        }
    }

    console.debug(`[WI] Character ${name}'s lore has ${entries.length} world info entries`, [...worldsToSearch]);
    return entries;
}

async function getGlobalLore(context) {
    if (!context.getSelectedWorldInfo()?.length) {
        return [];
    }

    let entries = [];
    for (const worldName of context.getSelectedWorldInfo()) {
        const data = await loadWorldInfo(worldName, context);
        const newEntries = data ? Object.keys(data.entries).map((x) => data.entries[x]).map(({ uid, ...rest }) => ({ uid, world: worldName, ...rest })) : [];
        entries = entries.concat(newEntries);
    }

    console.debug(`[WI] Global world info has ${entries.length} entries`, context.getSelectedWorldInfo());

    return entries;
}

async function getChatLore(context) {
    const chatWorld = context.getChatMetadata()[context.metadataKey];

    if (!chatWorld) {
        return [];
    }

    if (context.getSelectedWorldInfo().includes(chatWorld)) {
        console.debug(`[WI] Chat world ${chatWorld} is already activated in global world info! Skipping...`);
        return [];
    }

    const data = await loadWorldInfo(chatWorld, context);
    const entries = data ? Object.keys(data.entries).map((x) => data.entries[x]).map(({ uid, ...rest }) => ({ uid, world: chatWorld, ...rest })) : [];

    console.debug(`[WI] Chat lore has ${entries.length} entries`, [chatWorld]);

    return entries;
}

async function getPersonaLore(context) {
    const chatWorld = context.getChatMetadata()[context.metadataKey];
    const personaWorld = context.getPersonaLorebook();

    if (!personaWorld) {
        return [];
    }

    if (chatWorld === personaWorld) {
        console.debug(`[WI] Persona world ${personaWorld} is already activated in chat world! Skipping...`);
        return [];
    }

    if (context.getSelectedWorldInfo().includes(personaWorld)) {
        console.debug(`[WI] Persona world ${personaWorld} is already activated in global world info! Skipping...`);
        return [];
    }

    const data = await loadWorldInfo(personaWorld, context);
    const entries = data ? Object.keys(data.entries).map((x) => data.entries[x]).map(({ uid, ...rest }) => ({ uid, world: personaWorld, ...rest })) : [];

    console.debug(`[WI] Persona lore has ${entries.length} entries`, [personaWorld]);

    return entries;
}

async function getSortedEntries(context) {
    try {
        const [
            globalLore,
            characterLore,
            chatLore,
            personaLore,
        ] = await Promise.all([
            getGlobalLore(context),
            getCharacterLore(context),
            getChatLore(context),
            getPersonaLore(context),
        ]);

        await context.emitEntriesLoaded({ globalLore, characterLore, chatLore, personaLore });

        let entries;

        switch (Number(context.getCharacterStrategy())) {
            case context.getInsertionStrategy().evenly:
                entries = [...globalLore, ...characterLore].sort(context.sortFn);
                break;
            case context.getInsertionStrategy().character_first:
                entries = [...characterLore.sort(context.sortFn), ...globalLore.sort(context.sortFn)];
                break;
            case context.getInsertionStrategy().global_first:
                entries = [...globalLore.sort(context.sortFn), ...characterLore.sort(context.sortFn)];
                break;
            default:
                console.error('[WI] Unknown WI insertion strategy:', context.getCharacterStrategy(), 'defaulting to evenly');
                entries = [...globalLore, ...characterLore].sort(context.sortFn);
                break;
        }

        // Chat lore always goes first, then persona lore, then the rest
        entries = [...chatLore.sort(context.sortFn), ...personaLore.sort(context.sortFn), ...entries];

        // Calculate hash and parse decorators. Split maps to preserve old hashes.
        entries = entries.map((entry) => {
            const [decorators, content] = parseDecorators(entry.content || '');
            return { ...entry, decorators, content };
        }).map((entry) => {
            const hash = context.getStringHash(JSON.stringify(entry));
            return { ...entry, hash };
        });

        console.debug(`[WI] Found ${entries.length} world lore entries. Sorted by strategy`, Object.entries(context.getInsertionStrategy()).find((x) => x[1] === context.getCharacterStrategy()));

        // Need to deep clone the entries to avoid modifying the cached data
        return structuredClone(entries);
    } catch (e) {
        console.error(e);
        return [];
    }
}


/**
 * Parse decorators from worldinfo content
 * @param {string} content The content to parse
 * @returns {[string[],string]} The decorators found in the content and the content without decorators
*/

function parseDecorators(content) {
    /**
     * Check if the decorator is known
     * @param {string} data string to check
     * @returns {boolean} true if the decorator is known
    */
    const isKnownDecorator = (data) => {
        if (data.startsWith('@@@')) {
            data = data.substring(1);
        }

        for (let i = 0; i < KNOWN_DECORATORS.length; i++) {
            if (data.startsWith(KNOWN_DECORATORS[i])) {
                return true;
            }
        }
        return false;
    };

    if (content.startsWith('@@')) {
        let newContent = content;
        const splited = content.split('\n');
        let decorators = [];
        let fallbacked = false;

        for (let i = 0; i < splited.length; i++) {
            if (splited[i].startsWith('@@')) {
                if (splited[i].startsWith('@@@') && !fallbacked) {
                    continue;
                }

                if (isKnownDecorator(splited[i])) {
                    decorators.push(splited[i].startsWith('@@@') ? splited[i].substring(1) : splited[i]);
                    fallbacked = false;
                } else {
                    fallbacked = true;
                }
            } else {
                newContent = splited.slice(i).join('\n');
                break;
            }
        }
        return [decorators, newContent];
    }

    return [[], content];
}

/**
 * Performs a scan on the chat and returns the world info activated.
 * @param {string[]} chat The chat messages to scan, in reverse order.
 * @param {number} maxContext The maximum context size of the generation.
 * @param {boolean} isDryRun Whether to perform a dry run.
 * @param {WIGlobalScanData} globalScanData Chat independent context to be scanned
 * @returns {Promise<WIActivated>} The world info activated.
 */

export { loadWorldInfo, getSortedEntries, parseDecorators, getCharacterLore, getGlobalLore, getChatLore, getPersonaLore, KNOWN_DECORATORS };
