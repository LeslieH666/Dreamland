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
    saveMetadata,
    this_chid,
    updateChatMetadata,
} from '../script.js';
import { selected_group } from './group-chats.js';
import { getWorldLineKind } from './leslie-reality-context.js';
import { createStoryChoiceContextKey } from './leslie-story-choices-core.js';
import {
    buildPlotCompassPrompt,
    countPlotTurns,
    createPlotPlan,
    getActivePlotPlan,
    getPlotCompassSchema,
    LESLIE_PLOT_COMPASS_CHANGED_EVENT,
    LESLIE_PLOT_COMPASS_METADATA_KEY,
    LESLIE_PLOT_COMPASS_PURPOSE,
    LESLIE_PLOT_COMPASS_SCHEMA_VERSION,
    normalizePlotCompassMetadata,
    normalizePlotSuggestions,
} from './leslie-plot-compass-core.js';

const DURATION_PREFERENCE_KEY = 'leslie-plot-compass-duration';
const INTENSITY_PREFERENCE_KEY = 'leslie-plot-compass-intensity';
const MOBILE_PIN_MEDIA = window.matchMedia('(max-width: 700px)');
const KIND_LABELS = Object.freeze({
    continuation: '主线延续',
    relationship: '关系变局',
    disruption: '外部冲击',
});

const state = {
    loading: false,
    correcting: false,
    suggestions: [],
    contextKey: '',
    error: '',
    controller: null,
    requestSequence: 0,
    pinExpanded: false,
    planWarning: '',
};

let launcher;
let dialog;
let suggestionsList;
let dialogStatus;
let refreshButton;
let durationToggle;
let intensitySelect;
let pin;
let mobilePinDialog;

function readBooleanPreference(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value === 'true';
    } catch {
        return fallback;
    }
}

function readTextPreference(key, fallback, allowed) {
    try {
        const value = localStorage.getItem(key);
        return allowed.includes(value) ? value : fallback;
    } catch {
        return fallback;
    }
}

function savePreference(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // The preference remains available for this browser session.
    }
}

function isModelConnected() {
    return online_status !== 'no_connection';
}

function isSoloStoryChat() {
    return !selected_group
        && this_chid !== undefined
        && this_chid !== null
        && getWorldLineKind(chat_metadata) === 'story';
}

function getIdentity() {
    const lastMessage = chat[chat.length - 1];
    const lastAssistantName = !lastMessage?.is_user && !lastMessage?.is_system
        ? String(lastMessage?.name || '').trim()
        : '';
    return {
        userName: String(name1 || '用户').trim(),
        aiNames: [...new Set([name2, lastAssistantName].map(value => String(value ?? '').trim()).filter(Boolean))],
        lastAssistantName,
    };
}

function getContextKey() {
    const identity = getIdentity();
    const lastMessageIndex = chat.length - 1;
    return createStoryChoiceContextKey({
        entityType: 'character',
        entityId: this_chid,
        chatId: getCurrentChatId(),
        messageCount: chat.length,
        lastMessageIndex,
        lastMessage: chat[lastMessageIndex],
        userName: identity.userName,
        aiNames: identity.aiNames,
    });
}

function getMetadata() {
    return normalizePlotCompassMetadata(chat_metadata?.[LESLIE_PLOT_COMPASS_METADATA_KEY], { messageCount: chat.length });
}

function dispatchPlotChanged() {
    window.dispatchEvent(new CustomEvent(LESLIE_PLOT_COMPASS_CHANGED_EVENT));
}

async function persistMetadata(metadata) {
    const normalized = normalizePlotCompassMetadata(metadata, { messageCount: chat.length });
    updateChatMetadata({ [LESLIE_PLOT_COMPASS_METADATA_KEY]: normalized });
    await saveMetadata();
    dispatchPlotChanged();
    renderPin();
}

async function reconcileMetadataForBranch() {
    const raw = chat_metadata?.[LESLIE_PLOT_COMPASS_METADATA_KEY];
    if (!raw || ![1, LESLIE_PLOT_COMPASS_SCHEMA_VERSION].includes(Number(raw.schemaVersion ?? 1))) {
        return;
    }
    const normalized = normalizePlotCompassMetadata(raw, { messageCount: chat.length });
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
        await persistMetadata(normalized);
    }
}

