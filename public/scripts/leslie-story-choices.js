import {
    chat,
    chat_metadata,
    eventSource,
    event_types,
    generateQuietPrompt,
    getCurrentChatId,
    name1,
    name2,
    online_status,
    sendTextareaMessage,
    this_chid,
} from '../script.js';
import {
    getGroupNames,
    is_group_generating,
    selected_group,
} from './group-chats.js';
import {
    buildStoryChoicePrompt,
    createStoryChoiceContextKey,
    getStoryChoiceSchema,
    LESLIE_STORY_CHOICE_MODES,
    LESLIE_STORY_CHOICE_MODE_KEY,
    LESLIE_STORY_CHOICE_PURPOSE,
    normalizeStoryChoices,
} from './leslie-story-choices-core.js';
import {
    getActivePlotPlan,
    LESLIE_PLOT_COMPASS_CHANGED_EVENT,
} from './leslie-plot-compass-core.js';

const GENERATION_DELAY = 280;
const BUSY_RETRY_DELAY = 220;

const state = {
    mode: readMode(),
    expanded: true,
    loading: false,
    correcting: false,
    sending: false,
    choices: [],
    contextKey: '',
    error: '',
    requestSequence: 0,
    scheduleTimer: 0,
    controller: null,
};

let panel;
let panelBody;
let choiceList;
let statusLine;
let perspectiveName;
let refreshButton;
let expandButton;
let textarea;
let sendForm;

function readMode() {
    try {
        return localStorage.getItem(LESLIE_STORY_CHOICE_MODE_KEY) === LESLIE_STORY_CHOICE_MODES.GUIDED
            ? LESLIE_STORY_CHOICE_MODES.GUIDED
            : LESLIE_STORY_CHOICE_MODES.FREE;
    } catch {
        return LESLIE_STORY_CHOICE_MODES.FREE;
    }
}

function saveMode(mode) {
    try {
        localStorage.setItem(LESLIE_STORY_CHOICE_MODE_KEY, mode);
    } catch {
        // The mode remains available for this session if storage is unavailable.
    }
}

function hasActiveChat() {
    return Boolean(selected_group) || (this_chid !== undefined && this_chid !== null);
}

function isGuidedMode() {
    return state.mode === LESLIE_STORY_CHOICE_MODES.GUIDED;
}

function isModelConnected() {
    return online_status !== 'no_connection';
}

function getChoiceIdentity() {
    const lastMessage = chat[chat.length - 1];
    const groupNames = selected_group ? getGroupNames() : [];
    const aiNames = [...new Set([
        ...(selected_group ? groupNames : [name2]),
        !lastMessage?.is_user && !lastMessage?.is_system ? lastMessage?.name : '',
    ].map(value => String(value ?? '').trim()).filter(Boolean))];
    return {
        userName: String(name1 || '用户').trim(),
        aiNames,
        lastAssistantName: !lastMessage?.is_user && !lastMessage?.is_system
            ? String(lastMessage?.name || aiNames[0] || '').trim()
            : '',
    };
}

function getCurrentContextKey(identity = getChoiceIdentity()) {
    const lastMessageIndex = chat.length - 1;
    return createStoryChoiceContextKey({
        entityType: selected_group ? 'group' : 'character',
        entityId: selected_group || this_chid,
        chatId: getCurrentChatId(),
        messageCount: chat.length,
        lastMessageIndex,
        lastMessage: chat[lastMessageIndex],
        userName: identity.userName,
        aiNames: identity.aiNames,
    });
}

function canGenerateChoices() {
    const lastMessage = chat[chat.length - 1];
    return isGuidedMode()
        && hasActiveChat()
        && isModelConnected()
        && !state.sending
        && !is_group_generating
        && Boolean(lastMessage)
        && !lastMessage.is_user
        && !lastMessage.is_system
        && !String(textarea?.value ?? '').trim()
        && document.activeElement !== textarea;
}

