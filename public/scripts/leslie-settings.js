/**
 * Leslie's simple settings hub.
 *
 * This module only reorganizes access to existing SillyTavern controls. The
 * original drawers, event handlers, saved settings, and data formats remain
 * the source of truth.
 */

import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced, setOnlineStatus, stopStatusLoading } from '../script.js';
import { clearUserSpaceBrowserState } from './leslie-user-space-browser.js';
import { flushUserSpacePreferences } from './leslie-user-preferences.js';
import { extension_settings } from './extensions.js';
import { getLeslieConnectionState } from './leslie-connection-state.js';
import { isDreamLandAndroidClient } from './leslie-mobile-client.js';
import { SECRET_KEYS, secret_state, writeSecret } from './secrets.js';
import {
    isLocalModelLoadingEnabled,
    setLocalModelLoadingEnabled,
} from './leslie-local-model-core.js';
import {
    LESLIE_REPLY_STYLE_SETTINGS_KEY,
    migrateLeslieReplyStyleSettings,
    setLeslieReplyStyleRuntimeSettings,
} from './leslie-reply-style.js';
import {
    getLesliePrivacyModeState,
    setLesliePrivacyBlockMasked,
    setLesliePrivacyModeEnabled,
    syncLesliePrivacyModeControls,
} from './leslie-privacy-mode.js';
import './leslie-voice-settings.js';
import { navigateDreamlandPage, presentDreamlandPage, registerDreamlandPage, returnToDreamlandChat, usesDreamlandPages } from './dreamland-pages.js';
import { COPY } from './leslie-settings-copy.js';
import { serverModels, refreshServerModels } from './server-models.js';

let settingsPageVisited = false;

const SECONDARY_DRAWERS = [
    'ai-config-button',
    'sys-settings-button',
    'advanced-formatting-button',
    'WI-SP-button',
    'user-settings-button',
    'backgrounds-button',
    'extensions-settings-button',
    'persona-management-button',
];

let settingsOverlay;
let settingsLauncher;
let lastFocusedElement;
let closeTimer;
let activeDetail;
let detailBindingController;
let detailObservers = [];
let activeModelServiceId;
let localAdvancedOpen = false;
let demoModeState;
let demoModePending = false;
let demoModeError = '';
let demoModeBanner;
let userSpacesState = null;
let userSpacesBusy = false;

