import { ApiClient } from './client';
import { CharacterSummary } from './types';

/** Character-card endpoints of the versioned API. */
export class CharactersApi {
    constructor(private readonly client: ApiClient) {}

    /** List the account's character cards. */
    list(): Promise<CharacterSummary[]> {
        return this.client.request<CharacterSummary[]>('/api/v1/characters');
    }

    /** Fetch one character card. */
    get(id: string): Promise<CharacterSummary> {
        return this.client.request<CharacterSummary>(`/api/v1/characters/${encodeURIComponent(id)}`);
    }
}