function createPanel() {
    sendForm = document.getElementById('send_form');
    if (!sendForm || document.getElementById('leslie-story-choices')) {
        return false;
    }

    panel = document.createElement('section');
    panel.id = 'leslie-story-choices';
    panel.setAttribute('aria-label', '聊天输入方式');
    panel.innerHTML = `
        <div class="leslie-story-choice-toolbar">
            <div class="leslie-story-mode-switch" role="group" aria-label="输入方式">
                <button type="button" data-story-mode="free">自由输入</button>
                <button type="button" data-story-mode="guided">互动引导</button>
            </div>
            <div class="leslie-story-choice-actions">
                <button type="button" data-story-action="expand" title="显示剧情选项">
                    <i class="fa-solid fa-list-check" aria-hidden="true"></i><span>显示选项</span>
                </button>
                <button type="button" data-story-action="refresh" title="使用当前模型重新生成三个选项">
                    <i class="fa-solid fa-rotate" aria-hidden="true"></i><span>换一组</span>
                </button>
            </div>
        </div>
        <div class="leslie-story-choice-body">
            <p class="leslie-story-choice-perspective">接下来，<strong data-story-user-name></strong> 可以：</p>
            <p class="leslie-story-choice-status" role="status" aria-live="polite"></p>
            <div class="leslie-story-choice-list" role="list"></div>
        </div>
    `;
    sendForm.parentElement?.insertBefore(panel, sendForm);
    panelBody = panel.querySelector('.leslie-story-choice-body');
    choiceList = panel.querySelector('.leslie-story-choice-list');
    statusLine = panel.querySelector('.leslie-story-choice-status');
    perspectiveName = panel.querySelector('[data-story-user-name]');
    refreshButton = panel.querySelector('[data-story-action="refresh"]');
    expandButton = panel.querySelector('[data-story-action="expand"]');
    return true;
}

function renderChoiceButtons() {
    const identity = getChoiceIdentity();
    const fragment = document.createDocumentFragment();
    state.choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'leslie-story-choice';
        button.dataset.storyChoiceIndex = String(index);
        button.setAttribute('role', 'listitem');
        button.disabled = state.loading || state.sending;

        const number = document.createElement('span');
        number.className = 'leslie-story-choice-number';
        number.textContent = String(index + 1);
        const copy = document.createElement('span');
        copy.className = 'leslie-story-choice-copy';
        const heading = document.createElement('span');
        heading.className = 'leslie-story-choice-heading';
        const speaker = document.createElement('span');
        speaker.className = 'leslie-story-choice-speaker';
        speaker.textContent = identity.userName;
        const title = document.createElement('strong');
        title.textContent = choice.title;
        const message = document.createElement('span');
        message.className = 'leslie-story-choice-message';
        message.textContent = choice.userMessage;
        heading.append(speaker, title);
        copy.append(heading, message);
        button.append(number, copy);
        button.setAttribute('aria-label', `${identity.userName}：${choice.userMessage}`);
        fragment.append(button);
    });
    choiceList?.replaceChildren(fragment);
}

function render() {
    if (!panel) {
        return;
    }

    const active = hasActiveChat();
    const guided = isGuidedMode();
    const composerVisible = sendForm && getComputedStyle(sendForm).display !== 'none';
    panel.hidden = !active || !composerVisible;
    panel.classList.toggle('is-guided', guided);
    panel.classList.toggle('is-collapsed', guided && !state.expanded);
    panel.classList.toggle('is-loading', state.loading);
    panel.classList.toggle('is-sending', state.sending);
    document.body.classList.toggle('leslie-story-guided-mode', guided);

    if (perspectiveName) {
        perspectiveName.textContent = getChoiceIdentity().userName;
    }

    panel.querySelectorAll('[data-story-mode]').forEach((button) => {
        const selected = button.dataset.storyMode === state.mode;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });

    if (panelBody) {
        panelBody.hidden = !guided || !state.expanded;
    }
    if (expandButton) {
        expandButton.hidden = !guided || state.expanded;
    }
    if (refreshButton) {
        refreshButton.hidden = !guided || !state.expanded;
        refreshButton.disabled = state.loading || state.sending || !isModelConnected();
    }

    renderChoiceButtons();
    if (!statusLine) {
        return;
    }
    if (state.loading) {
        statusLine.textContent = state.correcting
            ? `正在校正为“${getChoiceIdentity().userName}”的回复视角…`
            : `正在为“${getChoiceIdentity().userName}”构思三个回复…`;
    } else if (state.error) {
        statusLine.textContent = state.error;
    } else if (state.choices.length === 3) {
        statusLine.textContent = '选项均由当前用户 Persona 发送；也可以点击输入框自由发挥。';
    } else if (!isModelConnected()) {
        statusLine.textContent = '模型未连接；你仍然可以自由输入。';
    } else {
        statusLine.textContent = '角色回复后，这里会出现三个可选的剧情方向。';
    }
}

