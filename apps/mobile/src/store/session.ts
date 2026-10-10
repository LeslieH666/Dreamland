/**
 * Session store: owns the API client and the token pair.
 *
 * Tokens are persisted in secure storage; the client is rebuilt whenever the access token
 * changes. The UI reads/writes this store and never touches HTTP directly.
 */

import { ApiClient, AuthApi, CharactersApi, ChatsApi, MemoryApi, MomentsApi, TokenPair, VoiceApi } from '../api';

const ACCESS_TOKEN_KEY = 'dreamland.accessToken';
const REFRESH_TOKEN_KEY = 'dreamland.refreshToken';

/** Minimal secure-storage facade; swap the fallback for expo-secure-store in the host. */
const storage = {
    async get(key: string): Promise<string | null> {
        return (globalThis as { __dreamlandTokens?: Record<string, string> }).__dreamlandTokens?.[key] ?? null;
    },
    async set(key: string, value: string): Promise<void> {
        const state = ((globalThis as { __dreamlandTokens?: Record<string, string> }).__dreamlandTokens ?? {});
        state[key] = value;
        (globalThis as { __dreamlandTokens?: Record<string, string> }).__dreamlandTokens = state;
    },
    async remove(key: string): Promise<void> {
        const state = ((globalThis as { __dreamlandTokens?: Record<string, string> }).__dreamlandTokens ?? {});
        delete state[key];
    },
};

export interface SessionConfig {
    baseUrl: string;
}

export class Session {
    client: ApiClient;
    auth: AuthApi;
    characters: CharactersApi;
    chats: ChatsApi;
    memory: MemoryApi;
    moments: MomentsApi;
    voice: VoiceApi;

    private constructor(client: ApiClient) {
        this.client = client;
        this.auth = new AuthApi(client);
        this.characters = new CharactersApi(client);
        this.chats = new ChatsApi(client);
        this.memory = new MemoryApi(client);
        this.moments = new MomentsApi(client);
        this.voice = new VoiceApi(client);
    }

    static async create(config: SessionConfig): Promise<Session> {
        // The refresh token lives in a closure so the client's sync getter can read it
        // without a circular reference back to the Session instance.
        let refreshToken: string | null = null;
        const client = new ApiClient({
            baseUrl: config.baseUrl,
            accessToken: await storage.get(ACCESS_TOKEN_KEY),
            getRefreshToken: () => refreshToken,
            onTokenRefreshed: async (tokens) => {
                refreshToken = tokens.refresh_token;
                await storage.set(ACCESS_TOKEN_KEY, tokens.access_token);
                await storage.set(REFRESH_TOKEN_KEY, tokens.refresh_token);
            },
        });
        refreshToken = await storage.get(REFRESH_TOKEN_KEY);
        return new Session(client);
    }

    async signIn(tokens: TokenPair): Promise<void> {
        this.client.setAccessToken(tokens.access_token);
        await storage.set(ACCESS_TOKEN_KEY, tokens.access_token);
        await storage.set(REFRESH_TOKEN_KEY, tokens.refresh_token);
    }

    async signOut(): Promise<void> {
        this.client.setAccessToken(null);
        await storage.remove(ACCESS_TOKEN_KEY);
        await storage.remove(REFRESH_TOKEN_KEY);
    }

    get signedIn(): boolean {
        return Boolean(this.client.accessToken);
    }
}
