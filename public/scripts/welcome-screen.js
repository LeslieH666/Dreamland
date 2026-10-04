import {
    addOneMessage,
    characters,
    chat,
    deleteCharacterChatByName,
    displayVersion,
    doNewChat,
    event_types,
    eventSource,
    getCharacters,
    getCurrentChatId,
    getRequestHeaders,
    getSystemMessageByType,
    getThumbnailUrl,
    is_send_press,
    neutralCharacterName,
    newAssistantChat,
    openCharacterChat,
    printCharactersDebounced,
    renameGroupOrCharacterChat,
    saveSettingsDebounced,
    selectCharacterById,
    setActiveCharacter,
    setActiveGroup,
    system_avatar,
    system_message_types,
    this_chid,
    unshallowCharacter,
    updateRemoteChatName,
} from '../script.js';
import { getRegexedString, regex_placement } from './extensions/regex/engine.js';
import { deleteGroupChatByName, getGroupAvatar, groups, is_group_generating, openGroupById, openGroupChat } from './group-chats.js';
import { t } from './i18n.js';
import { callGenericPopup, POPUP_TYPE } from './popup.js';
import { getMessageTimeStamp } from './RossAscends-mods.js';
import { getLeslieConnectionState } from './leslie-connection-state.js';
import {
    buildHomeMomentActivities,
    getLeslieHomeGreeting,
    LESLIE_HOME_CHARACTER_LIMIT,
    migratePinnedCharacterAvatar,
    normalizePinnedCharacterAvatars,
    rankHomeCharacters,
    selectHomeContinueChat,
} from './leslie-home-core.js';
import { renderTemplateAsync } from './templates.js';
import { accountStorage } from './util/AccountStorage.js';
import { returnToDreamlandChat } from './dreamland-pages.js';
import { clamp, flashHighlight, isElementInViewport, sortMoments, timestampToMoment } from './utils.js';

const assistantAvatarKey = 'assistant';
const pinnedChatsKey = 'pinnedChats';
const recentChatsSettingsKey = 'recentChatsSettings';
const pinnedHomeCharactersKey = 'leslieHomePinnedCharacters';
const defaultAssistantAvatar = 'default_Assistant.png';

const DEFAULT_MAX_DISPLAYED = 15;
const DEFAULT_COLLAPSED_DISPLAYED = 3;

/**
 * Gets the current recent chats settings from account storage.
 * @returns {{ maxDisplayed: number, collapsedDisplayed: number }}
 */
function getRecentChatsSettings() {
    const value = accountStorage.getItem(recentChatsSettingsKey);
    if (value) {
        try {
            const parsed = JSON.parse(value);
            return {
                maxDisplayed: Math.max(1, parseInt(parsed.maxDisplayed) || DEFAULT_MAX_DISPLAYED),
                collapsedDisplayed: Math.max(1, parseInt(parsed.collapsedDisplayed) || DEFAULT_COLLAPSED_DISPLAYED),
            };
        } catch {
            // Ignore parse errors
        }
    }
    return { maxDisplayed: DEFAULT_MAX_DISPLAYED, collapsedDisplayed: DEFAULT_COLLAPSED_DISPLAYED };
}

/**
 * Saves recent chats settings to account storage.
 * @param {{ maxDisplayed: number, collapsedDisplayed: number }} settings
 */
function saveRecentChatsSettings(settings) {
    accountStorage.setItem(recentChatsSettingsKey, JSON.stringify(settings));
}

/**
 * @typedef {Pick<RecentChat, 'group' | 'avatar' | 'file_name'>} PinnedChat
 */

/**
 * Manages pinned chat storage and operations.
 */
class PinnedChatsManager {
    /** @type {Record<string, PinnedChat> | null} */
    static #cachedState = null;

    /**
     * Initializes the cached state from storage.
     * Should be called once on app init.
     */
    static init() {
        this.#cachedState = this.#loadFromStorage();
    }