function abortChoiceGeneration(reason = 'Story-choice generation cancelled.') {
    clearTimeout(state.scheduleTimer);
    state.scheduleTimer = 0;
    state.requestSequence += 1;
    if (state.controller && !state.controller.signal.aborted) {
        state.controller.abort(new DOMException(reason, 'AbortError'));
    }
    state.controller = null;
    state.loading = false;
    state.correcting = false;
}

function clearChoices({ collapse = false } = {}) {
    abortChoiceGeneration();
    state.choices = [];
    state.contextKey = '';
    state.error = '';
    state.expanded = !collapse;
    render();
}

async function generateChoices({ force = false } = {}) {
    if (!canGenerateChoices() || state.loading) {
        render();
        return;
    }

    const identity = getChoiceIdentity();
    const contextKey = getCurrentContextKey(identity);
    if (!force && state.contextKey === contextKey && state.choices.length === 3) {
        render();
        return;
    }

    abortChoiceGeneration();
    const requestSequence = ++state.requestSequence;
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    state.correcting = false;
    state.error = '';
    state.choices = [];
    state.expanded = true;
    render();

    try {
        const requestChoices = async (correction) => {
            const raw = await generateQuietPrompt({
                quietPrompt: buildStoryChoicePrompt(identity, {
                    correction,
                    activePlan: getActivePlotPlan(chat_metadata, chat.length),
                }),
                responseLength: 620,
                jsonSchema: getStoryChoiceSchema(identity),
                signal: controller.signal,
                generationPurpose: LESLIE_STORY_CHOICE_PURPOSE,
                removeReasoning: true,
            });
            return normalizeStoryChoices(raw, identity);
        };

        let choices = await requestChoices(false);
        if (choices.length !== 3) {
            if (requestSequence !== state.requestSequence || contextKey !== getCurrentContextKey() || !isGuidedMode()) {
                return;
            }
            state.correcting = true;
            render();
            choices = await requestChoices(true);
        }
        if (choices.length !== 3) {
            throw new Error(`模型未能生成三个由“${identity.userName}”发送的回复，请换一组。`);
        }
        if (requestSequence !== state.requestSequence || contextKey !== getCurrentContextKey() || !isGuidedMode()) {
            return;
        }
        state.choices = choices;
        state.contextKey = contextKey;
    } catch (error) {
        if (requestSequence !== state.requestSequence || controller.signal.aborted) {
            return;
        }
        console.warn('[Leslie Story Choices] Could not generate choices.', error);
        state.error = error?.message || '剧情选项生成失败；你仍然可以自由输入。';
    } finally {
        if (requestSequence === state.requestSequence) {
            state.loading = false;
            state.correcting = false;
            state.controller = null;
            render();
        }
    }
}

function scheduleChoiceGeneration({ force = false, delay = GENERATION_DELAY } = {}) {
    clearTimeout(state.scheduleTimer);
    if (!isGuidedMode()) {
        return;
    }
    state.scheduleTimer = window.setTimeout(() => {
        state.scheduleTimer = 0;
        if (document.body.dataset.generating === 'true' && !state.loading) {
            scheduleChoiceGeneration({ force, delay: BUSY_RETRY_DELAY });
            return;
        }
        void generateChoices({ force });
    }, delay);
}

function setMode(mode) {
    const nextMode = mode === LESLIE_STORY_CHOICE_MODES.GUIDED
        ? LESLIE_STORY_CHOICE_MODES.GUIDED
        : LESLIE_STORY_CHOICE_MODES.FREE;
    if (state.mode === nextMode) {
        return;
    }
    state.mode = nextMode;
    saveMode(nextMode);
    clearChoices({ collapse: false });
    if (isGuidedMode()) {
        scheduleChoiceGeneration({ force: true, delay: 80 });
    }
}

