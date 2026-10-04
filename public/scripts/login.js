import { initAccessibility } from './a11y.js';
import { clearUserSpaceBrowserState } from './leslie-user-space-browser.js';

/**
 * CRSF token for requests.
 */
let csrfToken = '';
let discreetLogin = false;
let encryptedSpaces = false;
let loginPending = false;

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    return data.token;
}

/**
 * Gets a list of users from the server.
 * @returns {Promise<object>} List of users
 */
async function getUserList() {
    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    if (response.status === 204) {
        discreetLogin = true;
        return [];
    }

    const userListObj = await response.json();
    return userListObj;
}

/**
 * Requests a recovery code for the user.
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
async function sendRecoveryPart1(handle) {
    const response = await fetch('/api/users/recover-step1', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ handle }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    showRecoveryBlock();
}

/**
 * Sets a new password for the user using the recovery code.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const recoveryData = {
        handle,
        code,
        newPassword,
    };

    const response = await fetch('/api/users/recover-step2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(recoveryData),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    console.log(`Successfully recovered password for ${handle}!`);
    await performLogin(handle, newPassword);
}

/**
 * Attempts to log in the user.
 * @param {string} handle User's handle
 * @param {string} password User's password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    if (loginPending) return;
    loginPending = true;
    const button = $('#loginButton');
    const originalLabel = button.text();
    button.prop('disabled', true).text('正在进入空间…');
    $('#userList .userSelect, #userHandle, #userPassword').prop('disabled', true);
    $('#userSelectBlock').attr('aria-busy', 'true');
    // getRandomValues also works on a phone's plain HTTP LAN connection.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const operation = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const status = $('<div class="dreamland-login-progress" role="status" aria-live="polite"><span></span><progress max="1"></progress></div>');
    button.after(status);
    status.find('span').text(encryptedSpaces ? '正在打开空间，请稍候…' : '正在登录…');
    let pollTimer;
    let polling = true;
    const poll = async () => {
        try {
            const result = await fetch(`/api/users/login-progress?operation=${operation}`, { cache: 'no-store' });
            if (result.ok && polling) {
                const progress = await result.json();
                const label = { sealing: '正在封存上一空间', key: '正在验证加密密钥', decrypt: '正在解密与校验数据', loading: '正在加载空间', ready: '空间已准备好' }[progress.phase] || '正在打开空间';
                status.find('span').text(progress.total > 0 ? `${label} · ${progress.completed} / ${progress.total}` : `${label}…`);
                if (progress.total > 0) status.find('progress').attr('value', progress.completed / progress.total);
                else status.find('progress').removeAttr('value');
            }
        } catch { /* the login request remains authoritative */ }
        if (polling) pollTimer = setTimeout(poll, 800);
    };
    if (encryptedSpaces) void poll();
    displayError('');
    const userInfo = {
        handle: handle,
        password: password,
        operation,
    };

    let redirecting = false;
    try {
        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(userInfo),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            return displayError(errorData?.error || '登录失败，请稍后重试。');
        }

        const data = await response.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${handle}!`);
            if (encryptedSpaces) {
                clearUserSpaceBrowserState();
            }
            redirecting = true;
            redirectToHome();
        }
    } catch (error) {
        console.error('Error logging in:', error);
        displayError(String(error));
    } finally {
        polling = false;
        clearTimeout(pollTimer);
        if (!redirecting) {
            loginPending = false;
            button.prop('disabled', false).text(originalLabel);
            $('#userList .userSelect, #userHandle, #userPassword').prop('disabled', false);
            $('#userSelectBlock').attr('aria-busy', 'false');
            status.remove();
        }
    }
}

/**
 * Handles the user selection event.
 * @param {object} user User object
 * @returns {Promise<void>}
 */
async function onUserSelected(user) {
    if (user.appearance && Object.keys(user.appearance).length) {
        window.LeslieLoginAppearance = user.appearance;
        window.dispatchEvent(new CustomEvent('dreamland-login-appearance', { detail: user.appearance }));
    }
    // No password, just log in
    if (!user.password) {
        return await performLogin(user.handle, '');
    }

    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#userPassword').val('').trigger('focus');
    $('#loginButton').off('click').on('click', async () => {
        const password = String($('#userPassword').val());
        await performLogin(user.handle, password);
    });

    $('#recoverPassword').toggle(!encryptedSpaces).off('click').on('click', async () => {
        await sendRecoveryPart1(user.handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(user.handle, code, newPassword);
    });

    displayError('');
}

/**
 * Displays an error message to the user.
 * @param {string} message Error message
 */
function displayError(message) {
    $('#errorMessage').text(message);
}

/**
 * Redirects the user to the home page.
 * Preserves the query string.
 */
function redirectToHome() {
    // Create a URL object based on the current location
    const currentUrl = new URL(window.location.href);

    // After a login there's no need to preserve the
    // noauto parameter (if present)
    currentUrl.searchParams.delete('noauto');

    // Set the pathname to root and keep the updated query string
    currentUrl.pathname = '/';

    // Redirect to the new URL
    window.location.href = currentUrl.toString();
}

/**
 * Hides the password entry block and shows the password recovery block.
 */
function showRecoveryBlock() {
    $('#passwordEntryBlock').hide();
    $('#passwordRecoveryBlock').show();
    displayError('');
}

/**
 * Hides the password recovery block and shows the password entry block.
 */
function onCancelRecoveryClick() {
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    displayError('');
}

/**
 * Configures the login page for normal login.
 * @param {import('../../src/users').UserViewModel[]} userList List of users
 */
function configureNormalLogin(userList) {
    $('#handleEntryBlock').hide();
    $('#normalLoginPrompt').show();
    $('#discreetLoginPrompt').hide();
    for (const user of userList) {
        const userBlock = $('<button type="button"></button>').addClass('userSelect');
        const avatarBlock = $('<div></div>').addClass('avatar');
        avatarBlock.append($('<img>').attr('src', user.avatar));
        userBlock.append(avatarBlock);
        userBlock.append($('<span></span>').addClass('userName').text(user.name));
        userBlock.append($('<small></small>').addClass('userHandle').text(user.handle));
        userBlock.on('click', () => {
            $('#userList .userSelect').removeClass('is-selected');
            userBlock.addClass('is-selected');
            onUserSelected(user);
        });
        $('#userList').append(userBlock);
    }
}

/**
 * Configures the login page for discreet login.
 */
function configureDiscreetLogin() {
    console.log('Discreet login is enabled');
    $('#handleEntryBlock').show();
    $('#normalLoginPrompt').hide();
    $('#discreetLoginPrompt').show();
    $('#userList').hide();
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const password = String($('#userPassword').val());
        await performLogin(handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        await sendRecoveryPart1(handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(handle, code, newPassword);
    });
}

(async function () {
    initAccessibility();

    csrfToken = await getCsrfToken();
    encryptedSpaces = await fetch('/api/users/mode').then(response => response.json()).then(mode => {
        if (Object.keys(mode.appearance || {}).length) {
            window.LeslieLoginAppearance = mode.appearance;
            window.dispatchEvent(new CustomEvent('dreamland-login-appearance', { detail: mode.appearance }));
        }
        return mode.encryptedSpaces === true;
    }).catch(() => true);
    $('#recoverPassword').toggle(!encryptedSpaces);
    const userList = await getUserList();

    if (discreetLogin) {
        configureDiscreetLogin();
    } else {
        configureNormalLogin(userList);
    }
    document.getElementById('shadow_popup').style.opacity = '';
    $('#cancelRecovery').on('click', onCancelRecoveryClick);
    $(document).on('keydown', (evt) => {
        if (evt.key === 'Enter' && document.activeElement.tagName === 'INPUT') {
            if ($('#passwordRecoveryBlock').is(':visible')) {
                $('#sendRecovery').trigger('click');
            } else {
                $('#loginButton').trigger('click');
            }
        }
    });
})();
