import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { encodeCompositeId } from '../src/api-v1/ids.js';
import {
    assembleAuthoritativeTurn,
    loadServerCard,
    loadServerChat,
    loadServerSettings,
    resolveNoteText,
    resolveServerChatRef,
} from '../src/prompt-assembly/authoritative-turn.js';

/** @type {string} */
let root;
/** @type {object} */
let directories;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-auth-turn-'));
    directories = {
        root,
        characters: path.join(root, 'characters'),
        chats: path.join(root, 'chats'),
        groupChats: path.join(root, 'groupChats'),
    };
    for (const dir of [directories.characters, directories.chats, directories.groupChats]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ main_api: 'openai' }));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveServerChatRef', () => {
    test('resolves a solo chat id to its jsonl path', () => {
        const id = encodeCompositeId('chat', ['solo', 'fixture-aurora', '合成 · 常规']);
        const ref = resolveServerChatRef(id, directories);
        expect(ref.kind).toBe('solo');
        expect(ref.cardName).toBe('fixture-aurora');
        expect(ref.filePath).toBe(path.join(directories.chats, 'fixture-aurora', '合成 · 常规.jsonl'));
    });

    test('resolves a group chat id to its jsonl path', () => {
        const id = encodeCompositeId('chat', ['group', 'fixture-group']);
        const ref = resolveServerChatRef(id, directories);
        expect(ref.kind).toBe('group');
        expect(ref.filePath).toBe(path.join(directories.groupChats, 'fixture-group.jsonl'));
    });

    test('fails closed on a malformed id rather than guessing a path', () => {
        expect(() => resolveServerChatRef('not-a-real-id', directories)).toThrow(/malformed/u);
    });
});

describe('loadServerSettings', () => {
    test('reads the account settings file', () => {
        expect(loadServerSettings(directories, fs)).toEqual({ main_api: 'openai' });
    });

    test('fails closed when the settings are missing', () => {
        const empty = { root: path.join(root, 'empty-root') };
        fs.mkdirSync(empty.root, { recursive: true });
        expect(() => loadServerSettings(empty, fs)).toThrow(/not available/u);
    });
});

describe('loadServerCard', () => {
    test('unwraps a v2 card envelope', async () => {
        const cardPath = path.join(directories.characters, 'fixture-aurora.png');
        fs.writeFileSync(cardPath, 'not-a-real-png');
        const card = await loadServerCard('fixture-aurora', directories, {
            fs,
            readCard: async () => JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Aurora', description: 'd' } }),
        });
        expect(card.name).toBe('Aurora');
        expect(card.description).toBe('d');
    });

    test('returns a flat v1 card unchanged', async () => {
        const card = await loadServerCard('fixture-aurora', directories, {
            fs,
            readCard: async () => JSON.stringify({ name: 'Aurora', description: 'd' }),
        });
        expect(card.name).toBe('Aurora');
    });

    test('fails closed for a missing card file', async () => {
        await expect(loadServerCard('absent-card', directories, { fs, readCard: async () => null }))
            .rejects.toMatchObject({ status: 404 });
    });
});

describe('loadServerChat', () => {
    test('splits the metadata header from the messages', () => {
        const chat = loadServerChat('ignored.jsonl', {
            getChatData: () => [
                { user_name: '合成用户', note_prompt: 'NOTE' },
                { name: 'Aurora', is_user: false, mes: 'hi' },
                { name: '合成用户', is_user: true, mes: 'hello' },
            ],
        });
        expect(chat.metadata).toEqual({ user_name: '合成用户', note_prompt: 'NOTE' });
        expect(chat.messages.length).toBe(2);
        expect(chat.messages[1].mes).toBe('hello');
    });

    test('fails closed for an empty chat file', () => {
        expect(() => loadServerChat('ignored.jsonl', { getChatData: () => [] })).toThrow(/does not exist/u);
    });
});

describe('resolveNoteText', () => {
    test('prefers the explicit note over the persisted one', () => {
        expect(resolveNoteText('LIVE', { note_prompt: 'SAVED' })).toBe('LIVE');
    });

    test('falls back to the persisted note', () => {
        expect(resolveNoteText(undefined, { note_prompt: 'SAVED' })).toBe('SAVED');
    });

    test('returns an empty string when neither is present', () => {
        expect(resolveNoteText(undefined, {})).toBe('');
    });
});

describe('assembleAuthoritativeTurn', () => {
    test('requires authentication', async () => {
        await expect(assembleAuthoritativeTurn({ chatId: 'x' })).rejects.toMatchObject({ status: 401 });
    });

    test('requires its injected dependencies', async () => {
        await expect(assembleAuthoritativeTurn({ user: { directories }, chatId: 'x' }))
            .rejects.toMatchObject({ status: 500 });
    });

    test('attempts a real assembly instead of failing closed with 501', async () => {
        // The placeholder boundary is gone: the turn now loads, scans World Info and
        // calls the shared orchestration. A fixture without the page's settings defaults
        // still fails, but never with the old not-implemented code.
        const id = encodeCompositeId('chat', ['solo', 'fixture-aurora', 'c']);
        fs.mkdirSync(path.join(directories.chats, 'fixture-aurora'), { recursive: true });
        const error = await assembleAuthoritativeTurn({
            user: { directories },
            chatId: id,
            deps: {
                fs,
                readCard: async () => JSON.stringify({ name: 'A' }),
                getChatData: () => [{}, { mes: 'hi' }],
                ChatCompletion: class {},
            },
        }).then(() => null, raised => raised);

        expect(error).not.toBeNull();
        expect(error.code).not.toBe('authoritative_turn_not_implemented');
    });
});
