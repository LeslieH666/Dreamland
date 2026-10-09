/**
 * Server-side authoritative turn assembly (Phase 2.5.3).
 *
 * The browser builds its assembly inputs from live page state: the selected
 * character, the chat array in memory, the prompt-manager settings and the
 * extension-prompt registry. On the server none of that exists, so this module
 * reconstructs it from what is persisted under the user's data root and then
 * delegates to the same pure core the browser uses.
 *
 * Scope, per docs/authoritative-turn-spec.md and the Q3/Q4 rulings: the CC family
 * only, the legacy macro engine only (the experimental engine throws), and no
 * leslie-reality, /inject filter, vectors or data-bank participation.
 *
 * This file currently implements the §4 loading layer. The §5 registry rebuild and
 * the model dispatch (§7) are the remaining work; see the notes at the bottom.
 */

import path from 'node:path';

import { ApiError } from '../api-v1/errors.js';
import { decodeCompositeId } from '../api-v1/ids.js';
import { ExtensionPromptRole } from './enums.js';
import { getExtensionPrompt, getExtensionPromptMaxDepth } from './extension-prompts.js';
import { formatInstructModeExamples, parseMesExamples } from './macro-helpers.js';
import { substituteParams } from './macros.js';
import { setOpenAIMessageExamples, setOpenAIMessages } from './message-shaping.js';
import { prepareOpenAIMessagesCore } from './orchestrate.js';
import { Prompt, PromptCollection } from './prompt.js';
import { buildServerAssemblyEnv, buildServerPromptManager, buildServerTokenHandler } from './server-env.js';
import { createSeededRandom, WORLD_INFO_REGEX_PLACEMENT } from './world-info-portability.js';
import { getWorldInfoPrompt } from './world-info-prompt.js';

/** Settings file inside a user root. */
const SETTINGS_FILE = 'settings.json';

/** Chat metadata key holding the author's note body. */
const NOTE_PROMPT_KEY = 'note_prompt';

/**
 * Escape a string for literal use inside a regular expression.
 * Mirrors public/scripts/utils.js:1378; the world-info state classes take it from their
 * context because the browser passes the page's own copy.
 * @param {string} value Text to escape.
 * @returns {string} Escaped text.
 */
export function escapeRegex(value) {
    return String(value).replace(/[/\-\\^$*+?.()|[\]{}]/gu, '\\$&');
}

/**
 * Read a JSON file, returning null when it is absent or unparsable.
 * @param {string} filePath File to read.
 * @param {object} fs Node fs module.
 * @returns {object|null} Parsed value or null.
 */
function readJsonFile(filePath, fs) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Load the account settings the assembly needs.
 * @param {{root: string}} directories User directories.
 * @param {object} fs Node fs module.
 * @returns {object} Settings object.
 */
export function loadServerSettings(directories, fs) {
    const settings = readJsonFile(path.join(directories.root, SETTINGS_FILE), fs);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new ApiError(409, 'settings_unavailable', 'The account settings are not available.', { type: 'conflict_error' });
    }
    return settings;
}

/**
 * Resolve a v1 chat id into the files the assembly must read.
 * @param {string} chatId Composite chat id.
 * @param {{chats: string, groupChats: string}} directories User directories.
 * @returns {{kind: 'solo'|'group', cardName?: string, fileName: string, filePath: string}} Chat reference.
 */
export function resolveServerChatRef(chatId, directories) {
    let parts;
    try {
        parts = decodeCompositeId('chat', chatId);
    } catch {
        throw new ApiError(400, 'chat_id_malformed', 'The chat id is malformed.', { type: 'invalid_request_error' });
    }
    const [kind, first, second] = Array.isArray(parts) ? parts : [];
    if (kind === 'solo') {
        if (!first || !second) {
            throw new ApiError(400, 'chat_id_malformed', 'The chat id is malformed.', { type: 'invalid_request_error' });
        }
        return {
            kind: 'solo',
            cardName: String(first),
            fileName: String(second),
            filePath: path.join(directories.chats, String(first), `${String(second)}.jsonl`),
        };
    }
    if (kind === 'group') {
        if (!first) {
            throw new ApiError(400, 'chat_id_malformed', 'The chat id is malformed.', { type: 'invalid_request_error' });
        }
        return {
            kind: 'group',
            fileName: String(first),
            filePath: path.join(directories.groupChats, `${String(first)}.jsonl`),
        };
    }
    throw new ApiError(400, 'chat_id_malformed', 'The chat id is malformed.', { type: 'invalid_request_error' });
}

