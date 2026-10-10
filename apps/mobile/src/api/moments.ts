import { ApiClient } from './client';
import { MomentPost } from './types';

/** Moments (朋友圈) endpoints (read-only first release). */
export class MomentsApi {
    constructor(private readonly client: ApiClient) {}

    /** List the moments feed. */
    list(): Promise<MomentPost[]> {
        return this.client.request<MomentPost[]>('/api/v1/moments');
    }
}