    /**
     * Loads state from storage.
     * @returns {Record<string, PinnedChat>}
     */
    static #loadFromStorage() {
        const pinnedState = /** @type {Record<string, PinnedChat>} */ ({});
        const value = accountStorage.getItem(pinnedChatsKey);
        if (value) {
            try {
                Object.assign(pinnedState, JSON.parse(value));
            } catch (error) {
                console.warn('Failed to parse pinned chats from storage.', error);
            }
        }
        return pinnedState;
    }

    /**
     * Generates a key for pinned chat storage.
     * @param {Partial<RecentChat>} recentChat Recent chat data
     * @returns {string} Key for pinned chat storage
     */
    static getKey(recentChat) {
        return `${recentChat.group ? 'group_' + recentChat.group : ''}${recentChat.avatar ? 'char_' + recentChat.avatar : ''}_${recentChat.file_name}`;
    }

    /**
     * Gets the pinned chat state from cache.
     * @returns {Record<string, PinnedChat>}
     */
    static getState() {
        if (this.#cachedState === null) {
            this.#cachedState = this.#loadFromStorage();
        }
        return this.#cachedState;
    }

    /**
     * Saves the pinned chat state to storage and updates cache.
     * @param {Record<string, PinnedChat>} state The state to save
     */
    static #saveState(state) {
        this.#cachedState = state;
        accountStorage.setItem(pinnedChatsKey, JSON.stringify(state));
    }

    /**
     * Checks if a chat is pinned.
     * @param {RecentChat} recentChat Recent chat data
     * @returns {boolean} True if the chat is pinned, false otherwise
     */
    static isPinned(recentChat) {
        const pinKey = this.getKey(recentChat);
        const pinState = this.getState();
        return pinKey in pinState;
    }

    /**
     * Toggles the pinned state of a chat.
     * @param {RecentChat} recentChat Recent chat data
     * @param {boolean} pinned New pinned state
     */
    static toggle(recentChat, pinned) {
        const pinKey = this.getKey(recentChat);
        const pinState = { ...this.getState() };
        if (pinned) {
            pinState[pinKey] = {
                group: recentChat.group,
                avatar: recentChat.avatar,
                file_name: recentChat.file_name,
            };
        } else {
            delete pinState[pinKey];
        }
        this.#saveState(pinState);
    }

    /**
     * Migrates pinned state when a chat is renamed.
     * @param {Partial<RecentChat>} recentChat Recent chat data (with original file_name)
     * @param {string} newFileName New file name after rename
     */
    static rename(recentChat, newFileName) {
        const oldKey = this.getKey(recentChat);
        const pinState = { ...this.getState() };
        if (!(oldKey in pinState)) {
            return;
        }
        const updatedChat = { ...recentChat, file_name: newFileName };
        const newKey = this.getKey(updatedChat);
        pinState[newKey] = {
            group: recentChat.group,
            avatar: recentChat.avatar,
            file_name: newFileName,
        };
        delete pinState[oldKey];
        this.#saveState(pinState);
    }

    /**
     * Gets all pinned chats.
     * @returns {PinnedChat[]}
     */
    static getAll() {
        const pinState = this.getState();
        return Object.values(pinState);
    }
}

class PinnedHomeCharactersManager {
    static getAll() {
        let value = [];
        try {
            value = JSON.parse(accountStorage.getItem(pinnedHomeCharactersKey) || '[]');
        } catch (error) {
            console.warn('Failed to parse Leslie home character pins.', error);
        }
        const normalized = normalizePinnedCharacterAvatars(value, getHomeAvailableCharacters());
        if (JSON.stringify(value) !== JSON.stringify(normalized)) {
            this.setAll(normalized);
        }
        return normalized;
    }

    static setAll(avatars) {
        const normalized = normalizePinnedCharacterAvatars(avatars, getHomeAvailableCharacters());
        accountStorage.setItem(pinnedHomeCharactersKey, JSON.stringify(normalized));
    }

    static toggle(avatar) {
        const pins = this.getAll();
        const index = pins.indexOf(avatar);
        if (index >= 0) {
            pins.splice(index, 1);
        } else if (pins.length < LESLIE_HOME_CHARACTER_LIMIT) {
            pins.push(avatar);
        } else {
            toastr.info(t`You can pin up to ${LESLIE_HOME_CHARACTER_LIMIT} characters.`);
            return false;
        }
        this.setAll(pins);
        return true;
    }

    static rename(oldAvatar, newAvatar) {
        let pins = [];
        try {
            pins = JSON.parse(accountStorage.getItem(pinnedHomeCharactersKey) || '[]');
        } catch (error) {
            console.warn('Failed to parse Leslie home character pins during rename.', error);
        }
        const migrated = migratePinnedCharacterAvatar(pins, oldAvatar, newAvatar);
        accountStorage.setItem(pinnedHomeCharactersKey, JSON.stringify(migrated));
    }
}

function getHomeAvailableCharacters() {
    return characters.filter(character => character?.avatar && character.avatar !== defaultAssistantAvatar);
}

export function getPermanentAssistantAvatar() {
    const assistantAvatar = accountStorage.getItem(assistantAvatarKey);
    if (assistantAvatar === null) {
        return defaultAssistantAvatar;
    }

    const character = characters.find(x => x.avatar === assistantAvatar);
    if (character === undefined) {
        accountStorage.removeItem(assistantAvatarKey);
        return defaultAssistantAvatar;
    }

    return assistantAvatar;
}

/**
 * Opens a welcome screen if no chat is currently active.
 * @param {object} param Additional parameters
 * @param {boolean} [param.force] If true, forces clearing of the welcome screen.
 * @param {boolean} [param.expand] If true, expands the recent chats section.
 * @returns {Promise<void>}
 */
export async function openWelcomeScreen({ force = false, expand = false } = {}) {
    const currentChatId = getCurrentChatId();
    const useLeslieHome = document.body.classList.contains('leslie-modern')
        && !document.body.classList.contains('leslie-chat-layout-disabled');
    if (currentChatId !== undefined) {
        setLeslieHomeOpen(false);
        return;
    }
    if (useLeslieHome && document.querySelector('#chat > .leslieHomePanel') && !force) {
        setLeslieHomeOpen(true);
        return;
    }
    if (!useLeslieHome && chat.length > 0 && !force) {
        setLeslieHomeOpen(false);
        return;
    }

    const [recentChats, momentActivities] = await Promise.all([
        getRecentChats({ metadata: useLeslieHome }),
        useLeslieHome ? getRecentMomentActivities() : Promise.resolve([]),
    ]);
    const chatAfterFetch = getCurrentChatId();
    if (chatAfterFetch !== currentChatId) {
        console.debug('Chat changed while fetching recent chats.');
        setLeslieHomeOpen(false);
        return;
    }

    if (chatAfterFetch === undefined && (force || useLeslieHome)) {
        console.debug('Forcing welcome screen open.');
        chat.splice(0, chat.length);
        $('#chat').empty();
    }

    if (useLeslieHome) {
        setLeslieHomeOpen(true);
        await sendLeslieHomePanel(recentChats, momentActivities);
        return;
    }

    setLeslieHomeOpen(false);
    await sendWelcomePanel(recentChats, expand);
    await unshallowPermanentAssistant();
    sendAssistantMessage();
    sendWelcomePrompt();
}