function abortGeneration(reason = 'Plot-compass generation cancelled.') {
    state.requestSequence += 1;
    if (state.controller && !state.controller.signal.aborted) {
        state.controller.abort(new DOMException(reason, 'AbortError'));
    }
    state.controller = null;
    state.loading = false;
    state.correcting = false;
}

function clearSuggestions() {
    abortGeneration();
    state.suggestions = [];
    state.contextKey = '';
    state.error = '';
    renderDialog();
}

function createLauncher() {
    const actions = document.querySelector('#leslie-story-choices .leslie-story-choice-actions');
    if (!actions) {
        return false;
    }
    launcher = actions.querySelector('[data-story-action="plot-compass"]');
    if (!launcher) {
        launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.dataset.storyAction = 'plot-compass';
        launcher.title = '结合当前剧情与记忆规划下一章长线发展';
        launcher.innerHTML = '<i class="fa-solid fa-compass" aria-hidden="true"></i><span>剧情灵感</span>';
        actions.prepend(launcher);
    }
    launcher.addEventListener('click', openCompass);
    return true;
}

function createDialog() {
    if (document.getElementById('leslie-plot-compass-dialog')) {
        return false;
    }
    dialog = document.createElement('dialog');
    dialog.id = 'leslie-plot-compass-dialog';
    dialog.className = 'leslie-plot-compass-dialog';
    dialog.setAttribute('aria-labelledby', 'leslie-plot-compass-title');
    dialog.innerHTML = `
        <div class="leslie-plot-compass-shell">
            <header>
                <div>
                    <span class="leslie-plot-compass-kicker"><i class="fa-solid fa-compass" aria-hidden="true"></i> 剧情罗盘</span>
                    <h2 id="leslie-plot-compass-title">下一章主线往哪里走？</h2>
                    <p>结合当前故事线与记忆，提供三个跨阶段、会留下长期影响的篇章方向。</p>
                </div>
                <button type="button" class="leslie-plot-icon-button" data-plot-action="close" aria-label="关闭剧情罗盘"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </header>
            <div class="leslie-plot-compass-controls">
                <label>
                    <span>推进风格</span>
                    <select data-plot-intensity>
                        <option value="grounded">稳妥连贯</option>
                        <option value="emotional">关系优先</option>
                        <option value="bold">大胆转折</option>
                    </select>
                </label>
                <label class="leslie-plot-duration-toggle">
                    <input type="checkbox" data-plot-duration>
                    <span>显示建议轮数</span>
                </label>
                <button type="button" data-plot-action="refresh"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 换一组</button>
            </div>
            <p class="leslie-plot-compass-status" role="status" aria-live="polite"></p>
            <div class="leslie-plot-suggestion-list"></div>
        </div>`;
    document.body.append(dialog);
    suggestionsList = dialog.querySelector('.leslie-plot-suggestion-list');
    dialogStatus = dialog.querySelector('.leslie-plot-compass-status');
    refreshButton = dialog.querySelector('[data-plot-action="refresh"]');
    durationToggle = dialog.querySelector('[data-plot-duration]');
    intensitySelect = dialog.querySelector('[data-plot-intensity]');
    durationToggle.checked = readBooleanPreference(DURATION_PREFERENCE_KEY, true);
    intensitySelect.value = readTextPreference(INTENSITY_PREFERENCE_KEY, 'grounded', ['grounded', 'emotional', 'bold']);
    dialog.addEventListener('click', handleDialogClick);
    dialog.addEventListener('cancel', () => abortGeneration('The plot-compass dialog was closed.'));
    durationToggle.addEventListener('change', () => {
        savePreference(DURATION_PREFERENCE_KEY, durationToggle.checked);
        clearSuggestions();
        void generateSuggestions({ force: true });
    });
    intensitySelect.addEventListener('change', () => {
        savePreference(INTENSITY_PREFERENCE_KEY, intensitySelect.value);
        clearSuggestions();
        void generateSuggestions({ force: true });
    });
    return true;
}