async function sendChoice(index) {
    const choice = state.choices[index];
    if (!choice || state.sending || state.loading) {
        return;
    }
    if (state.contextKey !== getCurrentContextKey()) {
        clearChoices();
        scheduleChoiceGeneration({ force: true });
        return;
    }
    if (String(textarea?.value ?? '').trim()) {
        state.expanded = false;
        state.error = '输入框中已有草稿，未覆盖你的内容。';
        render();
        return;
    }

    state.sending = true;
    state.expanded = false;
    render();
    try {
        textarea.value = choice.userMessage;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        state.choices = [];
        state.contextKey = '';
        await sendTextareaMessage();
    } finally {
        state.sending = false;
        render();
    }
}

function handlePanelClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const modeButton = target?.closest('[data-story-mode]');
    if (modeButton instanceof HTMLButtonElement) {
        setMode(modeButton.dataset.storyMode);
        return;
    }

    const actionButton = target?.closest('[data-story-action]');
    if (actionButton instanceof HTMLButtonElement) {
        if (actionButton.dataset.storyAction === 'expand') {
            state.expanded = true;
            render();
            if (!state.choices.length) {
                scheduleChoiceGeneration({ force: true, delay: 60 });
            }
        } else if (actionButton.dataset.storyAction === 'refresh') {
            scheduleChoiceGeneration({ force: true, delay: 20 });
        }
        return;
    }

    const choiceButton = target?.closest('[data-story-choice-index]');
    if (choiceButton instanceof HTMLButtonElement) {
        void sendChoice(Number(choiceButton.dataset.storyChoiceIndex));
    }
}

function handleTextareaFocus() {
    if (!isGuidedMode()) {
        return;
    }
    if (state.loading) {
        abortChoiceGeneration('The user chose to type a custom message.');
    }
    state.expanded = false;
    state.error = '';
    render();
}

function handleTextareaInput() {
    if (!isGuidedMode() || !String(textarea?.value ?? '').trim()) {
        return;
    }
    if (state.loading) {
        abortChoiceGeneration('The user started typing a custom message.');
    }
    state.expanded = false;
    render();
}

function handleChatInvalidated({ schedule = true, collapse = false } = {}) {
    clearChoices({ collapse });
    if (schedule) {
        scheduleChoiceGeneration({ force: true });
    }
}

function bindLifecycleEvents() {
    panel?.addEventListener('click', handlePanelClick);
    textarea?.addEventListener('focus', handleTextareaFocus);
    textarea?.addEventListener('input', handleTextareaInput);
    if (sendForm) {
        new MutationObserver(render).observe(sendForm, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    eventSource.on(event_types.MESSAGE_SENT, () => handleChatInvalidated({ schedule: false }));
    eventSource.on(event_types.MESSAGE_RECEIVED, (_messageId, type) => {
        if (selected_group || type === 'quiet') {
            return;
        }
        scheduleChoiceGeneration({ force: true });
    });
    eventSource.on(event_types.GROUP_WRAPPER_FINISHED, (detail) => {
        if (detail?.type === 'quiet') {
            return;
        }
        scheduleChoiceGeneration({ force: true });
    });
    for (const eventName of [event_types.CHAT_CHANGED, event_types.CHAT_LOADED]) {
        eventSource.on(eventName, () => handleChatInvalidated({ schedule: true }));
    }
    for (const eventName of [
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_DELETED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_SWIPE_DELETED,
        event_types.PERSONA_CHANGED,
        event_types.CHARACTER_EDITED,
        event_types.GROUP_UPDATED,
    ].filter(Boolean)) {
        eventSource.on(eventName, () => handleChatInvalidated({ schedule: true }));
    }
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, () => {
        render();
        if (isModelConnected()) {
            scheduleChoiceGeneration({ force: true });
        }
    });
    window.addEventListener(LESLIE_PLOT_COMPASS_CHANGED_EVENT, () => handleChatInvalidated({ schedule: true }));
}

function initLeslieStoryChoices() {
    textarea = document.getElementById('send_textarea');
    if (!(textarea instanceof HTMLTextAreaElement) || !createPanel()) {
        return;
    }
    bindLifecycleEvents();
    render();
    if (isGuidedMode()) {
        scheduleChoiceGeneration({ force: false, delay: 500 });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLeslieStoryChoices, { once: true });
} else {
    initLeslieStoryChoices();
}