function setLeslieHomeOpen(open) {
    const wasOpen = document.body.classList.contains('leslie-home-open');
    document.body.classList.toggle('leslie-home-open', open);
    if (wasOpen !== open || open) {
        document.dispatchEvent(new CustomEvent('leslie:home-state-changed', { detail: { open } }));
    }
}

/**
 * Makes sure the assistant character has all data loaded.
 * @returns {Promise<void>}
 */
async function unshallowPermanentAssistant() {
    const assistantAvatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === assistantAvatar);
    if (characterId === -1) {
        return;
    }

    await unshallowCharacter(String(characterId));
}

/**
 * Returns a greeting message for the assistant based on the character.
 * @param {Character} character Character data
 * @returns {string} Greeting message
*/
function getAssistantGreeting(character) {
    const defaultGreeting = t`If you're connected to an API, try asking me something!` + '\n***\n' + t`**Hint:** Set any character as your welcome page assistant from their "More..." menu.`;

    if (!character) {
        return defaultGreeting;
    }

    return getRegexedString(character.first_mes || '', regex_placement.AI_OUTPUT, { depth: 0 }) || defaultGreeting;
}

function sendAssistantMessage() {
    const currentAssistantAvatar = getPermanentAssistantAvatar();
    const character = characters.find(x => x.avatar === currentAssistantAvatar);
    const name = character ? character.name : neutralCharacterName;
    const avatar = character ? getThumbnailUrl('avatar', character.avatar) : system_avatar;
    const greeting = getAssistantGreeting(character);

    const message = {
        name: name,
        force_avatar: avatar,
        mes: greeting,
        is_system: false,
        is_user: false,
        send_date: getMessageTimeStamp(),
        extra: {
            type: system_message_types.ASSISTANT_MESSAGE,
            swipeable: false,
        },
    };

    chat.push(message);
    addOneMessage(message, { scroll: false });
}

function sendWelcomePrompt() {
    const message = getSystemMessageByType(system_message_types.WELCOME_PROMPT);
    chat.push(message);
    addOneMessage(message, { scroll: false });
}

function getHomeMessagePreview(value) {
    const preview = String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return preview || t`Continue this conversation`;
}

function getHomeWorldLineLabel(recentChat) {
    if (recentChat?.is_group) {
        return t`Group chat`;
    }
    return recentChat?.chat_metadata?.leslie_world_line?.kind === 'reality'
        ? '现实世界线'
        : '故事线';
}

function getLatestChatForAvatar(chats, avatar) {
    return chats
        .filter(item => !item.is_group && item.avatar === avatar)
        .sort((left, right) => timestampToMoment(right.last_mes).valueOf() - timestampToMoment(left.last_mes).valueOf())[0] ?? null;
}

async function getRecentMomentActivities() {
    try {
        const response = await fetch('/api/leslie/moments', {
            method: 'GET',
            headers: getRequestHeaders(),
            cache: 'no-cache',
        });
        if (!response.ok) {
            return [];
        }
        const result = await response.json();
        return buildHomeMomentActivities(result?.posts, 3).map(activity => ({
            ...activity,
            icon: activity.kind === 'comment' ? 'fa-comment-dots' : 'fa-camera-retro',
            date: activity.createdAt ? timestampToMoment(activity.createdAt).fromNow() : '',
        }));
    } catch (error) {
        console.debug('Leslie home could not load Moments activities.', error);
        return [];
    }
}

function buildLeslieHomeData(chats, momentActivities) {
    const availableCharacters = getHomeAvailableCharacters();
    const pins = PinnedHomeCharactersManager.getAll();
    const homeCharacters = rankHomeCharacters(availableCharacters, chats, pins)
        .map((character) => {
            const latestChat = getLatestChatForAvatar(chats, character.avatar);
            return {
                avatar: character.avatar,
                avatarUrl: getThumbnailUrl('avatar', character.avatar),
                name: character.name || t`Unnamed character`,
                fileName: latestChat?.chat_name || '',
                pinned: character.homePinned,
                pinLabel: character.homePinned ? '取消首页置顶' : '置顶到首页',
                activityLabel: character.homePinned
                    ? '已置顶'
                    : character.homeSessions > 0 ? `${character.homeSessions} 个最近会话` : '开始第一段对话',
            };
        });
    const newestChat = selectHomeContinueChat(chats);
    const continueChat = newestChat ? {
        avatar: newestChat.avatar || '',
        group: newestChat.group || '',
        fileName: newestChat.chat_name,
        name: newestChat.char_name,
        avatarUrl: newestChat.is_group ? '' : newestChat.char_thumbnail,
        isGroup: newestChat.is_group,
        lineLabel: getHomeWorldLineLabel(newestChat),
        preview: getHomeMessagePreview(newestChat.mes),
        date: timestampToMoment(newestChat.last_mes).fromNow(),
    } : null;
    const connection = getLeslieConnectionState();
    const connectionNotice = connection.connected ? null : {
        title: connection.checking ? '正在检测模型连接' : connection.configured ? '模型还没有连接' : '先完成模型连接',
        detail: connection.checking ? '完成后就可以开始聊天' : connection.configured ? '打开模型设置并检查连接' : '选择在线 API 或本地模型',
    };
    const emptyCharacters = availableCharacters.length === 0;
    return {
        greeting: getLeslieHomeGreeting(),
        subtitle: emptyCharacters
            ? '添加第一位角色，把这里变成属于你的本地陪伴空间。'
            : continueChat ? '继续熟悉的故事，或者看看角色们最近在做什么。' : '选择一位角色，开始第一段对话。',
        emptyCharacters,
        continueChat,
        connectionNotice,
        characterSectionTitle: continueChat ? '常用角色' : '选择一位角色',
        homeCharacters,
        hasMomentActivities: momentActivities.length > 0,
        momentActivities,
    };
}