function createPin() {
    const header = document.getElementById('leslie-chat-header');
    const actions = document.getElementById('leslie-chat-actions');
    if (!header || !actions) {
        return false;
    }
    pin = document.getElementById('leslie-plot-pin');
    if (!pin) {
        pin = document.createElement('aside');
        pin.id = 'leslie-plot-pin';
        pin.className = 'leslie-plot-pin';
        pin.hidden = true;
        pin.innerHTML = `
            <button type="button" class="leslie-plot-pin-summary" data-plot-pin-action="toggle" aria-expanded="false">
                <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
                <span><small>当前长线</small><strong data-plot-pin-title></strong></span>
                <em data-plot-pin-progress></em>
            </button>
            <div class="leslie-plot-pin-detail" hidden>
                <p data-plot-pin-goal></p>
                <dl class="leslie-plot-pin-facts">
                    <div><dt>故事跨度</dt><dd data-plot-pin-horizon></dd></div>
                    <div><dt>长期影响</dt><dd data-plot-pin-impact></dd></div>
                </dl>
                <ol data-plot-pin-beats></ol>
                <p class="leslie-plot-pin-warning" data-plot-pin-warning hidden></p>
                <div class="leslie-plot-pin-actions">
                    <button type="button" data-plot-pin-action="first-move">放入开场</button>
                    <button type="button" data-plot-pin-action="pause"></button>
                    <button type="button" data-plot-pin-action="complete">已完成</button>
                    <button type="button" data-plot-pin-action="abandon">放弃</button>
                </div>
            </div>`;
        pin.addEventListener('click', handlePinClick);
    }
    positionPinForViewport();
    createMobilePinDialog();
    return true;
}

function createMobilePinDialog() {
    mobilePinDialog = document.getElementById('leslie-plot-pin-dialog');
    if (mobilePinDialog) {
        return;
    }
    mobilePinDialog = document.createElement('dialog');
    mobilePinDialog.id = 'leslie-plot-pin-dialog';
    mobilePinDialog.className = 'leslie-plot-pin-dialog';
    mobilePinDialog.setAttribute('aria-labelledby', 'leslie-plot-pin-dialog-title');
    mobilePinDialog.innerHTML = `
        <div class="leslie-plot-pin-sheet">
            <header>
                <div>
                    <small><i class="fa-solid fa-thumbtack" aria-hidden="true"></i> 当前长线</small>
                    <h2 id="leslie-plot-pin-dialog-title" data-plot-pin-title></h2>
                    <em data-plot-pin-progress></em>
                </div>
                <button type="button" class="leslie-plot-icon-button" data-plot-pin-action="close" aria-label="关闭当前主线"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </header>
            <p data-plot-pin-goal></p>
            <dl class="leslie-plot-pin-facts">
                <div><dt>故事跨度</dt><dd data-plot-pin-horizon></dd></div>
                <div><dt>长期影响</dt><dd data-plot-pin-impact></dd></div>
            </dl>
            <ol data-plot-pin-beats></ol>
            <p class="leslie-plot-pin-warning" data-plot-pin-warning hidden></p>
            <div class="leslie-plot-pin-actions">
                <button type="button" data-plot-pin-action="first-move">放入开场</button>
                <button type="button" data-plot-pin-action="pause"></button>
                <button type="button" data-plot-pin-action="complete">已完成</button>
                <button type="button" data-plot-pin-action="abandon">放弃</button>
            </div>
        </div>`;
    mobilePinDialog.addEventListener('click', handlePinClick);
    mobilePinDialog.addEventListener('close', () => {
        state.pinExpanded = false;
        pin?.querySelector('[data-plot-pin-action="toggle"]')?.setAttribute('aria-expanded', 'false');
    });
    document.body.append(mobilePinDialog);
}

function positionPinForViewport() {
    if (!pin) {
        return;
    }
    const header = document.getElementById('leslie-chat-header');
    const actions = document.getElementById('leslie-chat-actions');
    if (!header || !actions) {
        return;
    }
    if (MOBILE_PIN_MEDIA.matches) {
        if (header.nextElementSibling !== pin) {
            header.insertAdjacentElement('afterend', pin);
        }
        pin.classList.add('is-mobile-dock');
    } else {
        if (pin.parentElement !== header || pin.nextElementSibling !== actions) {
            header.insertBefore(pin, actions);
        }
        pin.classList.remove('is-mobile-dock');
    }
}