/**
 * Read the character card embedded in a PNG, as a plain object.
 * @param {string} cardName Card name without the extension.
 * @param {{characters: string}} directories User directories.
 * @param {object} deps Injected modules: { fs, readCard }.
 * @returns {Promise<object>} Card JSON.
 */
export async function loadServerCard(cardName, directories, deps) {
    const { fs, readCard } = deps;
    const cardPath = path.join(directories.characters, `${cardName}.png`);
    if (!fs.existsSync(cardPath)) {
        throw new ApiError(404, 'character_not_found', `Character "${cardName}" was not found.`, { type: 'invalid_request_error' });
    }
    let raw;
    try {
        raw = await readCard(cardPath);
    } catch {
        raw = null;
    }
    if (!raw) {
        throw new ApiError(409, 'character_card_unreadable', `Character "${cardName}" could not be read.`, { type: 'conflict_error' });
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // Cards are stored as { spec, spec_version, data: {...} } or as a flat v1 object.
    return parsed?.data && typeof parsed.data === 'object' ? { ...parsed, ...parsed.data, data: parsed.data } : parsed;
}

/**
 * Read the persisted chat: metadata header plus the message array.
 * @param {string} filePath Chat JSONL path.
 * @param {object} deps Injected modules: { getChatData }.
 * @returns {{metadata: object, messages: object[]}} Chat contents.
 */
export function loadServerChat(filePath, deps) {
    const { getChatData } = deps;
    const rows = getChatData(filePath);
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new ApiError(404, 'chat_not_found', 'That chat does not exist.', { type: 'invalid_request_error' });
    }
    const [header, ...messages] = rows;
    const metadata = header && typeof header === 'object' && !Array.isArray(header) ? { ...header } : {};
    delete metadata.mes;
    return { metadata, messages };
}

/**
 * Resolve the author's note body for this turn.
 *
 * The browser reads the live textarea, which can differ from what was last saved, so
 * callers may pass the text explicitly; otherwise the persisted note is used.
 * @param {string|undefined} noteText Explicit note text.
 * @param {object} metadata Chat metadata.
 * @returns {string} Author's note body.
 */
export function resolveNoteText(noteText, metadata) {
    if (typeof noteText === 'string') {
        return noteText;
    }
    const persisted = metadata?.[NOTE_PROMPT_KEY];
    return typeof persisted === 'string' ? persisted : '';
}

/**
 * Assemble one authoritative turn's messages and generation parameters.
 *
 * Only loads and assembles: it never calls a model and never writes a chat file
 * (the one exception is the World Info timed-effect write-back, which touches the
 * JSONL metadata header only).
 *
 * @param {object} input Input.
 * @param {object} input.user               Authenticated request user.
 * @param {string} input.chatId             Opaque v1 chat id.
 * @param {'normal'|'continue'|'swipe'|'regenerate'|'impersonate'|'quiet'} [input.type]
 * @param {string} [input.pendingUserText]  New user message.
 * @param {string} [input.noteText]         Author's note body.
 * @param {number} [input.randomSeed]       World Info probability seed.
 * @param {object} [input.deps]             Injected modules for testing.
 * @returns {Promise<{messages: Array<object>, counts: object, context: object}>} Assembled turn.
 */