async function openHomeCharacterPinManager() {
    const availableCharacters = getHomeAvailableCharacters()
        .slice()
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN'));
    const pins = PinnedHomeCharactersManager.getAll();
    const customInputs = availableCharacters.map((character, index) => ({
        id: `leslie-home-pin-${index}`,
        type: 'checkbox',
        label: character.name || t`Unnamed character`,
        tooltip: '置顶后会优先显示在首页常用角色中。',
        defaultState: pins.includes(character.avatar),
    }));
    let nextPins = null;
    const result = await callGenericPopup(
        `<h3>管理首页置顶角色</h3><p>最多置顶 ${LESLIE_HOME_CHARACTER_LIMIT} 位。未置顶的位置会根据最近会话频率自动补充。</p>`,
        POPUP_TYPE.CONFIRM,
        null,
        {
            okButton: t`Save`,
            cancelButton: t`Cancel`,
            allowVerticalScrolling: true,
            customInputs,
            onClosing: (popup) => {
                if (!popup.result) {
                    return true;
                }
                const selected = customInputs
                    .map((input, index) => popup.inputResults.get(input.id) ? availableCharacters[index].avatar : null)
                    .filter(Boolean);
                if (selected.length > LESLIE_HOME_CHARACTER_LIMIT) {
                    toastr.warning(`最多只能置顶 ${LESLIE_HOME_CHARACTER_LIMIT} 位角色。`);
                    return false;
                }
                nextPins = selected;
                return true;
            },
        },
    );
    if (result && nextPins) {
        PinnedHomeCharactersManager.setAll(nextPins);
        await refreshWelcomeScreen();
    }
}

async function openHomeCharacter(avatar, fileName) {
    if (fileName) {
        await openRecentCharacterChat(avatar, fileName);
        return;
    }
    const characterId = characters.findIndex(character => character.avatar === avatar);
    if (characterId >= 0) {
        await selectCharacterById(characterId);
    }
}

function focusHomeCharacterList() {
    const characterFilter = document.querySelector('#leslie-conversation-sidebar [data-filter="character"]');
    if (characterFilter instanceof HTMLButtonElement) {
        characterFilter.click();
    }
    const search = document.getElementById('leslie-conversation-search');
    if (search instanceof HTMLInputElement) {
        search.focus();
    }
}

async function startHomeTemporaryChat() {
    await newAssistantChat({ temporary: true });
    const sendTextArea = document.getElementById('send_textarea');
    if (sendTextArea instanceof HTMLTextAreaElement) {
        sendTextArea.focus();
    }
}

function openHomeMoments() {
    document.getElementById('leslie-moments-launcher')?.click();
}

function bindLeslieHomeActions(root) {
    root.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-home-action]') : null;
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        const action = button.dataset.homeAction;
        if (['open-chat', 'open-character', 'temporary-chat', 'focus-characters'].includes(action)) {
            returnToDreamlandChat();
            if (action !== 'focus-characters') document.dispatchEvent(new CustomEvent('dreamland:chat-resumed'));
        }
        if (action === 'open-chat') {
            const avatar = button.dataset.avatar;
            const group = button.dataset.group;
            const fileName = button.dataset.file;
            if (avatar && fileName) {
                void openRecentCharacterChat(avatar, fileName);
            } else if (group && fileName) {
                void openRecentGroupChat(group, fileName);
            }
        } else if (action === 'open-character' && button.dataset.avatar) {
            void openHomeCharacter(button.dataset.avatar, button.dataset.file || '');
        } else if (action === 'toggle-character-pin' && button.dataset.avatar) {
            event.stopPropagation();
            if (PinnedHomeCharactersManager.toggle(button.dataset.avatar)) {
                if (root.closest('.dreamland-home-content')) void renderLeslieNavigationHome(root.parentElement);
                else void refreshWelcomeScreen();
            }
        } else if (action === 'manage-pins') {
            void openHomeCharacterPinManager();
        } else if (action === 'focus-characters') {
            focusHomeCharacterList();
        } else if (action === 'temporary-chat') {
            void startHomeTemporaryChat();
        } else if (action === 'open-moments') {
            openHomeMoments();
        } else if (action === 'open-workshop') {
            document.getElementById('rm_button_create')?.click();
        } else if (action === 'configure-model') {
            document.querySelector('#leslie-conversation-sidebar .leslie-connection-card')?.click();
        }
    });
}