function updateLauncher() {
    if (!launcher) {
        return;
    }
    launcher.hidden = !isSoloStoryChat();
    launcher.disabled = false;
    launcher.title = !isModelConnected()
        ? '连接聊天模型后即可生成剧情灵感'
        : '结合当前剧情与记忆规划下一章长线发展';
}

function appendTextElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    element.textContent = text;
    parent.append(element);
    return element;
}

function renderSuggestionCards() {
    if (!suggestionsList) {
        return;
    }
    const fragment = document.createDocumentFragment();
    state.suggestions.forEach((suggestion, index) => {
        const card = document.createElement('article');
        card.className = `leslie-plot-suggestion kind-${suggestion.kind}`;
        card.dataset.plotSuggestionIndex = String(index);

        const heading = document.createElement('div');
        heading.className = 'leslie-plot-suggestion-heading';
        appendTextElement(heading, 'span', 'leslie-plot-kind', KIND_LABELS[suggestion.kind] || '剧情线');
        appendTextElement(heading, 'h3', '', suggestion.title);
        if (suggestion.duration) {
            appendTextElement(heading, 'small', 'leslie-plot-duration', `预计 ${suggestion.duration.minTurns}–${suggestion.duration.maxTurns} 轮`);
        }
        card.append(heading);
        appendTextElement(card, 'p', 'leslie-plot-hook', suggestion.hook);

        const scope = document.createElement('dl');
        scope.className = 'leslie-plot-scope';
        for (const [label, value] of [['故事跨度', suggestion.timeHorizon], ['长期影响', suggestion.impact]]) {
            const item = document.createElement('div');
            appendTextElement(item, 'dt', '', label);
            appendTextElement(item, 'dd', '', value);
            scope.append(item);
        }
        card.append(scope);

        const why = document.createElement('p');
        appendTextElement(why, 'strong', '', '为什么是现在：');
        why.append(document.createTextNode(suggestion.whyNow));
        card.append(why);

        const beats = document.createElement('ol');
        beats.className = 'leslie-plot-beats';
        suggestion.beats.forEach(beat => appendTextElement(beats, 'li', '', beat));
        card.append(beats);

        const firstMove = document.createElement('blockquote');
        appendTextElement(firstMove, 'small', '', '可以这样开始');
        appendTextElement(firstMove, 'span', '', suggestion.firstMove);
        card.append(firstMove);

        const actions = document.createElement('div');
        actions.className = 'leslie-plot-suggestion-actions';
        const draftButton = appendTextElement(actions, 'button', '', '放入输入框');
        draftButton.type = 'button';
        draftButton.dataset.plotAction = 'draft';
        draftButton.dataset.plotSuggestionIndex = String(index);
        const acceptButton = appendTextElement(actions, 'button', 'primary', '采用并固定');
        acceptButton.type = 'button';
        acceptButton.dataset.plotAction = 'accept';
        acceptButton.dataset.plotSuggestionIndex = String(index);
        card.append(actions);
        fragment.append(card);
    });
    suggestionsList.replaceChildren(fragment);
}

function renderDialog() {
    if (!dialog) {
        return;
    }
    dialog.classList.toggle('is-loading', state.loading);
    refreshButton.disabled = state.loading || !isModelConnected();
    renderSuggestionCards();
    if (state.loading) {
        dialogStatus.textContent = state.correcting
            ? '正在校正三个剧情方向…'
            : '正在回顾当前剧情并规划跨阶段主线…';
    } else if (state.error) {
        dialogStatus.textContent = state.error;
    } else if (state.suggestions.length === 3) {
        dialogStatus.textContent = '采用只会固定一条可见主线，不会自动发送消息或替角色决定结果。';
    } else if (!isModelConnected()) {
        dialogStatus.textContent = '聊天模型尚未连接；连接后可以生成剧情方向。';
    } else {
        dialogStatus.textContent = '点击“换一组”生成三个方向。';
    }
}

