import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../script.js';
import { extension_settings, getContext } from './extensions.js';
import { SECRET_KEYS, secret_state } from './secrets.js';
import {
    getVolcengineResourceId,
    loadVolcengineVoices,
    normalizeVolcengineVoiceId,
    VOLCENGINE_BUILTIN_VOICES,
} from './leslie-volcengine-voices.js';

const PROVIDER_NAME = 'Volcengine';
const DEFAULT_VOICE_MARKER = '[Default Voice]';
const OFFICIAL_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

const COPY = {
    zh: {
        switchTitle: '角色语音',
        switchHelp: '开启后使用火山引擎为角色回复生成语音。',
        autoTitle: '回复后自动朗读',
        autoHelp: '文字完成后很快开始，续写、重试或切换聊天会取消旧任务。',
        credentials: '火山引擎凭证',
        credentialHelp: '密钥保存在本机 SillyTavern 的密钥库中，不会写进聊天记录。',
        appId: '设置 App ID',
        accessKey: '设置 Access Key',
        resourceId: 'Resource ID',
        resourceHelp: '官方音色会自动使用正确的 Resource ID；这里作为声音复刻等自定义音色的备用值。',
        speed: '语速',
        speedHelp: '0 是原速；负数更慢，正数更快。',
        mode: '朗读内容',
        fullReply: '完整回复',
        dialogueOnly: '只读引号内对话',
        outsideParenthesesOnly: '只读括号外内容（（）与 ()）',
        language: '回复语言',
        languageHelp: '推荐自动识别：纯英文按英文朗读，中英混合自动使用跨语种模式。',
        languageAuto: '自动识别（推荐）',
        languageMixed: '中英混合 / 跨语种',
        languageChinese: '中文',
        languageEnglish: '英文',
        languageJapanese: '日文',
        voiceMap: '角色音色',
        voiceMapHelp: '已接入火山引擎公开的语音合成 1.0 与 2.0 音色；当前会话的每个角色可单独选择。',
        voiceSearch: '搜索音色名称、voice_type、语种或分类',
        catalogLoading: '正在读取火山引擎官方音色目录……',
        catalogReady: count => `已载入 ${count} 个可用音色。`,
        catalogFallback: '官方目录暂时不可用，当前显示离线备用音色；仍可手动导入 voice_type。',
        defaultVoice: '默认音色',
        disabledVoice: '不朗读这个角色',
        customVoice: '添加自定义音色 ID',
        customVoiceHelp: '可粘贴纯 ID、JSON，或 voice_type=xxx；添加后会立即设为默认音色。',
        add: '添加',
        preview: '试听',
        previewText: '你好，我是你的故事伙伴。很高兴用声音和你见面。',
        noCharacter: '当前还没有选中角色；可先设置默认音色。',
        ready: '配置已齐全，可以试听或自动朗读。',
        incomplete: '还需要补齐 App ID、Access Key、默认音色，或自定义音色所需的 Resource ID。',
        activating: '正在启用火山引擎语音……',
        previewing: '正在生成试听语音……',
        previewReady: '试听语音已开始播放。',
        invalidVoice: '音色 ID 只能包含文字、数字、下划线、点、冒号或短横线。',
        duplicateVoice: '这个音色 ID 已经在列表中。',
        importedVoice: voiceId => `已导入并选中音色：${voiceId}`,
        previewMissing: '请先补齐凭证、选择音色；自定义音色还需要填写 Resource ID。',
        unavailable: '语音扩展尚未加载，请稍后重新打开设置。',
        requestFailed: '试听失败',
        privacy: '角色回复会从这台电脑发送到火山引擎生成语音；音频只在当前页面播放，第一版不落盘缓存。',
        advanced: '打开完整语音设置',
        docs: '查看火山引擎配置文档',
    },
    en: {
        switchTitle: 'Character voice',
        switchHelp: 'Use Volcengine to generate speech for character replies.',
        autoTitle: 'Speak after each reply',
        autoHelp: 'Starts shortly after the reply settles; continuation, retry, or chat changes cancel stale jobs.',
        credentials: 'Volcengine credentials',
        credentialHelp: 'Keys stay in SillyTavern’s local secret store and are never written to chat history.',
        appId: 'Set App ID',
        accessKey: 'Set Access Key',
        resourceId: 'Resource ID',
        resourceHelp: 'Public voices use their matching Resource ID automatically. This is the fallback for cloned/custom voices.',
        speed: 'Speech speed',
        speedHelp: '0 is normal; negative is slower and positive is faster.',
        mode: 'Content to speak',
        fullReply: 'Full reply',
        dialogueOnly: 'Quoted dialogue only',
        outsideParenthesesOnly: 'Outside parentheses only',
        language: 'Reply language',
        languageHelp: 'Auto is recommended: English-only replies use English and mixed replies use cross-lingual mode.',
        languageAuto: 'Auto-detect (recommended)',
        languageMixed: 'Mixed / cross-lingual',
        languageChinese: 'Chinese',
        languageEnglish: 'English',
        languageJapanese: 'Japanese',
        voiceMap: 'Character voices',
        voiceMapHelp: 'Includes the public Volcengine TTS 1.0 and 2.0 catalog. Choose a voice for each role.',
        voiceSearch: 'Search name, voice_type, language, or category',
        catalogLoading: 'Loading the official Volcengine voice catalog…',
        catalogReady: count => `${count} voices are available.`,
        catalogFallback: 'The official catalog is temporarily unavailable. Offline voices and manual voice_type import still work.',
        defaultVoice: 'Default voice',
        disabledVoice: 'Do not speak this role',
        customVoice: 'Add a custom voice ID',
        customVoiceHelp: 'Paste an ID, JSON, or voice_type=xxx. The imported voice becomes the default.',
        add: 'Add',
        preview: 'Preview',
        previewText: 'Hello, I am your story companion. It is good to meet you by voice.',
        noCharacter: 'No character is selected yet; you can still set a default voice.',
        ready: 'Configuration is complete. Preview or enable automatic speech.',
        incomplete: 'App ID, Access Key, a default voice, and a Resource ID for custom voices are required.',
        activating: 'Enabling Volcengine speech…',
        previewing: 'Generating voice preview…',
        previewReady: 'Voice preview is now playing.',
        invalidVoice: 'Voice IDs may contain letters, numbers, underscores, dots, colons, or hyphens.',
        duplicateVoice: 'That voice ID is already in the list.',
        importedVoice: voiceId => `Imported and selected: ${voiceId}`,
        previewMissing: 'Configure credentials and a voice first. Custom voices also need a Resource ID.',
        unavailable: 'The speech extension is not ready. Reopen settings in a moment.',
        requestFailed: 'Preview failed',
        privacy: 'Character replies are sent from this computer to Volcengine. Audio is played in this page and is not cached to disk in version one.',
        advanced: 'Open complete speech settings',
        docs: 'Open Volcengine configuration docs',
    },
};

