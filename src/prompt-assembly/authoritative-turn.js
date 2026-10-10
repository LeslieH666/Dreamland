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
import { CHARACTER_NAMES_BEHAVIOR, ExtensionPromptRole, ExtensionPromptType, MAX_INJECTION_DEPTH, SYSTEM_MESSAGE_TYPES } from './enums.js';
import { getExtensionPrompt, getExtensionPromptMaxDepth } from './extension-prompts.js';
import { LeslieMemoryStore } from '../leslie-memory/store.js';
import { configureMacroEngine, evaluateMacros as evaluateMacrosCore } from './macro-engine.js';
import { formatEventsPrompt, formatGrowthPrompt, formatRelationshipPrompt } from './memory-prompts.js';
import { buildLeslieReplyStylePrompt, normalizeLeslieReplyStyleSettings, LESLIE_REPLY_STYLE_SETTINGS_KEY } from './reply-style.js';
import { NAMES_BEHAVIOR_TYPES, formatInstructModeExamples, parseExampleIntoIndividual, parseMesExamples } from './macro-helpers.js';
import { substituteParams } from './macros.js';
import { setOpenAIMessageExamples, setOpenAIMessages } from './message-shaping.js';
import { prepareOpenAIMessagesCore } from './orchestrate.js';
import { Prompt, PromptCollection } from './prompt.js';
import { buildServerAssemblyEnv, buildServerPromptManager, buildServerTokenHandler } from './server-env.js';
import { sanitizeServiceSettings } from './registry.js';
import { OAI_SETTINGS_ASSEMBLY_DEFAULTS, PERSONA_DESCRIPTION_POSITIONS, buildServerPowerUser, mergeSettings } from './settings-defaults.js';
import { createSeededRandom, WORLD_INFO_REGEX_PLACEMENT } from './world-info-portability.js';
import { getWorldInfoPrompt } from './world-info-prompt.js';

/** Settings file inside a user root. */
const SETTINGS_FILE = 'settings.json';

/** Chat metadata key holding the author's note body. */
const NOTE_PROMPT_KEY = 'note_prompt';

/** Registry key the character depth prompt is injected under (public/scripts/constants.js). */
const DEPTH_PROMPT_KEY = 'DEPTH_PROMPT';

/** Default injection depth for a card that has a depth prompt but no explicit depth. */
const DEPTH_PROMPT_DEPTH_DEFAULT = 4;

/** Default role name for a card depth prompt (public/script.js). */
const DEPTH_PROMPT_ROLE_DEFAULT = 'system';

/** Default persona-description injection depth (public/scripts/power-user.js). */
const PERSONA_DESCRIPTION_DEPTH_DEFAULT = 2;

/**
 * Resolve the page's `continue_postfix` value.
 *
 * The setting is stored as a string ('', ' ', '\n', '\n\n') but the page's select writes
 * it as a number, so anything that is not one of the four strings falls back to a single
 * space, exactly as `setContinuePostfixControls` repairs it.
 * @param {object} oaiSettings Chat-completion settings.
 * @returns {string} Postfix appended to the continue prompt.
 */
export function continuePostfix(oaiSettings) {
    const value = oaiSettings?.continue_postfix;
    return typeof value === 'string' && ['', ' ', '\n', '\n\n'].includes(value) ? value : ' ';
}

/**
 * Map a stored extension-prompt role (a name or an already-numeric value) to the enum.
 * Mirrors `getExtensionPromptRoleByName` in public/script.js.
 * @param {string|number|undefined} roleName Stored role.
 * @returns {number} ExtensionPromptRole value.
 */