function getPlanProgress(plan, turns) {
    let progress = plan.duration
        ? `${turns} / ${plan.duration.minTurns}–${plan.duration.maxTurns} 轮`
        : `${turns} 轮`;
    if (plan.duration && turns > plan.duration.maxTurns) {
        progress += ' · 可收束';
    }
    return progress;
}

function renderPlanDetails(container, plan, progressText) {
    if (!container) {
        return;
    }
    container.querySelectorAll('[data-plot-pin-title]').forEach(element => { element.textContent = plan.title; });
    container.querySelectorAll('[data-plot-pin-progress]').forEach(element => { element.textContent = progressText; });
    container.querySelectorAll('[data-plot-pin-goal]').forEach(element => { element.textContent = plan.goal; });
    container.querySelectorAll('[data-plot-pin-horizon]').forEach(element => { element.textContent = plan.timeHorizon; });
    container.querySelectorAll('[data-plot-pin-impact]').forEach(element => { element.textContent = plan.impact; });
    container.querySelectorAll('[data-plot-pin-beats]').forEach((beats) => {
        const beatFragment = document.createDocumentFragment();
        plan.beats.forEach(beat => appendTextElement(beatFragment, 'li', '', beat));
        beats.replaceChildren(beatFragment);
    });
    container.querySelectorAll('[data-plot-pin-warning]').forEach((warning) => {
        warning.hidden = !state.planWarning;
        warning.textContent = state.planWarning;
    });
    container.querySelectorAll('[data-plot-pin-action="pause"]').forEach((button) => {
        button.textContent = plan.status === 'paused' ? '继续' : '暂停';
    });
}

function renderPin() {
    createPin();
    updateLauncher();
    positionPinForViewport();
    if (!pin) {
        return;
    }
    const plan = isSoloStoryChat() ? getActivePlotPlan(chat_metadata, chat.length) : null;
    pin.hidden = !plan;
    if (!plan) {
        state.pinExpanded = false;
        if (mobilePinDialog?.open) {
            mobilePinDialog.close();
        }
        return;
    }
    const progressText = getPlanProgress(plan, countPlotTurns(chat, plan));
    pin.classList.toggle('is-paused', plan.status === 'paused');
    mobilePinDialog?.classList.toggle('is-paused', plan.status === 'paused');
    renderPlanDetails(pin, plan, progressText);
    renderPlanDetails(mobilePinDialog, plan, progressText);
    const detail = pin.querySelector('.leslie-plot-pin-detail');
    detail.hidden = MOBILE_PIN_MEDIA.matches || !state.pinExpanded;
    pin.querySelector('[data-plot-pin-action="toggle"]').setAttribute('aria-expanded', String(state.pinExpanded));
}

async function generateSuggestions({ force = false } = {}) {
    if (state.loading || !dialog?.open) {
        return;
    }
    if (!isSoloStoryChat()) {
        state.error = '剧情罗盘初版仅支持故事线中的单角色聊天。';
        renderDialog();
        return;
    }
    if (!isModelConnected()) {
        state.error = '请先连接聊天模型；普通聊天仍可继续使用。';
        renderDialog();
        return;
    }
    if (document.body.dataset.generating === 'true') {
        state.error = '角色正在回复，请等待本轮生成结束后再规划剧情。';
        renderDialog();
        return;
    }
    const contextKey = getContextKey();
    if (!force && state.contextKey === contextKey && state.suggestions.length === 3) {
        renderDialog();
        return;
    }

    abortGeneration();
    const requestSequence = ++state.requestSequence;
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    state.correcting = false;
    state.error = '';
    state.suggestions = [];
    renderDialog();

    try {
        const identity = getIdentity();
        const metadata = getMetadata();
        const history = [...metadata.history, ...(metadata.activePlan ? [metadata.activePlan] : [])];
        const requestSuggestions = async (correction) => {
            const durationEnabled = durationToggle.checked;
            const raw = await generateQuietPrompt({
                quietPrompt: buildPlotCompassPrompt({
                    ...identity,
                    durationEnabled,
                    intensity: intensitySelect.value,
                    history,
                    correction,
                }),
                responseLength: 2600,
                jsonSchema: getPlotCompassSchema({ durationEnabled }),
                signal: controller.signal,
                generationPurpose: LESLIE_PLOT_COMPASS_PURPOSE,
                removeReasoning: true,
            });
            return normalizePlotSuggestions(raw);
        };

        let suggestions = await requestSuggestions(false);
        if (suggestions.length !== 3) {
            if (requestSequence !== state.requestSequence || contextKey !== getContextKey()) {
                return;
            }
            state.correcting = true;
            renderDialog();
            suggestions = await requestSuggestions(true);
        }
        if (suggestions.length !== 3) {
            throw new Error('模型未能给出三个完整且不同的剧情方向，请换一组。');
        }
        if (requestSequence !== state.requestSequence || contextKey !== getContextKey()) {
            return;
        }
        state.suggestions = suggestions;
        state.contextKey = contextKey;
    } catch (error) {
        if (requestSequence !== state.requestSequence || controller.signal.aborted) {
            return;
        }
        console.warn('[Leslie Plot Compass] Could not generate plot directions.', error);
        state.error = error?.message || '剧情方向生成失败；普通聊天仍可继续使用。';
    } finally {
        if (requestSequence === state.requestSequence) {
            state.loading = false;
            state.correcting = false;
            state.controller = null;
            renderDialog();
        }
    }
}

