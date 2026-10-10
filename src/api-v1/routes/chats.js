/**
 * `/api/v1/chats` — JSONL chats.
 *
 * `src/endpoints/chats.js` exports the storage primitives this module uses
 * directly (`getChatData`, `trySaveChat`, `getChatInfo`), so reads and writes
 * reuse the exact same JSONL serialization, integrity handling and backups as
 * the web UI. Nothing here re-implements the storage format.
 *
 * A chat id encodes where the file lives, because solo chats are stored per
 * character (`chats/<card>/<file>.jsonl`) while group chats are flat
 * (`group chats/<id>.jsonl`).
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import sanitize from 'sanitize-filename';

import { getChatData, getChatInfo, trySaveChat } from '../../endpoints/chats.js';
import { getLeslieBridgeChatConfiguration } from '../../leslie-bridge/model-chat.js';
import { handleChatCompletionGenerate } from '../../endpoints/backends/chat-completions.js';
import { parse as parseCard } from '../../character-card-parser.js';
import { assembleAuthoritativeTurn } from '../../prompt-assembly/authoritative-turn.js';
import { ChatCompletion } from '../../prompt-assembly/chat-completion.js';
import { tryDeleteFile } from '../../util.js';
import { ApiError, asyncRoute, badRequest, notFound, notImplemented } from '../errors.js';
import { decodeCompositeId, decodeId, encodeCompositeId, encodeId } from '../ids.js';
import { readPageWindow, paginate } from '../pagination.js';
import { createMockRequest } from '../adapters/express.js';
import { toApiChat, toApiChatMessage, toApiChatSummary, toApiList, toIsoTimestamp } from '../presenters.js';

export const chatsRouter = express.Router();

/**
 * @typedef {object} ChatRef
 * @property {'solo'|'group'} kind Chat kind.
 * @property {string} fileName Chat file name without extension.
 * @property {string} [cardName] Character name for a solo chat.
 * @property {string} filePath Absolute path to the `.jsonl` file.
 */

/**
 * Decode an opaque chat id into a resolvable file reference.
 * @param {import('express').Request} request v1 request.
 * @param {string} id Opaque chat id.
 * @returns {ChatRef} Chat reference.
 */
function resolveChatRef(request, id) {
    const parts = decodeCompositeId('chat', id);
    const [kind, first, second] = parts;
    const directories = request.user.directories;
    if (kind === 'solo') {
        if (!first || !second) {
            throw badRequest('The chat id is malformed.');
        }
        const cardName = sanitize(String(first));
        const fileName = sanitize(String(second));
        return { kind, cardName, fileName, filePath: path.join(directories.chats, cardName, `${fileName}.jsonl`) };
    }
    if (kind === 'group') {
        if (!first) {
            throw badRequest('The chat id is malformed.');
        }
        const fileName = sanitize(String(first));
        return { kind, fileName, filePath: path.join(directories.groupChats, `${fileName}.jsonl`) };
    }
    throw badRequest('The chat id is malformed.');
}

/**
 * Assert that a resolved path stays inside the user's chat directories.
 * @param {import('express').Request} request v1 request.
 * @param {ChatRef} ref Chat reference.
 * @returns {void}
 */
function assertInsideUserChats(request, ref) {
    const root = ref.kind === 'group' ? request.user.directories.groupChats : request.user.directories.chats;
    const relative = path.relative(root, ref.filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw badRequest('The chat id resolves outside the account chat directory.');
    }
}

/**
 * List every chat file of the account.
 * @param {import('express').Request} request v1 request.
 * @returns {Promise<object[]>} Chat references with metadata.
 */
async function listChatRefs(request) {
    const directories = request.user.directories;
    const refs = [];

    const chatsRoot = directories.chats;
    if (fs.existsSync(chatsRoot)) {
        for (const entry of fs.readdirSync(chatsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }
            const cardName = entry.name;
            const dir = path.join(chatsRoot, cardName);
            for (const file of fs.readdirSync(dir)) {
                if (!file.endsWith('.jsonl')) {
                    continue;
                }
                refs.push({
                    ref: { kind: 'solo', cardName, fileName: file.replace(/\.jsonl$/, ''), filePath: path.join(dir, file) },
                });
            }
        }
    }

    const groupRoot = directories.groupChats;
    if (fs.existsSync(groupRoot)) {
        for (const file of fs.readdirSync(groupRoot)) {
            if (!file.endsWith('.jsonl')) {
                continue;
            }
            refs.push({ ref: { kind: 'group', fileName: file.replace(/\.jsonl$/, ''), filePath: path.join(groupRoot, file) } });
        }
    }

    return refs;
}

/**
 * Opaque id for a resolved chat reference.
 * @param {ChatRef} ref Chat reference.
 * @returns {string} Opaque chat id.
 */
function chatIdFor(ref) {
    return ref.kind === 'group'
        ? encodeCompositeId('chat', ['group', ref.fileName])
        : encodeCompositeId('chat', ['solo', ref.cardName, ref.fileName]);
}

