/**
 * Bearer-token session for the public web client.
 *
 * The desktop UI keeps its cookie session; the public web client (DREAMLAND_MODE=server)
 * logs in through `/api/v1/auth/token` and stores the returned access token. This module
 * installs the header injection for every same-origin request so the legacy `/api/*`
 * endpoints (and the `/api/v1` client) see `Authorization: Bearer <token>`. Cross-origin
 * requests — model providers, extras servers — never receive the token.
 */

const ACCESS_TOKEN_KEY = 'dreamland.accessToken';
const REFRESH_TOKEN_KEY = 'dreamland.refreshToken';

/** @returns {string} The current access token, or ''. */
export function getAccessToken() {
    try {
        return localStorage.getItem(ACCESS_TOKEN_KEY) ?? '';
    } catch {
        return '';
    }
}

/** @returns {string} The current refresh token, or ''. */
export function getRefreshToken() {
    try {
        return localStorage.getItem(REFRESH_TOKEN_KEY) ?? '';
    } catch {
        return '';
    }
}

/**
 * Store the issued token pair.
 * @param {{access_token?: string, accessToken?: string, refresh_token?: string, refreshToken?: string}} tokens Token pair.
 * @returns {void}
 */
export function storeTokenPair(tokens) {
    const access = tokens?.access_token ?? tokens?.accessToken ?? '';
    const refresh = tokens?.refresh_token ?? tokens?.refreshToken ?? '';
    try {
        if (access) localStorage.setItem(ACCESS_TOKEN_KEY, access);
        if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    } catch { /* storage unavailable */ }
}

/** @returns {void} */
export function clearTokenPair() {
    try {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch { /* storage unavailable */ }
}

/** @returns {boolean} Whether the request targets this origin. */
function isSameOrigin(url) {
    try {
        return new URL(String(url ?? ''), window.location.href).origin === window.location.origin;
    } catch {
        return true;
    }
}

/**
 * Attach the bearer header to same-origin requests. Runs once at bootstrap before any
 * chat module issues a request; `fetch` is wrapped, and jQuery gets an equivalent
 * prefilter, so both request styles carry the token without touching call sites.
 * @returns {void}
 */
export function installTokenInjection() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        const token = getAccessToken();
        if (token) {
            const url = typeof input === 'string' ? input : (input?.url ?? input);
            if (isSameOrigin(url)) {
                const headers = new Headers(init.headers ?? {});
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', `Bearer ${token}`);
                }
                init = { ...init, headers };
            }
        }
        return originalFetch(input, init);
    };

    if (window.jQuery) {
        window.jQuery.ajaxPrefilter((options, _originalOptions, jqXHR) => {
            const token = getAccessToken();
            if (token && isSameOrigin(options?.url)) {
                jqXHR.setRequestHeader('Authorization', `Bearer ${token}`);
            }
        });
    }
}
