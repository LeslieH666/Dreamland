/**
 * Public API response shaping.
 *
 * Every presenter takes an internal object and returns exactly the schema from
 * docs/contracts/api-v1.openapi.yaml. Keeping this in one place means no
 * internal file name, path or secret can leak through a route by accident, and
 * the id mapping stays in one auditable spot.
 */

import { encodeId } from './ids.js';

/**
 * @param {unknown} value Timestamp in ms or ISO string.
 * @returns {string | null} ISO-8601 timestamp.
 */
export function toIsoTimestamp(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value === 'number') {
        return new Date(value).toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * @param {import('./auth.js').AuthUser} profile Account record.
 * @returns {object} `User` schema.
 */
export function toApiUser(profile) {
    return {
        id: encodeId('user', profile.handle),
        handle: profile.handle,
        email: null,
        admin: Boolean(profile.admin),
        avatar_url: null,
        created_at: toIsoTimestamp(profile.created) ?? new Date(0).toISOString(),
    };
}

/**
 * @param {object} entry Internal chat message.
 * @param {number} index Position in the chat, used as the positional message id.
 * @returns {object} `ChatMessage` schema.
 */
export function toApiChatMessage(entry, index) {
    const isUser = Boolean(entry?.is_user);
    const isSystem = Boolean(entry?.is_system);
    return {
        id: encodeId('message', String(index)),
        role: isSystem ? 'system' : (isUser ? 'user' : 'assistant'),
        name: entry?.name ? String(entry.name) : null,
        content: String(entry?.mes ?? ''),
        swipe_id: entry?.swipe_id === undefined || entry.swipe_id === null ? null : String(entry.swipe_id),
        meta: {
            send_date: toIsoTimestamp(entry?.send_date),
            is_user: isUser,
            is_system: isSystem,
        },
        created_at: toIsoTimestamp(entry?.send_date) ?? new Date(0).toISOString(),
    };
}

/**
 * @param {object} options Chat parts.
 * @param {string} options.id Opaque chat id.
 * @param {string} options.title Display title.
 * @param {object[]} options.messages Internal messages (header line already removed).
 * @param {string | null} [options.characterId] Opaque character id for solo chats.
 * @param {string | null} [options.groupId] Opaque group id for group chats.
 * @returns {object} `Chat` schema (also a valid `ChatSummary`).
 */
export function toApiChat({ id, title, messages, characterId = null, groupId = null }) {
    const list = Array.isArray(messages) ? messages : [];
    const last = list.length > 0 ? list[list.length - 1] : null;
    return {
        id,
        title,
        character_id: characterId,
        group_id: groupId,
        message_count: list.length,
        updated_at: toIsoTimestamp(last?.send_date) ?? new Date(0).toISOString(),
        messages: list.map((entry, index) => toApiChatMessage(entry, index)),
    };
}

/**
 * @param {string} id Opaque chat id.
 * @param {object} options Extra summary fields.
 * @returns {object} `ChatSummary` schema.
 */
export function toApiChatSummary(id, { messageCount = 0, updatedAt = null, characterId = null, groupId = null, title = null } = {}) {
    return {
        id,
        title: title ?? id,
        character_id: characterId,
        group_id: groupId,
        message_count: messageCount,
        updated_at: toIsoTimestamp(updatedAt) ?? new Date(0).toISOString(),
    };
}

/**
 * Map a character to the public schema.
 *
 * Accepts either a raw CCv2/CCv3 document (`{data: {...}}`) or the flattened
 * object that `processCharacter` returns to the web UI (which uses `avatar`
 * as the internal file name).
 * @param {object} card Character card data.
 * @param {string} [fallbackName] Internal key to use when the object has no `avatar`.
 * @returns {object} `CharacterCard` schema.
 */
export function toApiCharacterCard(card, fallbackName) {
    const flattened = card && typeof card === 'object' && !card.data && (card.avatar || card.name);
    const data = flattened ? card : (card?.data ?? card ?? {});
    const internal = String(card?.avatar ?? fallbackName ?? data.avatar ?? data.name ?? '');
    return {
        id: encodeId('character', internal),
        name: String(data.name ?? internal),
        avatar_url: null,
        tags: Array.isArray(data.tags) ? data.tags.map(tag => String(tag)) : [],
        version: card?.spec === 'chara_card_v3' ? 'ccv3' : 'ccv2',
        description: String(data.description ?? ''),
        personality: String(data.personality ?? ''),
        scenario: String(data.scenario ?? ''),
        first_message: String(data.first_mes ?? data.first_message ?? ''),
        example_dialogue: String(data.mes_example ?? data.example_dialogue ?? ''),
        creator: String(data.creator ?? ''),
        metadata: {
            creator_notes: String(data.creator_notes ?? ''),
            character_version: String(data.character_version ?? ''),
            alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.length : 0,
        },
    };
}

/**
 * @param {object} card Character card data.
 * @param {string} fileName Character file name.
 * @returns {object} `CharacterSummary` schema.
 */
export function toApiCharacterSummary(card, fileName) {
    const full = toApiCharacterCard(card, fileName);
    return {
        id: full.id,
        name: full.name,
        avatar_url: full.avatar_url,
        tags: full.tags,
    };
}

/**
 * @param {object} group Internal group record.
 * @returns {object} `GroupChat` schema.
 */
export function toApiGroup(group) {
    const members = Array.isArray(group?.members) ? group.members : [];
    return {
        id: encodeId('group', String(group?.id ?? '')),
        name: String(group?.name ?? ''),
        member_ids: members
            .map(member => {
                const avatar = typeof member === 'string' ? member : member?.avatar;
                return avatar ? encodeId('character', String(avatar)) : null;
            })
            .filter(Boolean),
        created_at: toIsoTimestamp(group?.created) ?? new Date(0).toISOString(),
    };
}

/**
 * @param {string} bookName World Info file name without extension.
 * @param {object} entry World Info entry.
 * @param {number} index Entry position, used when the entry has no uid.
 * @returns {object} `WorldInfoEntry` schema.
 */
export function toApiWorldInfoEntry(bookName, entry, index = 0) {
    const uid = entry?.uid === undefined || entry?.uid === null ? index : entry.uid;
    return {
        id: encodeId('worldinfo', `${bookName}\u0000${uid}`),
        keys: Array.isArray(entry?.key) ? entry.key.map(key => String(key)) : [],
        content: String(entry?.content ?? ''),
        position: Number.isInteger(entry?.position) ? entry.position : 0,
        selective: Boolean(entry?.selective),
    };
}

/**
 * @param {object} voice Internal voice record.
 * @returns {object} `Voice` schema.
 */
export function toApiVoice(voice) {
    const id = String(voice?.voice_id ?? voice?.id ?? voice?.speaker ?? voice?.value ?? '');
    return {
        id,
        name: String(voice?.name ?? voice?.label ?? id),
        language: String(voice?.lang ?? voice?.language ?? '') || null,
        // The Volcengine resource id is needed to synthesize with some models,
        // so it travels with the voice instead of being guessed by the client.
        resource_id: voice?.resource_id ? String(voice.resource_id) : null,
    };
}

/**
 * Wrap a list in the API's cursor envelope.
 * @param {object[]} data Items.
 * @param {string | null} [nextCursor] Cursor for the next page.
 * @returns {{data: object[], next_cursor: string | null}} Envelope.
 */
export function toApiList(data, nextCursor = null) {
    return { data, next_cursor: nextCursor };
}