/**
 * Character or group id for a chat reference, when it can be derived.
 * @param {ChatRef} ref Chat reference.
 * @returns {{characterId: string | null, groupId: string | null}} Related ids.
 */
function relatedIdsFor(ref) {
    if (ref.kind === 'group') {
        return { characterId: null, groupId: encodeId('group', ref.fileName) };
    }
    return { characterId: encodeId('character', `${ref.cardName}.png`), groupId: null };
}

/**
 * Read the messages of a chat file.
 *
 * The first JSONL line of a chat is a metadata header (`user_name`,
 * `character_name`, `chat_metadata`) rather than a message, so it is filtered
 * out of the API view while remaining untouched on disk.
 * @param {ChatRef} ref Chat reference.
 * @returns {object[]} Messages.
 */
function readMessages(ref) {
    return getChatData(ref.filePath).filter(entry => entry && (typeof entry.mes === 'string' || entry.is_user === true));
}

/** Title shown for a chat. @param {ChatRef} ref Chat reference. @returns {string} Title. */
function titleFor(ref) {
    return ref.kind === 'group' ? ref.fileName : `${ref.cardName} · ${ref.fileName}`;
}

chatsRouter.get('/', asyncRoute(async (request, response) => {
    const refs = await listChatRefs(request);
    const wantedCharacter = request.query?.character_id
        ? decodeId('character', request.query.character_id).replace(/\.png$/i, '')
        : null;

    const summaries = [];
    for (const { ref } of refs) {
        if (wantedCharacter && ref.kind === 'solo' && ref.cardName !== wantedCharacter) {
            continue;
        }
        const info = await getChatInfo(ref.filePath);
        if (!info || Object.keys(info).length === 0) {
            continue;
        }
        summaries.push(toApiChatSummary(chatIdFor(ref), {
            title: titleFor(ref),
            messageCount: Number(info.chat_items ?? 0),
            updatedAt: info.last_mes,
            ...relatedIdsFor(ref),
        }));
    }

    const { page, nextCursor } = paginate(summaries, readPageWindow(request));
    response.send(toApiList(page, nextCursor));
}, 'Listing chats failed.'));

chatsRouter.post('/', asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    const directories = request.user.directories;
    const handle = request.user.storageHandle || request.user.profile.handle;
    const fileName = sanitize(String(body.title ?? `chat-${Date.now()}`)) || `chat-${Date.now()}`;
    const now = Date.now();

    /** @type {ChatRef} */
    let ref;
    if (body.group_id) {
        const groupId = sanitize(decodeId('group', body.group_id));
        ref = { kind: 'group', fileName: groupId, filePath: path.join(directories.groupChats, `${groupId}.jsonl`) };
    } else if (body.character_id) {
        // The card name is the character's internal key (its avatar file name
        // without the extension), which is what the chat directory is named after.
        const cardName = sanitize(decodeId('character', body.character_id).replace(/\.png$/i, ''));
        if (!cardName) {
            throw badRequest('character_id is required to create a solo chat.');
        }
        const dir = path.join(directories.chats, cardName);
        fs.mkdirSync(dir, { recursive: true });
        const id = sanitize(String(body.title ?? fileName));
        ref = { kind: 'solo', cardName, fileName: id, filePath: path.join(dir, `${id}.jsonl`) };
    } else {
        throw badRequest('Provide character_id (solo) or group_id (group).');
    }

    if (fs.existsSync(ref.filePath)) {
        throw badRequest('A chat with that name already exists.');
    }
    if (ref.kind === 'group') {
        fs.mkdirSync(directories.groupChats, { recursive: true });
    }
    assertInsideUserChats(request, ref);

    // The web UI writes the first line from the browser. The API has to create
    // the same header so both clients read identical files; the field set below
    // mirrors `chat_metadata` as the engine expects it, and the actual JSONL
    // serialization is the shared `trySaveChat`.
    const header = {
        user_name: request.user.profile.name || handle,
        character_name: ref.cardName ?? '',
        create_date: new Date(now).toISOString(),
        chat_metadata: {},
    };
    await trySaveChat([header], ref.filePath, true, handle, ref.cardName ?? '', directories.backups);

    response.status(201).send(toApiChat({
        id: chatIdFor(ref),
        title: titleFor(ref),
        messages: [],
        ...relatedIdsFor(ref),
    }));
}, 'Creating a chat failed.'));

chatsRouter.get('/:id', asyncRoute(async (request, response) => {
    const ref = resolveChatRef(request, request.params.id);
    assertInsideUserChats(request, ref);
    if (!fs.existsSync(ref.filePath)) {
        throw notFound('That chat does not exist.');
    }
    const messages = readMessages(ref);
    response.send(toApiChat({
        id: request.params.id,
        title: titleFor(ref),
        messages,
        ...relatedIdsFor(ref),
    }));
}, 'Reading a chat failed.'));

chatsRouter.delete('/:id', asyncRoute(async (request, response) => {
    const ref = resolveChatRef(request, request.params.id);
    assertInsideUserChats(request, ref);
    if (!fs.existsSync(ref.filePath)) {
        throw notFound('That chat does not exist.');
    }
    tryDeleteFile(ref.filePath);
    response.sendStatus(204);
}, 'Deleting a chat failed.'));