export function extensionRoleByName(roleName) {
    if (typeof roleName === 'number' && Object.values(ExtensionPromptRole).includes(roleName)) {
        return roleName;
    }
    switch (roleName) {
        case 'user':
            return ExtensionPromptRole.USER;
        case 'assistant':
            return ExtensionPromptRole.ASSISTANT;
        case 'system':
        default:
            return ExtensionPromptRole.SYSTEM;
    }
}

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
    // The header carries chat_metadata alongside the user/character names; the assembly
    // reads the note, persona, world info and memory binding out of that nested object.
    const nested = header && typeof header === 'object' && !Array.isArray(header) ? header.chat_metadata : null;
    const metadata = nested && typeof nested === 'object' && !Array.isArray(nested)
        ? { ...nested }
        : (header && typeof header === 'object' && !Array.isArray(header) ? { ...header } : {});
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
    // The page fills its settings defaults at load and only overlays what was persisted,
    // so the server has to merge the same defaults before anything reads them.
    // oai_settings comes from settings.json as-is for now; only the power_user subset the
    // assembly reads needs the page's defaults merged in.
    // The page starts from default_settings and overlays what was persisted; the server
    // needs the same prompt formats and caps, or blocks like "[Example Chat]" come out empty.
    const oaiSettings = mergeSettings(OAI_SETTINGS_ASSEMBLY_DEFAULTS, settings.oai_settings ?? {});
    const powerUser = buildServerPowerUser(settings.power_user);
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
        // preparePrompt macro-substitutes every prompt, exactly as the page's manager does.
        substituteParams: (text, overrides) => substitute(text, overrides),
    });

    // The macro engine reads the chat and settings through its own configured context,
    // because its accessors are module-level. Only the server is wired to this copy.
    configureMacroEngine({
        chat: chat.messages,
        chatMetadata: chat.metadata,
        extensionPrompts: registry,
        getCurrentChatId: () => ref.fileName,
        getMaxContextTokens: () => maxContext,
        getMaxPromptTokens: () => Math.max(0, maxContext - Number(oaiSettings.openai_max_tokens ?? 0)),
        getMaxResponseTokens: () => Number(oaiSettings.openai_max_tokens ?? 0),
        mainApi: settings.main_api ?? 'openai',
        substituteParams: (text, overrides) => substitute(text, overrides),
        powerUser,
        bannedWordsInMacros: Boolean(settings.textgenerationwebui_settings?.banned_in_macros),
        injectIds: { QUIET_PROMPT: 'QUIET_PROMPT' },
        jQuery: () => ({ val: () => '' }),
        // The idle-duration macro reads the page's document title; the server has none.
        document: { title: '' },
        // Only reachable with the experimental engine enabled, which the server refuses.
        macroSystem: new Proxy({}, { get() { throw new ApiError(501, 'experimental_macro_engine_unsupported', 'The experimental macro engine is not available server-side.', { type: 'server_error' }); } }),
        // The fixture corpus uses neither instruct sequences nor variables, so these
        // contribute no macros. A macro that did need one would stay literal in the
        // output and the byte comparison would fail loudly rather than silently.
        getInstructMacros: () => [],
        getVariableMacros: () => [],
    });

    // The page sanitises its prompt manager at startup: it seeds the default prompt set
    // and the default order when the account has none. Without this the collection is
    // empty and the assembly returns no messages at all.
    sanitizeServiceSettings(promptManager);

    const macroContext = () => ({
        name1,
        name2,
        powerUser,
        characters: [card],
        groups: [],
        selectedGroup: null,
        mainApi: settings.main_api ?? 'openai',
        getCardFields: () => card,
        // The instruct formatter reads these straight off its context.
        substituteParams: (text, overrides) => substitute(text, overrides),
        namesBehaviorTypes: NAMES_BEHAVIOR_TYPES,
        parseExampleIntoIndividual: (text, append) => parseExampleIntoIndividual(text, append, {
            name1,
            name2,
            selectedGroup: null,
            getGroupNames: () => [],
        }),
        helpers: {
            parseMesExamples: (text, isInstruct) => parseMesExamples(text, isInstruct, macroContext()),
            formatInstructModeExamples: (array, first, second) => formatInstructModeExamples(array, first, second, macroContext()),
            getGeneratingModel: () => oaiSettings.custom_model ?? oaiSettings.openai_model ?? '',
            // Plan P.1 decided this branch on evidence: all nine baselines call the macro
            // engine, so it is the lifted implementation rather than a fail-closed stub.
            evaluateMacros: (content, macroEnv, postProcessFn) => evaluateMacrosCore(content, macroEnv, postProcessFn),
        },
        warn: () => {},
    });
    function substitute(text, overrides) {
        return substituteParams(text, { ...macroContext(), ...(overrides ?? {}) });
    }

    // The orchestrator catches assembly errors and reports them through notify. A no-op
    // would turn a real failure into silently empty output, so the server surfaces them.
    const notify = deps.notify ?? {
        error: message => console.error('[assembly:error]', String(message)),
        warning: message => console.warn('[assembly:warning]', String(message)),
    };

    const assemblyEnv = buildServerAssemblyEnv({
        // The shared assembly reads `settings.oai_settings` directly, so hand it the
        // merged copy: passing the persisted object alone left every un-persisted default
        // undefined (and produced empty `new_chat_prompt` / `new_example_chat_prompt`
        // blocks that the message shaper then drops).
        settings: { ...settings, oai_settings: oaiSettings, power_user: powerUser },
        card,
        promptManager,
        tokenHandler,
        ChatCompletion: deps.ChatCompletion,
        deps: {
            ...deps.assemblyDeps,
            Prompt,
            // The shared assembly compares persona_description_position against this enum;
            // an empty object made every comparison undefined and dropped the persona block.
            personaDescriptionPositions: PERSONA_DESCRIPTION_POSITIONS,
            createPromptCollection: () => new PromptCollection(),
            substituteParams: substitute,
            substituteParamsExtended: substitute,
            getExtensionPrompt: (position, depth, separator, role, wrap) => getExtensionPrompt(registry, position, depth, { separator, role, wrap, substitute }),
            getExtensionPromptMaxDepth,
            // Mirror openai.js: these decide where a non-marker extension prompt lands in
            // the prompt order, so a stub here misplaces every memory block.
            getPromptPosition: position => (position === ExtensionPromptType.BEFORE_PROMPT
                ? 'start'
                : (position === ExtensionPromptType.IN_PROMPT ? 'end' : false)),
            getPromptRole: role => (role === ExtensionPromptRole.USER
                ? 'user'
                : (role === ExtensionPromptRole.ASSISTANT ? 'assistant' : 'system')),
            notify,
            emit: deps.emit,
            eventTypes: deps.eventTypes,
            getGenerationTokenBudget: deps.getGenerationTokenBudget,
            setOpenaiMessagesCount: deps.setOpenaiMessagesCount,
        },
    });

    // The author's note has to be in the registry before World Info runs: the WI-to-AN
    // hijack reads it out of the registry while building the prompt. This mirrors
    // setFloatingPrompt, including its interval gate.
    const noteInterval = Number(chat.metadata?.note_interval ?? 0);
    let lastMessageNumber = chat.messages.filter(entry => entry?.is_user).length;
    if (noteInterval === 1) {
        lastMessageNumber = 1;
    }
    let shouldWIAddPrompt = false;
    if (lastMessageNumber <= 0 || noteInterval <= 0) {
        registry['2_floating_prompt'] = { value: '', position: ExtensionPromptType.NONE, depth: MAX_INJECTION_DEPTH };
    } else {
        const messagesTillInsertion = lastMessageNumber >= noteInterval
            ? (lastMessageNumber % noteInterval)
            : (noteInterval - lastMessageNumber);
        shouldWIAddPrompt = messagesTillInsertion === 0;
        registry['2_floating_prompt'] = {
            value: shouldWIAddPrompt ? String(resolveNoteText(input.noteText, chat.metadata)) : '',
            position: chat.metadata?.note_position,
            depth: chat.metadata?.note_depth,
            role: chat.metadata?.note_role,
            scan: Boolean(extensionSettings.note?.allowWIScan),
            extension: true,
        };
    }

    // The quiet prompt is an extension prompt on the page (`setExtensionPrompt(QUIET_PROMPT,
    // …, IN_PROMPT, 0, true)`), not a prompt-collection entry, so the registry has to carry
    // it or every quiet turn comes back without its instruction block.
    if (String(input.quietPrompt ?? '').length > 0) {
        registry.QUIET_PROMPT = {
            value: String(input.quietPrompt),
            position: ExtensionPromptType.IN_PROMPT,
            depth: 0,
            scan: true,
            role: ExtensionPromptRole.SYSTEM,
            extension: true,
        };
    }

    // Persona description. The page registers it under `PERSONA_DESCRIPTION`: in-prompt it
    // rides the story string's `persona` field, at at-depth it is an in-chat injection, and
    // at top/bottom A/N it is merged into the author's note. Only the last two need the
    // registry, and skipping them silently dropped the persona from every depth/A-N turn.
    const personaDescription = String(powerUser.persona_description ?? '');
    const personaPosition = Number(powerUser.persona_description_position ?? PERSONA_DESCRIPTION_POSITIONS.IN_PROMPT);
    registry.PERSONA_DESCRIPTION = { value: '', position: ExtensionPromptType.IN_PROMPT, depth: 0, scan: false, role: ExtensionPromptRole.SYSTEM, extension: true };
    if (personaDescription && personaPosition !== PERSONA_DESCRIPTION_POSITIONS.NONE) {
        const anPositions = [PERSONA_DESCRIPTION_POSITIONS.BOTTOM_AN, PERSONA_DESCRIPTION_POSITIONS.TOP_AN];
        if (anPositions.includes(personaPosition) && shouldWIAddPrompt && registry['2_floating_prompt']) {
            const originalNote = registry['2_floating_prompt'].value;
            const merged = personaPosition === PERSONA_DESCRIPTION_POSITIONS.TOP_AN
                ? `${personaDescription}\n${originalNote}`
                : `${originalNote}\n${personaDescription}`;
            registry['2_floating_prompt'] = { ...registry['2_floating_prompt'], value: merged };
        }
        if (personaPosition === PERSONA_DESCRIPTION_POSITIONS.AT_DEPTH) {
            registry.PERSONA_DESCRIPTION = {
                value: personaDescription,
                position: ExtensionPromptType.IN_CHAT,
                depth: Number(powerUser.persona_description_depth ?? PERSONA_DESCRIPTION_DEPTH_DEFAULT),
                scan: true,
                role: extensionRoleByName(powerUser.persona_description_role),
                extension: true,
            };
        }
    }

    // Character depth prompt (the card's "character-specific author's note"). The page
    // registers it as an in-chat injection at the depth stored on the card, so the server
    // has to do the same or every card with a depth prompt loses that block.
    const cardDepthPrompt = card.extensions?.depth_prompt ?? {};
    if (String(cardDepthPrompt.prompt ?? '').length > 0) {
        registry[DEPTH_PROMPT_KEY] = {
            value: String(cardDepthPrompt.prompt).trim(),
            position: ExtensionPromptType.IN_CHAT,
            depth: Number(cardDepthPrompt.depth ?? DEPTH_PROMPT_DEPTH_DEFAULT),
            role: extensionRoleByName(cardDepthPrompt.role ?? DEPTH_PROMPT_ROLE_DEFAULT),
            scan: Boolean(extensionSettings.note?.allowWIScan),
            extension: true,
        };
    }

    // Leslie memory, from the store in-process rather than the memory HTTP API. The page
    // builds these blocks in its extension and pushes them through setExtensionPrompt; the
    // positions and depths below mirror that registration exactly. Memory is optional, so
    // any failure here leaves the blocks empty instead of breaking the turn.
    //
    // Memory is gated per generation type, because the page's memory interceptor does not
    // register the same blocks for every type. Two independent gates, both read off the
    // recorded baselines:
    //  - the growth summary and the retrieved memory list are skipped for `quiet`, which is
    //    a hidden summarisation turn and keeps only its own quiet prompt;
    //  - the relationship projection is additionally skipped for `swipe` and `impersonate`,
    //    which re-write an existing message instead of composing a new turn.
    const memorySummariesInjected = !['quiet'].includes(type);
    const memoryRelationshipInjected = !['swipe', 'impersonate', 'quiet'].includes(type);
    const memoryBinding = chat.metadata?.leslie_memory;
    const memoryIdentity = {
        persona: { name: name1 },
        context: { name1 },
        isGroup: ref.kind === 'group',
    };
    const lastMessageId = Math.max(0, chat.messages.length - 1);
    let growthText = '';
    let eventsText = '';
    let crossLineText = '';
    let relationshipText = '';
    // The metadata keeps one binding per persona; pick the one for this turn's persona,
    // falling back to the first, which is what the memory extension resolves as well.
    const memoryBindings = Array.isArray(memoryBinding?.bindings) ? memoryBinding.bindings.filter(Boolean) : [];
    const activeMemoryBinding = memoryBindings.find(entry => entry.personaName === name1)
        ?? memoryBindings[0]
        ?? null;
    const memoryId = activeMemoryBinding?.memoryId ?? memoryBinding?.id ?? null;
    if (memoryId && (memorySummariesInjected || memoryRelationshipInjected)) {
        try {
            const memoryStore = new LeslieMemoryStore(directories.root);
            if (memorySummariesInjected) {
                const selection = memoryStore.selectContext(memoryId, { query: '', currentMessageId: lastMessageId });
                if (selection.enabled) {
                    growthText = formatGrowthPrompt(selection.growth, memoryIdentity);
                    eventsText = formatEventsPrompt(selection.memories, memoryIdentity);
                }
            }
            if (memoryRelationshipInjected) {
                relationshipText = formatRelationshipPrompt(
                    memoryStore.getRelationship(memoryId, { currentMessageId: lastMessageId }),
                    memoryIdentity,
                );
            }
        } catch (error) {
            console.warn('[authoritative-turn] memory prompt build failed open:', error?.message ?? error);
        }
    }
    registry.leslie_memory_growth = { value: growthText, position: ExtensionPromptType.IN_PROMPT, depth: 0, scan: false, role: ExtensionPromptRole.SYSTEM, extension: true };
    registry.leslie_memory_events = { value: eventsText, position: ExtensionPromptType.IN_CHAT, depth: 4, scan: false, role: ExtensionPromptRole.SYSTEM, extension: true };
    registry.leslie_memory_cross_line = { value: crossLineText, position: ExtensionPromptType.IN_CHAT, depth: 5, scan: false, role: ExtensionPromptRole.SYSTEM, extension: true };
    registry.leslie_memory_relationship = { value: relationshipText, position: ExtensionPromptType.IN_PROMPT, depth: 0, scan: false, role: ExtensionPromptRole.SYSTEM, extension: true };

    // Reply style: injected for every type except the quiet ones, and only when the style
    // is not switched off. Mirrors the extension's preparePrompt interceptor.
    let replyStyleText = '';
    try {
        const replyStyle = normalizeLeslieReplyStyleSettings(extensionSettings[LESLIE_REPLY_STYLE_SETTINGS_KEY]);
        if (replyStyle.style !== 'off' && type !== 'quiet') {
            replyStyleText = buildLeslieReplyStylePrompt(replyStyle.style);
        }
    } catch (error) {
        console.warn('[authoritative-turn] reply style build failed open:', error?.message ?? error);
    }
    registry.leslie_reply_style = { value: replyStyleText, position: ExtensionPromptType.IN_PROMPT, depth: 0, scan: false, role: ExtensionPromptRole.SYSTEM, extension: true };

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
    const wiContext = {
        enforcePortability: true,
        random: createSeededRandom(input.randomSeed),
        // Persisted world_info_settings is snake_cased; the shared scan reads the same
        // camelCase shape the page builds in worldInfoContext().
        settings: {
            worldInfoBudget: worldInfoSettings.world_info_budget ?? 25,
            worldInfoBudgetCap: worldInfoSettings.world_info_budget_cap ?? 0,
            worldInfoMaxRecursionSteps: worldInfoSettings.world_info_max_recursion_steps ?? 0,
            worldInfoMinActivations: worldInfoSettings.world_info_min_activations ?? 0,
            worldInfoMinActivationsDepthMax: worldInfoSettings.world_info_min_activations_depth_max ?? 0,
            worldInfoOverflowAlert: worldInfoSettings.world_info_overflow_alert ?? false,
            worldInfoRecursive: worldInfoSettings.world_info_recursive ?? false,
            worldInfoUseGroupScoring: worldInfoSettings.world_info_use_group_scoring ?? false,
            worldInfoDepth: worldInfoSettings.world_info_depth ?? 2,
            worldInfoCaseSensitive: worldInfoSettings.world_info_case_sensitive ?? false,
            worldInfoMatchWholeWords: worldInfoSettings.world_info_match_whole_words ?? false,
        },
        sortFn: (left, right) => (right.order ?? 0) - (left.order ?? 0),
        countTokens: async text => Number(await tokenHandler.countAsync({ role: 'system', content: String(text ?? '') })),
        substituteParams: substitute,
        escapeRegex,
        metadataKey: 'world_info',
        tagMap: powerUser.tag_map ?? {},
        getStringHash: value => {
            let hash = 0;
            const text = String(value ?? '');
            for (let index = 0; index < text.length; index++) {
                hash = (hash << 5) - hash + text.charCodeAt(index);
                hash |= 0;
            }
            return Math.abs(hash);
        },
        getInsertionStrategy: () => ({ evenly: 0, character_first: 1, global_first: 2 }),
        getCharacterStrategy: () => Number({ character_first: 0, global_first: 1, character_only: 2 }[worldInfoSettings.world_info_character_strategy] ?? 0),
        getRequestHeaders: () => ({}),
        worldInfoUrl: '',
        // The author's-note hijack writes into the shared registry.
        setExtensionPrompt: (key, value, position, depth, scan, role) => {
            registry[key] = { value, position, depth, scan, role, extension: true };
        },
        getChatMetadata: () => chat.metadata,
        // The page's `getContext()` hands out the live extension context, which the author's
        // note and the World Info hijack use to read *and* write the registry. A two-field
        // stub here made the A/N write-back throw and lose the note entirely.
        getContext: () => ({
            chatMetadata: chat.metadata,
            extensionPrompts: registry,
            setExtensionPrompt: (key, value, position, depth, scan, role) => {
                registry[key] = { value, position, depth, scan, role, extension: true };
            },
        }),
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
        getPersonaLorebook: () => String(powerUser.persona_description_lorebook ?? ''),
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
        // Events are not part of the authoritative turn, but the loader expects the hook.
        emitEntriesLoaded: async () => {},
        emitWorldInfoActivated: deps.emit ?? (async () => {}),
        notifyOverflow: () => {},
        metadataKeys: { position: 'note_position', depth: 'note_depth', role: 'note_role', prompt: 'note_prompt', interval: 'note_interval' },
        noteModuleName: '2_floating_prompt',
        extensionPromptRoles: ExtensionPromptRole,
        regexPlacement: { worldInfo: WORLD_INFO_REGEX_PLACEMENT },
        getShouldWIAddPrompt: () => shouldWIAddPrompt,
    };
    const wi = await getWorldInfoPrompt(chatForWI, maxContext, false, globalScanData, wiContext);

    // The page drains World Info's at-depth and outlet entries into the extension registry
    // right after the scan (`flushWIInjections` in public/script.js). Without this the
    // in-chat depth entries are computed and then thrown away, so every at-depth lore
    // entry disappears from the assembled turn.
    for (const depthEntry of Array.isArray(wi.worldInfoDepth) ? wi.worldInfoDepth : []) {
        if (!Array.isArray(depthEntry?.entries) || depthEntry.entries.length === 0) {
            continue;
        }
        const depth = depthEntry.depth ?? 0;
        const role = depthEntry.role ?? ExtensionPromptRole.SYSTEM;
        registry[`customDepthWI_${depth}_${role}`] = {
            value: depthEntry.entries.join('\n'),
            position: ExtensionPromptType.IN_CHAT,
            depth,
            role,
            scan: false,
            extension: true,
        };
    }
    for (const [outletName, entries] of Object.entries(wi.outletEntries ?? {})) {
        if (!Array.isArray(entries) || entries.length === 0) {
            continue;
        }
        // Outlets are addressed by the `{{outlet::name}}` macro, never placed by position.
        registry[`customWIOutlet_${outletName}`] = {
            value: entries.join('\n'),
            position: ExtensionPromptType.NONE,
            depth: 0,
            scan: false,
            extension: true,
        };
    }

    const shapingContext = {
        oaiSettings,
        getChatCompletionModel: () => oaiSettings.custom_model ?? oaiSettings.openai_model ?? '',
        ignoreSymbol: deps.ignoreSymbol ?? '__ignore',
        // Both enums are compared against chat-message fields; an empty object made every
        // `extra.type` comparison undefined and turned every history message into a
        // narrator system message.
        systemMessageTypes: deps.systemMessageTypes ?? SYSTEM_MESSAGE_TYPES,
        characterNamesBehavior: deps.characterNamesBehavior ?? CHARACTER_NAMES_BEHAVIOR,
        selectedGroup: null,
        name1,
        name2,
        getMediaDisplay: () => null,
        getMediaIndex: () => null,
    };
    const messages = setOpenAIMessages(chat.messages, shapingContext);
    // The page's continue path takes the last usable message out of the history and hands
    // it to the assembly as `cyclePrompt`, which is what builds the continue-nudge pair
    // (nudge + prefill fragment) at the end of the turn. Without it a continue turn simply
    // loses both messages.
    const cyclePrompt = type === 'continue' && messages.length
        ? String(messages[messages.length - 1]?.content ?? '') + continuePostfix(oaiSettings)
        : null;
    const mesExamplesArray = parseMesExamples(String(card.mes_example ?? ''), false, macroContext());
    // The page substitutes the example dialog with `baseChatReplace` before the message
    // shaper splits it into `{{user}}:` / `{{char}}:` blocks (and keeps the raw array for
    // the story string). `baseChatReplace` substitutes names but explicitly leaves
    // character-card macros alone, hence `replaceCharacterCard: false`. Without this step
    // the split finds no speaker prefixes and every example block comes back empty.
    const messageExamples = setOpenAIMessageExamples(mesExamplesArray.map(example => substitute(example, { replaceCharacterCard: false })), {
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
        cyclePrompt,
        // The page only overrides the main prompt with the card's own prompt when the user
        // asked for it; otherwise the default main prompt stands. Same for the jailbreak.
        systemPromptOverride: powerUser.prefer_character_prompt
            ? substitute(String(chat.metadata?.system_prompt || card.system_prompt || '').trim())
            : '',
        jailbreakPromptOverride: powerUser.prefer_character_jailbreak
            ? substitute(String(card.post_history_instructions ?? '').trim())
            : '',
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
