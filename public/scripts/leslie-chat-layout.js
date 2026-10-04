/**
 * Leslie desktop chat shell.
 *
 * This module is a presentation adapter. It reads SillyTavern's live character
 * and group collections and calls their existing selection actions. It does not
 * own chat data, generation state, character cards, or memory data.
 */

import {
    chat_metadata,
    characters,
    clearChat,
    default_avatar,
    eventSource,
    event_types,
    getRequestHeaders,
    openCharacterChat,
    saveChatDebounced,
    saveMetadata,
    getThumbnailUrl,
    is_send_press,
    selectCharacterById,
    this_chid,
    updateChatMetadata,
} from '../script.js';
import {
    groups,
    openGroupById,
    selected_group,
} from './group-chats.js';
import { selectLatestCharacterChat } from './leslie-chat-selection.js';
import { runCharacterExport, syncCharacterExportMenuState } from './leslie-character-export.js';
import { getLeslieConnectionState } from './leslie-connection-state.js';
import { user_avatar } from './personas.js';
import { callGenericPopup, POPUP_TYPE } from './popup.js';
import { DREAMLAND_BRAND, BLUE_ARCHIVE_NOTICE } from './dreamland-brand.js';
import { getDreamlandPage, navigateDreamlandPage, returnToDreamlandChat, syncDreamlandPages, usesDreamlandPages } from './dreamland-pages.js';
import {
    beginRealitySession,
    getWorldLineKind,
    LESLIE_WORLD_LINE_METADATA_KEY,
    selectWorldLineChat,
    shouldGenerateRealitySessionOpening,
    touchRealitySession,
} from './leslie-reality-context.js';

const MOBILE_BREAKPOINT = 700;
const MOBILE_HISTORY_KEY = 'leslieMobileView';

const layoutState = {
    filter: 'all',
    query: '',
    renderFrame: 0,
    previewTimer: 0,
    latestPreviews: new Map(),
    mobileView: 'list',
};

let sidebar;
let conversationList;
let searchInput;
let workspaceBackdrop;
let chatTransitionSequence = 0;
let chatCreationTask = null;
let realitySessionChatId = '';
let realitySessionTask = null;
let worldLineSwitchTask = null;

async function cancelPendingRealityTasks() {
    if (typeof globalThis.LeslieRealityCancelPending === 'function') {
        await globalThis.LeslieRealityCancelPending();
    }
}

function getLayoutEnabled() {
    return true;
}

function isMobileLayout() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

function updateMobileAccessibility(chatOpen) {
    const shell = document.getElementById('sheld');
    if (usesDreamlandPages() && getDreamlandPage() !== 'chat') {
        shell?.setAttribute('inert', '');
        shell?.setAttribute('aria-hidden', 'true');
        sidebar?.toggleAttribute('inert', isMobileLayout());
        sidebar?.setAttribute('aria-hidden', String(isMobileLayout()));
        return;
    }
    if (!isMobileLayout() || !getLayoutEnabled()) {
        sidebar?.removeAttribute('aria-hidden');
        sidebar?.removeAttribute('inert');
        shell?.removeAttribute('aria-hidden');
        shell?.removeAttribute('inert');
        return;
    }

    sidebar?.toggleAttribute('inert', chatOpen);
    sidebar?.setAttribute('aria-hidden', String(chatOpen));
    shell?.toggleAttribute('inert', !chatOpen);
    shell?.setAttribute('aria-hidden', String(!chatOpen));
}

function setMobileView(view, { historyMode = 'none', focus = false } = {}) {
    const chatOpen = view === 'chat' && Boolean(getActiveEntity());
    layoutState.mobileView = chatOpen ? 'chat' : 'list';
    document.body.classList.toggle('leslie-mobile-chat-open', chatOpen && getLayoutEnabled());
    updateMobileAccessibility(chatOpen);

    if (isMobileLayout() && historyMode !== 'none') {
        const nextState = { ...(history.state ?? {}), [MOBILE_HISTORY_KEY]: layoutState.mobileView };
        history[historyMode === 'push' ? 'pushState' : 'replaceState'](nextState, '');
    }

    if (focus && isMobileLayout()) {
        window.setTimeout(() => {
            const target = chatOpen
                ? document.querySelector('.leslie-mobile-back')
                : searchInput;
            target?.focus({ preventScroll: true });
        }, 210);
    }
}

function initializeMobileNavigation() {
    if (!isMobileLayout()) {
        updateMobileAccessibility(false);
        return;
    }
    setMobileView('list', { historyMode: 'replace' });
}

function returnToConversationList() {
    if (isMobileLayout() && history.state?.[MOBILE_HISTORY_KEY] === 'chat') {
        history.back();
        return;
    }
    setMobileView('list', { historyMode: 'replace', focus: true });
}

function syncResponsiveNavigation() {
    if (!getLayoutEnabled()) {
        updateMobileAccessibility(false);
        return;
    }
    if (!isMobileLayout()) {
        document.body.classList.remove('leslie-mobile-chat-open');
        updateMobileAccessibility(false);
        return;
    }
    setMobileView(layoutState.mobileView);
}