chatsRouter.post('/:id/messages', asyncRoute(async (request, response) => {
    const ref = resolveChatRef(request, request.params.id);
    assertInsideUserChats(request, ref);
    if (!fs.existsSync(ref.filePath)) {
        throw notFound('That chat does not exist.');
    }
    const content = String(request.body?.content ?? '');
    if (!content.trim()) {
        throw badRequest('content is required.');
    }

    const handle = request.user.storageHandle || request.user.profile.handle;
    const messages = readMessages(ref);
    const entry = {
        name: request.user.profile.name || handle,
        is_user: true,
        is_system: false,
        send_date: Date.now(),
        mes: content,
        extra: {},
    };
    messages.push(entry);
    // Reuses the shared serializer: integrity metadata written by the web UI is
    // preserved, so a chat created in either client stays readable in both.
    await trySaveChat(messages, ref.filePath, false, handle, ref.cardName ?? '', request.user.directories.backups);

    response.status(201).send(toApiChatMessage(entry, messages.length - 1));
}, 'Appending a message failed.'));

chatsRouter.post('/:id/generate', asyncRoute(async (request, response) => {
    const ref = resolveChatRef(request, request.params.id);
    assertInsideUserChats(request, ref);
    if (!fs.existsSync(ref.filePath)) {
        throw notFound('That chat does not exist.');
    }

    const body = request.body ?? {};
    const handle = request.user.storageHandle || request.user.profile.handle;

    // A new user message is appended to the stored conversation before the turn is
    // assembled, exactly as the page appends it to its in-memory chat before Generate.
    // The full chat (metadata header included) is preserved so note/memory metadata
    // survives the append.
    if (body.message !== undefined) {
        const content = String(body.message);
        if (!content.trim()) {
            throw badRequest('message must not be empty.');
        }
        const fullChat = getChatData(ref.filePath);
        fullChat.push({
            name: request.user.profile.name || handle,
            is_user: true,
            is_system: false,
            send_date: Date.now(),
            mes: content,
            extra: {},
        });
        await trySaveChat(fullChat, ref.filePath, false, handle, ref.cardName ?? '', request.user.directories.backups);
    }

    // Authoritative turn: the full prompt (character card, World Info, persona, memory,
    // author's note) is assembled server-side from the persisted state and then streamed
    // through the existing model proxy. No prompt-building logic is duplicated here.
    const assembled = await assembleAuthoritativeTurn({
        user: request.user,
        chatId: request.params.id,
        type: body.type ?? 'normal',
        noteText: body.note_text,
        randomSeed: body.random_seed,
        deps: {
            fs,
            readCard: async cardPath => await parseCard(cardPath, 'png'),
            getChatData,
            ChatCompletion,
        },
    });

    // Validate the model configuration *before* any byte is written, so a
    // misconfigured account gets the normal JSON error envelope instead of an
    // empty 200 stream. Mirrors what the Leslie Bridge does.
    let configuration;
    try {
        configuration = getLeslieBridgeChatConfiguration(request.user.directories);
    } catch (error) {
        throw new ApiError(409, 'chat_model_not_configured', String(error?.message ?? 'No chat model is configured for this account.'), { type: 'conflict_error' });
    }

    // Streaming stays unbuffered through a reverse proxy.
    response.set('X-Accel-Buffering', 'no');
    response.set('Cache-Control', 'no-cache, no-transform');

    // A plain mock request, not one inheriting IncomingMessage: `path`/`url`
    // are getter-only there and cannot be reassigned. The real response is
    // used so the provider stream is piped straight to the client.
    const proxyRequest = createMockRequest(request, {
        method: 'POST',
        path: request.path,
        body: {
            // The model proxy reads the provider configuration (endpoint,
            // proxy, model parameters) from the request body, exactly as the
            // browser posts its OpenAI settings. `configuration.settings` is
            // the already-loaded oai_settings for this account, so the stored
            // connection is reused rather than re-read or duplicated here.
            ...configuration.settings,
            chat_completion_source: request.body?.chat_completion_source ?? configuration.source,
            messages: assembled.messages,
            model: request.body?.model ?? configuration.model,
            stream: request.body?.stream !== false,
            temperature: request.body?.temperature,
            max_tokens: request.body?.max_tokens,
        },
    });
    await handleChatCompletionGenerate(proxyRequest, response);
}, 'Generating a chat completion failed.'));

chatsRouter.post('/:id/messages/:messageId/swipe', asyncRoute(async (_request, _response) => {
    // Swipes are a browser concept: `Generate('swipe')` rebuilds the prompt in
    // the page and keeps alternatives in the client-side chat array. There is no
    // server-side swipe logic to reuse, and re-implementing it would duplicate
    // the prompt pipeline.
    throw notImplemented(
        'Swipe regeneration is not available through /api/v1 yet. Swipes are produced by the browser prompt pipeline today.',
    );
}, 'Swiping a message failed.'));

export { toIsoTimestamp };