async function sendLeslieHomePanel(chats, momentActivities, destination = document.getElementById('chat')) {
    try {
        const chatElement = destination;
        if (!chatElement) {
            return;
        }
        const template = await renderTemplateAsync('leslieHomePanel', buildLeslieHomeData(chats, momentActivities));
        const fragment = document.createRange().createContextualFragment(template);
        const panel = fragment.querySelector('.leslieHomePanel');
        if (!panel) {
            return;
        }
        bindLeslieHomeActions(panel);
        panel.querySelectorAll('img').forEach((image) => {
            image.addEventListener('error', () => image.classList.add('is-broken'), { once: true });
        });
        chatElement.append(panel);
    } catch (error) {
        console.error('Leslie home error:', error);
    }
}

/** Render the greeting page without closing, clearing or reloading a live chat. */
export async function renderLeslieNavigationHome(container, isCurrent = () => container.isConnected) {
    const [chats, activities] = await Promise.all([getRecentChats({ metadata: true }), getRecentMomentActivities()]);
    if (!isCurrent()) return;
    container.replaceChildren();
    await sendLeslieHomePanel(chats, activities, container);
}

/** Keep the active chat/draft; after login, reopen the latest native JSONL chat. */
export async function resumeLeslieRecentChat(isCurrent = () => true) {
    if (!isCurrent()) return;
    if (getCurrentChatId() === undefined && !is_send_press && !is_group_generating) {
        const recent = selectHomeContinueChat(await getRecentChats({ metadata: true }));
        if (!isCurrent() || getCurrentChatId() !== undefined || is_send_press || is_group_generating) return;
        if (recent?.avatar) {
            const characterId = characters.findIndex(character => character.avatar === recent.avatar);
            if (characterId >= 0) await selectCharacterById(characterId, { switchMenu: false, chatFile: recent.chat_name });
        } else if (recent?.group) await openRecentGroupChat(recent.group, recent.chat_name);
    }
    if (isCurrent()) document.dispatchEvent(new CustomEvent('dreamland:chat-resumed'));
}

/**
 * Sends the welcome panel to the chat.
 * @param {RecentChat[]} chats List of recent chats
 * @param {boolean} [expand=false] If true, expands the recent chats section
 */
async function sendWelcomePanel(chats, expand = false) {
    try {
        const chatElement = document.getElementById('chat');
        const sendTextArea = document.getElementById('send_textarea');
        if (!chatElement) {
            console.error('Chat element not found');
            return;
        }
        const templateData = {
            chats,
            empty: !chats.length,
            version: displayVersion,
            more: chats.some(chat => chat.hidden),
        };
        const template = await renderTemplateAsync('welcomePanel', templateData);
        const fragment = document.createRange().createContextualFragment(template);
        fragment.querySelectorAll('.welcomePanel').forEach((root) => {
            const recentHiddenClass = 'recentHidden';
            const recentHiddenKey = 'WelcomePage_RecentChatsHidden';
            if (accountStorage.getItem(recentHiddenKey) === 'true') {
                root.classList.add(recentHiddenClass);
            }
            root.querySelectorAll('.showRecentChats').forEach((button) => {
                button.addEventListener('click', () => {
                    root.classList.remove(recentHiddenClass);
                    accountStorage.setItem(recentHiddenKey, 'false');
                });
            });
            root.querySelectorAll('.hideRecentChats').forEach((button) => {
                button.addEventListener('click', () => {
                    root.classList.add(recentHiddenClass);
                    accountStorage.setItem(recentHiddenKey, 'true');
                });
            });
            root.querySelectorAll('.recentChatsSettings').forEach((button) => {
                button.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    await openRecentChatsSettingsPopup();
                });
            });
        });
        fragment.querySelectorAll('.recentChat').forEach((item) => {
            item.addEventListener('click', () => {
                const avatarId = item.getAttribute('data-avatar');
                const groupId = item.getAttribute('data-group');
                const fileName = item.getAttribute('data-file');
                if (avatarId && fileName) {
                    void openRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void openRecentGroupChat(groupId, fileName);
                }
            });
        });
        const hiddenChats = fragment.querySelectorAll('.recentChat.hidden');
        fragment.querySelectorAll('button.showMoreChats').forEach((button) => {
            const showRecentChatsTitle = t`Show more recent chats`;
            const hideRecentChatsTitle = t`Show less recent chats`;

            button.setAttribute('title', showRecentChatsTitle);
            button.addEventListener('click', () => {
                const rotate = button.classList.contains('rotated');
                hiddenChats.forEach((chatItem) => {
                    chatItem.classList.toggle('hidden', rotate);
                });
                button.classList.toggle('rotated', !rotate);
                button.setAttribute('title', rotate ? showRecentChatsTitle : hideRecentChatsTitle);
            });
        });
        fragment.querySelectorAll('button.openTemporaryChat').forEach((button) => {
            button.addEventListener('click', async () => {
                await newAssistantChat({ temporary: true });
                if (sendTextArea instanceof HTMLTextAreaElement) {
                    sendTextArea.focus();
                }
            });
        });
        fragment.querySelectorAll('.recentChat.group').forEach((groupChat) => {
            const groupId = groupChat.getAttribute('data-group');
            const group = groups.find(x => x.id === groupId);
            if (group) {
                const avatar = groupChat.querySelector('.avatar');
                if (!avatar) {
                    return;
                }
                const groupAvatar = getGroupAvatar(group);
                $(avatar).replaceWith(groupAvatar);
            }
        });
        fragment.querySelectorAll('.recentChat .renameChat').forEach((renameButton) => {
            renameButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatItem = renameButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                if (avatarId && fileName) {
                    void renameRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void renameRecentGroupChat(groupId, fileName);
                }
            });
        });
        fragment.querySelectorAll('.recentChat .deleteChat').forEach((deleteButton) => {
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatItem = deleteButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                if (avatarId && fileName) {
                    void deleteRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void deleteRecentGroupChat(groupId, fileName);
                }
            });
        });
        fragment.querySelectorAll('.recentChat .pinChat').forEach((pinButton) => {
            pinButton.addEventListener('click', async (event) => {
                event.stopPropagation();
                const chatItem = pinButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                const recentChat = chats.find(c => c.chat_name === fileName && ((c.is_group && c.group === groupId) || (!c.is_group && c.avatar === avatarId)));
                if (!recentChat) {
                    console.error('Recent chat not found for pinning.');
                    return;
                }
                const currentlyPinned = PinnedChatsManager.isPinned(recentChat);
                PinnedChatsManager.toggle(recentChat, !currentlyPinned);
                await refreshWelcomeScreen({ flashChat: recentChat });
            });
        });
        chatElement.append(fragment.firstChild);
        if (expand) {
            chatElement.querySelectorAll('button.showMoreChats').forEach((button) => {
                if (button instanceof HTMLButtonElement) {
                    button.click();
                }
            });
        }
    } catch (error) {
        console.error('Welcome screen error:', error);
    }
}