function createIconButton({ action, icon, label, className = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `leslie-icon-button ${className}`.trim();
    button.dataset.action = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
    return button;
}

function createSidebar() {
    const sheld = document.getElementById('sheld');
    if (!sheld || document.getElementById('leslie-conversation-sidebar')) {
        return;
    }

    sidebar = document.createElement('aside');
    sidebar.id = 'leslie-conversation-sidebar';
    sidebar.setAttribute('aria-label', '角色与会话');
    sidebar.innerHTML = `
        <header class="leslie-sidebar-header">
            <div class="leslie-brand" aria-label="DreamLand">
                <span class="leslie-brand-mark"><img src="${DREAMLAND_BRAND.icon}" alt=""></span>
                <span class="leslie-brand-copy"><strong>DreamLand</strong><small>故事与陪伴的归处</small></span>
                <span class="dreamland-momotalk-brand"><span class="dreamland-momotalk-peach" aria-hidden="true"></span><span><strong>MomoTalk</strong><small>DreamLand · 故事与陪伴</small></span></span>
            </div>
            <div class="leslie-sidebar-actions"></div>
        </header>
        <nav class="dreamland-navigation" aria-label="DreamLand 导航">
            <button type="button" data-action="home" title="首页"><i class="fa-solid fa-house" aria-hidden="true"></i><span>首页</span></button>
            <button type="button" data-action="chat" title="继续最近的聊天"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i><span>聊天</span></button>
            <button type="button" data-action="moments" title="朋友圈"><i class="fa-solid fa-camera-retro" aria-hidden="true"></i><span>朋友圈</span></button>
            <button type="button" data-action="workshop" title="角色工坊"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>工坊</span></button>
            <button type="button" data-action="settings" title="设置"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>设置</span></button>
        </nav>
        <div class="leslie-sidebar-tools">
            <label class="leslie-conversation-search" for="leslie-conversation-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input id="leslie-conversation-search" type="search" autocomplete="off" placeholder="搜索角色或群聊">
                <button type="button" data-action="clear-search" aria-label="清除搜索" title="清除搜索">
                    <i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>
                </button>
            </label>
            <nav class="leslie-conversation-filters" aria-label="会话筛选">
                <button type="button" class="is-active" data-filter="all" aria-pressed="true">全部</button>
                <button type="button" data-filter="character" aria-pressed="false">角色</button>
                <button type="button" data-filter="group" aria-pressed="false">群聊</button>
            </nav>
        </div>
        <div id="leslie-conversation-list" class="leslie-conversation-list" role="listbox" aria-label="会话列表"></div>
        <footer class="leslie-sidebar-footer">
            <button type="button" class="leslie-connection-card" data-action="settings">
                <span class="leslie-connection-dot" aria-hidden="true"></span>
                <span><strong data-leslie-connection-label>模型未连接</strong><small data-leslie-connection-detail>点击配置模型与 API</small></span>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
        </footer>
    `;

    const actions = sidebar.querySelector('.leslie-sidebar-actions');
    actions.append(
        createIconButton({ action: 'create-character', icon: 'fa-pen-to-square', label: '新建角色' }),
        createIconButton({ action: 'settings', icon: 'fa-gear', label: '设置' }),
    );

    conversationList = sidebar.querySelector('#leslie-conversation-list');
    searchInput = sidebar.querySelector('#leslie-conversation-search');
    document.body.insertBefore(sidebar, sheld);
}

function ensureChatHeader() {
    const header = document.getElementById('leslie-chat-header');
    if (!header || header.dataset.leslieShellReady === 'true') {
        return;
    }

    header.dataset.leslieShellReady = 'true';
    header.replaceChildren();

    const backButton = createIconButton({ action: 'mobile-back', icon: 'fa-arrow-left', label: '返回会话列表', className: 'leslie-mobile-back' });
    const identity = document.createElement('div');
    identity.className = 'leslie-chat-identity';
    identity.innerHTML = `
        <span class="leslie-chat-avatar" id="leslie-chat-avatar">
            <img alt="" hidden>
            <i class="fa-solid fa-user" aria-hidden="true"></i>
        </span>
        <span class="leslie-chat-heading">
            <strong id="leslie-chat-name">选择一个角色</strong>
            <small id="leslie-chat-status">从左侧开始一段对话</small>
        </span>
    `;
    identity.tabIndex = 0;
    identity.setAttribute('role', 'button');
    identity.setAttribute('aria-label', '打开当前角色卡');
    identity.dataset.action = 'character-card';

    const actions = document.createElement('div');
    actions.id = 'leslie-chat-actions';
    actions.className = 'leslie-chat-actions';
    actions.append(
        createIconButton({ action: 'new-chat', icon: 'fa-plus', label: '新建当前世界线会话' }),
        createIconButton({ action: 'chat-more', icon: 'fa-ellipsis-vertical', label: '更多会话操作' }),
    );
    const newChatLabel = document.createElement('span');
    newChatLabel.className = 'leslie-new-chat-label';
    actions.querySelector('[data-action="new-chat"]').append(newChatLabel);

    const worldLineSwitch = document.createElement('div');
    worldLineSwitch.className = 'leslie-world-line-switch';
    worldLineSwitch.setAttribute('role', 'group');
    worldLineSwitch.setAttribute('aria-label', '聊天世界线');
    worldLineSwitch.innerHTML = `
        <button type="button" data-action="line-story" data-world-line="story"><i class="fa-solid fa-book-open"></i><span>故事线</span></button>
        <button type="button" data-action="line-reality" data-world-line="reality"><i class="fa-solid fa-earth-asia"></i><span>现实线</span></button>`;

    const menu = document.createElement('div');
    menu.id = 'leslie-chat-more-menu';
    menu.className = 'leslie-chat-more-menu';
    menu.hidden = true;
    menu.innerHTML = `
        <button type="button" data-action="manage-chats"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i><span>历史会话</span></button>
        <button type="button" data-action="world-info"><i class="fa-solid fa-book-atlas" aria-hidden="true"></i><span>世界设定</span></button>
        <details class="leslie-chat-tools"><summary><i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i><span>聊天工具</span></summary>
            <button type="button" data-action="tool-regenerate"><i class="fa-solid fa-repeat" aria-hidden="true"></i><span>重新生成</span></button>
            <button type="button" data-action="tool-continue"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>继续回复</span></button>
            <button type="button" data-action="tool-delete-messages"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>删除消息</span></button>
            <button type="button" data-action="tool-impersonate"><i class="fa-solid fa-user-secret" aria-hidden="true"></i><span>代写用户消息</span></button>
            <button type="button" data-action="tool-author-note"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i><span>作者注释</span></button>
            <button type="button" data-action="tool-cfg"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i><span>CFG</span></button>
            <button type="button" data-action="tool-logprobs"><i class="fa-solid fa-pie-chart" aria-hidden="true"></i><span>Token 概率</span></button>
            <button type="button" data-action="tool-checkpoint"><i class="fa-solid fa-flag" aria-hidden="true"></i><span>保存检查点</span></button>
            <button type="button" data-action="tool-parent"><i class="fa-solid fa-left-long" aria-hidden="true"></i><span>返回父会话</span></button>
            <button type="button" data-action="tool-convert-group"><i class="fa-solid fa-people-arrows" aria-hidden="true"></i><span>转换为群聊</span></button>
            <button type="button" data-action="tool-close-chat"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span>关闭聊天</span></button>
        </details>
        <hr>
        <button type="button" data-action="export-character" data-character-export-only><i class="fa-solid fa-address-card" aria-hidden="true"></i><span>导出角色卡（PNG）</span></button>
        <button type="button" data-action="export-chat"><i class="fa-solid fa-file-lines" aria-hidden="true"></i><span>导出当前聊天（JSONL）</span></button>
        <button type="button" data-action="export-character-bundle" data-character-export-only><i class="fa-solid fa-file-zipper" aria-hidden="true"></i><span>导出角色卡与全部聊天（ZIP）</span></button>
    `;

    header.append(backButton, identity, worldLineSwitch, actions, menu);
    relocateMemoryLauncher();
}

function createWorkspaceBackdrop() {
    if (document.getElementById('leslie-workspace-backdrop')) {
        return;
    }
    workspaceBackdrop = document.createElement('button');
    workspaceBackdrop.id = 'leslie-workspace-backdrop';
    workspaceBackdrop.type = 'button';
    workspaceBackdrop.tabIndex = -1;
    workspaceBackdrop.setAttribute('aria-label', '关闭高级工作区');
    workspaceBackdrop.addEventListener('click', closeOpenDrawers);
    document.body.append(workspaceBackdrop);
}

function ensureChatHistoryDialog() {
    let dialog = document.getElementById('leslie-chat-history');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'leslie-chat-history';
    dialog.className = 'leslie-chat-history';
    dialog.setAttribute('aria-labelledby', 'leslie-chat-history-title');
    dialog.innerHTML = '<header><strong id="leslie-chat-history-title">历史会话</strong><button type="button" data-close aria-label="关闭历史会话"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header><div class="leslie-chat-history-list"></div>';
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
    return dialog;
}

async function populateCharacterChatHistory(active, dialog) {
    const list = dialog.querySelector('.leslie-chat-history-list');
    list.replaceChildren();
    const history = await getCharacterChatHistory(Number(active.id), { metadata: true });
    const visible = getVisibleCharacterChatHistory(history);
    if (!visible.length) {
        const empty = document.createElement('p');
        empty.textContent = '这个角色还没有历史会话。';
        list.append(empty);
    }
    visible.forEach(item => {
        const fileName = String(item.file_id || item.file_name || '').replace(/\.jsonl$/i, '');
        if (!fileName) return;
        const entry = document.createElement('div');
        entry.className = 'leslie-chat-history-entry';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'leslie-chat-history-open';
        const label = document.createElement('strong');
        label.textContent = fileName;
        const detail = document.createElement('small');
        const line = getWorldLineKind(item.chat_metadata) === 'reality' ? '现实线' : '故事线';
        const date = new Date(getTimestamp(item.last_mes));
        detail.textContent = `${line} · ${getTimestamp(item.last_mes) ? date.toLocaleString('zh-CN') : '时间未知'} · ${Number(item.chat_items) || 0} 条消息`;
        button.append(label, detail);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await cancelPendingRealityTasks();
                await touchCurrentRealitySession({ immediate: true });
                realitySessionChatId = '';
                await openCharacterChat(fileName);
                dialog.close();
                updateHeader();
            } catch (error) {
                button.disabled = false;
                console.error('[Leslie chat layout] Could not open history chat.', error);
                globalThis.toastr?.error('无法打开这条历史会话。');
            }
        });
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'leslie-chat-history-delete';
        deleteButton.setAttribute('aria-label', `删除会话 ${fileName}`);
        deleteButton.title = '删除会话';
        deleteButton.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>';
        deleteButton.addEventListener('click', () => {
            if (is_send_press) {
                globalThis.toastr?.info('请等待当前回复结束后再删除会话。');
                return;
            }
            dialog.querySelectorAll('.leslie-chat-history-confirm').forEach(node => node.remove());
            const confirmation = document.createElement('div');
            confirmation.className = 'leslie-chat-history-confirm';
            const warning = document.createElement('p');
            warning.textContent = `永久删除“${fileName}”及其中的聊天记录？此操作无法撤销。`;
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = '取消';
            cancel.addEventListener('click', () => { confirmation.remove(); deleteButton.focus(); });
            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'is-danger';
            confirm.textContent = '确认删除';
            confirm.addEventListener('click', async () => {
                confirm.disabled = true;
                try {
                    await cancelPendingRealityTasks();
                    const response = await fetch('/api/chats/delete', {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: active.item.avatar }),
                    });
                    const result = await response.json().catch(() => null);
                    if (!response.ok || result?.ok !== true) throw new Error('删除会话失败。');
                    confirmation.remove();
                    const preview = layoutState.latestPreviews.get(active.key);
                    if (preview?.chatId === fileName) {
                        layoutState.latestPreviews.delete(active.key);
                    }
                    if (String(active.id) === String(this_chid) && characters[this_chid]?.chat === fileName) {
                        // The deleted file must never remain visible while the next
                        // history lookup or chat load is still in progress.
                        clearTimeout(layoutState.previewTimer);
                        try {
                            await clearChat({ clearData: true });
                        } catch (error) {
                            console.warn('[Leslie chat layout] Could not finish clearing deleted chat state.', error);
                        }
                        scheduleConversationRender();
                        realitySessionChatId = '';
                        try {
                            const remaining = getVisibleCharacterChatHistory(await getCharacterChatHistory(Number(active.id), { metadata: true }));
                            const nextName = String(remaining[0]?.file_id || remaining[0]?.file_name || '').replace(/\.jsonl$/i, '');
                            if (nextName) await openCharacterChat(nextName);
                            else await createStoryChat(active);
                        } catch (error) {
                            console.error('[Leslie chat layout] Deleted the chat but could not open another.', error);
                            try {
                                await createStoryChat(active);
                            } catch (fallbackError) {
                                console.error('[Leslie chat layout] Could not create a replacement chat.', fallbackError);
                                globalThis.toastr?.warning('会话已删除，但切换到其他会话失败，请重新选择角色。');
                            }
                        }
                    }
                    try {
                        await eventSource.emit(event_types.CHAT_DELETED, fileName);
                    } catch (error) {
                        console.warn('[Leslie chat layout] Chat deletion event failed.', error);
                    }
                    try {
                        await populateCharacterChatHistory(active, dialog);
                    } catch (error) {
                        console.warn('[Leslie chat layout] Deleted the chat but could not refresh history.', error);
                        globalThis.toastr?.warning('会话已删除，历史列表刷新失败，请重新打开历史会话。');
                    }
                    updateHeader();
                    scheduleConversationRender();
                } catch (error) {
                    confirm.disabled = false;
                    console.error('[Leslie chat layout] Could not delete history chat.', error);
                    globalThis.toastr?.error(error?.message || '删除会话失败。');
                }
            });
            confirmation.append(warning, cancel, confirm);
            entry.append(confirmation);
            confirm.focus();
        });
        entry.append(button, deleteButton);
        list.append(entry);
    });
}