function openCompass() {
    if (!dialog || !isSoloStoryChat()) {
        return;
    }
    if (!dialog.open) {
        dialog.showModal();
    }
    state.error = '';
    renderDialog();
    if (!state.suggestions.length || state.contextKey !== getContextKey()) {
        void generateSuggestions({ force: true });
    }
}

function closeCompass() {
    abortGeneration('The plot-compass dialog was closed.');
    if (dialog?.open) {
        dialog.close();
    }
}

function putSuggestionInComposer(suggestion) {
    const textarea = document.getElementById('send_textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
        return false;
    }
    if (textarea.value.trim()) {
        state.error = '输入框中已有草稿，未覆盖你的内容。';
        renderDialog();
        return false;
    }
    textarea.value = suggestion.firstMove;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    closeCompass();
    return true;
}

async function acceptSuggestion(suggestion) {
    const current = getMetadata();
    const lastMessage = chat[chat.length - 1];
    const plan = createPlotPlan(suggestion, {
        messageId: Math.max(0, chat.length - 1),
        swipeId: Number(lastMessage?.swipe_id ?? 0),
    });
    const history = [...current.history];
    if (current.activePlan) {
        history.push({
            ...current.activePlan,
            status: 'replaced',
            endedAtMessageId: Math.max(current.activePlan.acceptedAtMessageId, chat.length - 1),
        });
    }
    await persistMetadata({
        schemaVersion: LESLIE_PLOT_COMPASS_SCHEMA_VERSION,
        activePlan: plan,
        history,
    });
    state.planWarning = '';
    state.pinExpanded = true;
    closeCompass();
    renderPin();
    globalThis.toastr?.success('剧情主线已固定在聊天右上方。');
}

async function updatePlanStatus(action) {
    const metadata = getMetadata();
    const plan = metadata.activePlan;
    if (!plan) {
        return;
    }
    if (action === 'pause') {
        await persistMetadata({
            ...metadata,
            activePlan: { ...plan, status: plan.status === 'paused' ? 'active' : 'paused' },
        });
        return;
    }
    const status = action === 'complete' ? 'completed' : 'abandoned';
    await persistMetadata({
        schemaVersion: LESLIE_PLOT_COMPASS_SCHEMA_VERSION,
        activePlan: null,
        history: [...metadata.history, {
            ...plan,
            status,
            endedAtMessageId: Math.max(plan.acceptedAtMessageId, chat.length - 1),
        }],
    });
    state.pinExpanded = false;
    state.planWarning = '';
    if (mobilePinDialog?.open) {
        mobilePinDialog.close();
    }
    globalThis.toastr?.success(status === 'completed' ? '这条剧情主线已标记为完成。' : '这条剧情主线已放弃。');
}

