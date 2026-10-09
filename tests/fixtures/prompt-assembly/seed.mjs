/**
 * Seed the synthetic prompt-assembly corpus into an isolated data root.
 *
 * The seeder writes the same on-disk shapes the app itself writes, so the
 * browser loads the fixtures through its normal code paths:
 *   - character cards as PNGs with an embedded `chara_card_v2` JSON payload;
 *   - chats as JSONL with a metadata header line;
 *   - world books as `<userRoot>/worlds/<name>.json`;
 *   - groups in `<userRoot>/groups/<id>.json` plus a group-chat JSONL;
 *   - Leslie memories through the real store API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { write as writeCard } from '../../../src/character-card-parser.js';
import { DEFAULT_USER, SETTINGS_FILE } from '../../../src/constants.js';
import {
    CHARACTERS,
    CHAT_HISTORY,
    FIXTURE_PERSONA_AVATAR,
    FIXTURE_USER_NAME,
    GROUP,
    GROUP_HISTORY,
    SWIPE_HISTORY,
    WORLD_BOOK,
    buildSettings,
} from './corpus.mjs';

const ICON = fileURLToPath(new URL('../../../public/img/dreamland/icon-192.png', import.meta.url));

/**
 * Serialize a chat file the way the app does: metadata header, then messages.
 * @param {object} metadata Chat metadata.
 * @param {object[]} messages Messages.
 * @param {string} userName User display name.
 * @param {string} characterName Character display name.
 * @returns {string} JSONL contents.
 */
function serializeChat(metadata, messages, userName, characterName) {
    const header = { user_name: userName, character_name: characterName, chat_metadata: metadata };
    return [header, ...messages].map(value => JSON.stringify(value)).join('\n') + '\n';
}

/**
 * Write one character card PNG with an embedded v2 payload.
 * @param {string} charactersDir Directory for character cards.
 * @param {object} character Corpus character.
 * @param {string} chatName Default chat name recorded on the card.
 * @returns {void}
 */
function writeCharacter(charactersDir, character, chatName) {
    const data = {
        name: character.name,
        description: character.description,
        personality: character.personality,
        scenario: character.scenario,
        first_mes: character.first_mes,
        mes_example: character.mes_example,
        creator_notes: character.creator_notes,
        system_prompt: character.system_prompt,
        post_history_instructions: character.post_history_instructions,
        alternate_greetings: character.alternate_greetings,
        tags: character.tags,
        creator: 'DreamLand 合成夹具',
        character_version: '1',
        extensions: {
            depth_prompt: character.depth_prompt,
            world: WORLD_BOOK.name,
        },
    };
    const card = {
        ...data,
        data,
        spec: 'chara_card_v2',
        spec_version: '2.0',
        chat: chatName,
        create_date: '2026-01-01T00:00:00.000Z',
        fav: false,
    };
    fs.writeFileSync(path.join(charactersDir, character.avatar), writeCard(fs.readFileSync(ICON), JSON.stringify(card)));
}

/**
 * Seed everything for one profile.
 * @param {string} dataRoot Isolated data root.
 * @param {{ personaPosition?: number, handle?: string, seedMemory?: (userRoot: string, chatKeys: object) => object }} options Options.
 * @returns {{ userRoot: string, chatKeys: object }} Seeded paths.
 */