/**
 * Opens a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function openRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }

    try {
        await selectCharacterById(characterId);
        setActiveCharacter(avatarId);
        saveSettingsDebounced();
        const currentChatId = getCurrentChatId();
        if (currentChatId === fileName) {
            console.debug(`Chat ${fileName} is already open.`);
            return;
        }
        await openCharacterChat(fileName);
    } catch (error) {
        console.error('Error opening recent chat:', error);
        toastr.error(t`Failed to open recent chat. See console for details.`);
    }
}

/**
 * Opens a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function openRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }

    try {
        await openGroupById(groupId);
        setActiveGroup(groupId);
        saveSettingsDebounced();
        const currentChatId = getCurrentChatId();
        if (currentChatId === fileName) {
            console.debug(`Chat ${fileName} is already open.`);
            return;
        }
        await openGroupChat(groupId, fileName);
    } catch (error) {
        console.error('Error opening recent group chat:', error);
        toastr.error(t`Failed to open recent group chat. See console for details.`);
    }
}

/**
 * Renames a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function renameRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }
    try {
        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, fileName);
        if (!newName || typeof newName !== 'string' || newName === fileName) {
            console.log('No new name provided, aborting');
            return;
        }
        await renameGroupOrCharacterChat({
            characterId: String(characterId),
            oldFileName: fileName,
            newFileName: newName,
            loader: false,
        });
        await updateRemoteChatName(characterId, newName);
        await refreshWelcomeScreen();
        toastr.success(t`Chat renamed.`);
    } catch (error) {
        console.error('Error renaming recent character chat:', error);
        toastr.error(t`Failed to rename recent chat. See console for details.`);
    }
}

/**
 * Renames a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function renameRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }
    try {
        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, fileName);
        if (!newName || newName === fileName) {
            console.log('No new name provided, aborting');
            return;
        }
        await renameGroupOrCharacterChat({
            groupId: String(groupId),
            oldFileName: fileName,
            newFileName: String(newName),
            loader: false,
        });
        await refreshWelcomeScreen();
        toastr.success(t`Group chat renamed.`);
    } catch (error) {
        console.error('Error renaming recent group chat:', error);
        toastr.error(t`Failed to rename recent group chat. See console for details.`);
    }
}

/**
 * Deletes a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function deleteRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }
    try {
        const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            console.log('Deletion cancelled by user');
            return;
        }
        await deleteCharacterChatByName(String(characterId), fileName);
        await refreshWelcomeScreen();
        toastr.success(t`Chat deleted.`);
    } catch (error) {
        console.error('Error deleting recent character chat:', error);
        toastr.error(t`Failed to delete recent chat. See console for details.`);
    }
}

/**
 * Deletes a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function deleteRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }
    try {
        const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            console.log('Deletion cancelled by user');
            return;
        }
        await deleteGroupChatByName(groupId, fileName);
        await refreshWelcomeScreen();
        toastr.success(t`Group chat deleted.`);
    } catch (error) {
        console.error('Error deleting recent group chat:', error);
        toastr.error(t`Failed to delete recent group chat. See console for details.`);
    }
}

/**
 * Reopens the welcome screen and restores the scroll position.
 * @param {object} param Additional parameters
 * @param {RecentChat} [param.flashChat] Recent chat to flash (if any)
 * @returns {Promise<void>}
 */