function handleDialogClick(event) {
    if (event.target === dialog) {
        closeCompass();
        return;
    }
    const button = event.target instanceof Element ? event.target.closest('[data-plot-action]') : null;
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }
    const action = button.dataset.plotAction;
    if (action === 'close') {
        closeCompass();
    } else if (action === 'refresh') {
        void generateSuggestions({ force: true });
    } else if (action === 'draft' || action === 'accept') {
        const suggestion = state.suggestions[Number(button.dataset.plotSuggestionIndex)];
        if (!suggestion) {
            return;
        }
        if (action === 'draft') {
            putSuggestionInComposer(suggestion);
        } else {
            void acceptSuggestion(suggestion);
        }
    }
}

function handlePinClick(event) {
    if (event.target === mobilePinDialog) {
        mobilePinDialog.close();
        return;
    }
    const button = event.target instanceof Element ? event.target.closest('[data-plot-pin-action]') : null;
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }
    const action = button.dataset.plotPinAction;
    if (action === 'toggle') {
        if (MOBILE_PIN_MEDIA.matches) {
            state.pinExpanded = true;
            renderPin();
            if (!mobilePinDialog.open) {
                mobilePinDialog.showModal();
            }
        } else {
            state.pinExpanded = !state.pinExpanded;
            renderPin();
        }
        return;
    }
    if (action === 'close') {
        state.pinExpanded = false;
        if (mobilePinDialog?.open) {
            mobilePinDialog.close();
        }
        renderPin();
        return;
    }
    const plan = getActivePlotPlan(chat_metadata, chat.length);
    if (!plan) {
        return;
    }
    if (action === 'first-move') {
        const textarea = document.getElementById('send_textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) {
            return;
        }
        if (textarea.value.trim()) {
            globalThis.toastr?.info('输入框中已有草稿，未覆盖你的内容。');
            return;
        }
        textarea.value = plan.firstMove;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
        state.pinExpanded = false;
        if (mobilePinDialog?.open) {
            mobilePinDialog.close();
        }
        renderPin();
    } else if (['pause', 'complete', 'abandon'].includes(action)) {
        void updatePlanStatus(action);
    }
}

function invalidateGeneratedSuggestions({ warnPlan = false } = {}) {
    clearSuggestions();
    if (warnPlan && getActivePlotPlan(chat_metadata, chat.length)) {
        state.planWarning = '对话依据发生了变化，固定主线仍然保留；继续前请确认它是否仍然合适。';
    }
    renderPin();
}

function bindLifecycleEvents() {
    MOBILE_PIN_MEDIA.addEventListener('change', () => {
        if (!MOBILE_PIN_MEDIA.matches && mobilePinDialog?.open) {
            mobilePinDialog.close();
        }
        state.pinExpanded = false;
        positionPinForViewport();
        renderPin();
    });
    window.addEventListener(LESLIE_PLOT_COMPASS_CHANGED_EVENT, renderPin);
    for (const eventName of [event_types.CHAT_CHANGED, event_types.CHAT_LOADED]) {
        eventSource.on(eventName, () => {
            closeCompass();
            state.suggestions = [];
            state.contextKey = '';
            state.planWarning = '';
            window.setTimeout(() => {
                createLauncher();
                createPin();
                updateLauncher();
                void reconcileMetadataForBranch();
                renderPin();
            }, 0);
        });
    }
    for (const eventName of [
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_DELETED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_SWIPE_DELETED,
        event_types.PERSONA_CHANGED,
    ].filter(Boolean)) {
        eventSource.on(eventName, () => invalidateGeneratedSuggestions({ warnPlan: true }));
    }
    for (const eventName of [event_types.MESSAGE_SENT, event_types.MESSAGE_RECEIVED]) {
        eventSource.on(eventName, () => renderPin());
    }
    eventSource.on(event_types.CHARACTER_EDITED, () => invalidateGeneratedSuggestions());
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, () => {
        updateLauncher();
        renderDialog();
    });
}

function initLesliePlotCompass() {
    if (!createLauncher() || !createDialog()) {
        return;
    }
    createPin();
    bindLifecycleEvents();
    updateLauncher();
    void reconcileMetadataForBranch();
    renderPin();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLesliePlotCompass, { once: true });
} else {
    initLesliePlotCompass();
}