function getVisibleCharacterChatHistory(history) {
    const personaKey = String(user_avatar || '').trim();
    return history.filter(item => {
        if (getWorldLineKind(item?.chat_metadata) !== 'reality') return true;
        const boundPersona = String(item.chat_metadata?.[LESLIE_WORLD_LINE_METADATA_KEY]?.personaSourceKey || '').trim();
        return !boundPersona || boundPersona === personaKey;
    }).sort((left, right) => getTimestamp(right.last_mes) - getTimestamp(left.last_mes));
}

async function openCharacterChatHistory(active) {
    const dialog = ensureChatHistoryDialog();
    await populateCharacterChatHistory(active, dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

function getCharacterAvatar(character) {
    try {
        return character?.avatar && character.avatar !== 'none'
            ? getThumbnailUrl('avatar', character.avatar)
            : default_avatar;
    } catch {
        return default_avatar;
    }
}

function getGroupAvatar(group) {
    const escapedId = globalThis.CSS?.escape ? CSS.escape(String(group?.id ?? '')) : String(group?.id ?? '');
    const renderedAvatar = document.querySelector(`#rm_print_characters_block .group_select[data-grid="${escapedId}"] img`)?.src;
    return renderedAvatar || group?.avatar_url || '';
}

function getTimestamp(value) {
    if (!value) {
        return 0;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatConversationTime(timestamp) {
    if (!timestamp) {
        return '';
    }
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    if (now.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000) {
        return date.toLocaleDateString('zh-CN', { weekday: 'short' });
    }
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function getActiveEntity() {
    if (selected_group) {
        const group = groups.find(item => String(item.id) === String(selected_group));
        return group ? {
            type: 'group',
            key: `group:${group.id}`,
            id: group.id,
            name: group.name || '未命名群聊',
            avatar: getGroupAvatar(group),
            item: group,
        } : null;
    }
    if (this_chid !== undefined && characters[this_chid]) {
        const character = characters[this_chid];
        return {
            type: 'character',
            key: `character:${this_chid}`,
            id: this_chid,
            name: character.name || '未命名角色',
            avatar: getCharacterAvatar(character),
            item: character,
        };
    }
    return null;
}

function getConversationEntities() {
    const characterItems = characters.map((character, id) => ({
        type: 'character',
        key: `character:${id}`,
        id,
        name: character.name || '未命名角色',
        avatar: getCharacterAvatar(character),
        timestamp: getTimestamp(character.date_last_chat),
        preview: (layoutState.latestPreviews.get(`character:${id}`)?.chatId === character.chat
            ? layoutState.latestPreviews.get(`character:${id}`)?.text : '')
            || (character.chat ? '继续最近的角色对话' : '开始一段新的角色对话'),
    }));
    const groupItems = groups.map(group => ({
        type: 'group',
        key: `group:${group.id}`,
        id: group.id,
        name: group.name || '未命名群聊',
        avatar: getGroupAvatar(group),
        timestamp: getTimestamp(group.date_last_chat || group.chat_metadata?.last_mes),
        preview: layoutState.latestPreviews.get(`group:${group.id}`)?.text
            || `${group.members?.length ?? 0} 位角色参与`,
    }));

    const query = layoutState.query.trim().toLocaleLowerCase('zh-CN');
    return [...characterItems, ...groupItems]
        .filter(item => layoutState.filter === 'all' || item.type === layoutState.filter)
        .filter(item => !query || `${item.name} ${item.preview}`.toLocaleLowerCase('zh-CN').includes(query))
        .sort((left, right) => right.timestamp - left.timestamp || left.name.localeCompare(right.name, 'zh-CN'));
}

async function getLatestCharacterChat(characterId) {
    const character = characters[characterId];
    if (!character?.avatar) {
        return null;
    }
    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ avatar_url: character.avatar }),
    });
    if (!response.ok) {
        throw new Error(`Could not read chat history (${response.status}).`);
    }
    const history = await response.json();
    if (history?.error === true) {
        return null;
    }
    return selectLatestCharacterChat(history);
}

async function getCharacterChatHistory(characterId, { metadata = false } = {}) {
    const character = characters[characterId];
    if (!character?.avatar) {
        return [];
    }
    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ avatar_url: character.avatar, metadata }),
    });
    if (!response.ok) {
        throw new Error(`Could not read chat history (${response.status}).`);
    }
    const history = await response.json();
    return Array.isArray(history) ? history : [];
}