async function refreshWelcomeScreen({ flashChat = null } = {}) {
    const navigationHome = document.querySelector('.dreamland-home-page:not([hidden]) .dreamland-home-content');
    if (navigationHome) {
        await renderLeslieNavigationHome(navigationHome);
        return;
    }
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        console.error('Chat element not found');
        return;
    }

    const scrollTop = chatElement.scrollTop;
    const scrollHeight = chatElement.scrollHeight;
    const expand = chatElement.querySelectorAll('button.showMoreChats.rotated').length > 0;

    await openWelcomeScreen({ force: true, expand });

    // Restore scroll position or flash specific chat
    if (flashChat) {
        const recentChats = Array.from(chatElement.querySelectorAll('.recentChat'));
        const chatToFlash = recentChats.find(el => {
            const file = el.getAttribute('data-file');
            const group = el.getAttribute('data-group');
            const avatar = el.getAttribute('data-avatar');
            return file === flashChat.chat_name &&
                ((flashChat.is_group && group === flashChat.group) || (!flashChat.is_group && avatar === flashChat.avatar));
        });
        if (chatToFlash instanceof HTMLElement) {
            if (!isElementInViewport(chatToFlash)) {
                chatElement.scrollTop = chatToFlash.offsetTop - chatElement.offsetTop - (chatToFlash.clientHeight / 2);
            }
            flashHighlight($(chatToFlash), 1000);
        }
    } else {
        // Restore scroll position
        chatElement.scrollTop = scrollTop + (chatElement.scrollHeight - scrollHeight);
    }
}

/**
 * Opens a popup to configure recent chats settings.
 */
async function openRecentChatsSettingsPopup() {
    const settings = getRecentChatsSettings();

    const MIN_CHATS = 1;
    const MAX_CHATS = 1000;

    /** @type {import('./popup.js').CustomPopupInput} */
    const maxRecentChatsInput = {
        id: 'maxRecentChats',
        type: 'number',
        label: t`Max recent chats`,
        tooltip: t`${MIN_CHATS} - ${MAX_CHATS}`,
        defaultState: String(settings.maxDisplayed),
        min: MIN_CHATS,
        max: MAX_CHATS,
        step: 1,
    };

    /** @type {import('./popup.js').CustomPopupInput} */
    const collapsedRecentChatsInput = {
        id: 'collapsedRecentChats',
        type: 'number',
        label: t`Collapsed recent chats`,
        tooltip: t`${MIN_CHATS} - ${MAX_CHATS}`,
        defaultState: String(settings.collapsedDisplayed),
        min: MIN_CHATS,
        max: MAX_CHATS,
        step: 1,
    };

    await callGenericPopup(t`Recent Chats Settings`, POPUP_TYPE.CONFIRM, null, {
        okButton: t`Save`,
        cancelButton: t`Cancel`,
        customInputs: [maxRecentChatsInput, collapsedRecentChatsInput],
        onClose: (popup) => {
            if (!popup.result) {
                return;
            }

            const maxInputValue = popup.inputResults.get(maxRecentChatsInput.id)?.toString() ?? String(DEFAULT_MAX_DISPLAYED);
            const collapsedInputValue = popup.inputResults.get(collapsedRecentChatsInput.id)?.toString() ?? String(DEFAULT_COLLAPSED_DISPLAYED);

            const newMax = clamp(parseInt(maxInputValue) || DEFAULT_MAX_DISPLAYED, maxRecentChatsInput.min, maxRecentChatsInput.max);
            const newCollapsed = clamp(parseInt(collapsedInputValue) || DEFAULT_COLLAPSED_DISPLAYED, collapsedRecentChatsInput.min, newMax);

            saveRecentChatsSettings({ maxDisplayed: newMax, collapsedDisplayed: newCollapsed });
        },
    });

    await refreshWelcomeScreen();
}

/**
 * Gets the list of recent chats from the server.
 * @returns {Promise<RecentChat[]>} List of recent chats
 *
 * @typedef {object} RecentChat
 * @property {string} file_name Name of the chat file
 * @property {string} chat_name Name of the chat (without extension)
 * @property {string} file_size Size of the chat file
 * @property {number} chat_items Number of items in the chat
 * @property {string} mes Last message content
 * @property {string} last_mes Timestamp of the last message
 * @property {string} avatar Avatar URL
 * @property {string} char_thumbnail Thumbnail URL
 * @property {string} char_name Character or group name
 * @property {string} date_short Date in short format
 * @property {string} date_long Date in long format
 * @property {string} group Group ID (if applicable)
 * @property {boolean} is_group Indicates if the chat is a group chat
 * @property {boolean} hidden Chat will be hidden by default
 * @property {boolean} pinned Indicates if the chat is pinned
 */
