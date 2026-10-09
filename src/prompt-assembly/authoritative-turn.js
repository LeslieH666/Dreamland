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

/** Settings file inside a user root. */
const SETTINGS_FILE = 'settings.json';

/** Chat metadata key holding the author's note body. */
const NOTE_PROMPT_KEY = 'note_prompt';

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

    // §5: the browser's extension-prompt registry must be rebuilt from what is
    // persisted. Until that lands, the assembly cannot produce byte-identical
    // messages, so fail closed instead of returning a subtly different prompt.
    throw new ApiError(
        501,
        'authoritative_turn_not_implemented',
        'Authoritative turn assembly is not implemented yet: the server-side registry rebuild (spec §5) is pending.',
        { type: 'server_error' },
    );

    // eslint-disable-next-line no-unreachable -- kept as the shape the §5 work returns
    return {
        messages: [],
        counts: {},
        context: {
            ref,
            settings,
            metadata: chat.metadata,
            messages: chat.messages,
            noteText: resolveNoteText(input.noteText, chat.metadata),
        },
    };
}