async function createRealityChat(active) {
    if (typeof globalThis.LeslieRealityPrepareOpening !== 'function') {
        throw new Error('现实世界线模块尚未加载，请刷新页面后重试。');
    }
    const characterId = this_chid;
    const sourceChatId = String(characters[characterId]?.chat || '');
    const history = await getCharacterChatHistory(Number(active.id), { metadata: true });
    const previous = selectWorldLineChat(history, 'reality', user_avatar);
    const prepared = await globalThis.LeslieRealityPrepareOpening({
        personaSourceKey: user_avatar,
        previousMetadata: previous?.chat_metadata?.[LESLIE_WORLD_LINE_METADATA_KEY] ?? null,
    });
    if (this_chid !== characterId || String(characters[characterId]?.chat || '') !== sourceChatId) {
        throw new Error('生成开场期间当前会话已经改变，请重新进入现实世界线。');
    }
    const chatName = `${active.name} - 现实世界线 - ${Date.now()}`;
    // The seeded first message is already this entry's greeting. Mark the chat
    // before CHAT_LOADED fires so the session hook cannot append a duplicate.
    realitySessionChatId = chatName;
    try {
        await openCharacterChat(chatName, {
            initialMetadata: {
                [LESLIE_WORLD_LINE_METADATA_KEY]: prepared.metadata,
            },
            initialAssistantMessage: {
                text: prepared.text,
                extra: prepared.extra,
            },
        });
    } catch (error) {
        realitySessionChatId = '';
        throw error;
    }
}

async function createStoryChat(active) {
    await openCharacterChat(`${active.name} - 故事线 - ${Date.now()}`, {
        initialMetadata: {
            [LESLIE_WORLD_LINE_METADATA_KEY]: {
                schemaVersion: 1,
                kind: 'story',
                createdAt: new Date().toISOString(),
            },
        },
    });
}

async function createCurrentLineChat() {
    const active = getActiveEntity();
    if (chatCreationTask) return chatCreationTask;
    if (worldLineSwitchTask) return;
    if (!active || is_send_press) {
        if (is_send_press) globalThis.toastr?.info('请等待当前回复结束后再新建会话。');
        return;
    }
    if (active.type === 'group') {
        document.getElementById('option_start_new_chat')?.click();
        return;
    }
    chatCreationTask = (async () => {
        document.body.classList.add('leslie-chat-transitioning');
        try {
            await cancelPendingRealityTasks();
            await touchCurrentRealitySession({ immediate: true });
            if (getWorldLineKind(chat_metadata) === 'reality') {
                await createRealityChat(active);
            } else {
                await createStoryChat(active);
            }
        } catch (error) {
            console.error('[Leslie chat layout] Could not create chat.', error);
            globalThis.toastr?.error(error?.message || '无法创建新会话。');
        } finally {
            document.body.classList.remove('leslie-chat-transitioning');
        }
    })();
    updateHeader();
    try {
        await chatCreationTask;
    } finally {
        chatCreationTask = null;
        updateHeader();
    }
}

