/**
 * Domain types for the DreamLand `/api/v1` contract.
 *
 * These mirror docs/contracts/api-v1.openapi.yaml. They carry no React or React Native
 * imports so the API client layer stays independently reusable by a future native shell
 * or by tools/scripts.
 */

/** An opaque v1 resource id (never decoded by the client). */
export type OpaqueId = string;

/** Account user as returned by auth and /me. */
export interface User {
    handle: string;
    name?: string;
    admin?: boolean;
    enabled?: boolean;
}

/** Token pair issued by POST /auth/token or /auth/refresh. */
export interface TokenPair {
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
}

/** Character card summary returned by the characters list. */
export interface CharacterSummary {
    id: OpaqueId;
    name: string;
    description?: string;
    avatar?: string;
    personality?: string;
    scenario?: string;
    first_message?: string;
}

/** A chat message in its API view. */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    name?: string;
}

/** A chat summary returned by the chats list. */
export interface ChatSummary {
    id: OpaqueId;
    title: string;
    character_id?: OpaqueId;
    /** Number of messages, when the list endpoint reports it. */
    message_count?: number;
}

/** A full chat returned by GET /chats/{id}. */
export interface Chat {
    id: OpaqueId;
    title: string;
    messages: ChatMessage[];
}

/** Generation type accepted by POST /chats/{id}/generate. */
export type GenerationType = 'normal' | 'continue' | 'swipe' | 'regenerate' | 'impersonate' | 'quiet';

/** Body for POST /chats/{id}/generate. */
export interface GenerateRequest {
    message?: string;
    type?: GenerationType;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    top_p?: number | null;
    random_seed?: number;
    note_text?: string;
    /** Server model catalog id (server-managed gateway). */
    model_id?: string;
}

/** Client-visible model catalog entry (no provider details or keys). */
export interface ModelCatalogEntry {
    id: string;
    name: string;
    enabled: boolean;
}

/** One OpenAI-compatible streamed chunk. */
export interface ChatCompletionChunk {
    choices?: Array<{
        delta?: { content?: string; role?: string };
        finish_reason?: string | null;
    }>;
    id?: string;
}

/** A single memory event (read-only feed). */
export interface MemoryEvent {
    id: string;
    level?: 'A' | 'B' | 'C';
    summary: string;
    createdAt?: string;
}

/** A moments (朋友圈) post (read-only feed). */
export interface MomentPost {
    id: string;
    content: string;
    createdAt?: string;
    author?: string;
}

/** Error envelope produced by the API. */
export interface ApiErrorBody {
    error?: {
        message?: string;
        type?: string;
        code?: string;
    } | string;
    message?: string;
}

/** A thrown API error with the HTTP status and the parsed body. */
export class ApiError extends Error {
    status: number;
    code?: string;
    body?: ApiErrorBody;

    constructor(status: number, body?: ApiErrorBody) {
        const message = typeof body?.error === 'string'
            ? body.error
            : (body?.error?.message ?? body?.message ?? `Request failed with status ${status}`);
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = typeof body?.error === 'object' ? body.error.code : undefined;
        this.body = body;
    }
}