async function userSpaceRequest(url, body = undefined) {
    const response = await fetch(url, { method: 'POST', headers: getRequestHeaders(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `User space request returned ${response.status}.`);
    }
    return response.status === 204 ? null : response.json();
}

async function refreshUserSpacesState() {
    if (serverModels.mode !== 'desktop') return;
    try {
        userSpacesState = await userSpaceRequest('/api/leslie/user-spaces/status');
    } catch (error) {
        console.error('[Leslie User Spaces] Status failed:', error);
        userSpacesState = { error: true };
    }
    if (activeDetail === 'spaces') showDetail('spaces');
}

async function changeUserSpace(action) {
    if (serverModels.mode !== 'desktop') return;
    if (userSpacesBusy) return;
    const copy = COPY[getCopyLocale()];
    const root = settingsOverlay?.querySelector('#leslie-settings-detail');
    const field = selector => root?.querySelector(selector)?.value || '';
    try {
        if (!await flushUserSpacePreferences()) throw new Error('设置尚未保存，请稍后重试。');
        if (action === 'switch') {
            userSpacesBusy = true;
            const button = root?.querySelector('[data-leslie-space-switch]');
            if (button) {
                button.disabled = true;
                button.textContent = copy.spacesSwitching;
            }
            await Promise.resolve(saveSettingsDebounced.flush?.());
            await userSpaceRequest('/api/users/logout');
            clearUserSpaceBrowserState();
            window.location.assign('/login');
            return;
        }
        const creating = action === 'create';
        const password = field(creating ? '[data-leslie-space-new-password]' : '[data-leslie-space-password]');
        const confirm = field(creating ? '[data-leslie-space-new-confirm]' : '[data-leslie-space-confirm]');
        if (password !== confirm) throw new Error(copy.spacesMismatch);
        if (!password) throw new Error(copy.spacesPasswordRequired);
        userSpacesBusy = true;
        const endpoint = creating ? '/api/users/create' : '/api/leslie/user-spaces/activate';
        const payload = creating ? { name: field('[data-leslie-space-name]').trim(), handle: field('[data-leslie-space-handle]').trim(), password } : { password };
        if (creating && (!payload.name || !payload.handle)) throw new Error(copy.spacesError);
        await userSpaceRequest(endpoint, payload);
        if (!creating) {
            clearUserSpaceBrowserState();
            window.location.assign('/login');
            return;
        }
        toastr.success(copy.spacesCreateSuccess);
        userSpacesState = null;
        await refreshUserSpacesState();
    } catch (error) {
        toastr.error(error.message || copy.spacesError, copy.spacesTitle);
        if (action === 'activate') {
            const mode = await fetch('/api/users/mode').then(response => response.json()).catch(() => ({}));
            if (mode.encryptedSpaces) {
                clearUserSpaceBrowserState();
                window.location.assign('/login');
            }
        }
    } finally {
        const wasBusy = userSpacesBusy;
        userSpacesBusy = false;
        if (wasBusy && activeDetail === 'spaces') showDetail('spaces');
    }
}

/**
 * Determine which of the two built-in Leslie translations to display.
 * @returns {'zh' | 'en'} The Leslie copy locale.
 */
function getCopyLocale() {
    const selectedLanguage = document.getElementById('ui_language_select')?.value;
    const savedLanguage = localStorage.getItem('language');
    const language = selectedLanguage || savedLanguage || navigator.language || document.documentElement.lang || 'en';
    return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * Convert a normalized connection state into the short settings label.
 * @param {{ connected: boolean, configured: boolean, checking: boolean }} connectionState Leslie connection state.
 * @param {Record<string, string>} copy Active UI copy.
 * @returns {string} Visible status label.
 */
function getConnectionStatusText(connectionState, copy) {
    if (serverModels.mode !== 'desktop') {
        return serverModels.loading ? '正在加载服务器模型' : serverModels.error
            || (serverModels.selectedId ? '已选择服务器模型' : '管理员尚未配置可用模型');
    }
    if (connectionState.checking) {
        return copy.checking;
    }
    if (connectionState.connected) {
        return copy.connected;
    }
    return connectionState.configured ? copy.configured : copy.disconnected;
}

/**
 * Render one row that opens an existing SillyTavern drawer.
 * @param {object} options Row configuration.
 * @param {string} [options.target] Existing drawer holder id.
 * @param {string} [options.detail] Leslie detail page id.
 * @param {string} options.icon Font Awesome icon class.
 * @param {string} options.title Visible title.
 * @param {string} options.body Explanatory text.
 * @param {boolean} [options.connectionStatus] Show the live API status pill.
 * @returns {string} Row markup.
 */
function renderSettingsRow({ target, detail, icon, title, body, connectionStatus = false }) {
    const copy = COPY[getCopyLocale()];
    const connectionState = connectionStatus ? getLeslieConnectionState() : undefined;
    const status = connectionStatus
        ? `<span class="leslie-settings-status is-${connectionState.state}" data-leslie-connection-status>${getConnectionStatusText(connectionState, copy)}</span>`
        : '';
    const action = detail ? `data-leslie-detail="${detail}"` : `data-leslie-drawer-target="${target}"`;

    return `
        <button type="button" class="leslie-settings-row" ${action}>
            <span class="leslie-settings-row-icon ${icon}" aria-hidden="true"></span>
            <span class="leslie-settings-row-copy">
                <span class="leslie-settings-row-title">${title}</span>
                <span class="leslie-settings-row-description">${body}</span>
            </span>
            ${status}
            <span class="leslie-settings-row-action">
                <span>${copy.open}</span>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </span>
        </button>`;
}

const MODEL_SERVICES = {
    deepseek: {
        kind: 'online', secretKey: SECRET_KEYS.DEEPSEEK, mainApi: 'openai', secondaryId: 'chat_completion_source', secondaryValue: 'deepseek', connectId: 'api_button_openai', icon: 'fa-solid fa-brain',
        fields: [
            ['api_key_deepseek', 'leslie-model-key', 'apiKey', 'apiKeyHelp', 'password'],
            ['model_deepseek_select', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    openai: {
        kind: 'online', secretKey: SECRET_KEYS.OPENAI, mainApi: 'openai', secondaryId: 'chat_completion_source', secondaryValue: 'openai', connectId: 'api_button_openai', icon: 'fa-solid fa-cloud',
        fields: [
            ['api_key_openai', 'leslie-model-key', 'apiKey', 'apiKeyHelp', 'password'],
            ['model_openai_select', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    openrouter: {
        kind: 'online', secretKey: SECRET_KEYS.OPENROUTER, mainApi: 'openai', secondaryId: 'chat_completion_source', secondaryValue: 'openrouter', connectId: 'api_button_openai', icon: 'fa-solid fa-route',
        fields: [
            ['api_key_openrouter', 'leslie-model-key', 'apiKey', 'apiKeyHelp', 'password'],
            ['model_openrouter_select', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    claude: {
        kind: 'online', secretKey: SECRET_KEYS.CLAUDE, mainApi: 'openai', secondaryId: 'chat_completion_source', secondaryValue: 'claude', connectId: 'api_button_openai', icon: 'fa-solid fa-a',
        fields: [
            ['api_key_claude', 'leslie-model-key', 'apiKey', 'apiKeyHelp', 'password'],
            ['model_claude_select', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    makersuite: {
        kind: 'online', secretKey: SECRET_KEYS.MAKERSUITE, mainApi: 'openai', secondaryId: 'chat_completion_source', secondaryValue: 'makersuite', connectId: 'api_button_openai', icon: 'fa-brands fa-google',
        fields: [
            ['api_key_makersuite', 'leslie-model-key', 'apiKey', 'apiKeyHelp', 'password'],
            ['model_google_select', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    custom: {
        kind: 'online', secretKey: SECRET_KEYS.CUSTOM, mainApi: 'openai', secondaryId: 'chat_completion_source', secondaryValue: 'custom', connectId: 'api_button_openai', icon: 'fa-solid fa-link',
        fields: [
            ['custom_api_url_text', 'leslie-model-endpoint', 'endpoint', 'endpointHelp', 'text'],
            ['api_key_custom', 'leslie-model-key', 'apiKey', 'apiKeyHelp', 'password'],
            ['custom_model_id', 'leslie-model-id', 'model', 'modelHelp', 'text'],
            ['model_custom_select', 'leslie-model-select', 'availableModel', 'modelHelp', 'select'],
        ],
    },
    ollama: {
        kind: 'local', mainApi: 'textgenerationwebui', secondaryId: 'textgen_type', secondaryValue: 'ollama', connectId: 'api_button_textgenerationwebui', icon: 'fa-solid fa-computer',
        fields: [
            ['ollama_api_url_text', 'leslie-model-endpoint', 'endpoint', 'endpointHelp', 'text'],
            ['ollama_model', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    llamacpp: {
        kind: 'local', mainApi: 'textgenerationwebui', secondaryId: 'textgen_type', secondaryValue: 'llamacpp', connectId: 'api_button_textgenerationwebui', icon: 'fa-solid fa-microchip',
        fields: [
            ['llamacpp_api_url_text', 'leslie-model-endpoint', 'endpoint', 'endpointHelp', 'text'],
            ['llamacpp_model', 'leslie-model-select', 'model', 'modelHelp', 'select'],
        ],
    },
    koboldcpp: {
        kind: 'local', mainApi: 'textgenerationwebui', secondaryId: 'textgen_type', secondaryValue: 'koboldcpp', connectId: 'api_button_textgenerationwebui', icon: 'fa-solid fa-dragon',
        fields: [
            ['koboldcpp_api_url_text', 'leslie-model-endpoint', 'endpoint', 'endpointHelp', 'text'],
        ],
    },
    ooba: {
        kind: 'local', mainApi: 'textgenerationwebui', secondaryId: 'textgen_type', secondaryValue: 'ooba', connectId: 'api_button_textgenerationwebui', icon: 'fa-solid fa-terminal',
        fields: [
            ['textgenerationwebui_api_url_text', 'leslie-model-endpoint', 'endpoint', 'endpointHelp', 'text'],
        ],
    },
    generic: {
        kind: 'local', mainApi: 'textgenerationwebui', secondaryId: 'textgen_type', secondaryValue: 'generic', connectId: 'api_button_textgenerationwebui', icon: 'fa-solid fa-network-wired',
        fields: [
            ['generic_api_url_text', 'leslie-model-endpoint', 'endpoint', 'endpointHelp', 'text'],
            ['generic_model_textgenerationwebui', 'leslie-model-id', 'model', 'modelHelp', 'text'],
        ],
    },
};

let activeModelKind;

const REPLY_STYLE_PRESETS = {
    off: {
        icon: 'fa-solid fa-feather-pointed',
        titleKey: 'styleOff',
        bodyKey: 'styleOffBody',
        tagKey: 'styleOffTag',
    },
    balanced: {
        icon: 'fa-solid fa-scale-balanced',
        titleKey: 'styleBalanced',
        bodyKey: 'styleBalancedBody',
        tagKey: 'styleBalancedTag',
    },
    novel: {
        icon: 'fa-solid fa-book-open',
        titleKey: 'styleNovel',
        bodyKey: 'styleNovelBody',
        tagKey: 'styleNovelTag',
    },
    dialogue: {
        icon: 'fa-solid fa-comments',
        titleKey: 'styleDialogue',
        bodyKey: 'styleDialogueBody',
        tagKey: 'styleDialogueTag',
    },
    concise: {
        icon: 'fa-solid fa-bolt',
        titleKey: 'styleConcise',
        bodyKey: 'styleConciseBody',
        tagKey: 'styleConciseTag',
    },
};

/**
 * Escape dynamic labels before inserting them into Leslie markup.
 * @param {string} value Dynamic text.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\u0027', '&#039;');
}

/**
 * Render the shared header and card container used by a detail page.
 * @param {object} options Detail page content.
 * @param {string} options.icon Font Awesome icon class.
 * @param {string} options.title Detail page title.
 * @param {string} options.body Detail page explanation.
 * @param {string} options.content Detail page markup.
 * @returns {string} Detail page markup.
 */
function renderDetailShell({ icon, title, body, content }) {
    const copy = COPY[getCopyLocale()];
    return `
        <div class="leslie-detail-toolbar">
            <button type="button" class="leslie-detail-back" data-leslie-detail-back>
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                <span>${copy.back}</span>
            </button>
            <span class="leslie-detail-mode">${copy.simpleDetail}</span>
        </div>
        <header class="leslie-detail-hero">
            <span class="leslie-detail-hero-icon ${icon}" aria-hidden="true"></span>
            <div>
                <h2>${title}</h2>
                <p>${body}</p>
            </div>
        </header>
        <div class="leslie-detail-content">${content}</div>`;
}

/**
 * Render one labeled input in a detail card when its original control exists.
 * @param {object} options Field configuration.
 * @param {string} options.sourceId Original control id.
 * @param {string} options.mirrorId Leslie control id.
 * @param {string} options.label Visible field label.
 * @param {string} options.help Visible field explanation.
 * @param {'text' | 'password' | 'select' | 'textarea'} options.kind Mirror control kind.
 * @param {boolean} [options.multiple] Whether a select allows multiple values.
 * @returns {string} Field markup or an empty string.
 */
function renderDetailField({ sourceId, mirrorId, label, help, kind, multiple = false }) {
    if (!document.getElementById(sourceId)) {
        return '';
    }

    let control = `<input id="${mirrorId}" type="${kind}" autocomplete="off">`;
    if (kind === 'password') {
        control = `<input id="${mirrorId}" type="password" autocomplete="new-password" placeholder="••••••••">`;
    } else if (kind === 'select') {
        control = `<select id="${mirrorId}"${multiple ? ' multiple size="5"' : ''}></select>`;
    } else if (kind === 'textarea') {
        control = `<textarea id="${mirrorId}" rows="6"></textarea>`;
    }

    return `
        <label class="leslie-detail-field" for="${mirrorId}">
            <span class="leslie-detail-field-copy">
                <strong>${label}</strong>
                <small>${help}</small>
            </span>
            ${control}
        </label>`;
}

/**
 * Identify a common model connection without changing the active API.
 * @returns {string | undefined} Leslie service id.
 */
function getActiveModelService() {
    const mainApi = document.getElementById('main_api')?.value;
    const serviceId = Object.entries(MODEL_SERVICES).find(([, service]) => {
        return mainApi === service.mainApi
            && document.getElementById(service.secondaryId)?.value === service.secondaryValue;
    })?.[0];

    // The original settings loader changes the main API and provider controls
    // in separate steps. Keep the last explicit Leslie selection available
    // during that short refresh window so the connect button cannot silently
    // lose its target.
    return serviceId || (activeModelServiceId && MODEL_SERVICES[activeModelServiceId] ? activeModelServiceId : undefined);
}

/**
 * Render the local model setup without taking ownership of the original API
 * controls. DreamLand no longer hosts or starts local models; connecting to an
 * already running self-hosted endpoint stays with the existing service cards
 * and the Text Completion handlers below.
 * @param {Record<string, string>} copy Active UI copy.
 * @returns {string} Local model setup markup.
 */
function renderLocalModelSetup(copy) {
    const localModelLoadingEnabled = isLocalModelLoadingEnabled();
    return `
        <section class="leslie-detail-card leslie-local-model-card" aria-labelledby="leslie-local-model-title">
            <div class="leslie-local-model-card-heading">
                <div>
                    <strong id="leslie-local-model-title">${copy.localModelTitle}</strong>
                    <small>${copy.localModelBody}</small>
                </div>
            </div>
            <label class="leslie-detail-switch-row leslie-local-model-loading-toggle" for="leslie-local-model-loading">
                <span><strong>${copy.localModelLoading}</strong><small>${copy.localModelLoadingHelp}</small></span>
                <input id="leslie-local-model-loading" type="checkbox" role="switch" data-leslie-local-model-toggle ${localModelLoadingEnabled ? 'checked' : ''}>
            </label>
            <small class="leslie-local-model-loading-status" data-leslie-local-model-loading-status>${localModelLoadingEnabled ? copy.localModelLoadingEnabledStatus : copy.localModelLoadingDisabledStatus}</small>
        </section>`;
}


/**
 * Render the model connection detail page.
 * @returns {string} Page markup.
 */
function renderModelDetail() {
    if (serverModels.mode !== 'desktop') {
        const content = `<section class="leslie-detail-card">
            <div class="leslie-detail-card-heading"><h3>选择模型</h3><p>API 地址和密钥由管理员统一配置，你只需选择可用模型。</p></div>
            <p role="status" data-server-model-status></p>
            <label class="leslie-quick-control" for="leslie-server-model-select"><span><strong>聊天模型</strong></span>
                <select id="leslie-server-model-select" class="text_pole"></select></label>
            <button type="button" class="leslie-settings-secondary-button" data-server-model-refresh>刷新模型清单</button>
        </section>`;
        return renderDetailShell({ icon: 'fa-solid fa-plug', title: '模型选择', body: '使用服务器提供的 AI 模型', content });
    }
    const copy = COPY[getCopyLocale()];
    const activeService = getActiveModelService();
    activeModelKind ??= MODEL_SERVICES[activeService]?.kind || 'online';
    if (isDreamLandAndroidClient() && activeModelKind === 'local') {
        activeModelKind = 'online';
    }
    const serviceCopy = {
        deepseek: [copy.serviceDeepSeek, copy.serviceDeepSeekBody],
        custom: [copy.serviceCustom, copy.serviceCustomBody],
        openrouter: [copy.serviceOpenRouter, copy.serviceOpenRouterBody],
        ollama: [copy.serviceOllama, copy.serviceOllamaBody],
        openai: [copy.serviceOpenAI, copy.serviceOpenAIBody],
        claude: [copy.serviceClaude, copy.serviceClaudeBody],
        makersuite: [copy.serviceGemini, copy.serviceGeminiBody],
        llamacpp: [copy.serviceLlamaCpp, copy.serviceLlamaCppBody],
        koboldcpp: [copy.serviceKoboldCpp, copy.serviceKoboldCppBody],
        ooba: [copy.serviceTextGen, copy.serviceTextGenBody],
        generic: [copy.serviceLocalGeneric, copy.serviceLocalGenericBody],
    };
    const kindOptions = [
        ['online', 'fa-solid fa-cloud', copy.onlineApi, copy.onlineApiBody],
        ['local', 'fa-solid fa-computer', copy.localApi, copy.localApiBody],
    ].filter(([kind]) => !isDreamLandAndroidClient() || kind === 'online').map(([kind, icon, title, body]) => `
        <button type="button" class="leslie-api-kind-card${kind === activeModelKind ? ' is-active' : ''}" data-leslie-api-kind="${kind}" aria-pressed="${kind === activeModelKind}">
            <span class="${icon}" aria-hidden="true"></span>
            <span><strong>${title}</strong><small>${body}</small></span>
            <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
        </button>`).join('');
    const cards = Object.entries(MODEL_SERVICES).filter(([, service]) => service.kind === activeModelKind).map(([id, service]) => `
        <button type="button" class="leslie-service-card${id === activeService ? ' is-active' : ''}" data-leslie-service="${id}" aria-pressed="${id === activeService}">
            <span class="leslie-service-icon ${service.icon}" aria-hidden="true"></span>
            <span><strong>${serviceCopy[id][0]}</strong><small>${serviceCopy[id][1]}</small></span>
            <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
        </button>`).join('');

    const selectedService = MODEL_SERVICES[activeService];
    let fields = `<div class="leslie-detail-callout"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${copy.chooseProvider}</span></div>`;
    if (selectedService?.kind === activeModelKind) {
        fields = selectedService.fields.map(([sourceId, mirrorId, labelKey, helpKey, kind]) => renderDetailField({
            sourceId,
            mirrorId,
            label: copy[labelKey],
            help: copy[helpKey],
            kind,
        })).join('');
    }

    const connectionState = getLeslieConnectionState();
    const statusText = getConnectionStatusText(connectionState, copy);
    const thinkingMode = selectedService?.mainApi === 'openai' && document.getElementById('openai_show_thoughts') ? `
        <label class="leslie-detail-switch-row" for="leslie-model-thinking-mode">
            <span><strong>${copy.thinkingMode}</strong><small>${copy.thinkingModeHelp}</small></span>
            <input id="leslie-model-thinking-mode" type="checkbox" role="switch">
        </label>` : '';

    const serviceSection = `<section class="leslie-detail-card">
            <div class="leslie-detail-card-heading"><h3>${copy.serviceTitle}</h3><p>${copy.serviceBody}</p></div>
            <div class="leslie-service-grid">${cards}</div>
        </section>`;
    const fieldsSection = `<section class="leslie-detail-card">
            <div class="leslie-detail-grid">${fields}</div>
            ${selectedService?.kind === activeModelKind ? `
                <label class="leslie-detail-switch-row" for="leslie-model-auto-connect">
                    <span><strong>${copy.autoConnect}</strong><small>${copy.autoConnectHelp}</small></span>
                    <input id="leslie-model-auto-connect" type="checkbox" role="switch">
                </label>
                ${thinkingMode}
                <div class="leslie-detail-actions">
                    <span class="leslie-detail-privacy"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>${copy.privacy}</span>
                    <button type="button" class="leslie-settings-primary-button" data-leslie-model-connect>
                        <i class="fa-solid fa-plug" aria-hidden="true"></i><span>${copy.connect}</span>
                    </button>
                </div>` : ''}
        </section>`;
    const fullSettingsButton = `<button type="button" class="leslie-detail-full-button" data-leslie-drawer-target="sys-settings-button">
            <span><strong>${copy.allProviders}</strong><small>${copy.fullSettingsHelp}</small></span>
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </button>`;
    const localContent = isDreamLandAndroidClient() ? '' : `${renderLocalModelSetup(copy)}
        <details class="leslie-local-advanced" ${localAdvancedOpen ? 'open' : ''}>
            <summary><span><strong>${copy.localModelAdvanced}</strong><small>${copy.localModelAdvancedHelp}</small></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
            <div class="leslie-local-advanced-content">
                ${serviceSection}
                ${fieldsSection}
                ${fullSettingsButton}
            </div>
        </details>`;
    const content = `
        <section class="leslie-model-status is-${connectionState.state}" data-leslie-model-status>
            <span class="leslie-connection-dot" aria-hidden="true"></span>
            <strong>${statusText}</strong>
        </section>
        <section class="leslie-detail-card leslie-api-kind-section">
            <div class="leslie-detail-card-heading"><h3>${copy.apiKindTitle}</h3><p>${copy.apiKindBody}</p></div>
            <div class="leslie-api-kind-grid">${kindOptions}</div>
        </section>
        ${activeModelKind === 'local' ? localContent : `${serviceSection}${fieldsSection}${fullSettingsButton}`}`;
    return renderDetailShell({ icon: 'fa-solid fa-plug', title: copy.modelDetailTitle, body: copy.modelDetailBody, content });
}

/**
 * Resolve reply controls for the currently active API family.
 * @returns {{temperature?: string, streaming?: string}} Control ids.
 */
function getReplyControlIds() {
    const mainApi = document.getElementById('main_api')?.value;
    if (mainApi === 'openai') {
        return {
            temperature: 'temp_openai',
            streaming: 'stream_toggle',
        };
    }
    if (mainApi === 'textgenerationwebui') {
        return {
            temperature: 'temp_textgenerationwebui',
            streaming: 'streaming_textgenerationwebui',
        };
    }
    if (mainApi === 'novel') {
        return {
            temperature: 'temp_novel',
            streaming: 'streaming_novel',
        };
    }
    return {
        temperature: 'temp',
        streaming: 'streaming_kobold',
    };
}

/**
 * Render a range setting with a compact numeric companion input.
 * @param {object} options Range configuration.
 * @param {string} options.sourceId Original range id.
 * @param {string} options.mirrorId Leslie range id.
 * @param {string} options.label Visible label.
 * @param {string} options.help Visible explanation.
 * @returns {string} Range markup or an empty string.
 */
function renderDetailRange({ sourceId, mirrorId, label, help }) {
    if (!document.getElementById(sourceId)) {
        return '';
    }
    return `
        <label class="leslie-detail-field leslie-detail-range-field" for="${mirrorId}">
            <span class="leslie-detail-field-copy"><strong>${label}</strong><small>${help}</small></span>
            <span class="leslie-detail-range-controls">
                <input id="${mirrorId}" type="range">
                <input id="${mirrorId}-number" type="number" aria-label="${label}">
            </span>
        </label>`;
}

/**
 * Read and normalize the persisted semantic reply style.
 * @returns {{schemaVersion: number, style: string, outputPolicy: 'provider' | 'manual'}} Reply-style settings.
 */
function getReplyStyleSettings() {
    const legacySourceId = document.getElementById('main_api')?.value === 'openai'
        ? 'openai_max_tokens'
        : 'amount_gen';
    const normalized = migrateLeslieReplyStyleSettings(extension_settings[LESLIE_REPLY_STYLE_SETTINGS_KEY], {
        legacyOutputTokens: document.getElementById(legacySourceId)?.value,
    });
    extension_settings[LESLIE_REPLY_STYLE_SETTINGS_KEY] = normalized;
    setLeslieReplyStyleRuntimeSettings(normalized);
    return normalized;
}

/**
 * Read the selected semantic reply style.
 * @returns {string} Active style id.
 */
function getActiveReplyStylePreset() {
    return getReplyStyleSettings().style;
}

/**
 * Render the scene-based reply presets.
 * @returns {string} Preset card markup.
 */
function renderReplyStylePresets() {
    const copy = COPY[getCopyLocale()];
    const activePreset = getActiveReplyStylePreset();
    const cards = Object.entries(REPLY_STYLE_PRESETS).map(([id, preset]) => `
        <button type="button" class="leslie-style-preset${id === activePreset ? ' is-active' : ''}" data-leslie-reply-style="${id}" aria-pressed="${id === activePreset}">
            <span class="leslie-style-preset-icon ${preset.icon}" aria-hidden="true"></span>
            <span class="leslie-style-preset-copy">
                <strong>${copy[preset.titleKey]}</strong>
                <small>${copy[preset.bodyKey]}</small>
                <em>${copy[preset.tagKey]}</em>
            </span>
            <span class="leslie-style-preset-check fa-solid fa-check" aria-hidden="true"></span>
        </button>`).join('');
    return `
        <section class="leslie-detail-card leslie-style-presets-card">
            <div class="leslie-detail-card-heading">
                <h3>${copy.stylePresetsTitle}</h3>
                <p>${copy.stylePresetsBody}</p>
            </div>
            <div class="leslie-style-presets">${cards}</div>
            <div class="leslie-style-preset-note"><i class="fa-solid fa-shield-heart" aria-hidden="true"></i><span>${copy.stylePresetsSafe}</span></div>
            <div class="leslie-style-preset-feedback" aria-live="polite">
                <span data-leslie-preset-feedback>${copy.styleApplied}“${copy[REPLY_STYLE_PRESETS[activePreset].titleKey]}”${copy.styleAppliedTail}</span>
            </div>
        </section>`;
}

/**
 * Render the reply-style detail page.
 * @returns {string} Page markup.
 */
function renderReplyDetail() {
    const copy = COPY[getCopyLocale()];
    const ids = getReplyControlIds();
    const controls = [
        renderDetailRange({ sourceId: ids.temperature, mirrorId: 'leslie-reply-creativity', label: copy.creativity, help: copy.creativityHelp }),
    ].join('');
    const streaming = document.getElementById(ids.streaming) ? `
        <label class="leslie-detail-switch-row" for="leslie-reply-streaming">
            <span><strong>${copy.streaming}</strong><small>${copy.streamingHelp}</small></span>
            <input id="leslie-reply-streaming" type="checkbox" role="switch">
        </label>` : '';
    const emptyNote = controls || streaming ? '' : `<div class="leslie-detail-callout"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${copy.settingUnavailable}</span></div>`;
    const content = `
        ${renderReplyStylePresets()}
        <section class="leslie-detail-card">
            <div class="leslie-detail-callout"><i class="fa-solid fa-infinity" aria-hidden="true"></i><span><strong>${copy.providerOutput}</strong><br>${copy.providerOutputHelp}</span></div>
        </section>
        <section class="leslie-detail-card">
            <div class="leslie-detail-grid">${controls}${emptyNote}</div>
            ${streaming}
        </section>
        <button type="button" class="leslie-detail-full-button" data-leslie-drawer-target="ai-config-button">
            <span><strong>${copy.advancedReply}</strong><small>${copy.fullSettingsHelp}</small></span>
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </button>`;
    return renderDetailShell({ icon: 'fa-solid fa-wand-magic-sparkles', title: copy.replyDetailTitle, body: copy.replyDetailBody, content });
}

/**
 * Read the current character name from SillyTavern's existing UI.
 * @returns {string} Current character label.
 */
function getCurrentCharacterName() {
    const copy = COPY[getCopyLocale()];
    return document.querySelector('#rm_button_selected_ch h2')?.textContent?.trim()
        || document.getElementById('character_name_pole')?.textContent?.trim()
        || copy.noCharacter;
}

/**
 * Render the character and chat detail page.
 * @returns {string} Page markup.
 */
function renderCharacterDetail() {
    const copy = COPY[getCopyLocale()];
    const content = `
        <section class="leslie-detail-card leslie-character-summary">
            <span class="leslie-character-avatar fa-solid fa-user" aria-hidden="true"></span>
            <div><small>${copy.currentCharacter}</small><strong data-leslie-character-name>${escapeHtml(getCurrentCharacterName())}</strong><p>${copy.characterGuide}</p></div>
        </section>
        <div class="leslie-character-actions">
            <button type="button" data-leslie-open-character-list><i class="fa-solid fa-address-book" aria-hidden="true"></i><span>${copy.chooseCharacter}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            <button type="button" data-leslie-drawer-target="rightNavHolder"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>${copy.editCharacter}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            <button type="button" data-leslie-detail="persona"><i class="fa-solid fa-face-smile" aria-hidden="true"></i><span>${copy.goPersona}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            <button type="button" data-leslie-detail="world"><i class="fa-solid fa-book-atlas" aria-hidden="true"></i><span>${copy.goWorld}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        </div>`;
    return renderDetailShell({ icon: 'fa-solid fa-address-card', title: copy.characterDetailTitle, body: copy.characterDetailBody, content });
}

/**
 * Render the persona detail page.
 * @returns {string} Page markup.
 */
function renderPersonaDetail() {
    const copy = COPY[getCopyLocale()];
    const personaName = document.getElementById('your_name')?.textContent?.trim() || copy.noPersona;
    const content = `
        <section class="leslie-detail-card leslie-persona-summary">
            <span class="leslie-character-avatar fa-solid fa-face-smile" aria-hidden="true"></span>
            <div><small>${copy.currentPersona}</small><strong data-leslie-persona-name>${escapeHtml(personaName)}</strong></div>
        </section>
        <section class="leslie-detail-card">
            <div class="leslie-detail-grid">
                ${renderDetailField({ sourceId: 'persona_description', mirrorId: 'leslie-persona-description', label: copy.personaDescription, help: copy.personaDescriptionHelp, kind: 'textarea' })}
                ${renderDetailField({ sourceId: 'persona_description_position', mirrorId: 'leslie-persona-position', label: copy.personaPosition, help: copy.personaPositionHelp, kind: 'select' })}
            </div>
            ${document.getElementById('persona_auto_lock') ? `
                <label class="leslie-detail-switch-row" for="leslie-persona-lock">
                    <span><strong>${copy.autoLockPersona}</strong><small>${copy.autoLockPersonaHelp}</small></span>
                    <input id="leslie-persona-lock" type="checkbox" role="switch">
                </label>` : ''}
        </section>
        <div class="leslie-detail-button-grid">
            <button type="button" class="leslie-detail-full-button" data-leslie-drawer-target="persona-management-button"><span><strong>${copy.managePersonas}</strong></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            <button type="button" class="leslie-detail-full-button" data-leslie-source-click="persona_rename_button"><span><strong>${copy.renamePersona}</strong></span><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        </div>`;
    return renderDetailShell({ icon: 'fa-solid fa-face-smile', title: copy.personaDetailTitle, body: copy.personaDetailBody, content });
}

/**
 * Render the world and memory detail page.
 * @returns {string} Page markup.
 */
function renderWorldDetail() {
    const copy = COPY[getCopyLocale()];
    const content = `
        <section class="leslie-detail-card">
            <div class="leslie-detail-grid">
                ${renderDetailField({ sourceId: 'world_info', mirrorId: 'leslie-world-info', label: copy.activeWorlds, help: copy.activeWorldsHelp, kind: 'select', multiple: true })}
            </div>
            ${document.getElementById('world_info_recursive') ? `
                <label class="leslie-detail-switch-row" for="leslie-world-recursive">
                    <span><strong>${copy.recursiveWorld}</strong><small>${copy.recursiveWorldHelp}</small></span>
                    <input id="leslie-world-recursive" type="checkbox" role="switch">
                </label>` : ''}
        </section>
        <button type="button" class="leslie-detail-full-button" data-leslie-drawer-target="WI-SP-button">
            <span><strong>${copy.manageWorlds}</strong><small>${copy.fullSettingsHelp}</small></span>
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </button>`;
    return renderDetailShell({ icon: 'fa-solid fa-book-atlas', title: copy.worldDetailTitle, body: copy.worldDetailBody, content });
}

/** @returns {string} Volcengine character voice detail page. */
function renderVoiceDetail() {
    const copy = COPY[getCopyLocale()];
    const content = `<leslie-voice-settings data-locale="${getCopyLocale()}"></leslie-voice-settings>`;
    return renderDetailShell({ icon: 'fa-solid fa-volume-high', title: copy.voiceDetailTitle, body: copy.voiceDetailBody, content });
}

function renderPrivacyDetail() {
    const copy = COPY[getCopyLocale()];
    const state = getLesliePrivacyModeState();
    const blocks = [
        ['conversations', copy.privacyConversations, copy.privacyConversationsHelp],
        ['header', copy.privacyHeader, copy.privacyHeaderHelp],
        ['messages', copy.privacyMessages, copy.privacyMessagesHelp],
        ['composer', copy.privacyComposer, copy.privacyComposerHelp],
        ['connection', copy.privacyConnection, copy.privacyConnectionHelp],
    ];
    const rows = blocks.map(([id, title, help]) => `
        <label class="leslie-detail-switch-row" for="leslie-privacy-block-${id}">
            <span><strong>${title}</strong><small>${help}</small></span>
            <input id="leslie-privacy-block-${id}" type="checkbox" role="switch" data-leslie-privacy-block="${id}" ${state.blocks[id] ? 'checked' : ''}>
        </label>`).join('');
    const content = `
        <section class="leslie-detail-card leslie-privacy-master-card">
            <label class="leslie-detail-switch-row" for="leslie-privacy-enabled">
                <span><strong>${copy.privacyModeEnabled}</strong><small>${copy.privacyModeEnabledHelp}</small></span>
                <input id="leslie-privacy-enabled" type="checkbox" role="switch" data-leslie-privacy-master ${state.enabled ? 'checked' : ''}>
            </label>
            <div class="leslie-detail-card-heading">
                <h3>${copy.privacyModePreview}</h3>
                <p>${copy.privacyModePreviewHelp}</p>
            </div>
            <div class="leslie-privacy-preview" aria-hidden="true">
                <div class="leslie-privacy-preview-sidebar">
                    <span class="leslie-privacy-preview-block" data-leslie-privacy-preview="conversations">${copy.privacyConversations}</span>
                    <span class="leslie-privacy-preview-block" data-leslie-privacy-preview="connection">${copy.privacyConnection}</span>
                </div>
                <div class="leslie-privacy-preview-chat">
                    <span class="leslie-privacy-preview-block" data-leslie-privacy-preview="header">${copy.privacyHeader}</span>
                    <span class="leslie-privacy-preview-block" data-leslie-privacy-preview="messages">${copy.privacyMessages}</span>
                    <span class="leslie-privacy-preview-block" data-leslie-privacy-preview="composer">${copy.privacyComposer}</span>
                </div>
            </div>
        </section>
        <section class="leslie-detail-card">
            <div class="leslie-detail-card-heading">
                <h3>${copy.privacyModeBlocks}</h3>
                <p>${copy.privacyModeBlocksHelp}</p>
            </div>
            <div class="leslie-privacy-block-list">${rows}</div>
        </section>
        <div class="leslie-detail-callout">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            <span>${copy.privacyVisualOnly}</span>
        </div>`;
    return renderDetailShell({ icon: 'fa-solid fa-user-shield', title: copy.privacyModeDetailTitle, body: copy.privacyModeDetailBody, content });
}

function renderUserSpacesDetail() {
    const copy = COPY[getCopyLocale()];
    const state = userSpacesState;
    if (!state) {
        return renderDetailShell({ icon: 'fa-solid fa-users', title: copy.spacesTitle, body: copy.spacesBody,
            content: `<section class="leslie-detail-card"><p>${copy.spacesLoading}</p></section>` });
    }
    if (state.error) {
        return renderDetailShell({ icon: 'fa-solid fa-users', title: copy.spacesTitle, body: copy.spacesBody,
            content: `<section class="leslie-detail-card"><p>${copy.spacesError}</p></section>` });
    }
    const users = state.users.map(user => `<div class="leslie-user-space-row">
        <span class="fa-solid fa-user" aria-hidden="true"></span>
        <span><strong>${escapeHtml(user.name)}</strong><small>@${escapeHtml(user.handle)}</small></span>
        ${user.handle === state.current ? `<small>${copy.spacesCurrent}</small>` : ''}
    </div>`).join('');
    const setup = !state.enabled && state.admin && state.localSetup ? `
        <section class="leslie-detail-card">
            <div class="leslie-detail-card-heading"><h3>${copy.spacesInactive}</h3><p>${copy.spacesSetupHelp}</p></div>
            <div class="leslie-user-space-form">
                <label>${copy.spacesPassword}<input type="password" data-leslie-space-password autocomplete="new-password" required></label>
                <label>${copy.spacesConfirm}<input type="password" data-leslie-space-confirm autocomplete="new-password" required></label>
                <p class="leslie-user-space-password-tip">${copy.spacesPasswordTip}</p>
                <button type="button" class="leslie-settings-primary-button" data-leslie-space-activate ${userSpacesBusy ? 'disabled' : ''}>${copy.spacesEnable}</button>
            </div>
        </section>` : '';
    const create = state.enabled && state.admin ? `
        <section class="leslie-detail-card">
            <div class="leslie-detail-card-heading"><h3>${copy.spacesCreateTitle}</h3></div>
            <div class="leslie-user-space-form">
                <label>${copy.spacesName}<input type="text" data-leslie-space-name autocomplete="off" maxlength="80"></label>
                <label>${copy.spacesHandle}<input type="text" data-leslie-space-handle autocomplete="off" maxlength="50"></label>
                <label>${copy.spacesPassword}<input type="password" data-leslie-space-new-password autocomplete="new-password" required></label>
                <label>${copy.spacesConfirm}<input type="password" data-leslie-space-new-confirm autocomplete="new-password" required></label>
                <p class="leslie-user-space-password-tip">${copy.spacesPasswordTip}</p>
                <button type="button" class="leslie-settings-primary-button" data-leslie-space-create ${userSpacesBusy ? 'disabled' : ''}>${copy.spacesCreate}</button>
            </div>
        </section>` : '';
    const content = `
        <section class="leslie-detail-card">
            <div class="leslie-detail-card-heading"><h3>${state.enabled ? copy.spacesProtected : copy.spacesInactive}</h3></div>
            <div class="leslie-user-space-list">${users}</div>
            ${state.enabled ? `<button type="button" class="leslie-settings-secondary-button" data-leslie-space-switch>${copy.spacesSwitch}</button>` : ''}
            ${!state.enabled && !state.localSetup ? `<p>${copy.spacesLocalOnly}</p>` : ''}
        </section>${setup}${create}`;
    return renderDetailShell({ icon: 'fa-solid fa-users', title: copy.spacesTitle, body: copy.spacesBody, content });
}

const DETAIL_RENDERERS = {
    privacy: renderPrivacyDetail,
    spaces: renderUserSpacesDetail,
    model: renderModelDetail,
    reply: renderReplyDetail,
    voice: renderVoiceDetail,
    character: renderCharacterDetail,
    persona: renderPersonaDetail,
    world: renderWorldDetail,
};

/**
 * Build the settings hub using user-facing language and real drawer targets.
 * @returns {HTMLElement} The overlay element.
 */
function createSettingsOverlay() {
    const copy = COPY[getCopyLocale()];
    const overlay = document.createElement('div');
    overlay.id = 'leslie-settings-overlay';
    overlay.className = 'leslie-settings-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <section class="leslie-settings-panel" role="main" aria-labelledby="leslie-settings-title">
            <div class="leslie-settings-layout">
                <aside class="leslie-settings-master">
                    <header class="leslie-settings-header">
                        <div class="leslie-settings-heading">
                            <span class="leslie-settings-logo fa-solid fa-sliders" aria-hidden="true"></span>
                            <span>
                                <small>${copy.subtitle}</small>
                                <strong id="leslie-settings-title">${copy.settings}</strong>
                            </span>
                        </div>
                        <button type="button" class="leslie-settings-close fa-solid fa-arrow-left" data-leslie-settings-close aria-label="${copy.backToChat}" title="${copy.backToChat}"></button>
                    </header>
                <nav class="leslie-settings-navigation" aria-label="${copy.navigation}">
                    <div class="leslie-settings-navigation-heading">
                        <span>${copy.navigation}</span>
                        <small>${copy.subtitle}</small>
                    </div>
                    <div class="leslie-settings-navigation-group">
                        <button type="button" class="leslie-settings-nav-item active" data-leslie-settings-home data-leslie-settings-page="overview" aria-current="page">
                            <i class="fa-solid fa-sliders" aria-hidden="true"></i>
                            <span><strong>${copy.overviewTitle}</strong><small>${copy.overviewBody}</small></span>
                        </button>
                    </div>
                    <div class="leslie-settings-navigation-group">
                        <span class="leslie-settings-navigation-label">${copy.coreGroup}</span>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="privacy" data-leslie-settings-page="privacy">
                            <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
                            <span><strong>${copy.privacyModeTitle}</strong><small>${copy.privacyModeBody}</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="spaces" data-leslie-settings-page="spaces">
                            <i class="fa-solid fa-users" aria-hidden="true"></i>
                            <span><strong>${copy.spacesTitle}</strong><small>${copy.spacesBody}</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="model" data-leslie-settings-page="model">
                            <i class="fa-solid fa-plug" aria-hidden="true"></i>
                            <span><strong>${copy.modelTitle}</strong><small>${copy.modelBody}</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="reply" data-leslie-settings-page="reply">
                            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                            <span><strong>${copy.replyTitle}</strong><small>${copy.replyBody}</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="voice" data-leslie-settings-page="voice">
                            <i class="fa-solid fa-volume-high" aria-hidden="true"></i>
                            <span><strong>${copy.voiceTitle}</strong><small>${copy.voiceBody}</small></span>
                        </button>
                    </div>
                    <div class="leslie-settings-navigation-group">
                        <span class="leslie-settings-navigation-label">${copy.roleGroup}</span>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="character" data-leslie-settings-page="character">
                            <i class="fa-solid fa-address-card" aria-hidden="true"></i>
                            <span><strong>${copy.characterTitle}</strong><small>${copy.characterBody}</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="persona" data-leslie-settings-page="persona">
                            <i class="fa-solid fa-face-smile" aria-hidden="true"></i>
                            <span><strong>${copy.personaTitle}</strong><small>${copy.personaBody}</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-detail="world" data-leslie-settings-page="world">
                            <i class="fa-solid fa-book-atlas" aria-hidden="true"></i>
                            <span><strong>${copy.worldTitle}</strong><small>${copy.worldBody}</small></span>
                        </button>
                    </div>
                    <div class="leslie-settings-navigation-group leslie-settings-navigation-advanced">
                        <span class="leslie-settings-navigation-label">${copy.advancedGroup}</span>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-settings-about>
                            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                            <span><strong>关于 DreamLand</strong><small>版本、项目介绍与素材说明</small></span>
                        </button>
                        <button type="button" class="leslie-settings-nav-item" data-leslie-settings-anchor="advanced" data-leslie-settings-page="advanced">
                            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                            <span><strong>${copy.advancedTitle}</strong><small>${copy.advancedBody}</small></span>
                        </button>
                    </div>
                </nav>
                </aside>

                <section class="leslie-settings-content-pane" aria-labelledby="leslie-settings-content-title">
                <header class="leslie-settings-content-header">
                    <button type="button" class="leslie-settings-content-back" data-leslie-settings-nav-back aria-label="${copy.navigation}" title="${copy.navigation}">
                        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                    </button>
                    <div class="leslie-settings-content-heading">
                        <small>${copy.contentEyebrow}</small>
                        <strong id="leslie-settings-content-title">${copy.overviewTitle}</strong>
                    </div>
                    <span class="leslie-settings-content-save"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>${copy.originalSave}</span></span>
                </header>
                <div class="leslie-settings-scroll">
                <div id="leslie-settings-home" class="leslie-settings-home">
                <section class="leslie-settings-intro">
                    <div>
                        <span class="leslie-settings-eyebrow">${copy.introEyebrow}</span>
                        <h2>${copy.introTitle}</h2>
                        <p>${copy.introBody}</p>
                    </div>
                    <div class="leslie-settings-safe-note">
                        <i class="fa-solid fa-shield-heart" aria-hidden="true"></i>
                        <span>${copy.safeNote}</span>
                    </div>
                </section>

                <div class="leslie-settings-columns">
                    <main class="leslie-settings-main">
                        <section class="leslie-settings-section leslie-settings-quick-section">
                            <div class="leslie-settings-section-heading">
                                <div>
                                    <h3>${copy.quickTitle}</h3>
                                    <p>${copy.quickBody}</p>
                                </div>
                            </div>
                            <div class="leslie-settings-quick-grid">
                                <label class="leslie-quick-control" for="dreamland-decoration-select">
                                    <span><strong>首页场景装饰</strong><small>显示或关闭首页 BA 游戏场景</small></span>
                                    <select id="dreamland-decoration-select" data-dreamland-preference="decoration"><option value="subtle">显示</option><option value="off">关闭</option></select>
                                </label>
                                <label class="leslie-quick-control" for="dreamland-background-select">
                                    <span><strong>聊天背景显示</strong><small>在下方“背景素材”选择图片；选择后自动开启显示</small></span>
                                    <select id="dreamland-background-select" data-dreamland-preference="background"><option value="off">纯色界面</option><option value="soft">柔和遮罩</option><option value="visible">清晰背景</option></select>
                                </label>
                                <label class="leslie-quick-control" for="leslie-display-mode-select">
                                    <span><strong>明暗模式</strong><small>亮色、暗色或跟随系统；与登录页同步</small></span>
                                    <select id="leslie-display-mode-select"><option value="auto">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select>
                                </label>
                                <section class="dreamland-glass-settings" aria-labelledby="dreamland-glass-title">
                                    <h4 id="dreamland-glass-title">磨砂玻璃效果</h4>
                                    <p id="dreamland-glass-help">登录卡片与标题栏同步调节透明度和模糊；聊天栏保留主题粉色，其他标题栏使用白色。滚动内容从标题栏后方透出。</p>
                                    <label for="dreamland-glass-transparency">标题栏透明度 <output for="dreamland-glass-transparency" data-dreamland-glass-value="glassTransparency">28%</output></label>
                                    <input id="dreamland-glass-transparency" type="range" min="0" max="100" step="1" value="28" data-dreamland-preference="glassTransparency" aria-describedby="dreamland-glass-help dreamland-glass-transparency-help">
                                    <small id="dreamland-glass-transparency-help">0% 为不透明，100% 为全透明；暗色模式对应深色底。</small>
                                    <label for="dreamland-glass-blur">高斯模糊 <output for="dreamland-glass-blur" data-dreamland-glass-value="glassBlur">24 px</output></label>
                                    <input id="dreamland-glass-blur" type="range" min="0" max="48" step="1" value="24" data-dreamland-preference="glassBlur" aria-describedby="dreamland-glass-help">
                                    <div class="dreamland-glass-preview" role="group" aria-label="实时预览：滚动示例内容，查看白色功能页栏、粉色聊天栏与登录卡片">
                                        <div class="dreamland-glass-preview-sample">
                                            <div class="dreamland-glass-preview-white">功能页标题栏</div>
                                            <div class="dreamland-glass-preview-scroll" tabindex="0" aria-label="白色标题栏滚动预览"><p>向上滚动，内容会经过标题栏后方。</p><p>朋友圈 · 今天的小小记录</p><p>透过玻璃看到的是当前页面内容。</p><p>调节模糊，比较文字与色块的变化。</p></div>
                                        </div>
                                        <div class="dreamland-glass-preview-sample">
                                            <div class="dreamland-glass-preview-color">聊天标题栏 · 主题粉色</div>
                                            <div class="dreamland-glass-preview-scroll" tabindex="0" aria-label="粉色聊天栏滚动预览"><p>聊天消息也会从标题栏后方经过。</p><p>透明度改变，主题粉色保持不变。</p><p>向上滚动观察高斯模糊效果。</p><p>文字和色块随滚动实时变化。</p></div>
                                        </div>
                                        <div class="dreamland-glass-preview-login-scene"><div class="dreamland-glass-preview-login"><strong>DreamLand</strong><span>登录卡片预览</span></div></div>
                                    </div>
                                    <button type="button" class="leslie-settings-secondary-button" data-dreamland-glass-reset>恢复默认效果</button>
                                </section>
                                <label class="leslie-quick-control" for="leslie-language-select">
                                    <span>
                                        <strong>${copy.language}</strong>
                                        <small>${copy.languageHelp}</small>
                                    </span>
                                    <select id="leslie-language-select" aria-label="${copy.language}"></select>
                                </label>
                                <label class="leslie-quick-control leslie-quick-toggle" for="leslie-reduced-motion">
                                    <span>
                                        <strong>${copy.reducedMotion}</strong>
                                        <small>${copy.reducedMotionHelp}</small>
                                    </span>
                                    <input id="leslie-reduced-motion" type="checkbox" role="switch">
                                </label>
                                <label class="leslie-quick-control leslie-quick-toggle" for="leslie-fast-ui">
                                    <span>
                                        <strong>${copy.performance}</strong>
                                        <small>${copy.performanceHelp}</small>
                                    </span>
                                    <input id="leslie-fast-ui" type="checkbox" role="switch">
                                </label>
                            </div>
                            ${renderSettingsRow({ target: 'backgrounds-button', icon: 'fa-solid fa-panorama', title: copy.backgroundTitle, body: copy.backgroundBody })}
                            <div class="dreamland-asset-health"><strong>BA 游戏素材</strong><p class="dreamland-ba-status" data-ba-asset-status aria-live="polite">正在检测本机素材…</p><button type="button" class="leslie-settings-secondary-button" data-ba-asset-retry>重新检测</button></div>
                        </section>

                        <section class="leslie-settings-section leslie-demo-mode-card" data-leslie-demo-card>
                            <div class="leslie-demo-mode-heading">
                                <span class="leslie-demo-mode-icon fa-solid fa-display" aria-hidden="true"></span>
                                <div>
                                    <h3>${copy.demoTitle}</h3>
                                    <p>${copy.demoBody}</p>
                                </div>
                                <span class="leslie-demo-mode-status" data-leslie-demo-status>${copy.demoLoadingStatus}</span>
                            </div>
                            <div class="leslie-demo-mode-actions">
                                <small><i class="fa-solid fa-circle-info" aria-hidden="true"></i>${copy.demoStorageNote}</small>
                                <button type="button" class="leslie-settings-primary-button" data-leslie-demo-toggle disabled>
                                    <i class="fa-solid fa-arrow-right-arrow-left" aria-hidden="true"></i>
                                    <span>${copy.demoLoadingStatus}</span>
                                </button>
                            </div>
                        </section>

                        <section class="leslie-settings-section leslie-settings-essentials-section">
                            <div class="leslie-settings-section-heading">
                                <div>
                                    <h3>${copy.essentialsTitle}</h3>
                                    <p>${copy.essentialsBody}</p>
                                </div>
                            </div>
                            <div class="leslie-settings-list">
                                ${renderSettingsRow({ detail: 'privacy', icon: 'fa-solid fa-user-shield', title: copy.privacyModeTitle, body: copy.privacyModeBody })}
                                ${renderSettingsRow({ detail: 'model', icon: 'fa-solid fa-plug', title: copy.modelTitle, body: copy.modelBody, connectionStatus: true })}
                                ${renderSettingsRow({ detail: 'reply', icon: 'fa-solid fa-wand-magic-sparkles', title: copy.replyTitle, body: copy.replyBody })}
                                ${renderSettingsRow({ detail: 'voice', icon: 'fa-solid fa-volume-high', title: copy.voiceTitle, body: copy.voiceBody })}
                                ${renderSettingsRow({ detail: 'character', icon: 'fa-solid fa-address-card', title: copy.characterTitle, body: copy.characterBody })}
                                ${renderSettingsRow({ detail: 'persona', icon: 'fa-solid fa-face-smile', title: copy.personaTitle, body: copy.personaBody })}
                                ${renderSettingsRow({ detail: 'world', icon: 'fa-solid fa-book-atlas', title: copy.worldTitle, body: copy.worldBody })}
                            </div>
                        </section>
                    </main>

                    <aside id="leslie-advanced-vault" class="leslie-settings-section leslie-advanced-vault">
                        <div class="leslie-settings-section-heading">
                            <div>
                                <span class="leslie-settings-eyebrow">${copy.advancedTitle}</span>
                                <h3>${copy.advancedTitle}</h3>
                                <p>${copy.advancedBody}</p>
                            </div>
                            <button type="button" id="leslie-advanced-relock" class="leslie-settings-text-button" hidden>
                                <i class="fa-solid fa-lock" aria-hidden="true"></i>
                                <span>${copy.relock}</span>
                            </button>
                        </div>
                        <div class="leslie-advanced-preview" aria-hidden="true">
                            ${renderSettingsRow({ target: 'advanced-formatting-button', icon: 'fa-solid fa-code-branch', title: copy.promptTitle, body: copy.promptBody })}
                            ${renderSettingsRow({ target: 'extensions-settings-button', icon: 'fa-solid fa-cubes', title: copy.extensionsTitle, body: copy.extensionsBody })}
                            ${renderSettingsRow({ target: 'user-settings-button', icon: 'fa-solid fa-sliders', title: copy.fullSettingsTitle, body: copy.fullSettingsBody })}
                        </div>
                        <div class="leslie-advanced-lock">
                            <span class="leslie-advanced-lock-icon fa-solid fa-lock" aria-hidden="true"></span>
                            <h4>${copy.lockedTitle}</h4>
                            <p>${copy.lockedBody}</p>
                            <button type="button" id="leslie-advanced-unlock" class="leslie-settings-primary-button">
                                <i class="fa-solid fa-unlock-keyhole" aria-hidden="true"></i>
                                <span>${copy.unlock}</span>
                            </button>
                        </div>
                    </aside>
                </div>

                <p class="leslie-settings-footer-note">
                    <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                    <span>${copy.footer}</span>
                </p>
                </div>
                <section id="leslie-settings-detail" class="leslie-settings-detail" hidden></section>
                </div>
                </section>
            </div>
        </section>`;

    return overlay;
}

/**
 * Create the persistent marker shown while isolated demo storage is active.
 * @returns {HTMLElement} Demo mode banner.
 */
function createDemoModeBanner() {
    const copy = COPY[getCopyLocale()];
    const banner = document.createElement('aside');
    banner.id = 'leslie-demo-mode-banner';
    banner.className = 'leslie-demo-mode-banner';
    banner.hidden = true;
    banner.setAttribute('aria-label', copy.demoBannerTitle);
    banner.innerHTML = `
        <i class="fa-solid fa-display" aria-hidden="true"></i>
        <span><strong>${copy.demoBannerTitle}</strong><small>${copy.demoBannerBody}</small></span>
        <button type="button" data-leslie-demo-toggle disabled>
            <span>${copy.demoExit}</span>
            <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
        </button>`;
    return banner;
}

/** Render the current demo-mode state into every visible control. */
function updateDemoModeUi() {
    const copy = COPY[getCopyLocale()];
    const ready = typeof demoModeState === 'boolean';
    const active = demoModeState === true;
    const statusText = demoModeError
        || (!ready ? copy.demoLoadingStatus : active ? copy.demoActiveStatus : copy.demoNormalStatus);
    const buttonText = demoModePending
        ? copy.demoSwitching
        : active ? copy.demoExit : copy.demoEnter;

    document.documentElement.classList.toggle('leslie-demo-mode', active);
    document.body.classList.toggle('leslie-demo-mode', active);
    settingsOverlay?.querySelector('[data-leslie-demo-card]')?.classList.toggle('is-active', active);
    settingsOverlay?.querySelectorAll('[data-leslie-demo-status]').forEach((element) => {
        element.textContent = statusText;
        element.classList.toggle('is-error', Boolean(demoModeError));
    });
    document.querySelectorAll('[data-leslie-demo-toggle]').forEach((button) => {
        if (button instanceof HTMLButtonElement) {
            button.disabled = !ready || demoModePending;
            button.setAttribute('aria-busy', String(demoModePending));
            const label = button.querySelector('span');
            if (label) {
                label.textContent = button.closest('#leslie-demo-mode-banner') && !demoModePending
                    ? copy.demoExit
                    : buttonText;
            }
        }
    });
    if (demoModeBanner) {
        const footer = document.querySelector('#leslie-conversation-sidebar .leslie-sidebar-footer');
        if (footer && demoModeBanner.parentElement !== footer) footer.prepend(demoModeBanner);
        demoModeBanner.hidden = !active;
        demoModeBanner.querySelector('button').setAttribute('aria-label', copy.demoExit);
    }
}

/** Read the session-scoped storage selection from the server. */
async function refreshDemoModeState() {
    try {
        const response = await fetch('/api/leslie/demo-mode/status', {
            headers: getRequestHeaders({ omitContentType: true }),
        });
        if (!response.ok) {
            throw new Error(`Demo mode status returned ${response.status}.`);
        }
        const result = await response.json();
        demoModeState = result.enabled === true;
        demoModeError = '';
    } catch (error) {
        console.error('[Leslie Demo Mode] Could not read the current storage mode:', error);
        demoModeState = undefined;
        demoModeError = COPY[getCopyLocale()].demoError;
    }
    updateDemoModeUi();
}

/** Save pending settings, switch storage namespaces, and reload clean state. */
async function toggleDemoMode() {
    if (demoModePending || typeof demoModeState !== 'boolean') {
        return;
    }

    demoModePending = true;
    demoModeError = '';
    updateDemoModeUi();
    try {
        await Promise.resolve(saveSettingsDebounced.flush?.());
        if (!await flushUserSpacePreferences()) throw new Error('设置尚未保存，请稍后重试。');
        const response = await fetch('/api/leslie/demo-mode/switch', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ enabled: !demoModeState }),
        });
        if (!response.ok) {
            throw new Error(`Demo mode switch returned ${response.status}.`);
        }
        const result = await response.json();
        demoModeState = result.enabled === true;
        updateDemoModeUi();
        window.location.reload();
    } catch (error) {
        console.error('[Leslie Demo Mode] Could not switch storage spaces:', error);
        demoModePending = false;
        demoModeError = COPY[getCopyLocale()].demoError;
        updateDemoModeUi();
    }
}

/**
 * Close any unpinned SillyTavern drawer before opening the settings hub.
 */
function closeOpenDrawers() {
    document.querySelectorAll('.openIcon:not(.drawerPinnedOpen)').forEach((icon) => {
        icon.classList.remove('openIcon');
        icon.classList.add('closedIcon');
    });
    document.querySelectorAll('.openDrawer:not(.pinnedOpen)').forEach((drawer) => {
        drawer.classList.remove('openDrawer');
        drawer.classList.add('closedDrawer');
    });
}

/**
 * Reveal the simple settings hub and move keyboard focus into it.
 */
function openSettings() {
    window.clearTimeout(closeTimer);
    if (presentDreamlandPage('settings', settingsOverlay, () => {
        settingsOverlay.dataset.open = 'false';
        lockAdvancedSettings();
    })) {
        if (!settingsPageVisited) showSettingsHome();
        settingsPageVisited = true;
        settingsOverlay.dataset.open = 'true';
        closeOpenDrawers();
        return;
    }
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : settingsLauncher;
    closeOpenDrawers();
    showSettingsHome();
    settingsOverlay.classList.remove('leslie-settings-mobile-detail');
    settingsOverlay.hidden = false;
    document.documentElement.classList.add('leslie-settings-open');
    document.body.classList.add('leslie-settings-open');
    requestAnimationFrame(() => {
        settingsOverlay.dataset.open = 'true';
        settingsOverlay.querySelector('[data-leslie-settings-close]:not(.leslie-settings-backdrop)')?.focus();
    });
}

/**
 * Hide the settings hub and restore focus to its launcher.
 */
function closeSettings() {
    if (returnToDreamlandChat('settings')) return;
    settingsOverlay.dataset.open = 'false';
    settingsOverlay.classList.remove('leslie-settings-mobile-detail');
    document.documentElement.classList.remove('leslie-settings-open');
    document.body.classList.remove('leslie-settings-open');
    lockAdvancedSettings();
    closeTimer = window.setTimeout(() => {
        settingsOverlay.hidden = true;
        showSettingsHome();
        lastFocusedElement?.focus();
    }, 180);
}

/**
 * Open an original drawer so its established controls and save handlers remain
 * responsible for every setting change.
 * @param {string} targetId Existing drawer holder id.
 * @param {string} [afterOpenId] Optional original control to click after opening.
 */
function openOriginalDrawer(targetId, afterOpenId) {
    if (targetId === 'backgrounds-button' && usesDreamlandPages()) {
        void navigateDreamlandPage('background');
        return;
    }
    const target = document.getElementById(targetId);
    const drawer = target?.querySelector('.drawer-content');
    const toggle = target?.querySelector('.drawer-toggle');
    const icon = toggle?.querySelector('.drawer-icon');

    if (!target || !drawer || !toggle) {
        return;
    }

    closeSettings();
    window.setTimeout(() => {
        if (!drawer.classList.contains('openDrawer')) {
            (icon || toggle).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        if (afterOpenId) {
            window.setTimeout(() => document.getElementById(afterOpenId)?.click(), 80);
        }
    }, 210);
}

/**
 * Close Leslie settings before triggering an original standalone action.
 * @param {string} sourceId Existing SillyTavern control id.
 */
function clickOriginalControl(sourceId) {
    closeSettings();
    window.setTimeout(() => document.getElementById(sourceId)?.click(), 210);
}

/**
 * Make the guarded advanced rows available for the current settings visit.
 */
function unlockAdvancedSettings() {
    const vault = document.getElementById('leslie-advanced-vault');
    const preview = vault?.querySelector('.leslie-advanced-preview');
    const relockButton = document.getElementById('leslie-advanced-relock');
    vault?.classList.add('is-unlocked');
    preview?.setAttribute('aria-hidden', 'false');
    preview?.querySelectorAll('button').forEach((button) => button.removeAttribute('tabindex'));
    if (relockButton) {
        relockButton.hidden = false;
    }
    preview?.querySelector('button')?.focus();
}

/**
 * Return the advanced area to its default guarded state.
 */
function lockAdvancedSettings() {
    const vault = document.getElementById('leslie-advanced-vault');
    const preview = vault?.querySelector('.leslie-advanced-preview');
    const relockButton = document.getElementById('leslie-advanced-relock');
    vault?.classList.remove('is-unlocked');
    preview?.setAttribute('aria-hidden', 'true');
    preview?.querySelectorAll('button').forEach((button) => button.setAttribute('tabindex', '-1'));
    if (relockButton) {
        relockButton.hidden = true;
    }
}

/**
 * Keep a Leslie select synchronized with an existing SillyTavern select.
 * @param {string} sourceId Existing select id.
 * @param {string} mirrorId Leslie select id.
 */
function mirrorSelect(sourceId, mirrorId) {
    const source = document.getElementById(sourceId);
    const mirror = document.getElementById(mirrorId);
    if (!(source instanceof HTMLSelectElement) || !(mirror instanceof HTMLSelectElement)) {
        return;
    }

    const syncFromSource = () => {
        const optionsChanged = source.options.length !== mirror.options.length
            || Array.from(source.options).some((option, index) => mirror.options[index]?.value !== option.value || mirror.options[index]?.text !== option.text);
        if (optionsChanged) {
            mirror.replaceChildren(...Array.from(source.options).map((option) => option.cloneNode(true)));
        }
        mirror.value = source.value;
        mirror.disabled = source.disabled;
    };

    mirror.addEventListener('change', () => {
        source.value = mirror.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    source.addEventListener('change', syncFromSource);
    new MutationObserver(syncFromSource).observe(source, { childList: true, subtree: true, attributes: true });
    syncFromSource();
}

/**
 * Keep a Leslie switch synchronized with an existing SillyTavern checkbox.
 * @param {string} sourceId Existing checkbox id.
 * @param {string} mirrorId Leslie checkbox id.
 * @param {'change' | 'input'} sourceEvent Event used by the original handler.
 */
function mirrorCheckbox(sourceId, mirrorId, sourceEvent) {
    const source = document.getElementById(sourceId);
    const mirror = document.getElementById(mirrorId);
    if (!(source instanceof HTMLInputElement) || !(mirror instanceof HTMLInputElement)) {
        return;
    }

    const syncFromSource = () => {
        mirror.checked = source.checked;
        mirror.disabled = source.disabled;
    };

    mirror.addEventListener('change', () => {
        source.checked = mirror.checked;
        source.dispatchEvent(new Event(sourceEvent, { bubbles: true }));
    });
    source.addEventListener('change', syncFromSource);
    source.addEventListener('input', syncFromSource);
    new MutationObserver(syncFromSource).observe(source, { attributes: true, attributeFilter: ['checked', 'disabled'] });
    syncFromSource();
}

/**
 * Remove event listeners and observers that belong to the current detail page.
 */
function clearDetailBindings() {
    detailBindingController?.abort();
    detailBindingController = undefined;
    detailObservers.forEach((observer) => observer.disconnect());
    detailObservers = [];
}

/**
 * Observe a source control for changes that should refresh a detail mirror.
 * @param {Element} source Existing SillyTavern control.
 * @param {() => void} update Mirror update callback.
 * @param {string[]} [attributeFilter] Attributes to observe.
 */
function observeDetailSource(source, update, attributeFilter = ['disabled']) {
    const observer = new MutationObserver(update);
    observer.observe(source, { childList: true, subtree: true, attributes: true, attributeFilter });
    detailObservers.push(observer);
}

/**
 * Mirror an original text input or textarea for the lifetime of a detail page.
 * @param {string} sourceId Existing control id.
 * @param {string} mirrorId Leslie control id.
 * @param {'change' | 'input'} sourceEvent Event expected by the original control.
 * @param {object} [options] Binding options.
 * @param {boolean} [options.secret] Do not copy an existing secret into Leslie's input.
 */
function bindDetailInput(sourceId, mirrorId, sourceEvent, { secret = false } = {}) {
    const source = document.getElementById(sourceId);
    const mirror = document.getElementById(mirrorId);
    const validSource = source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement;
    const validMirror = mirror instanceof HTMLInputElement || mirror instanceof HTMLTextAreaElement;
    if (!validSource || !validMirror || !detailBindingController) {
        return;
    }

    const syncFromSource = () => {
        if (!secret) {
            mirror.value = source.value;
        } else {
            const hint = mirror.closest('.leslie-detail-field')?.querySelector('.leslie-detail-field-copy small');
            if (hint) {
                const saved = Array.isArray(secret_state[sourceId]) && secret_state[sourceId].length > 0;
                const copy = COPY[getCopyLocale()];
                hint.textContent = saved ? copy.apiKeySavedHelp : copy.apiKeyHelp;
            }
        }
        mirror.disabled = source.disabled;
        ['min', 'max', 'step', 'placeholder'].forEach((attribute) => {
            const value = source.getAttribute(attribute);
            if (value !== null && (!secret || attribute === 'placeholder')) {
                mirror.setAttribute(attribute, value);
            }
        });
    };
    mirror.addEventListener(sourceEvent, () => {
        source.value = mirror.value;
        source.dispatchEvent(new Event(sourceEvent, { bubbles: true }));
    }, { signal: detailBindingController.signal });
    if (secret) {
        mirror.addEventListener('change', () => { void saveActiveOnlineSecret(); }, { signal: detailBindingController.signal });
    }
    source.addEventListener('input', syncFromSource, { signal: detailBindingController.signal });
    source.addEventListener('change', syncFromSource, { signal: detailBindingController.signal });
    observeDetailSource(source, syncFromSource, ['disabled', 'min', 'max', 'step', 'placeholder']);
    syncFromSource();
}

/**
 * Mirror an original select for the lifetime of a detail page.
 * @param {string} sourceId Existing select id.
 * @param {string} mirrorId Leslie select id.
 * @param {'change' | 'input'} sourceEvent Event expected by the original select.
 */
function bindDetailSelect(sourceId, mirrorId, sourceEvent = 'change') {
    const source = document.getElementById(sourceId);
    const mirror = document.getElementById(mirrorId);
    if (!(source instanceof HTMLSelectElement) || !(mirror instanceof HTMLSelectElement) || !detailBindingController) {
        return;
    }

    const syncFromSource = () => {
        const optionsChanged = source.options.length !== mirror.options.length
            || Array.from(source.options).some((option, index) => mirror.options[index]?.value !== option.value || mirror.options[index]?.text !== option.text);
        if (optionsChanged) {
            mirror.replaceChildren(...Array.from(source.options).map((option) => option.cloneNode(true)));
        }
        mirror.multiple = source.multiple;
        Array.from(mirror.options).forEach((option, index) => {
            option.selected = source.options[index]?.selected ?? false;
            option.disabled = source.options[index]?.disabled ?? false;
        });
        mirror.disabled = source.disabled;
    };
    mirror.addEventListener(sourceEvent, () => {
        Array.from(source.options).forEach((option, index) => {
            option.selected = mirror.options[index]?.selected ?? false;
        });
        source.dispatchEvent(new Event(sourceEvent, { bubbles: true }));
    }, { signal: detailBindingController.signal });
    source.addEventListener('change', syncFromSource, { signal: detailBindingController.signal });
    source.addEventListener('input', syncFromSource, { signal: detailBindingController.signal });
    observeDetailSource(source, syncFromSource, ['disabled', 'selected', 'value']);
    syncFromSource();
}

/**
 * Mirror an original checkbox for the lifetime of a detail page.
 * @param {string} sourceId Existing checkbox id.
 * @param {string} mirrorId Leslie checkbox id.
 * @param {'change' | 'input'} sourceEvent Event expected by the original checkbox.
 */
function bindDetailCheckbox(sourceId, mirrorId, sourceEvent = 'input') {
    const source = document.getElementById(sourceId);
    const mirror = document.getElementById(mirrorId);
    if (!(source instanceof HTMLInputElement) || !(mirror instanceof HTMLInputElement) || !detailBindingController) {
        return;
    }

    const syncFromSource = () => {
        mirror.checked = source.checked;
        mirror.disabled = source.disabled;
    };
    mirror.addEventListener('change', () => {
        source.checked = mirror.checked;
        source.dispatchEvent(new Event(sourceEvent, { bubbles: true }));
    }, { signal: detailBindingController.signal });
    source.addEventListener('change', syncFromSource, { signal: detailBindingController.signal });
    source.addEventListener('input', syncFromSource, { signal: detailBindingController.signal });
    observeDetailSource(source, syncFromSource, ['checked', 'disabled']);
    syncFromSource();
}

/**
 * Mirror SillyTavern's existing reasoning switch and remove an explicit effort
 * request when the user asks for direct replies.
 */
function bindThinkingMode() {
    bindDetailCheckbox('openai_show_thoughts', 'leslie-model-thinking-mode', 'input');
    const mirror = document.getElementById('leslie-model-thinking-mode');
    const effort = document.getElementById('openai_reasoning_effort');
    if (!(mirror instanceof HTMLInputElement) || !(effort instanceof HTMLSelectElement) || !detailBindingController) {
        return;
    }
    mirror.addEventListener('change', () => {
        if (!mirror.checked && effort.value !== 'auto') {
            effort.value = 'auto';
            effort.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, { signal: detailBindingController.signal });
}

/**
 * Mirror an original numeric control to a slider and a number input.
 * @param {string} sourceId Existing numeric control id.
 * @param {string} mirrorId Leslie range id.
 */
function bindDetailRange(sourceId, mirrorId) {
    const source = document.getElementById(sourceId);
    const range = document.getElementById(mirrorId);
    const number = document.getElementById(`${mirrorId}-number`);
    if (!(source instanceof HTMLInputElement) || !(range instanceof HTMLInputElement) || !(number instanceof HTMLInputElement) || !detailBindingController) {
        return;
    }

    const syncFromSource = () => {
        ['min', 'max', 'step'].forEach((attribute) => {
            const value = source.getAttribute(attribute);
            if (value !== null) {
                range.setAttribute(attribute, value);
                number.setAttribute(attribute, value);
            }
        });
        range.value = source.value;
        number.value = source.value;
        range.disabled = source.disabled;
        number.disabled = source.disabled;
    };
    const syncToSource = (value) => {
        source.value = value;
        source.dispatchEvent(new Event('input', { bubbles: true }));
        syncFromSource();
    };
    range.addEventListener('input', () => syncToSource(range.value), { signal: detailBindingController.signal });
    number.addEventListener('input', () => syncToSource(number.value), { signal: detailBindingController.signal });
    source.addEventListener('input', syncFromSource, { signal: detailBindingController.signal });
    source.addEventListener('change', syncFromSource, { signal: detailBindingController.signal });
    observeDetailSource(source, syncFromSource, ['disabled', 'min', 'max', 'step']);
    syncFromSource();
}

/**
 * Update reply-style selection and feedback.
 * @param {string} [message] Optional feedback message.
 */
function updateReplyPresetState(message) {
    const copy = COPY[getCopyLocale()];
    const activePreset = getActiveReplyStylePreset();
    settingsOverlay?.querySelectorAll('[data-leslie-reply-style]').forEach((button) => {
        const isActive = button.getAttribute('data-leslie-reply-style') === activePreset;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
    const feedback = settingsOverlay?.querySelector('[data-leslie-preset-feedback]');
    if (feedback) {
        feedback.textContent = message
            || `${copy.styleApplied}“${copy[REPLY_STYLE_PRESETS[activePreset].titleKey]}”${copy.styleAppliedTail}`;
    }
}

/**
 * Persist one semantic reply style without changing generation parameters.
 * @param {string} presetId Reply preset id.
 */
function applyReplyStylePreset(presetId) {
    const preset = REPLY_STYLE_PRESETS[presetId];
    if (!preset) {
        return;
    }
    const settings = getReplyStyleSettings();
    const updated = { ...settings, style: presetId };
    extension_settings[LESLIE_REPLY_STYLE_SETTINGS_KEY] = updated;
    setLeslieReplyStyleRuntimeSettings(updated);
    saveSettingsDebounced();
    const copy = COPY[getCopyLocale()];
    updateReplyPresetState(`${copy.styleApplied}“${copy[preset.titleKey]}”${copy.styleAppliedTail}`);
}

/**
 * Keep a summary label synchronized with existing SillyTavern text.
 * @param {Element | null} source Existing text element.
 * @param {string} targetSelector Leslie summary selector.
 * @param {string} fallback Fallback label.
 */
function bindDetailText(source, targetSelector, fallback) {
    const target = settingsOverlay.querySelector(targetSelector);
    if (!source || !target) {
        return;
    }
    const update = () => {
        target.textContent = source.textContent?.trim() || fallback;
    };
    const observer = new MutationObserver(update);
    observer.observe(source, { childList: true, subtree: true, characterData: true });
    detailObservers.push(observer);
    update();
}

/**
 * Connect a rendered detail page to SillyTavern's original controls.
 * @param {string} detailId Detail page id.
 */
function bindDetailPage(detailId) {
    clearDetailBindings();
    detailBindingController = new AbortController();
    if (detailId === 'privacy') {
        syncLesliePrivacyModeControls(document.getElementById('leslie-settings-detail'));
    } else if (detailId === 'spaces') {
        if (!userSpacesState) {
            void refreshUserSpacesState();
        }
    } else if (detailId === 'model' && serverModels.mode !== 'desktop') {
        bindDetailSelect('server_model_select', 'leslie-server-model-select');
        const status = document.querySelector('[data-server-model-status]');
        if (status) status.textContent = serverModels.loading ? '正在加载服务器模型…'
            : serverModels.error || (serverModels.models.length ? '选择将随你的账号保存。' : '管理员尚未配置可用模型，请联系管理员。');
        document.querySelector('[data-server-model-refresh]')?.addEventListener('click', () => {
            void refreshServerModels({ headers: getRequestHeaders() });
        }, { signal: detailBindingController.signal });
    } else if (detailId === 'model') {
        const service = MODEL_SERVICES[getActiveModelService()];
        if (service?.kind === activeModelKind) {
            service.fields.forEach(([sourceId, mirrorId, , , kind]) => {
                if (kind === 'select') {
                    bindDetailSelect(sourceId, mirrorId);
                } else {
                    bindDetailInput(sourceId, mirrorId, 'input', { secret: kind === 'password' });
                }
            });
        }
        bindDetailCheckbox('auto-connect-checkbox', 'leslie-model-auto-connect', 'input');
        bindThinkingMode();
    } else if (detailId === 'reply') {
        const ids = getReplyControlIds();
        bindDetailRange(ids.temperature, 'leslie-reply-creativity');
        bindDetailCheckbox(ids.streaming, 'leslie-reply-streaming', 'input');
        updateReplyPresetState();
    } else if (detailId === 'character') {
        const copy = COPY[getCopyLocale()];
        const characterName = document.querySelector('#rm_button_selected_ch h2') || document.getElementById('character_name_pole');
        bindDetailText(characterName, '[data-leslie-character-name]', copy.noCharacter);
    } else if (detailId === 'persona') {
        const copy = COPY[getCopyLocale()];
        bindDetailInput('persona_description', 'leslie-persona-description', 'input');
        bindDetailSelect('persona_description_position', 'leslie-persona-position', 'input');
        bindDetailCheckbox('persona_auto_lock', 'leslie-persona-lock', 'input');
        bindDetailText(document.getElementById('your_name'), '[data-leslie-persona-name]', copy.noPersona);
    } else if (detailId === 'world') {
        bindDetailSelect('world_info', 'leslie-world-info', 'change');
        bindDetailCheckbox('world_info_recursive', 'leslie-world-recursive', 'input');
    }
}

/**
 * Show one Leslie detail page without opening a raw SillyTavern drawer.
 * @param {string} detailId Detail page id.
 */
function showDetail(detailId) {
    if (detailId === 'spaces' && serverModels.mode !== 'desktop') return;
    const renderer = DETAIL_RENDERERS[detailId];
    const home = document.getElementById('leslie-settings-home');
    const detail = document.getElementById('leslie-settings-detail');
    const scroll = settingsOverlay.querySelector('.leslie-settings-scroll');
    if (!renderer || !home || !detail) {
        return;
    }
    if (detailId === 'model' && activeDetail !== 'model') {
        activeModelKind = MODEL_SERVICES[getActiveModelService()]?.kind || 'online';
    }
    activeDetail = detailId;
    updateSettingsNavigation(detailId);
    home.hidden = true;
    detail.innerHTML = renderer();
    detail.hidden = false;
    bindDetailPage(detailId);
    updateConnectionStatus();
    scroll?.scrollTo({ top: 0 });
    revealSettingsContent();
    requestAnimationFrame(() => {
        if (window.matchMedia('(max-width: 700px)').matches) {
            settingsOverlay.querySelector('[data-leslie-settings-nav-back]')?.focus();
        }
    });
}

/** Show the settings detail pane as a separate mobile page. */
function revealSettingsContent() {
    if (window.matchMedia('(max-width: 700px)').matches) {
        settingsOverlay?.classList.add('leslie-settings-mobile-detail');
    }
}

/** Return to the settings category list on narrow screens. */
function showSettingsNavigation() {
    settingsOverlay?.classList.remove('leslie-settings-mobile-detail');
    requestAnimationFrame(() => settingsOverlay?.querySelector('.leslie-settings-nav-item.active')?.focus());
}

/**
 * Keep the persistent category rail synchronized with the visible page.
 * @param {string} pageId Navigation page id.
 */
function updateSettingsNavigation(pageId) {
    let activeButton;
    settingsOverlay?.querySelectorAll('[data-leslie-settings-page]').forEach((button) => {
        const active = button.dataset.leslieSettingsPage === pageId;
        button.classList.toggle('active', active);
        if (active) {
            activeButton = button;
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
    });
    const contentTitle = settingsOverlay?.querySelector('#leslie-settings-content-title');
    const activeTitle = activeButton?.querySelector('strong')?.textContent?.trim();
    if (contentTitle && activeTitle) {
        contentTitle.textContent = activeTitle;
    }
}

/**
 * Return from a detail page to the Leslie settings home.
 */
function showSettingsHome(pageId = 'overview') {
    const home = document.getElementById('leslie-settings-home');
    const detail = document.getElementById('leslie-settings-detail');
    const scroll = settingsOverlay?.querySelector('.leslie-settings-scroll');
    clearDetailBindings();
    activeDetail = undefined;
    updateSettingsNavigation(pageId);
    if (detail) {
        detail.hidden = true;
        detail.replaceChildren();
    }
    if (home) {
        home.hidden = false;
    }
    scroll?.scrollTo({ top: 0 });
}

/**
 * Save a newly entered online key before leaving its provider. Stored keys
 * remain server-side; the mirror only reports their presence.
 * @returns {Promise<boolean>} Whether it is safe to leave this provider.
 */
let activeSecretSavePromise;

async function saveActiveOnlineSecret() {
    const service = MODEL_SERVICES[getActiveModelService()];
    if (service?.kind !== 'online' || !service.secretKey) {
        return true;
    }
    const mirror = document.getElementById('leslie-model-key');
    if (!(mirror instanceof HTMLInputElement)) {
        return true;
    }
    while (true) {
        if (activeSecretSavePromise) {
            if (!(await activeSecretSavePromise)) {
                return false;
            }
            continue;
        }
        const value = mirror.value.trim();
        if (!value) {
            return true;
        }
        const save = (async () => {
            const savedId = await writeSecret(service.secretKey, value);
            if (!savedId) {
                const copy = COPY[getCopyLocale()];
                toastr.error(copy.apiKeySaveFailed, copy.modelTitle);
                return false;
            }
            if (mirror.value.trim() === value) {
                mirror.value = '';
            }
            return true;
        })();
        activeSecretSavePromise = save.finally(() => { activeSecretSavePromise = undefined; });
        if (!(await activeSecretSavePromise)) {
            return false;
        }
    }
}

/**
 * Switch SillyTavern to a common model service chosen by the user.
 * @param {string} serviceId Leslie service id.
 * @param {(() => void) | undefined} afterSelect Optional callback after the
 * provider's original controls have been selected.
 * @returns {Promise<boolean>} Whether the selection completed.
 */
async function selectModelService(serviceId, afterSelect) {
    const service = MODEL_SERVICES[serviceId];
    const mainApi = document.getElementById('main_api');
    if (!service || !(mainApi instanceof HTMLSelectElement)) {
        return false;
    }
    if (!(await saveActiveOnlineSecret())) {
        return false;
    }
    activeModelServiceId = serviceId;
    activeModelKind = service.kind;
    mainApi.value = service.mainApi;
    mainApi.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise((resolve, reject) => window.setTimeout(() => {
        try {
            const secondary = document.getElementById(service.secondaryId);
            if (secondary instanceof HTMLSelectElement) {
                secondary.value = service.secondaryValue;
                secondary.dispatchEvent(new Event('change', { bubbles: true }));
            }
            afterSelect?.();
            showDetail('model');
            resolve(true);
        } catch (error) {
            reject(error);
        }
    }, 60));
}


/**
 * Trigger the original connect action for the selected service.
 */
async function connectSelectedModelService() {
    const serviceId = getActiveModelService();
    const service = MODEL_SERVICES[serviceId];
    if (isDreamLandAndroidClient() && service?.kind === 'local') {
        toastr.info('手机端暂不支持本地大模型，请使用在线模型接口。', COPY[getCopyLocale()].modelTitle);
        return;
    }
    if (service?.kind === 'local' && !isLocalModelLoadingEnabled()) {
        const copy = COPY[getCopyLocale()];
        toastr.warning(copy.localModelLoadingDisabled, copy.modelTitle);
        return;
    }
    const connectButton = document.getElementById(service?.connectId);
    if (!(service && connectButton)) {
        toastr.error('请先选择一个有效的模型连接方式。', '模型连接');
        stopStatusLoading();
        updateConnectionStatus();
        return;
    }
    if (!(await saveActiveOnlineSecret())) {
        return;
    }

    // Re-apply the visible mirror values immediately before the original
    // handler runs. This protects the endpoint/model from a concurrent
    // settings refresh that replaced the hidden SillyTavern controls.
    service.fields.forEach(([sourceId, mirrorId, , , kind]) => {
        const source = document.getElementById(sourceId);
        const mirror = document.getElementById(mirrorId);
        if (!(source instanceof HTMLInputElement || source instanceof HTMLSelectElement) || !(mirror instanceof HTMLInputElement || mirror instanceof HTMLSelectElement)) {
            return;
        }
        if (kind === 'password' && !mirror.value) {
            return;
        }
        source.value = mirror.value;
        source.dispatchEvent(new Event(kind === 'select' ? 'change' : 'input', { bubbles: true }));
    });

    connectButton.click();
    const secretMirror = document.getElementById('leslie-model-key');
    if (secretMirror instanceof HTMLInputElement) {
        secretMirror.value = '';
    }
}

/**
 * Keep the application-side connection state honest when local usage is
 * disabled. The external runtime is intentionally not managed here: users
 * may run KoboldCpp or llama.cpp independently of DreamLand.
 */
function disconnectLocalModelInApp() {
    const service = MODEL_SERVICES[getActiveModelService()];
    if (service?.kind === 'local') {
        setOnlineStatus('no_connection');
    }
}

/**
 * Apply the local-model gate to the visible quick-setup controls.
 * @param {HTMLInputElement} toggle Leslie local-model switch.
 */
function handleLocalModelLoadingToggle(toggle) {
    const enabled = setLocalModelLoadingEnabled(toggle.checked);
    if (!enabled) {
        disconnectLocalModelInApp();
        stopStatusLoading();
    }
    const copy = COPY[getCopyLocale()];
    const status = settingsOverlay?.querySelector('[data-leslie-local-model-loading-status]');
    if (status) {
        status.textContent = enabled ? copy.localModelLoadingEnabledStatus : copy.localModelLoadingDisabledStatus;
    }
}

/**
 * Update every visible Leslie connection badge from SillyTavern's API icon.
 */
function updateConnectionStatus() {
    const connectionState = getLeslieConnectionState();
    const copy = COPY[getCopyLocale()];
    settingsOverlay?.querySelectorAll('[data-leslie-connection-status]').forEach((status) => {
        status.textContent = getConnectionStatusText(connectionState, copy);
        status.classList.toggle('is-checking', connectionState.checking);
        status.classList.toggle('is-connected', connectionState.connected);
        status.classList.toggle('is-configured', connectionState.configured && !connectionState.connected);
    });
    const modelStatus = settingsOverlay?.querySelector('[data-leslie-model-status]');
    if (modelStatus) {
        modelStatus.className = `leslie-model-status is-${connectionState.state}`;
        const text = modelStatus.querySelector('strong');
        if (text) {
            text.textContent = getConnectionStatusText(connectionState, copy);
        }
    }
    const connectButton = settingsOverlay?.querySelector('[data-leslie-model-connect]');
    if (connectButton instanceof HTMLButtonElement) {
        connectButton.disabled = connectionState.checking;
        connectButton.setAttribute('aria-busy', String(connectionState.checking));
    }
}

/**
 * Reflect the real SillyTavern API connection icon in the simple settings row.
 */
function bindConnectionStatus() {
    const source = document.getElementById('API-status-top');
    if (source) {
        new MutationObserver(updateConnectionStatus).observe(source, { attributes: true, attributeFilter: ['class'] });
    }
    const apiSettings = document.getElementById('openai_api')?.parentElement;
    if (apiSettings) {
        new MutationObserver(updateConnectionStatus).observe(apiSettings, { attributes: true, attributeFilter: ['placeholder'], subtree: true });
    }
    document.querySelectorAll('.api_loading').forEach((loader) => {
        new MutationObserver(updateConnectionStatus).observe(loader, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    });
    [
        event_types.APP_READY,
        event_types.SETTINGS_LOADED_AFTER,
        event_types.ONLINE_STATUS_CHANGED,
        event_types.MAIN_API_CHANGED,
        event_types.CONNECTION_PROFILE_LOADED,
    ]
        .filter(Boolean)
        .forEach(eventName => eventSource.on(eventName, updateConnectionStatus));
    updateConnectionStatus();
}

/**
 * Keep keyboard focus inside the full-window settings page while it is visible.
 * @param {KeyboardEvent} event Keyboard event.
 */
function handleSettingsKeydown(event) {
    if (settingsOverlay.hidden) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        if (settingsOverlay.classList.contains('leslie-settings-mobile-detail')) {
            showSettingsNavigation();
        } else {
            closeSettings();
        }
        return;
    }
    if (event.key !== 'Tab') {
        return;
    }
    if (usesDreamlandPages()) return;

    const focusable = Array.from(settingsOverlay.querySelectorAll('button:not([hidden]):not([disabled]), select:not([disabled]), input:not([disabled])'))
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
        return;
    }
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

/**
 * Add the hub after SillyTavern has created its standard page structure.
 */
function initLeslieSettings() {
    if (!document.body.classList.contains('leslie-modern') || document.getElementById('leslie-settings-launcher')) {
        return;
    }

    const copy = COPY[getCopyLocale()];
    const topSettings = document.getElementById('top-settings-holder');
    const characterDrawer = document.getElementById('rightNavHolder');
    if (!topSettings || !characterDrawer) {
        return;
    }

    SECONDARY_DRAWERS.forEach((id) => document.getElementById(id)?.classList.add('leslie-secondary-drawer'));

    settingsLauncher = document.createElement('button');
    settingsLauncher.id = 'leslie-settings-launcher';
    settingsLauncher.className = 'leslie-settings-launcher';
    settingsLauncher.type = 'button';
    settingsLauncher.title = copy.launcher;
    settingsLauncher.setAttribute('aria-label', copy.launcher);
    settingsLauncher.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i><span></span>';
    settingsLauncher.querySelector('span').textContent = copy.launcher;
    topSettings.insertBefore(settingsLauncher, characterDrawer.parentElement === topSettings ? characterDrawer : null);

    document.addEventListener('dreamland:server-models', () => {
        const spaces = settingsOverlay?.querySelector('[data-leslie-settings-page="spaces"]');
        if (spaces) spaces.style.display = serverModels.mode === 'desktop' ? '' : 'none';
        if (serverModels.mode === 'server') spaces?.remove();
        if (activeDetail === 'model') showDetail('model');
        updateConnectionStatus();
        if (serverModels.mode === 'server') {
            const saveLabel = settingsOverlay?.querySelector('.leslie-settings-content-save span');
            if (saveLabel) saveLabel.textContent = '设置随账号保存';
            settingsOverlay?.querySelectorAll('[data-leslie-settings-page="model"] strong, [data-leslie-detail="model"] .leslie-settings-row-title').forEach(element => { element.textContent = '模型选择'; });
            settingsOverlay?.querySelectorAll('[data-leslie-settings-page="model"] small, [data-leslie-detail="model"] .leslie-settings-row-description').forEach(element => { element.textContent = '选择管理员提供的可用模型'; });
        }
    });
    settingsOverlay = createSettingsOverlay();
    const spaces = settingsOverlay.querySelector('[data-leslie-settings-page="spaces"]');
    if (spaces) spaces.style.display = serverModels.mode === 'desktop' ? '' : 'none';
    if (serverModels.mode === 'server') spaces?.remove();
    document.body.append(settingsOverlay);
    registerDreamlandPage('settings', openSettings);
    document.dispatchEvent(new CustomEvent('dreamland:appearance-ready'));
    demoModeBanner = createDemoModeBanner();
    document.body.append(demoModeBanner);
    demoModeBanner.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-leslie-demo-toggle]')) {
            toggleDemoMode();
        }
    });
    lockAdvancedSettings();

    settingsLauncher.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSettings();
    });
    document.addEventListener('leslie:open-model-settings', () => {
        openSettings();
        showDetail('model');
    });
    settingsOverlay.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-leslie-settings-about]')) {
            event.preventDefault();
            navigateDreamlandPage('about');
            return;
        }
        const spaceAction = target?.closest('[data-leslie-space-activate], [data-leslie-space-create], [data-leslie-space-switch]');
        if (spaceAction) {
            event.preventDefault();
            void changeUserSpace(spaceAction.hasAttribute('data-leslie-space-activate') ? 'activate'
                : spaceAction.hasAttribute('data-leslie-space-create') ? 'create' : 'switch');
            return;
        }
        if (target?.closest('[data-leslie-settings-home]')) {
            event.preventDefault();
            event.stopPropagation();
            showSettingsHome();
            revealSettingsContent();
            return;
        }
        if (target?.closest('[data-leslie-settings-anchor="advanced"]')) {
            event.preventDefault();
            event.stopPropagation();
            showSettingsHome('advanced');
            revealSettingsContent();
            requestAnimationFrame(() => document.getElementById('leslie-advanced-vault')?.scrollIntoView({ block: 'start' }));
            return;
        }
        if (target?.closest('[data-leslie-settings-nav-back]')) {
            event.preventDefault();
            event.stopPropagation();
            showSettingsNavigation();
            return;
        }
        const detailButton = target?.closest('[data-leslie-detail]');
        if (detailButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            showDetail(detailButton.dataset.leslieDetail);
            return;
        }
        if (target?.closest('[data-leslie-demo-toggle]')) {
            event.preventDefault();
            event.stopPropagation();
            toggleDemoMode();
            return;
        }
        if (target?.closest('[data-leslie-detail-back]')) {
            event.preventDefault();
            event.stopPropagation();
            const previousDetail = activeDetail;
            showSettingsHome();
            settingsOverlay.querySelector(`[data-leslie-detail="${previousDetail}"]`)?.focus();
            return;
        }
        const replyStyleButton = target?.closest('[data-leslie-reply-style]');
        if (replyStyleButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            applyReplyStylePreset(replyStyleButton.dataset.leslieReplyStyle);
            return;
        }
        const apiKindButton = target?.closest('[data-leslie-api-kind]');
        if (apiKindButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            if (!(await saveActiveOnlineSecret())) {
                return;
            }
            activeModelKind = apiKindButton.dataset.leslieApiKind;
            showDetail('model');
            return;
        }
        const serviceButton = target?.closest('[data-leslie-service]');
        if (serviceButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            void selectModelService(serviceButton.dataset.leslieService).catch(() => {
                toastr.error(COPY[getCopyLocale()].apiKeySaveFailed, COPY[getCopyLocale()].modelTitle);
            });
            return;
        }
        if (target?.closest('[data-leslie-model-connect]')) {
            event.preventDefault();
            event.stopPropagation();
            void connectSelectedModelService();
            return;
        }
        if (target?.closest('[data-leslie-open-character-list]')) {
            event.preventDefault();
            event.stopPropagation();
            openOriginalDrawer('rightNavHolder', 'rm_button_characters');
            return;
        }
        const sourceButton = target?.closest('[data-leslie-source-click]');
        if (sourceButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            clickOriginalControl(sourceButton.dataset.leslieSourceClick);
            return;
        }
        const drawerButton = target?.closest('[data-leslie-drawer-target]');
        if (drawerButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            openOriginalDrawer(drawerButton.dataset.leslieDrawerTarget);
            return;
        }
        if (target?.closest('[data-leslie-settings-close]')) {
            event.preventDefault();
            event.stopPropagation();
            closeSettings();
        }
    });
    settingsOverlay.addEventListener('change', (event) => {
        const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
        if (target?.matches('[data-leslie-privacy-master]')) {
            setLesliePrivacyModeEnabled(target.checked);
        } else if (target?.matches('[data-leslie-privacy-block]')) {
            setLesliePrivacyBlockMasked(target.dataset.lesliePrivacyBlock, target.checked);
        } else if (target?.matches('[data-leslie-local-model-toggle]')) {
            handleLocalModelLoadingToggle(target);
        }
    });
    settingsOverlay.addEventListener('toggle', (event) => {
        if (event.target instanceof HTMLDetailsElement && event.target.matches('.leslie-local-advanced')) {
            localAdvancedOpen = event.target.open;
        }
    }, true);
    document.getElementById('leslie-advanced-unlock')?.addEventListener('click', unlockAdvancedSettings);
    document.getElementById('leslie-advanced-relock')?.addEventListener('click', () => {
        lockAdvancedSettings();
        document.getElementById('leslie-advanced-unlock')?.focus();
    });
    document.addEventListener('keydown', handleSettingsKeydown);

    mirrorSelect('ui_language_select', 'leslie-language-select');
    mirrorCheckbox('reduced_motion', 'leslie-reduced-motion', 'input');
    mirrorCheckbox('fast_ui_mode', 'leslie-fast-ui', 'change');
    bindConnectionStatus();
    refreshDemoModeState();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLeslieSettings, { once: true });
} else {
    initLeslieSettings();
}