async function beginCurrentRealitySession() {
    if (getWorldLineKind(chat_metadata) !== 'reality') {
        realitySessionChatId = '';
        return;
    }
    const chatId = String(characters[this_chid]?.chat || '');
    if (realitySessionTask?.chatId === chatId) {
        return realitySessionTask.promise;
    }
    if (!chatId || realitySessionChatId === chatId) {
        return;
    }
    const previousMetadata = chat_metadata?.[LESLIE_WORLD_LINE_METADATA_KEY];
    realitySessionChatId = chatId;
    const promise = (async () => {
        const nextMetadata = beginRealitySession(previousMetadata, {
            personaSourceKey: user_avatar,
        });
        updateChatMetadata({
            [LESLIE_WORLD_LINE_METADATA_KEY]: nextMetadata,
        });
        await saveMetadata();
        updateHeader();
        if (shouldGenerateRealitySessionOpening(nextMetadata)
            && typeof globalThis.LeslieRealityGenerateSessionOpening === 'function') {
            try {
                await globalThis.LeslieRealityGenerateSessionOpening();
            } catch (error) {
                console.error('[Leslie chat layout] Could not generate reality session opening.', error);
                globalThis.toastr?.warning('这次主动消息没有生成成功，你仍然可以正常发送消息。');
            }
        }
    })();
    realitySessionTask = { chatId, promise };
    try {
        await promise;
    } catch (error) {
        if (realitySessionChatId === chatId) {
            realitySessionChatId = '';
        }
        throw error;
    } finally {
        if (realitySessionTask?.promise === promise) {
            realitySessionTask = null;
        }
    }
}

async function touchCurrentRealitySession({ immediate = false } = {}) {
    if (getWorldLineKind(chat_metadata) !== 'reality') {
        return;
    }
    updateChatMetadata({
        [LESLIE_WORLD_LINE_METADATA_KEY]: touchRealitySession(chat_metadata?.[LESLIE_WORLD_LINE_METADATA_KEY]),
    });
    if (immediate) {
        await saveMetadata();
    } else {
        saveChatDebounced();
    }
}

async function switchWorldLine(kind) {
    const requested = kind === 'reality' ? 'reality' : 'story';
    const active = getActiveEntity();
    if (!active || active.type !== 'character') {
        globalThis.toastr?.info('现实世界线目前先支持单角色聊天；群聊会继续使用故事线。');
        return;
    }
    if (is_send_press) {
        globalThis.toastr?.info('请等待当前回复结束后再切换世界线。');
        return;
    }
    if (getWorldLineKind(chat_metadata) === requested) {
        return;
    }
    await cancelPendingRealityTasks();
    await touchCurrentRealitySession({ immediate: true });
    document.body.classList.add('leslie-chat-transitioning');
    try {
        const history = await getCharacterChatHistory(Number(active.id), { metadata: true });
        const target = selectWorldLineChat(history, requested, user_avatar);
        realitySessionChatId = '';
        if (target) {
            await openCharacterChat(String(target.file_id || target.file_name || '').replace(/\.jsonl$/i, ''));
        } else if (requested === 'reality') {
            await createRealityChat(active);
        } else {
            await createStoryChat(active);
        }
        if (requested === 'reality') {
            await beginCurrentRealitySession();
        }
        updateHeader();
        scheduleConversationRender();
    } catch (error) {
        console.error('[Leslie chat layout] Could not switch world lines.', error);
        globalThis.toastr?.error('世界线切换失败，原聊天没有被删除。');
    } finally {
        requestAnimationFrame(() => document.body.classList.remove('leslie-chat-transitioning'));
    }
}

async function switchWorldLineSafely(kind) {
    if (worldLineSwitchTask || chatCreationTask) return;
    worldLineSwitchTask = Promise.resolve().then(() => switchWorldLine(kind));
    updateHeader();
    try {
        await worldLineSwitchTask;
    } finally {
        worldLineSwitchTask = null;
        updateHeader();
    }
}

function buildAvatar(entity, className = '') {
    const avatar = document.createElement('span');
    avatar.className = `leslie-conversation-avatar ${className}`.trim();
    if (entity.avatar) {
        const image = document.createElement('img');
        image.src = entity.avatar;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => {
            image.remove();
            avatar.classList.add('is-fallback');
        }, { once: true });
        avatar.append(image);
    } else {
        avatar.classList.add('is-fallback');
    }
    const fallback = document.createElement('i');
    fallback.className = `fa-solid ${entity.type === 'group' ? 'fa-user-group' : 'fa-user'}`;
    fallback.setAttribute('aria-hidden', 'true');
    avatar.append(fallback);
    return avatar;
}

function renderConversationList() {
    if (!conversationList) {
        return;
    }
    const active = getActiveEntity();
    const entities = getConversationEntities();
    const fragment = document.createDocumentFragment();

    if (!entities.length) {
        const empty = document.createElement('div');
        empty.className = 'leslie-conversation-empty';
        empty.innerHTML = layoutState.query
            ? '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><strong>没有找到对应会话</strong><span>换一个名称或清除搜索试试</span>'
            : '<i class="fa-regular fa-comments" aria-hidden="true"></i><strong>还没有角色会话</strong><span>打开角色工坊创建或导入角色</span>';
        fragment.append(empty);
    }

    entities.forEach((entity) => {
        const selected = active?.key === entity.key;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `leslie-conversation-item${selected ? ' is-active' : ''}`;
        button.dataset.entityType = entity.type;
        button.dataset.entityId = String(entity.id);
        button.dataset.entityKey = entity.key;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(selected));
        button.append(buildAvatar(entity));

        const copy = document.createElement('span');
        copy.className = 'leslie-conversation-copy';
        const row = document.createElement('span');
        row.className = 'leslie-conversation-primary';
        const name = document.createElement('strong');
        name.textContent = entity.name;
        const time = document.createElement('time');
        time.textContent = formatConversationTime(entity.timestamp);
        row.append(name, time);
        const preview = document.createElement('span');
        preview.className = 'leslie-conversation-preview';
        preview.textContent = entity.preview;
        copy.append(row, preview);
        button.append(copy);
        fragment.append(button);
    });

    conversationList.replaceChildren(fragment);
    updateHeader();
    updateConnectionState();
}