/** @returns {Record<string, any>} Existing Volcengine provider settings. */
function getProviderSettings() {
    extension_settings.tts ??= {};
    extension_settings.tts[PROVIDER_NAME] ??= {};
    const settings = extension_settings.tts[PROVIDER_NAME];
    settings.voiceMap = settings.voiceMap && typeof settings.voiceMap === 'object' ? settings.voiceMap : {};
    settings.customVoices = Array.isArray(settings.customVoices) ? settings.customVoices : [];
    settings.resource_id ??= '';
    settings.speed ??= 0;
    settings.language_mode ??= 'auto';
    settings.provider_endpoint = OFFICIAL_ENDPOINT;
    return settings;
}

/**
 * Get the Volcengine voice that belongs to the active companion character.
 * Secret values stay in the LeslieTavern secret store.
 * @param {string} characterName Active character name.
 * @returns {{available: boolean, speakerId: string, resourceId: string, speed: number, languageMode: string}} Voice snapshot.
 */
export function getLeslieCompanionVoiceSettings(characterName) {
    const settings = getProviderSettings();
    const speakerId = settings.voiceMap[characterName] || settings.voiceMap[DEFAULT_VOICE_MARKER] || '';
    const voices = [
        ...VOLCENGINE_BUILTIN_VOICES,
        ...settings.customVoices.map(voiceId => ({ name: voiceId, voice_id: voiceId })),
    ];
    const resourceId = getVolcengineResourceId(speakerId, voices, settings.resource_id);
    const hasCredentials = hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_APP_ID])
        && hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_ACCESS_KEY]);
    return {
        available: hasCredentials && Boolean(speakerId) && speakerId !== 'disabled' && Boolean(resourceId),
        speakerId,
        resourceId,
        speed: Math.min(100, Math.max(-50, Number(settings.speed) || 0)),
        languageMode: String(settings.language_mode || 'auto'),
    };
}

