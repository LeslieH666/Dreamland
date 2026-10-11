/**
 * Verify the server session before importing account/chat modules. A navigation
 * cannot attach a localStorage bearer token, and an expired token must go to login
 * before it can break legacy session bootstrap requests.
 * @param {object} options Entry dependencies.
 * @param {string} options.pathname Current page path.
 * @param {() => Promise<{mode: string}>} options.fetchVersion Public runtime metadata (without bearer).
 * @param {() => boolean} options.hasToken Whether a bearer token is stored.
 * @param {() => Promise<{status: number, ok: boolean}>} options.fetchAccount Account validation request.
 * @param {() => void} options.clearTokens Remove rejected tokens.
 * @param {() => void} options.redirectToLogin Navigate to the login entry.
 * @returns {Promise<boolean>} Whether account modules may start.
 */
export async function checkAppEntry({ pathname, fetchVersion, hasToken, fetchAccount, clearTokens, redirectToLogin }) {
    if (pathname !== '/app') return true;
    const version = await fetchVersion();
    if (version.mode !== 'server') return true;
    if (!hasToken()) {
        redirectToLogin();
        return false;
    }
    const account = await fetchAccount();
    if (account.status === 401 || account.status === 403) {
        clearTokens();
        redirectToLogin();
        return false;
    }
    if (!account.ok) throw new Error('无法验证登录状态，请刷新页面后重试。');
    return true;
}