function scheduleConversationRender() {
    cancelAnimationFrame(layoutState.renderFrame);
    layoutState.renderFrame = requestAnimationFrame(renderConversationList);
}

function readLatestMessagePreview() {
    clearTimeout(layoutState.previewTimer);
    layoutState.previewTimer = window.setTimeout(() => {
        const active = getActiveEntity();
        const text = document.querySelector('#chat .mes:last-of-type .mes_text')?.textContent?.replace(/\s+/g, ' ').trim();
        if (active) {
            if (text) {
                layoutState.latestPreviews.set(active.key, {
                    chatId: active.type === 'character' ? active.item.chat : '',
                    text: text.slice(0, 96),
                });
            } else {
                layoutState.latestPreviews.delete(active.key);
            }
        }
        scheduleConversationRender();
    }, 160);
}

function updateHeader() {
    const active = getActiveEntity();
    const homeOpen = document.body.classList.contains('leslie-home-open')
        && !document.body.classList.contains('leslie-chat-layout-disabled')
        && !active;
    const name = document.getElementById('leslie-chat-name');
    const status = document.getElementById('leslie-chat-status');
    const avatar = document.getElementById('leslie-chat-avatar');
    const image = avatar?.querySelector('img');
    const fallback = avatar?.querySelector('i');
    const newChatButton = document.querySelector('#leslie-chat-actions [data-action="new-chat"]');

    if (name) {
        name.textContent = active?.name || (homeOpen ? '首页' : '选择一个角色');
    }
    if (status) {
        const connectionState = getLeslieConnectionState();
        const worldLineLabel = active?.type === 'character'
            ? getWorldLineKind(chat_metadata) === 'reality' ? '现实世界线' : '故事线'
            : '群聊故事线';
        status.textContent = active
            ? `${worldLineLabel} · ${connectionState.checking ? '正在检测模型' : connectionState.connected ? '模型已连接' : '模型未连接'}`
            : homeOpen ? '继续对话、查看角色动态或开始新的故事' : '从左侧开始一段对话';
    }
    if (image instanceof HTMLImageElement) {
        image.hidden = !active?.avatar;
        image.src = active?.avatar || '';
        image.alt = active ? `${active.name}头像` : '';
    }
    if (fallback) {
        fallback.hidden = Boolean(active?.avatar);
        fallback.className = `fa-solid ${active?.type === 'group' ? 'fa-user-group' : homeOpen ? 'fa-house' : 'fa-user'}`;
    }
    if (newChatButton instanceof HTMLButtonElement) {
        newChatButton.disabled = !active || is_send_press || Boolean(chatCreationTask || worldLineSwitchTask);
        newChatButton.title = active?.type === 'group' ? '新建群聊会话'
            : getWorldLineKind(chat_metadata) === 'reality' ? '新建现实线会话' : '新建故事线会话';
        newChatButton.setAttribute('aria-label', newChatButton.title);
        newChatButton.dataset.worldLine = active?.type === 'group' ? 'group' : getWorldLineKind(chat_metadata);
        newChatButton.querySelector('.leslie-new-chat-label').textContent = newChatButton.title.replace('会话', '');
    }
    document.querySelectorAll('.leslie-world-line-switch [data-world-line]').forEach((button) => {
        const line = button.getAttribute('data-world-line');
        const selected = Boolean(active && (active.type === 'group' ? line === 'story' : getWorldLineKind(chat_metadata) === line));
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.toggleAttribute('disabled', active?.type !== 'character' || is_send_press || Boolean(chatCreationTask || worldLineSwitchTask));
        button.title = active?.type === 'group' ? '群聊目前仅支持故事线' : line === 'story' ? '切换到故事线' : '切换到现实线';
    });
    syncCharacterExportMenuState();
    document.querySelector('.leslie-chat-identity')?.setAttribute('aria-disabled', String(!active));
    relocateMemoryLauncher();
}

function updateConnectionState() {
    const { connected, configured, checking } = getLeslieConnectionState();
    sidebar?.classList.toggle('is-connected', connected);
    sidebar?.classList.toggle('is-configured', configured && !connected);
    sidebar?.classList.toggle('is-checking', checking);
    const label = sidebar?.querySelector('[data-leslie-connection-label]');
    const detail = sidebar?.querySelector('[data-leslie-connection-detail]');
    if (label) {
        label.textContent = checking ? '正在检测 API 连接' : connected ? '模型已连接' : configured ? 'API 已配置' : '尚未配置模型';
    }
    if (detail) {
        detail.textContent = checking ? '正在读取设置并验证服务，请稍候' : connected ? '点击查看当前模型设置' : configured ? '点击连接或检查模型' : '点击选择 API 并完成配置';
    }
    const sendTextarea = document.getElementById('send_textarea');
    if (sendTextarea instanceof HTMLTextAreaElement && usesDreamlandPages()) {
        syncComposerPlaceholder();
    } else if (sendTextarea instanceof HTMLTextAreaElement) {
        sendTextarea.dataset.leslieConnectedPlaceholder ||= sendTextarea.placeholder;
        sendTextarea.placeholder = connected
            ? sendTextarea.dataset.leslieConnectedPlaceholder
            : checking ? '正在检测 API 连接…' : configured ? 'API 已配置，请先连接模型' : '尚未配置 API，点击左下角开始设置';
    }
    updateHeader();
}

function syncComposerPlaceholder() {
    const textarea = document.getElementById('send_textarea');
    if (usesDreamlandPages() && textarea instanceof HTMLTextAreaElement && textarea.placeholder !== '输入消息…') {
        textarea.placeholder = '输入消息…';
    }
}

function relocateMemoryLauncher() {
    const launcher = document.getElementById('leslie-memory-launcher');
    const actions = document.getElementById('leslie-chat-actions');
    if (!launcher || !actions || !getLayoutEnabled()) {
        return;
    }
    launcher.classList.add('leslie-header-memory-button');
    launcher.title = launcher.title || '角色记忆';
    const newChatButton = actions.querySelector('[data-action="new-chat"]');
    if (launcher.parentElement !== actions || launcher.nextElementSibling !== newChatButton) {
        actions.insertBefore(launcher, newChatButton);
    }
}

function openSettings() {
    document.getElementById('leslie-settings-launcher')?.click();
}