/** @param {unknown} value @returns {string} HTML-safe text. */
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\u0027', '&#039;');
}

/** @param {unknown} value @returns {boolean} Whether a secret slot is populated. */
function hasSecret(value) {
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** @returns {string[]} Character names visible in the current conversation. */
function getCurrentCharacters() {
    const context = getContext();
    const names = [];
    if (context.groupId !== null && context.groupId !== undefined) {
        const group = context.groups?.find(item => String(item.id) === String(context.groupId));
        for (const member of group?.members ?? []) {
            const character = context.characters?.find(item => item.avatar === member);
            if (character?.name) names.push(character.name);
        }
    } else if (context.name2) {
        names.push(context.name2);
    }
    return [...new Set(names.filter(name => name && name !== context.name1))];
}

/** @param {boolean} value @returns {void} */
function setOriginalCheckbox(id, value) {
    const source = document.getElementById(id);
    if (source instanceof HTMLInputElement && source.checked !== value) source.click();
}

class LeslieVoiceSettings extends HTMLElement {
    #status = '';
    #statusKind = '';
    #events = [];
    #voices = [...VOLCENGINE_BUILTIN_VOICES];
    #catalogLoading = true;
    #voiceFilter = '';
    #customVoiceDraft = '';
    #searchTimer;

    connectedCallback() {
        this.render();
        this.addEventListener('change', event => this.onChange(event));
        this.addEventListener('input', event => this.onInput(event));
        this.addEventListener('click', event => this.onClick(event));
        this.addEventListener('submit', event => this.onSubmit(event));
        this.loadCatalog();

        const refresh = () => this.render();
        for (const eventName of [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED]) {
            eventSource.on(eventName, refresh);
            this.#events.push([eventName, refresh]);
        }
        const started = () => this.setStatus(this.copy.previewing, 'working');
        const ready = () => this.setStatus(this.copy.previewReady, 'ready');
        for (const eventName of [event_types.TTS_JOB_STARTED, event_types.TTS_AUDIO_READY]) {
            eventSource.on(eventName, eventName === event_types.TTS_JOB_STARTED ? started : ready);
            this.#events.push([eventName, eventName === event_types.TTS_JOB_STARTED ? started : ready]);
        }
    }

    disconnectedCallback() {
        clearTimeout(this.#searchTimer);
        for (const [eventName, handler] of this.#events) eventSource.removeListener(eventName, handler);
        this.#events = [];
    }

    async loadCatalog() {
        this.#catalogLoading = true;
        try {
            this.#voices = await loadVolcengineVoices();
        } finally {
            this.#catalogLoading = false;
            if (this.isConnected) this.render();
        }
    }

    /** @returns {Record<string, string>} Active translation. */
    get copy() {
        return COPY[this.dataset.locale === 'en' ? 'en' : 'zh'];
    }

    /** Render current settings without exposing secret values. */
    render() {
        const copy = this.copy;
        const settings = getProviderSettings();
        const characters = getCurrentCharacters();
        const voices = [
            ...this.#voices,
            ...settings.customVoices
                .filter(voiceId => !this.#voices.some(voice => voice.voice_id === voiceId))
                .map(voiceId => ({ name: voiceId, voice_id: voiceId, category: 'Custom' })),
        ];
        const normalizedFilter = this.#voiceFilter.trim().toLocaleLowerCase();
        const filteredVoices = normalizedFilter ? voices.filter(voice => [voice.name, voice.voice_id, voice.lang, voice.category, voice.model]
            .some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedFilter))) : voices;
        const defaultVoice = settings.voiceMap[DEFAULT_VOICE_MARKER] ?? '';
        const defaultResourceId = getVolcengineResourceId(defaultVoice, voices, settings.resource_id);
        const configured = hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_APP_ID])
            && hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_ACCESS_KEY])
            && Boolean(defaultResourceId)
            && Boolean(defaultVoice);
        const mode = extension_settings.tts.narrate_outside_parentheses_only
            ? 'outside-parentheses'
            : (extension_settings.tts.narrate_quoted_only ? 'dialogue' : 'full');
        const voiceRows = [DEFAULT_VOICE_MARKER, ...characters].map(character => {
            const selected = settings.voiceMap[character] ?? (character === DEFAULT_VOICE_MARKER ? '' : settings.voiceMap[DEFAULT_VOICE_MARKER] ?? '');
            const selectedVoice = voices.find(voice => voice.voice_id === selected);
            const rowVoices = selectedVoice && !filteredVoices.includes(selectedVoice) ? [selectedVoice, ...filteredVoices] : filteredVoices;
            const options = rowVoices.map(voice => {
                const details = [voice.model ? `TTS ${voice.model}` : '', voice.lang, voice.voice_id].filter(Boolean).join(' · ');
                return `<option value="${escapeHtml(voice.voice_id)}" ${voice.voice_id === selected ? 'selected' : ''}>${escapeHtml(voice.name)} · ${escapeHtml(details)}</option>`;
            }).join('');
            return `<div class="leslie-voice-map-row">
                <label><span>${escapeHtml(character === DEFAULT_VOICE_MARKER ? copy.defaultVoice : character)}</span>
                    <select class="text_pole" data-voice-character="${escapeHtml(character)}">
                        ${character === DEFAULT_VOICE_MARKER ? '<option value="">—</option>' : `<option value="disabled" ${selected === 'disabled' ? 'selected' : ''}>${copy.disabledVoice}</option>`}
                        ${options}
                    </select>
                </label>
                <button type="button" class="menu_button leslie-voice-preview" data-preview-character="${escapeHtml(character)}"><i class="fa-solid fa-play" aria-hidden="true"></i>${copy.preview}</button>
            </div>`;
        }).join('');

        this.innerHTML = `
            <section class="leslie-detail-card leslie-voice-primary">
                <label class="leslie-voice-toggle">
                    <span><strong>${copy.switchTitle}</strong><small>${copy.switchHelp}</small></span>
                    <input type="checkbox" role="switch" data-voice-enable ${extension_settings.tts.enabled ? 'checked' : ''}>
                </label>
                <label class="leslie-voice-toggle">
                    <span><strong>${copy.autoTitle}</strong><small>${copy.autoHelp}</small></span>
                    <input type="checkbox" role="switch" data-voice-auto ${extension_settings.tts.auto_generation ? 'checked' : ''}>
                </label>
                <div class="leslie-voice-mode" role="group" aria-label="${copy.mode}">
                    <span>${copy.mode}</span>
                    <label><input type="radio" name="leslie-voice-mode" value="full" ${mode === 'full' ? 'checked' : ''}>${copy.fullReply}</label>
                    <label><input type="radio" name="leslie-voice-mode" value="dialogue" ${mode === 'dialogue' ? 'checked' : ''}>${copy.dialogueOnly}</label>
                    <label><input type="radio" name="leslie-voice-mode" value="outside-parentheses" ${mode === 'outside-parentheses' ? 'checked' : ''}>${copy.outsideParenthesesOnly}</label>
                </div>
            </section>
            <section class="leslie-detail-card">
                <div class="leslie-voice-section-heading"><div><h3>${copy.credentials}</h3><p>${copy.credentialHelp}</p></div><span class="leslie-voice-state ${configured ? 'ready' : ''}">${configured ? copy.ready : copy.incomplete}</span></div>
                <div class="leslie-voice-key-row">
                    <button type="button" class="menu_button manage-api-keys ${hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_APP_ID]) ? 'success' : ''}" data-key="${SECRET_KEYS.VOLCENGINE_APP_ID}"><i class="fa-solid fa-key" aria-hidden="true"></i>${copy.appId}</button>
                    <button type="button" class="menu_button manage-api-keys ${hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_ACCESS_KEY]) ? 'success' : ''}" data-key="${SECRET_KEYS.VOLCENGINE_ACCESS_KEY}"><i class="fa-solid fa-key" aria-hidden="true"></i>${copy.accessKey}</button>
                </div>
                <label class="leslie-voice-field"><span><strong>${copy.resourceId}</strong><small>${copy.resourceHelp}</small></span><input class="text_pole" type="text" maxlength="256" value="${escapeHtml(settings.resource_id)}" data-voice-resource autocomplete="off"></label>
                <label class="leslie-voice-field"><span><strong>${copy.language}</strong><small>${copy.languageHelp}</small></span><select class="text_pole" data-voice-language>
                    <option value="auto" ${settings.language_mode === 'auto' ? 'selected' : ''}>${copy.languageAuto}</option>
                    <option value="crosslingual" ${settings.language_mode === 'crosslingual' ? 'selected' : ''}>${copy.languageMixed}</option>
                    <option value="zh-cn" ${settings.language_mode === 'zh-cn' ? 'selected' : ''}>${copy.languageChinese}</option>
                    <option value="en" ${settings.language_mode === 'en' ? 'selected' : ''}>${copy.languageEnglish}</option>
                    <option value="ja" ${settings.language_mode === 'ja' ? 'selected' : ''}>${copy.languageJapanese}</option>
                </select></label>
                <label class="leslie-voice-field"><span><strong>${copy.speed}</strong><small>${copy.speedHelp}</small></span><div class="leslie-voice-range"><input type="range" min="-50" max="100" step="1" value="${escapeHtml(settings.speed)}" data-voice-speed><output>${escapeHtml(settings.speed)}</output></div></label>
            </section>
            <section class="leslie-detail-card">
                <div class="leslie-voice-section-heading"><div><h3>${copy.voiceMap}</h3><p>${copy.voiceMapHelp}</p></div></div>
                <label class="leslie-voice-catalog-search"><input class="text_pole" type="search" value="${escapeHtml(this.#voiceFilter)}" placeholder="${copy.voiceSearch}" data-voice-search autocomplete="off"><small>${this.#catalogLoading ? copy.catalogLoading : (this.#voices.length > VOLCENGINE_BUILTIN_VOICES.length ? copy.catalogReady(voices.length) : copy.catalogFallback)}</small></label>
                <div class="leslie-voice-map">${voiceRows}</div>
                ${characters.length === 0 ? `<p class="leslie-voice-note">${copy.noCharacter}</p>` : ''}
                <form class="leslie-voice-custom-form">
                    <label><strong>${copy.customVoice}</strong><small>${copy.customVoiceHelp}</small><input class="text_pole" name="voiceId" maxlength="512" autocomplete="off" placeholder="voice_type=zh_female_..." value="${escapeHtml(this.#customVoiceDraft)}"></label>
                    <button type="submit" class="menu_button"><i class="fa-solid fa-plus" aria-hidden="true"></i>${copy.add}</button>
                </form>
            </section>
            <p class="leslie-voice-status ${this.#statusKind}" aria-live="polite">${escapeHtml(this.#status || (configured ? copy.ready : copy.incomplete))}</p>
            <p class="leslie-voice-privacy"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>${copy.privacy}</p>
            <div class="leslie-voice-footer">
                <a href="https://www.volcengine.com/docs/6561/2228192?lang=zh" target="_blank" rel="noreferrer">${copy.docs}<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
                <button type="button" class="leslie-detail-full-button" data-leslie-drawer-target="extensions-settings-button"><span><strong>${copy.advanced}</strong></span><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></button>
            </div>`;
    }

    /** @param {string} message @param {string} [kind] */
    setStatus(message, kind = '') {
        this.#status = message;
        this.#statusKind = kind;
        const status = this.querySelector('.leslie-voice-status');
        if (status) {
            status.textContent = message;
            status.className = `leslie-voice-status ${kind}`;
        }
    }

    /** Select Volcengine in the original extension and refresh its voice map. */
    async activateProvider() {
        this.setStatus(this.copy.activating, 'working');
        const provider = document.getElementById('tts_provider');
        if (!(provider instanceof HTMLSelectElement)) throw new Error(this.copy.unavailable);
        if (provider.value !== PROVIDER_NAME) {
            provider.value = PROVIDER_NAME;
            provider.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const startedAt = Date.now();
        while (!document.getElementById('volcengine-tts-resource-id') && Date.now() - startedAt < 3_000) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const sourceResource = document.getElementById('volcengine-tts-resource-id');
        if (!(sourceResource instanceof HTMLInputElement)) throw new Error(this.copy.unavailable);

        const settings = getProviderSettings();
        sourceResource.value = settings.resource_id;
        sourceResource.dispatchEvent(new Event('change', { bubbles: true }));
        const sourceSpeed = document.getElementById('volcengine-tts-speed');
        if (sourceSpeed instanceof HTMLInputElement) {
            sourceSpeed.value = String(settings.speed);
            sourceSpeed.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const sourceLanguage = document.getElementById('volcengine-tts-language');
        if (sourceLanguage instanceof HTMLSelectElement) {
            sourceLanguage.value = settings.language_mode;
            sourceLanguage.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await this.refreshVoiceMap();
    }

    /** Refresh the upstream TTS extension only after it is already loaded. */
    async refreshVoiceMap() {
        const tts = await import('./extensions/tts/index.js');
        if (extension_settings.tts.enabled) await tts.initVoiceMap(false);
    }

    /** @param {Event} event */
    async onChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
        // Draft/search fields are handled by input events. Their blur must not
        // replace the submit button between pointer-down and the form submit.
        if (!target.matches('[data-voice-enable], [data-voice-auto], [data-voice-resource], [data-voice-speed], [data-voice-language], [data-voice-character], [name="leslie-voice-mode"]')) return;
        const settings = getProviderSettings();
        try {
            if (target.matches('[data-voice-enable]')) {
                if (target.checked) {
                    settings.voiceMap[DEFAULT_VOICE_MARKER] ||= VOLCENGINE_BUILTIN_VOICES[0].voice_id;
                    extension_settings.tts.enabled = true;
                    setOriginalCheckbox('tts_enabled', true);
                    await this.activateProvider();
                } else {
                    extension_settings.tts.enabled = false;
                    setOriginalCheckbox('tts_enabled', false);
                }
            } else if (target.matches('[data-voice-auto]')) {
                extension_settings.tts.auto_generation = target.checked;
                setOriginalCheckbox('tts_auto_generation', target.checked);
                if (target.checked && !extension_settings.tts.enabled) {
                    extension_settings.tts.enabled = true;
                    settings.voiceMap[DEFAULT_VOICE_MARKER] ||= VOLCENGINE_BUILTIN_VOICES[0].voice_id;
                    setOriginalCheckbox('tts_enabled', true);
                    await this.activateProvider();
                }
            } else if (target.name === 'leslie-voice-mode') {
                const dialogueOnly = target.value === 'dialogue';
                const outsideParenthesesOnly = target.value === 'outside-parentheses';
                extension_settings.tts.narrate_quoted_only = dialogueOnly;
                extension_settings.tts.narrate_dialogues_only = dialogueOnly;
                extension_settings.tts.narrate_outside_parentheses_only = outsideParenthesesOnly;
                setOriginalCheckbox('tts_narrate_quoted', dialogueOnly);
                setOriginalCheckbox('tts_narrate_dialogues', dialogueOnly);
                setOriginalCheckbox('tts_narrate_outside_parentheses', outsideParenthesesOnly);
            } else if (target.matches('[data-voice-resource]')) {
                settings.resource_id = target.value.trim();
                const source = document.getElementById('volcengine-tts-resource-id');
                if (source instanceof HTMLInputElement) {
                    source.value = settings.resource_id;
                    source.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else if (target.matches('[data-voice-speed]')) {
                settings.speed = Math.min(100, Math.max(-50, Number(target.value) || 0));
                target.parentElement?.querySelector('output')?.replaceChildren(String(settings.speed));
                const source = document.getElementById('volcengine-tts-speed');
                if (source instanceof HTMLInputElement) {
                    source.value = String(settings.speed);
                    source.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else if (target.matches('[data-voice-language]')) {
                settings.language_mode = target.value;
                const source = document.getElementById('volcengine-tts-language');
                if (source instanceof HTMLSelectElement) {
                    source.value = settings.language_mode;
                    source.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else if (target.matches('[data-voice-character]')) {
                settings.voiceMap[target.dataset.voiceCharacter] = target.value;
                await this.refreshVoiceMap();
            }

            // Stable defaults for the one-click path: never speak user text or
            // partial streaming text, and remove code/tag markup before TTS.
            extension_settings.tts.narrate_user = false;
            extension_settings.tts.periodic_auto_generation = false;
            extension_settings.tts.narrate_by_paragraphs = true;
            extension_settings.tts.skip_codeblocks = true;
            extension_settings.tts.skip_tags = true;
            setOriginalCheckbox('tts_narrate_user', false);
            setOriginalCheckbox('tts_periodic_auto_generation', false);
            setOriginalCheckbox('tts_narrate_by_paragraphs', true);
            setOriginalCheckbox('tts_skip_codeblocks', true);
            setOriginalCheckbox('tts_skip_tags', true);
            saveSettingsDebounced();
            this.render();
        } catch (error) {
            console.error('Unable to update Leslie voice settings', error);
            this.setStatus(error.message || this.copy.unavailable, 'error');
        }
    }

    /** @param {InputEvent} event */
    onInput(event) {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name === 'voiceId') {
            // Catalog and secret-status refreshes must preserve an unfinished paste.
            this.#customVoiceDraft = target.value;
            return;
        }
        if (!(target instanceof HTMLInputElement) || !target.matches('[data-voice-search]')) return;
        this.#voiceFilter = target.value;
        clearTimeout(this.#searchTimer);
        this.#searchTimer = setTimeout(() => {
            this.render();
            const search = this.querySelector('[data-voice-search]');
            if (search instanceof HTMLInputElement) {
                search.focus();
                search.setSelectionRange(search.value.length, search.value.length);
            }
        }, 120);
    }

    /** @param {SubmitEvent} event */
    async onSubmit(event) {
        event.preventDefault();
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const voiceId = normalizeVolcengineVoiceId(new FormData(form).get('voiceId'));
        if (!voiceId) return this.setStatus(this.copy.invalidVoice, 'error');
        const settings = getProviderSettings();
        const exists = this.#voices.some(voice => voice.voice_id === voiceId) || settings.customVoices.includes(voiceId);
        if (!exists) settings.customVoices.push(voiceId);
        settings.voiceMap[DEFAULT_VOICE_MARKER] = voiceId;
        this.#voiceFilter = '';
        saveSettingsDebounced();
        await this.refreshVoiceMap();
        this.#status = this.copy.importedVoice(voiceId);
        this.#customVoiceDraft = '';
        this.#statusKind = 'ready';
        this.render();
    }

    /** @param {MouseEvent} event */
    async onClick(event) {
        const button = event.target instanceof Element ? event.target.closest('[data-preview-character]') : null;
        if (!(button instanceof HTMLButtonElement)) return;
        const settings = getProviderSettings();
        const character = button.dataset.previewCharacter;
        const voice = settings.voiceMap[character] || settings.voiceMap[DEFAULT_VOICE_MARKER];
        const voices = [
            ...this.#voices,
            ...settings.customVoices.map(voiceId => ({ name: voiceId, voice_id: voiceId })),
        ];
        const resourceId = getVolcengineResourceId(voice, voices, settings.resource_id);
        if (!hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_APP_ID])
            || !hasSecret(secret_state[SECRET_KEYS.VOLCENGINE_ACCESS_KEY])
            || !resourceId || !voice || voice === 'disabled') {
            return this.setStatus(this.copy.previewMissing, 'error');
        }

        button.disabled = true;
        this.setStatus(this.copy.previewing, 'working');
        try {
            const response = await fetch('/api/volcengine/generate-voice', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    provider_endpoint: OFFICIAL_ENDPOINT,
                    resource_id: resourceId,
                    text: this.copy.previewText,
                    voice_speaker: voice,
                    speed: settings.speed,
                    language_mode: settings.language_mode,
                }),
            });
            if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
            const audioUrl = URL.createObjectURL(await response.blob());
            const audio = new Audio(audioUrl);
            audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
            await audio.play();
            this.setStatus(this.copy.previewReady, 'ready');
        } catch (error) {
            console.error('Volcengine voice preview failed', error);
            this.setStatus(`${this.copy.requestFailed}：${error.message}`, 'error');
        } finally {
            button.disabled = false;
        }
    }
}

if (!customElements.get('leslie-voice-settings')) {
    customElements.define('leslie-voice-settings', LeslieVoiceSettings);
}