async function getRecentChats({ metadata = false } = {}) {
    const settings = getRecentChatsSettings();
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ max: settings.maxDisplayed, pinned: PinnedChatsManager.getAll(), metadata }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        console.warn('Failed to fetch recent character chats');
        return [];
    }

    /** @type {RecentChat[]} */
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }

    const dataWithEntities = data
        .map(chat => ({ chat, character: characters.find(x => x.avatar === chat.avatar), group: groups.find(x => x.id === chat.group) }))
        .filter(t => t.character || t.group)
        .sort((a, b) => {
            const isAPinned = PinnedChatsManager.isPinned(a.chat);
            const isBPinned = PinnedChatsManager.isPinned(b.chat);
            const momentComparison = sortMoments(timestampToMoment(a.chat.last_mes), timestampToMoment(b.chat.last_mes));

            if (isAPinned && !isBPinned) {
                return -1;
            }
            if (!isAPinned && isBPinned) {
                return 1;
            }

            return momentComparison;
        });

    dataWithEntities.forEach(({ chat, character, group }, index) => {
        const chatTimestamp = timestampToMoment(chat.last_mes);
        chat.char_name = character?.name || group?.name || '';
        chat.date_short = chatTimestamp.format('l');
        chat.date_long = chatTimestamp.format('LL LT');
        chat.chat_name = chat.file_name.replace('.jsonl', '');
        chat.char_thumbnail = character ? getThumbnailUrl('avatar', character.avatar) : system_avatar;
        chat.is_group = !!group;
        chat.hidden = index >= settings.collapsedDisplayed;
        chat.avatar = chat.avatar || '';
        chat.group = chat.group || '';
        chat.pinned = PinnedChatsManager.isPinned(chat);
    });

    return dataWithEntities.map(t => t.chat);
}

export async function openPermanentAssistantChat({ tryCreate = true, created = false } = {}) {
    const avatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === avatar);
    if (characterId === -1) {
        if (!tryCreate) {
            console.error(`Character not found for avatar ID: ${avatar}. Cannot create.`);
            return;
        }

        try {
            console.log(`Character not found for avatar ID: ${avatar}. Creating new assistant.`);
            await createPermanentAssistant();
            return openPermanentAssistantChat({ tryCreate: false, created: true });
        } catch (error) {
            console.error('Error creating permanent assistant:', error);
            toastr.error(t`Failed to create ${neutralCharacterName}. See console for details.`);
            return;
        }
    }

    try {
        await selectCharacterById(characterId);
        if (!created) {
            await doNewChat({ deleteCurrentChat: false });
        }
        console.log(`Opened permanent assistant chat for ${neutralCharacterName}.`, getCurrentChatId());
    } catch (error) {
        console.error('Error opening permanent assistant chat:', error);
        toastr.error(t`Failed to open permanent assistant chat. See console for details.`);
    }
}

async function createPermanentAssistant() {
    if (is_group_generating || is_send_press) {
        throw new Error(t`Cannot create while generating.`);
    }

    const formData = new FormData();
    formData.append('ch_name', neutralCharacterName);
    formData.append('file_name', defaultAssistantAvatar.replace('.png', ''));
    formData.append('creator_notes', t`Automatically created character. Feel free to edit.`);

    try {
        const avatarResponse = await fetch(system_avatar);
        const avatarBlob = await avatarResponse.blob();
        formData.append('avatar', avatarBlob, defaultAssistantAvatar);
    } catch (error) {
        console.warn('Error fetching system avatar. Fallback image will be used.', error);
    }

    const fetchResult = await fetch('/api/characters/create', {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
        body: formData,
        cache: 'no-cache',
    });

    if (!fetchResult.ok) {
        throw new Error(t`Creation request did not succeed.`);
    }

    await getCharacters();
}

export async function openPermanentAssistantCard() {
    const avatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === avatar);
    if (characterId === -1) {
        toastr.info(t`Assistant not found. Try sending a chat message.`);
        return;
    }

    await selectCharacterById(characterId);
}

/**
 * Assigns a character as the assistant.
 * @param {string?} characterId Character ID
 */
export function assignCharacterAsAssistant(characterId) {
    if (characterId === undefined) {
        return;
    }
    /** @type {Character} */
    const character = characters[characterId];
    if (!character) {
        return;
    }

    const currentAssistantAvatar = getPermanentAssistantAvatar();
    if (currentAssistantAvatar === character.avatar) {
        if (character.avatar === defaultAssistantAvatar) {
            toastr.info(t`${character.name} is a system assistant. Choose another character.`);
            return;
        }

        toastr.info(t`${character.name} is no longer your assistant.`);
        accountStorage.removeItem(assistantAvatarKey);
        return;
    }

    accountStorage.setItem(assistantAvatarKey, character.avatar);
    printCharactersDebounced();
    toastr.success(t`Set ${character.name} as your assistant.`);
}

export function initWelcomeScreen() {
    PinnedChatsManager.init();

    const events = [event_types.CHAT_CHANGED, event_types.APP_READY];
    for (const event of events) {
        eventSource.makeFirst(event, openWelcomeScreen);
    }

    eventSource.on(event_types.CHARACTER_MANAGEMENT_DROPDOWN, (target) => {
        if (target !== 'set_as_assistant') {
            return;
        }
        assignCharacterAsAssistant(this_chid);
    });

    eventSource.on(event_types.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        if (oldAvatar === getPermanentAssistantAvatar()) {
            accountStorage.setItem(assistantAvatarKey, newAvatar);
        }
        PinnedHomeCharactersManager.rename(oldAvatar, newAvatar);
    });

    eventSource.on(event_types.CHAT_RENAMED, async ({ avatarId, groupId, oldFileName, newFileName }) => {
        PinnedChatsManager.rename({ avatar: avatarId, group: groupId, file_name: oldFileName }, newFileName);
    });
}
