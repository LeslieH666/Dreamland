import { ApiClient, StreamHandler } from './client';
import { Chat, ChatCompletionChunk, ChatMessage, ChatSummary, GenerateRequest } from './types';

/** Chat endpoints of the versioned API. */
export class ChatsApi {
    constructor(private readonly client: ApiClient) {}

    /** List the account's chats. */
    list(): Promise<ChatSummary[]> {
        return this.client.request<ChatSummary[]>('/api/v1/chats');
    }

    /** Fetch a full chat, messages included. */
    get(id: string): Promise<Chat> {
        return this.client.request<Chat>(`/api/v1/chats/${encodeURIComponent(id)}`);
    }

    /** Create a solo chat for a character. */
    create(characterId: string, title?: string): Promise<ChatSummary> {
        return this.client.request<ChatSummary>('/api/v1/chats', {
            method: 'POST',
            body: JSON.stringify({ character_id: characterId, title }),
        });
    }

    /** Append a user message to a chat. */
    appendMessage(id: string, content: string): Promise<ChatMessage> {
        return this.client.request<ChatMessage>(`/api/v1/chats/${encodeURIComponent(id)}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content }),
        });
    }

    /**
     * Generate an authoritative turn. Streams `chat.completion.chunk` frames and consumes
     * `[DONE]`; `onDelta` receives each accumulated text delta in order (no dropped bytes).
     * @returns The number of streamed frames.
     */
    generate(id: string, body: GenerateRequest, onDelta: (text: string) => void): Promise<number> {
        return this.client.stream<ChatCompletionChunk>(
            `/api/v1/chats/${encodeURIComponent(id)}/generate`,
            { ...body, stream: true },
            (chunk) => {
                const delta = chunk?.choices?.[0]?.delta?.content;
                if (delta) onDelta(delta);
                return true;
            },
        );
    }
}