function ensureCharacterWorkspace(actionId) {
    const panel = document.getElementById('right-nav-panel');
    const drawer = document.getElementById('rightNavHolder');
    const toggle = drawer?.querySelector(':scope > .drawer-toggle');
    if (!panel || !toggle) {
        return;
    }
    const alreadyOpen = panel.classList.contains('openDrawer');
    if (!alreadyOpen) {
        toggle.click();
    }
    window.setTimeout(() => {
        if (actionId === 'rm_button_create') {
            document.getElementById('rm_button_characters')?.click();
        }
        document.getElementById(actionId)?.click();
        updateWorkspaceState();
    }, alreadyOpen ? 0 : 80);
}

function openWorldInfo() {
    document.getElementById('WIDrawerIcon')?.click();
    window.setTimeout(updateWorkspaceState, 0);
}

function closeOpenDrawers() {
    document.querySelectorAll('#top-settings-holder .drawer-content.openDrawer').forEach((panel) => {
        panel.closest('.drawer')?.querySelector(':scope > .drawer-toggle')?.click();
    });
    window.setTimeout(updateWorkspaceState, 0);
}

function updateWorkspaceState() {
    const hasOpenWorkspace = Boolean(document.querySelector('#top-settings-holder .drawer-content.openDrawer'));
    document.body.classList.toggle('leslie-workspace-open', hasOpenWorkspace && getLayoutEnabled());
}

function closeHeaderMenu() {
    const menu = document.getElementById('leslie-chat-more-menu');
    const button = document.querySelector('#leslie-chat-actions [data-action="chat-more"]');
    if (menu) {
        menu.hidden = true;
        delete menu.dataset.open;
        menu.querySelectorAll('details[open]').forEach(details => { details.open = false; });
    }
    button?.setAttribute('aria-expanded', 'false');
}

function toggleHeaderMenu() {
    const menu = document.getElementById('leslie-chat-more-menu');
    const button = document.querySelector('#leslie-chat-actions [data-action="chat-more"]');
    if (!menu) {
        return;
    }
    menu.hidden = !menu.hidden;
    if (menu.hidden) {
        delete menu.dataset.open;
    } else {
        menu.dataset.open = 'true';
    }
    button?.setAttribute('aria-expanded', String(!menu.hidden));
}

async function selectConversation(button) {
    returnToDreamlandChat();
    const type = button.dataset.entityType;
    const id = button.dataset.entityId;
    const transitionSequence = ++chatTransitionSequence;
    button.classList.add('is-loading');
    document.body.classList.add('leslie-chat-transitioning');
    try {
        if (type === 'group') {
            await cancelPendingRealityTasks();
            await openGroupById(id);
        } else {
            const characterId = Number(id);
            realitySessionChatId = '';
            const active = getActiveEntity();
            if (active?.type === 'character' && Number(active.id) === characterId) {
                // Returning from the mobile list (or selecting the active role
                // again) continues the in-memory chat without reloading its file.
                await beginCurrentRealitySession();
            } else {
                await cancelPendingRealityTasks();
                const latestChat = await getLatestCharacterChat(characterId);
                await selectCharacterById(characterId, { switchMenu: false, chatFile: latestChat?.fileName ?? null });
                await beginCurrentRealitySession();
            }
        }
        if (isMobileLayout()) {
            setMobileView('chat', { historyMode: 'push', focus: true });
        }
        closeOpenDrawers();
        readLatestMessagePreview();
    } catch (error) {
        console.error('[Leslie chat layout] Could not open conversation.', error);
        globalThis.toastr?.error('无法打开最近的聊天记录，请稍后重试。');
    } finally {
        button.classList.remove('is-loading');
        scheduleConversationRender();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (transitionSequence === chatTransitionSequence) {
                document.body.classList.remove('leslie-chat-transitioning');
            }
        }));
    }
}

async function handleAction(action) {
    if (usesDreamlandPages() && ['home', 'chat', 'moments', 'workshop', 'background', 'settings', 'about'].includes(action)) {
        if (navigateDreamlandPage(action)) {
            if (action === 'chat' && isMobileLayout()) setMobileView('chat', { historyMode: 'replace' });
            return;
        }
    }
    if (action === 'chat-more') {
        toggleHeaderMenu();
        return;
    }
    closeHeaderMenu();
    const originalChatActions = {
        'tool-regenerate': 'option_regenerate',
        'tool-continue': 'option_continue',
        'tool-delete-messages': 'option_delete_mes',
        'tool-impersonate': 'option_impersonate',
        'tool-author-note': 'option_toggle_AN',
        'tool-cfg': 'option_toggle_CFG',
        'tool-logprobs': 'option_toggle_logprobs',
        'tool-checkpoint': 'option_new_bookmark',
        'tool-parent': 'option_back_to_main',
        'tool-convert-group': 'option_convert_to_group',
        'tool-close-chat': 'option_close_chat',
    };
    if (originalChatActions[action]) {
        document.getElementById(originalChatActions[action])?.click();
        return;
    }
    if (action.startsWith('export-')) {
        await runCharacterExport(action);
        return;
    }
    switch (action) {
        case 'home':
            document.getElementById('option_close_chat')?.click();
            break;
        case 'moments':
            document.getElementById('leslie-moments-launcher')?.click();
            break;
        case 'workshop': {
            ensureCharacterWorkspace('rm_button_create');
            break;
        }
        case 'background':
            document.querySelector('#backgrounds-button .drawer-toggle')?.click();
            break;
        case 'about':
            await callGenericPopup(`<article class="dreamland-about"><img src="${DREAMLAND_BRAND.icon}" width="64" height="64" alt=""><h2>DreamLand</h2><p>${DREAMLAND_BRAND.tagline}</p><p>${DREAMLAND_BRAND.introduction}</p><p>原 LeslieTavern。基于 SillyTavern，集成 AIRI；衍生代码采用 AGPL-3.0，各上游作者保留其权利。</p><h3>蔚蓝终端 · Blue Archive Inspired</h3><p>${BLUE_ARCHIVE_NOTICE}</p><a href="${DREAMLAND_BRAND.feedback}" target="_blank" rel="noopener noreferrer">项目反馈与素材联系</a></article>`, POPUP_TYPE.TEXT);
            break;
        case 'clear-search':
            searchInput.value = '';
            layoutState.query = '';
            searchInput.focus();
            scheduleConversationRender();
            break;
        case 'create-character':
            ensureCharacterWorkspace('rm_button_create');
            break;
        case 'settings':
            openSettings();
            break;
        case 'character-card':
            if (getActiveEntity()) {
                ensureCharacterWorkspace('rm_button_selected_ch');
            }
            break;
        case 'new-chat':
            await createCurrentLineChat();
            break;
        case 'manage-chats':
            if (getActiveEntity()?.type === 'character') {
                try {
                    await openCharacterChatHistory(getActiveEntity());
                } catch (error) {
                    console.error('[Leslie chat layout] Could not list chat history.', error);
                    globalThis.toastr?.error('无法读取历史会话。');
                }
            } else {
                document.getElementById('option_select_chat')?.click();
            }
            break;
        case 'line-story':
            await switchWorldLineSafely('story');
            break;
        case 'line-reality':
            await switchWorldLineSafely('reality');
            break;
        case 'world-info':
            openWorldInfo();
            break;
        case 'mobile-back':
            returnToConversationList();
            break;
    }
}

