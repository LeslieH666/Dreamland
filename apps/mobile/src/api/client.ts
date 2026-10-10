/**
 * Minimal typed HTTP + SSE client for the DreamLand `/api/v1` service.
 *
 * It has no React/React Native imports: it runs on the fetch + ReadableStream + TextDecoder
 * primitives every RN runtime provides, so it is reusable outside the UI. The bearer token,
 * base URL and refresh-token callbacks are injected, never read from globals, which keeps
 * the layer testable and the UI decoupled.
 */

import { ApiError, ApiErrorBody, TokenPair } from './types';

export interface ApiClientConfig {
    /** Origin of the DreamLand server, e.g. "https://dreamland.example.com". */
    baseUrl: string;
    /** Current access token, or null when unauthenticated. */
    accessToken: string | null;
    /** Reads the stored refresh token (secure storage) so an expired access token can rotate. */
    getRefreshToken?: () => string | null;
    /** Called with a fresh token pair after a refresh; the host persists and updates state. */
    onTokenRefreshed?: (tokens: TokenPair) => void;
    /** Optional fetch implementation (for tests). Defaults to globalThis.fetch. */
    fetch?: typeof fetch;
}

/**
 * Callback invoked once per streamed chunk. Return `false` to stop consuming early.
 */
export type StreamHandler<T> = (chunk: T) => boolean | void;

export class ApiClient {
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly getRefreshToken?: () => string | null;
    private readonly onTokenRefreshed?: (tokens: TokenPair) => void;
    private accessTokenValue: string | null;
    private refreshPromise: Promise<string> | null = null;

    constructor(config: ApiClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.accessTokenValue = config.accessToken;
        this.getRefreshToken = config.getRefreshToken;
        this.onTokenRefreshed = config.onTokenRefreshed;
        this.fetchImpl = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    }

    /** Current access token (null when unauthenticated). */
    get accessToken(): string | null {
        return this.accessTokenValue;
    }

    /** Update the access token after login or a manual refresh. */
    setAccessToken(token: string | null) {
        this.accessTokenValue = token;
    }

    private url(path: string) {
        return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    }

    private async parseError(response: Response): Promise<ApiError> {
        let body: ApiErrorBody | undefined;
        try {
            body = (await response.json()) as ApiErrorBody;
        } catch { /* non-JSON error body */ }
        return new ApiError(response.status, body);
    }

    private async refreshAccessToken(): Promise<string> {
        if (!this.refreshPromise) {
            this.refreshPromise = this.requestRefresh().finally(() => { this.refreshPromise = null; });
        }
        return this.refreshPromise;
    }

    private async requestRefresh(): Promise<string> {
        const refreshToken = this.getRefreshToken?.();
        if (!refreshToken) {
            throw new ApiError(401, { error: { message: 'No refresh token is available. Sign in again.' } });
        }
        const response = await this.fetchImpl(this.url('/api/v1/auth/refresh'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!response.ok) {
            throw await this.parseError(response);
        }
        const tokens = (await response.json()) as TokenPair;
        this.accessTokenValue = tokens.access_token;
        this.onTokenRefreshed?.(tokens);
        return tokens.access_token;
    }

    /**
     * Perform an authenticated JSON request.
     * @returns The parsed JSON body (or null for 204/empty bodies).
     */
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        return this.requestInternal<T>(path, init, false);
    }

    private async requestInternal<T>(path: string, init: RequestInit, retried: boolean): Promise<T> {
        const headers = new Headers(init.headers ?? {});
        headers.set('Content-Type', 'application/json');
        if (this.accessToken) {
            headers.set('Authorization', `Bearer ${this.accessToken}`);
        }
        const response = await this.fetchImpl(this.url(path), { ...init, headers });
        if (response.status === 401 && !retried) {
            try {
                await this.refreshAccessToken();
                return this.requestInternal<T>(path, init, true);
            } catch {
                // Let the original 401 surface rather than masking it with a refresh error.
            }
        }
        if (!response.ok) {
            throw await this.parseError(response);
        }
        if (response.status === 204) {
            return undefined as T;
        }
        const text = await response.text();
        if (!text) {
            return undefined as T;
        }
        try {
            return JSON.parse(text) as T;
        } catch {
            return text as unknown as T;
        }
    }

    /**
     * Perform an authenticated request that returns a binary body (e.g. synthesized audio).
     * @returns The response body as a Blob.
     */
    async requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
        const headers = new Headers(init.headers ?? {});
        headers.set('Content-Type', 'application/json');
        if (this.accessToken) {
            headers.set('Authorization', `Bearer ${this.accessToken}`);
        }
        const response = await this.fetchImpl(this.url(path), { ...init, headers });
        if (!response.ok) {
            throw await this.parseError(response);
        }
        return response.blob();
    }

    /**
     * Stream a text/event-stream response, parsing `data:` lines.
     *
     * `[DONE]` terminates the stream cleanly. Each parsed data payload is passed to
     * `onChunk`; returning `false` from `onChunk` aborts early (used for interrupt/resume).
     *
     * @param path Request path.
     * @param body Request body.
     * @param onChunk Per-chunk callback.
     * @returns The number of data frames consumed.
     */
    async stream<T>(path: string, body: unknown, onChunk: StreamHandler<T>): Promise<number> {
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        });
        if (this.accessToken) {
            headers.set('Authorization', `Bearer ${this.accessToken}`);
        }
        const response = await this.fetchImpl(this.url(path), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw await this.parseError(response);
        }
        if (!response.body) {
            throw new ApiError(500, { error: { message: 'The server returned no stream body.' } });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let frames = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line.startsWith('data:')) continue;
                const data = line.slice('data:'.length).trim();
                if (data === '[DONE]') {
                    return frames;
                }
                try {
                    const parsed = JSON.parse(data) as T;
                    frames += 1;
                    if (onChunk(parsed) === false) {
                        await reader.cancel();
                        return frames;
                    }
                } catch {
                    // Ignore malformed keep-alive or comment frames; the [DONE] frame ends it.
                }
            }
        }
        return frames;
    }
}
