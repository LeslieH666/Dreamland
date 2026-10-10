import { ApiClient } from './client';
import { TokenPair, User } from './types';

/** Auth endpoints of the versioned API. */
export class AuthApi {
    constructor(private readonly client: ApiClient) {}

    /** Register a new account. */
    register(handle: string, password: string): Promise<User> {
        return this.client.request<User>('/api/v1/auth/register', {
            method: 'POST',
            body: JSON.stringify({ handle, password }),
        });
    }

    /** Exchange a handle + password for a token pair (password grant). */
    login(handle: string, password: string): Promise<TokenPair> {
        return this.client.request<TokenPair>('/api/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'password', handle, password }),
        });
    }

    /** Rotate the stored refresh token into a new token pair. */
    refresh(refreshToken: string): Promise<TokenPair> {
        return this.client.request<TokenPair>('/api/v1/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
    }

    /** Return the authenticated account. */
    me(): Promise<User> {
        return this.client.request<User>('/api/v1/auth/me');
    }

    /** Revoke the stored refresh token (sign out of this client). */
    logout(refreshToken: string): Promise<void> {
        return this.client.request<void>('/api/v1/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
    }
}