export function seedPromptAssemblyFixtures(dataRoot, { personaPosition, noteText = '', handle = DEFAULT_USER.handle, seedMemory } = {}) {
    const userRoot = path.join(dataRoot, handle);
    const dirs = {
        root: userRoot,
        characters: path.join(userRoot, 'characters'),
        chats: path.join(userRoot, 'chats'),
        groups: path.join(userRoot, 'groups'),
        groupChats: path.join(userRoot, 'group chats'),
        worlds: path.join(userRoot, 'worlds'),
        user: path.join(userRoot, 'user'),
        themes: path.join(userRoot, 'themes'),
        sysprompt: path.join(userRoot, 'sysprompt'),
        instruct: path.join(userRoot, 'instruct'),
        context: path.join(userRoot, 'context'),
        vectors: path.join(userRoot, 'vectors'),
        backups: path.join(userRoot, 'backups'),
        thumbnails: path.join(userRoot, 'thumbnails'),
        thumbnailsBg: path.join(userRoot, 'thumbnails', 'bg'),
        thumbnailsAvatar: path.join(userRoot, 'thumbnails', 'avatar'),
        thumbnailsPersona: path.join(userRoot, 'thumbnails', 'persona'),
        avatars: path.join(userRoot, 'User Avatars'),
        userImages: path.join(userRoot, 'user', 'images'),
        assets: path.join(userRoot, 'assets'),
        extensions: path.join(userRoot, 'extensions'),
        quickreplies: path.join(userRoot, 'QuickReplies'),
        movingUI: path.join(userRoot, 'movingUI'),
        backgrounds: path.join(userRoot, 'backgrounds'),
        novelAI_Settings: path.join(userRoot, 'NovelAI Settings'),
        koboldAI_Settings: path.join(userRoot, 'KoboldAI Settings'),
        openAI_Settings: path.join(userRoot, 'OpenAI Settings'),
        textGen_Settings: path.join(userRoot, 'TextGen Settings'),
        comfyWorkflows: path.join(userRoot, 'user', 'workflows'),
        files: path.join(userRoot, 'user', 'files'),
        reasoning: path.join(userRoot, 'reasoning'),
    };
    for (const directory of Object.values(dirs)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const settings = buildSettings({ personaPosition, noteText });
    fs.writeFileSync(path.join(userRoot, SETTINGS_FILE), JSON.stringify(settings, null, 4), 'utf8');

    fs.writeFileSync(path.join(dirs.worlds, `${WORLD_BOOK.name}.json`), JSON.stringify({ entries: Object.fromEntries(WORLD_BOOK.entries.map(entry => [String(entry.uid), entry])) }, null, 4), 'utf8');

    for (const character of CHARACTERS) {
        writeCharacter(dirs.characters, character, '合成 · 常规');
    }

    // The persona needs a real avatar file: without it the browser cannot bind
    // the persona, which silently disables both persona injection and the
    // Leslie memory interceptors.
    const personaImage = fs.readFileSync(ICON);
    fs.writeFileSync(path.join(dirs.avatars, FIXTURE_PERSONA_AVATAR), personaImage);
    fs.writeFileSync(path.join(dirs.thumbnailsPersona, FIXTURE_PERSONA_AVATAR), personaImage);
    fs.writeFileSync(path.join(dirs.thumbnailsAvatar, FIXTURE_PERSONA_AVATAR), personaImage);

    // Memory/identity binding is seeded through the real stores before the chat
    // files are written, because the JSONL metadata header carries the binding.
    const chatKeys = {};
    const chatPlan = [
        ['fixture-aurora.png', '合成 · 常规', CHAT_HISTORY],
        ['fixture-aurora.png', '合成 · 继续', CHAT_HISTORY],
        ['fixture-aurora.png', '合成 · 重新生成', CHAT_HISTORY],
        ['fixture-aurora.png', '合成 · 代替发言', CHAT_HISTORY],
        ['fixture-aurora.png', '合成 · 静默', CHAT_HISTORY],
        ['fixture-aurora.png', '合成 · 换一条', SWIPE_HISTORY],
        ['fixture-aurora.png', '合成 · 深度人设', CHAT_HISTORY],
        ['fixture-aurora.png', '合成 · 作者注', CHAT_HISTORY],
    ];
    for (const [avatar, chatName] of chatPlan) {
        chatKeys[`${avatar}::${chatName}`] = { avatar, chatName, characterName: CHARACTERS.find(entry => entry.avatar === avatar)?.name ?? avatar };
    }
    const memoryMetadata = seedMemory ? seedMemory(userRoot, chatKeys) : {};

    const writeChat = (avatar, chatName, history, metadata) => {
        const folder = path.join(dirs.chats, path.basename(avatar, '.png'));
        fs.mkdirSync(folder, { recursive: true });
        const characterName = CHARACTERS.find(entry => entry.avatar === avatar)?.name ?? avatar;
        fs.writeFileSync(path.join(folder, `${chatName}.jsonl`), serializeChat(metadata, history, FIXTURE_USER_NAME, characterName), 'utf8');
        chatKeys[`${avatar}::${chatName}`] = { avatar, chatName, characterName };
    };

    // interval 1 means the note is inserted regardless of position, so the case
    // exercises the author's-note path deterministically.
    const noteMetadata = noteText
        ? { note_prompt: noteText, note_interval: 1, note_position: 1, note_depth: 4, note_role: 0 }
        : {};
    const baseMetadata = { persona: FIXTURE_PERSONA_AVATAR, ...noteMetadata };
    for (const [avatar, chatName, history] of chatPlan) {
        const extra = memoryMetadata[`${avatar}::${chatName}`] ?? {};
        writeChat(avatar, chatName, history, { ...baseMetadata, ...extra });
    }

    fs.writeFileSync(path.join(dirs.groups, `${GROUP.id}.json`), JSON.stringify(GROUP, null, 4), 'utf8');
    fs.writeFileSync(path.join(dirs.groupChats, '合成 · 群聊.jsonl'), serializeChat({ ...baseMetadata }, GROUP_HISTORY, FIXTURE_USER_NAME, GROUP.name), 'utf8');

    return { userRoot, chatKeys };
}