export async function assembleAuthoritativeTurn(input) {
    const { user, chatId } = input ?? {};
    if (!user?.directories) {
        throw new ApiError(401, 'unauthenticated', 'Authentication is required.', { type: 'authentication_error' });
    }
    const deps = input.deps;
    if (!deps?.fs || !deps?.readCard || !deps?.getChatData) {
        throw new ApiError(500, 'assembly_not_wired', 'assembleAuthoritativeTurn requires injected fs/readCard/getChatData.', { type: 'server_error' });
    }

    const directories = user.directories;
    const ref = resolveServerChatRef(chatId, directories);
    const settings = loadServerSettings(directories, deps.fs);
    const chat = loadServerChat(ref.filePath, deps);
    const oaiSettings = settings.oai_settings ?? {};
    const powerUser = settings.power_user ?? {};
    const worldInfoSettings = settings.world_info_settings ?? {};
    const extensionSettings = settings.extension_settings ?? {};
    const type = String(input.type ?? 'normal');

    const card = await loadServerCard(ref.cardName, directories, deps);
    const name1 = String(powerUser.name1 ?? settings.username ?? 'User');
    const name2 = String(card.name ?? ref.cardName);

    // §5 registry. Rebuilt from persisted sources; until that lands the assembly runs
    // with an empty registry, which is exactly what the oracle needs to measure.
    const registry = {};

    const tokenHandler = buildServerTokenHandler(oaiSettings);
    const promptManager = buildServerPromptManager({
        serviceSettings: {
            ...oaiSettings,
            prompts: oaiSettings.prompts ?? [],
            prompt_order: oaiSettings.prompt_order ?? [],
        },
        activeCharacter: { ...card, id: 100000, avatar: `${ref.cardName}.png` },
        tokenHandler,
        createPromptCollection: () => new PromptCollection(),
    });

    const macroContext = () => ({
        name1,
        name2,
        powerUser,
        characters: [card],
        groups: [],
        selectedGroup: null,
        mainApi: settings.main_api ?? 'openai',
        getCardFields: () => card,
        helpers: {
            parseMesExamples: (text, isInstruct) => parseMesExamples(text, isInstruct, macroContext()),
            formatInstructModeExamples: (array, first, second) => formatInstructModeExamples(array, first, second, macroContext()),
            getGeneratingModel: () => oaiSettings.custom_model ?? oaiSettings.openai_model ?? '',
            // Per the phase ruling: the nine baselines do not exercise the dynamic macro
            // engine, so it fails closed rather than silently expanding to nothing.
            evaluateMacros: () => {
                throw new ApiError(501, 'experimental_macro_engine_unsupported', 'The experimental macro engine is not available server-side.', { type: 'server_error' });
            },
        },
        warn: () => {},
    });
    const substitute = (text, overrides) => substituteParams(text, { ...macroContext(), ...(overrides ?? {}) });

    const assemblyEnv = buildServerAssemblyEnv({
        settings,
        card,
        promptManager,
        tokenHandler,
        ChatCompletion: deps.ChatCompletion,
        deps: {
            ...deps.assemblyDeps,
            Prompt,
            createPromptCollection: () => new PromptCollection(),
            substituteParams: substitute,
            substituteParamsExtended: substitute,
            getExtensionPrompt: (position, depth, separator, role, wrap) => getExtensionPrompt(registry, position, depth, { separator, role, wrap, substitute }),
            getExtensionPromptMaxDepth,
            notify: deps.notify,
            emit: deps.emit,
            eventTypes: deps.eventTypes,
            getGenerationTokenBudget: deps.getGenerationTokenBudget,
            setOpenaiMessagesCount: deps.setOpenaiMessagesCount,
        },
    });

    // World Info runs first: its output is an input to the assembly, and the portability
    // guard is enforced here on the server (the browser is the reference implementation).
    const maxContext = Number(powerUser.context?.context_size ?? oaiSettings.openai_max_context ?? 4096);
    // The browser hands World Info a reversed array of plain strings, optionally prefixed
    // with the speaker name, plus a scan-data object carrying the card fields.
    const includeNamesInScan = worldInfoSettings.world_info_include_names ?? true;
    const chatForWI = chat.messages
        .map(entry => (includeNamesInScan ? `${entry?.name}: ${entry?.mes}` : entry?.mes))
        .reverse();
    const depthPrompt = card.extensions?.depth_prompt?.prompt ?? '';
    const globalScanData = {
        trigger: type,
        personaDescription: String(powerUser.persona_description ?? ''),
        characterDescription: String(card.description ?? ''),
        characterPersonality: String(card.personality ?? ''),
        characterDepthPrompt: String(depthPrompt ?? ''),
        scenario: String(card.scenario ?? ''),
        creatorNotes: String(card.creator_notes ?? ''),
    };
    const wi = await getWorldInfoPrompt(chatForWI, maxContext, false, globalScanData, {
        enforcePortability: true,
        random: createSeededRandom(input.randomSeed),
        settings: worldInfoSettings,
        sortFn: (left, right) => (right.order ?? 0) - (left.order ?? 0),
        countTokens: async text => Number(await tokenHandler.countAsync({ role: 'system', content: String(text ?? '') })),
        substituteParams: substitute,
        escapeRegex,
        getChatMetadata: () => chat.metadata,
        getContext: () => ({ chatMetadata: chat.metadata, extensionPrompts: registry }),
        getExtensionPromptByName: async () => '',
        getExtensionSettings: () => extensionSettings,
        getRegexScripts: () => extensionSettings.regex ?? [],
        isRegexDisabled: () => false,
        isVectorsEnabled: () => false,
        getScanDoneListenerCount: () => 0,
        getRegexedString: value => value,
        getCharaFilename: () => ref.cardName,
        getTagKeyForEntity: () => '',
        getThisChid: () => 0,
        getCharacters: () => [{ ...card, avatar: `${ref.cardName}.png` }],
        getWorldInfo: () => worldInfoSettings.world_info ?? {},
        getSelectedWorldInfo: () => worldInfoSettings.world_info?.globalSelect ?? [],
        getWorldInfoCharacterStrategy: () => worldInfoSettings.world_info_character_strategy ?? 'character_first',
        cache: new Map(),
        readWorldInfo: async name => {
            try {
                return JSON.parse(deps.fs.readFileSync(path.join(directories.worlds, `${name}.json`), 'utf8'));
            } catch {
                return null;
            }
        },
        emitScanDone: async () => {},
        emitWorldInfoActivated: deps.emit ?? (async () => {}),
        notifyOverflow: () => {},
        metadataKeys: { position: 'note_position', depth: 'note_depth', role: 'note_role', prompt: 'note_prompt', interval: 'note_interval' },
        noteModuleName: '2_floating_prompt',
        extensionPromptRoles: ExtensionPromptRole,
        regexPlacement: { worldInfo: WORLD_INFO_REGEX_PLACEMENT },
        getShouldWIAddPrompt: () => true,
    });

    const shapingContext = {
        oaiSettings,
        getChatCompletionModel: () => oaiSettings.custom_model ?? oaiSettings.openai_model ?? '',
        ignoreSymbol: deps.ignoreSymbol ?? '__ignore',
        systemMessageTypes: deps.systemMessageTypes ?? {},
        characterNamesBehavior: deps.characterNamesBehavior ?? {},
        selectedGroup: null,
        name1,
        name2,
        getMediaDisplay: () => null,
        getMediaIndex: () => null,
    };
    const messages = setOpenAIMessages(chat.messages, shapingContext);
    const mesExamplesArray = parseMesExamples(String(card.mes_example ?? ''), false, macroContext());
    const messageExamples = setOpenAIMessageExamples(mesExamplesArray, {
        name1,
        name2,
        selectedGroup: null,
        getGroupNames: () => [],
    });

    const [assembled, counts] = await prepareOpenAIMessagesCore({
        name2,
        charDescription: String(card.description ?? ''),
        charPersonality: String(card.personality ?? ''),
        scenario: String(card.scenario ?? ''),
        worldInfoBefore: wi.worldInfoBefore,
        worldInfoAfter: wi.worldInfoAfter,
        extensionPrompts: registry,
        bias: input.bias ?? '',
        type,
        quietPrompt: input.quietPrompt ?? '',
        quietImage: null,
        cyclePrompt: null,
        systemPromptOverride: card.system_prompt ?? null,
        jailbreakPromptOverride: card.post_history_instructions ?? null,
        messages,
        messageExamples,
    }, false, assemblyEnv);

    return {
        messages: assembled,
        counts,
        context: {
            ref,
            settings,
            metadata: chat.metadata,
            noteText: resolveNoteText(input.noteText, chat.metadata),
            worldInfoBefore: wi.worldInfoBefore,
            worldInfoAfter: wi.worldInfoAfter,
            tokenHandler,
            promptManager,
        },
    };
}
