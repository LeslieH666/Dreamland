import { ApiClient } from './client';
import { MemoryEvent } from './types';

/** Leslie memory endpoints (read-only first release). */
export class MemoryApi {
    constructor(private readonly client: ApiClient) {}

    /**
     * List the memory sources the account can read. The first release is read-only:
     * the feed is presented, nothing is created or mutated.
     */
    listSources(): Promise<Array<{ id: string; displayName?: string }>> {
        return this.client.request<Array<{ id: string; displayName?: string }>>('/api/v1/memory');
    }

    /** Read the memory events for one source. */
    listEvents(memoryId: string): Promise<MemoryEvent[]> {
        return this.client.request<MemoryEvent[]>(`/api/v1/memory/${encodeURIComponent(memoryId)}/events`);
    }
}