function bindShellEvents() {
    document.querySelector('.dreamland-navigation')?.addEventListener('click', event => {
        const action = event.target instanceof Element ? event.target.closest('[data-action]')?.dataset.action : null;
        if (usesDreamlandPages() && action) {
            event.stopPropagation();
            void handleAction(action);
        }
    });
    document.addEventListener('dreamland:page-layout-changed', syncResponsiveNavigation);
    sidebar?.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const conversation = target?.closest('.leslie-conversation-item');
        if (conversation instanceof HTMLButtonElement) {
            await selectConversation(conversation);
            return;
        }
        const action = target?.closest('[data-action]')?.dataset.action;
        if (action) {
            await handleAction(action);
        }
    });

    searchInput?.addEventListener('input', () => {
        layoutState.query = searchInput.value;
        scheduleConversationRender();
    });

    sidebar?.querySelector('.leslie-conversation-filters')?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-filter]') : null;
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        layoutState.filter = button.dataset.filter || 'all';
        sidebar.querySelectorAll('[data-filter]').forEach((item) => {
            const active = item === button;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-pressed', String(active));
        });
        scheduleConversationRender();
    });

    document.getElementById('leslie-chat-header')?.addEventListener('click', (event) => {
        const action = event.target instanceof Element ? event.target.closest('[data-action]')?.dataset.action : null;
        if (action) {
            void handleAction(action);
        }
    });
    document.querySelector('.leslie-chat-identity')?.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && getActiveEntity()) {
            event.preventDefault();
            ensureCharacterWorkspace('rm_button_selected_ch');
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && !event.target.closest('#leslie-chat-more-menu, [data-action="chat-more"]')) {
            closeHeaderMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k' && getLayoutEnabled()) {
            event.preventDefault();
            searchInput?.focus();
        } else if (event.key === 'Escape') {
            closeHeaderMenu();
        }
    });
    window.addEventListener('resize', syncResponsiveNavigation, { passive: true });
    window.addEventListener('popstate', (event) => {
        if (!isMobileLayout() || !getLayoutEnabled()) {
            return;
        }
        setMobileView(event.state?.[MOBILE_HISTORY_KEY] === 'chat' ? 'chat' : 'list', { focus: true });
    });

    const connectionIcon = document.getElementById('API-status-top');
    if (connectionIcon) {
        new MutationObserver(updateConnectionState).observe(connectionIcon, { attributes: true, attributeFilter: ['class', 'title'] });
    }
    const composer = document.getElementById('send_textarea');
    if (composer) {
        // Keep upstream generation/connection checks intact; only the BA input
        // hint stays neutral when those checks rewrite its placeholder.
        new MutationObserver(syncComposerPlaceholder).observe(composer, { attributes: true, attributeFilter: ['placeholder'] });
        syncComposerPlaceholder();
    }
    document.addEventListener('input', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('#openai_api, #textgenerationwebui_api, #kobold_api')) {
            updateConnectionState();
        }
    });
    document.addEventListener('change', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('#openai_api, #textgenerationwebui_api, #kobold_api, #main_api')) {
            window.setTimeout(updateConnectionState, 0);
        }
    });
    document.addEventListener('leslie:home-state-changed', updateHeader);
    document.addEventListener('dreamland:chat-resumed', () => {
        if (isMobileLayout()) setMobileView('chat', { historyMode: 'replace' });
    });
    const chat = document.getElementById('chat');
    if (chat) {
        new MutationObserver(readLatestMessagePreview).observe(chat, { childList: true, subtree: true, characterData: true });
    }
    const characterSource = document.getElementById('rm_print_characters_block');
    if (characterSource) {
        new MutationObserver(scheduleConversationRender).observe(characterSource, { childList: true, subtree: true });
    }
    const topSettings = document.getElementById('top-settings-holder');
    if (topSettings) {
        new MutationObserver(() => {
            relocateMemoryLauncher();
            updateWorkspaceState();
        }).observe(topSettings, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    new MutationObserver(relocateMemoryLauncher).observe(document.body, { childList: true, subtree: true });

    [
        event_types.APP_READY,
        event_types.CHARACTER_PAGE_LOADED,
        event_types.CHARACTER_EDITED,
        event_types.CHARACTER_DELETED,
        event_types.GROUP_UPDATED,
        event_types.GROUP_CHAT_CREATED,
        event_types.GROUP_CHAT_DELETED,
        event_types.CHAT_CHANGED,
        event_types.CHAT_LOADED,
        event_types.CHAT_CREATED,
        event_types.CHAT_RENAMED,
        event_types.MESSAGE_SENT,
        event_types.MESSAGE_RECEIVED,
        event_types.MESSAGE_UPDATED,
        event_types.ONLINE_STATUS_CHANGED,
        event_types.GENERATION_STARTED,
        event_types.GENERATION_ENDED,
    ].filter(Boolean).forEach(eventName => eventSource.on(eventName, scheduleConversationRender));
    eventSource.on(event_types.CHAT_LOADED, () => {
        updateHeader();
        void beginCurrentRealitySession().catch(error => console.error('[Leslie chat layout] Could not begin reality session.', error));
    });
    [event_types.MESSAGE_SENT, event_types.MESSAGE_RECEIVED]
        .filter(Boolean)
        .forEach(eventName => eventSource.on(eventName, () => void touchCurrentRealitySession()));
    [event_types.ONLINE_STATUS_CHANGED, event_types.MAIN_API_CHANGED]
        .filter(Boolean)
        .forEach(eventName => eventSource.on(eventName, updateConnectionState));
}

function initLeslieChatLayout() {
    if (!document.body.classList.contains('leslie-modern')) {
        return;
    }
    createSidebar();
    ensureChatHeader();
    createWorkspaceBackdrop();
    ensureChatHistoryDialog();
    bindShellEvents();
    syncDreamlandPages();
    initializeMobileNavigation();
    document.body.classList.remove('leslie-chat-layout-disabled');
    relocateMemoryLauncher();
    syncResponsiveNavigation();
    updateWorkspaceState();
    scheduleConversationRender();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLeslieChatLayout, { once: true });
} else {
    initLeslieChatLayout();
}
