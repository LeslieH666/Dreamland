/**
 * Leslie's simple settings hub.
 *
 * This module only reorganizes access to existing SillyTavern controls. The
 * original drawers, event handlers, saved settings, and data formats remain
 * the source of truth.
 */

import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced, setGenerationParamsFromPreset, setOnlineStatus, stopStatusLoading } from '../script.js';
import { clearUserSpaceBrowserState } from './leslie-user-space-browser.js';
import { flushUserSpacePreferences } from './leslie-user-preferences.js';
import { extension_settings } from './extensions.js';
import { getLeslieConnectionState } from './leslie-connection-state.js';
import { textgen_types, textgenerationwebui_settings } from './textgen-settings.js';
import { selectContextPreset, selectInstructPreset } from './instruct-mode.js';
import { SECRET_KEYS, secret_state, writeSecret } from './secrets.js';
import {
    getLeslieLocalRuntime,
    getLeslieLocalSettings,
    isLeslieQwenRoleplayModel,
    isLocalModelLoadingEnabled,
    probeLeslieLocalRuntime,
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
import { presentDreamlandPage, registerDreamlandPage, returnToDreamlandChat, usesDreamlandPages } from './dreamland-pages.js';

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

const COPY = {
    zh: {
        launcher: '设置',
        close: '关闭设置',
        backToChat: '返回聊天',
        settings: '设置',
        subtitle: 'DreamLand 设置',
        introEyebrow: '日常设置',
        introTitle: '把常用的留在眼前',
        introBody: '这里只整理入口，不会删除或改写 SillyTavern 的原功能。常用选项可以直接调整，复杂功能仍保留在高级设置中。',
        safeNote: '聊天记录、角色卡和提示词顺序不会因这个界面而改变。',
        quickTitle: '外观与使用习惯',
        quickBody: '统一使用 MomoTalk 界面和默认红色；明暗与外观偏好按用户空间保存，登录页同步使用。',
        theme: '界面主题',
        themeHelp: '选择 SillyTavern 基础主题',
        language: '界面语言',
        languageHelp: '更改后页面会重新载入',
        reducedMotion: '减少动态效果',
        reducedMotionHelp: '减少动画，阅读更稳定',
        performance: '性能优先',
        performanceHelp: '关闭背景模糊，低配置设备更流畅',
        privacyModeTitle: '隐私模式',
        privacyModeBody: '按会话列表、聊天头部、消息、输入区和连接状态分别设置遮罩。',
        privacyModeDetailTitle: '屏幕隐私模式',
        privacyModeDetailBody: '沿用最初的桌面 UI 分区，只模糊你选择的界面区块，不改写或移动任何聊天数据。',
        privacyModeEnabled: '开启隐私模式',
        privacyModeEnabledHelp: '可从聊天头部或会话栏的眼睛按钮随时开关。',
        privacyModePreview: '遮罩预览',
        privacyModePreviewHelp: '下方预览与实际聊天界面同步。带眼睛斜线的区块会被模糊。',
        privacyModeBlocks: '选择要遮罩的区块',
        privacyModeBlocksHelp: '打开表示隐私模式启用时遮罩；关闭表示该区块可以透过。',
        privacyConversations: '会话列表',
        privacyConversationsHelp: '角色名称、搜索内容和最近消息摘要。',
        privacyHeader: '聊天头部',
        privacyHeaderHelp: '当前角色头像、名称、状态和世界线。',
        privacyMessages: '消息内容',
        privacyMessagesHelp: '当前聊天中的文字、图片与消息操作。',
        privacyComposer: '输入区',
        privacyComposerHelp: '未发送的草稿、互动引导和输入控件。',
        privacyConnection: '连接状态',
        privacyConnectionHelp: '会话栏底部显示的模型和连接信息。',
        privacyVisualOnly: '这是本机屏幕遮挡功能，不是数据加密。聊天数据、辅助技术和开发工具仍可读取原内容。',
        spacesTitle: '用户空间',
        spacesBody: '选择、创建和切换各自独立的账号与聊天空间。',
        spacesLoading: '正在读取用户空间…',
        spacesCurrent: '当前空间',
        spacesProtected: '已启用密码登录',
        spacesInactive: '尚未启用多用户登录',
        spacesSetupHelp: '在这台电脑上为默认空间设置密码；若已有密码，请输入原密码。启用后将迁移并加密现有数据，保留加密备份。密码丢失后无法解密。',
        spacesPasswordRequired: '请输入密码，不能留空。',
        spacesPasswordTip: '密码长度不限；较短的密码更容易被猜到。',
        spacesLocalOnly: '首次启用只能在 DreamLand 电脑本机完成。',
        spacesPassword: '密码',
        spacesConfirm: '确认密码',
        spacesEnable: '启用用户空间',
        spacesMismatch: '两次输入的密码不一致。',
        spacesCreateTitle: '创建用户空间',
        spacesName: '显示名称',
        spacesHandle: '账号标识',
        spacesCreate: '创建空间',
        spacesSwitch: '切换用户',
        spacesSwitching: '正在封存并切换…',
        spacesCreateSuccess: '用户空间已创建。',
        spacesError: '无法操作用户空间，请稍后重试。',
        essentialsTitle: '核心功能',
        essentialsBody: '按要完成的事情寻找设置，不必理解内部术语。',
        modelTitle: '模型连接',
        modelBody: '选择模型服务、填写地址和密钥，并检查是否连接成功。',
        replyTitle: '回复方式',
        replyBody: '调整回复长度、随机程度和生成预设。改动会影响之后的回复风格。',
        voiceTitle: '角色语音',
        voiceBody: '接入火山引擎，为不同角色设置音色并在回复后自动朗读。',
        voiceDetailTitle: '火山引擎角色语音',
        voiceDetailBody: '密钥、音色和自动朗读集中在这里配置，不改变角色回复文字或提示词。',
        characterTitle: '角色与会话',
        characterBody: '选择或创建角色，查看已有角色和聊天入口。',
        personaTitle: '我的身份',
        personaBody: '设置你在对话中是谁，以及角色如何称呼你。',
        worldTitle: '世界与记忆',
        worldBody: '管理故事背景、地点、规则和会被自动引用的资料。',
        connected: '已连接',
        configured: '已配置',
        checking: '正在检测',
        disconnected: '未连接',
        open: '打开',
        advancedTitle: '高级设置',
        advancedBody: '复杂选项集中放在这里，日常使用通常不需要修改。',
        promptTitle: '提示词与格式',
        promptBody: '控制消息怎样组合后交给模型。设置不当会明显改变回复效果。',
        extensionsTitle: '扩展能力',
        extensionsBody: '管理翻译、语音、图片生成等附加功能。',
        backgroundTitle: '背景素材',
        backgroundBody: '上传、整理和选择聊天背景。',
        fullSettingsTitle: '完整界面设置',
        fullSettingsBody: '进入 SillyTavern 原有的全部界面与行为选项。',
        lockedTitle: '高级选项已收起',
        lockedBody: '这些功能仍然完整保留。只有需要精细调整时再展开，可减少误操作。',
        unlock: '展开高级设置',
        relock: '收起高级设置',
        footer: 'DreamLand 外观偏好可随时调整；其他设置仍可在对应面板中恢复。',
        back: '返回设置首页',
        simpleDetail: '常用设置',
        navigation: '设置分类',
        overviewTitle: '通用与外观',
        overviewBody: '主题、语言和日常使用习惯',
        coreGroup: '对话',
        roleGroup: '角色资料',
        advancedGroup: '高级与兼容',
        contentEyebrow: '设置内容',
        originalSave: '设置保存在本机',
        fullSettings: '打开完整设置',
        fullSettingsHelp: '需要其他供应商或精细参数时再进入。',
        modelDetailTitle: '模型连接',
        modelDetailBody: '选择最常用的连接方式，在这里完成地址、密钥和模型设置。',
        serviceTitle: '选择连接方式',
        serviceBody: '选择后会同步切换 SillyTavern 原来的接口类型。',
        apiKindTitle: '先选择 API 类型',
        apiKindBody: '联网 API 使用厂商提供的密钥；本地 API 连接你电脑上运行的模型服务。',
        onlineApi: '联网 API',
        onlineApiBody: 'DeepSeek、OpenAI 等云端模型服务',
        localApi: '本地 API',
        localApiBody: 'Ollama、llama.cpp 等本机模型',
        chooseProvider: '请选择下方的一种连接方式，再填写对应信息。',
        serviceDeepSeek: 'DeepSeek',
        serviceDeepSeekBody: 'DeepSeek 官方联网接口。',
        serviceCustom: 'OpenAI 兼容',
        serviceCustomBody: '适合第三方联网 API 或中转服务。',
        serviceOpenRouter: 'OpenRouter',
        serviceOpenRouterBody: '使用一个密钥访问多个模型供应商。',
        serviceClaude: 'Anthropic Claude',
        serviceClaudeBody: '连接 Anthropic 官方 Claude 接口。',
        serviceGemini: 'Google Gemini',
        serviceGeminiBody: '连接 Google AI Studio 的 Gemini 接口。',
        serviceOllama: 'Ollama',
        serviceOllamaBody: '连接本机运行的 Ollama 模型。',
        serviceLlamaCpp: 'llama.cpp',
        serviceLlamaCppBody: '连接 llama.cpp 本地服务器。',
        serviceKoboldCpp: 'KoboldCpp',
        serviceKoboldCppBody: '连接 KoboldCpp 本地服务器。',
        serviceTextGen: 'Text Generation WebUI',
        serviceTextGenBody: '连接 oobabooga WebUI 接口。',
        serviceLocalGeneric: '通用本地接口',
        serviceLocalGenericBody: '连接兼容接口的其他本地推理程序。',
        localModelTitle: '连接本地模型',
        localModelBody: '选择电脑 models 目录中的 GGUF 模型，可从电脑或同一局域网的手机启动并自动连接。',
        localModelPath: '统一模型目录',
        localModelOpenFolder: '打开模型目录',
        localModelFolderFailed: '无法打开模型目录，请按上方路径手动打开。',
        localModelRefresh: '重新扫描',
        localModelScanning: '正在扫描模型目录…',
        localModelDesktopOnly: '暂时无法使用电脑托管启动。请确认电脑服务仍在运行，然后重新扫描；也可在高级设置中手动连接。',
        localModelEmpty: '尚未找到可一键连接的 GGUF 模型。将单文件 GGUF 放入上述目录或其子目录，然后重新扫描。',
        localModelRuntimeMissing: '已找到模型，但未安装项目适配的 KoboldCpp 运行程序。可展开高级设置手动连接已有服务。',
        localModelMethod: '自动连接方式：KoboldCpp',
        localModelMethodHelp: '下方列出这个连接方式能加载的 GGUF 模型；无需填写地址或端口。实际能否运行取决于模型架构和电脑资源。',
        localModelSelect: '选择模型',
        localModelConnect: '连接所选模型',
        localModelConnecting: '正在启动模型并连接，请稍候…',
        localModelConnected: '本地模型已配置并发起连接：',
        localModelReadyFailure: '模型服务未能在预期时间内就绪，请查看运行日志或展开高级设置。',
        localModelStop: '停止本地模型',
        localModelAdvanced: '展开高级连接设置',
        localModelAdvancedHelp: 'Ollama、llama.cpp、其他运行时、手动地址和端口',
        localModelDetect: '一键识别并自动配置',
        localModelDetectHelp: '由 DreamLand 电脑识别已运行的模型；若未运行，则启动上方选中的 GGUF 模型。',
        localModelDetectChecking: '正在查找或启动本地模型，请稍候…',
        localModelDetectSuccess: '已识别并配置：',
        localModelDetectFailure: '未找到正在运行的适配模型，也没有可托管启动的 GGUF 模型。请检查模型目录或运行程序。',
        localModelLoading: '启用本地模型加载',
        localModelLoadingHelp: '关闭后，DreamLand 不会自动连接或调用本地模型；不会删除模型文件。',
        localModelLoadingDisabled: '本地模型加载已关闭，请先打开开关。',
        localModelLoadingEnabledStatus: '本地模型加载已开启。',
        localModelLoadingDisabledStatus: '本地模型加载已关闭；项目不会连接本地模型。',
        desktopServicesTitle: '本地服务',
        desktopServicesBody: '从 DreamLand 内启动或停止可选桌面组件，不再需要单独的启动脚本。',
        desktopServicesUnavailable: '请在 DreamLand 桌面应用中管理这些服务。浏览器与局域网页面只能查看设置。',
        desktopServiceAiri: 'AIRI 桌面陪伴',
        desktopServiceAiriBody: '连接当前角色、聊天、记忆与语音。首次启动可能需要构建。',
        desktopServiceModel: '已管理的本地模型',
        desktopServiceModelBody: '启动或停止项目内的 KoboldCpp；上方可直接选择要加载的模型。',
        desktopServiceStart: '启动',
        desktopServiceStop: '停止',
        desktopServiceStarting: '处理中',
        desktopServiceRunning: '运行中',
        desktopServiceStopped: '未启动',
        desktopServiceMissing: '组件未配置',
        desktopServiceFailed: '本地服务操作失败。',
        serviceOpenAI: 'OpenAI',
        serviceOpenAIBody: '直接连接 OpenAI 官方接口。',
        endpoint: '服务地址',
        endpointHelp: '填写接口的基础地址；OpenAI 兼容地址通常以 /v1 结尾。',
        apiKey: 'API 密钥',
        apiKeyHelp: '输入后点击连接或切换接口即可保存；密钥不会在输入框中回显。',
        apiKeySavedHelp: '此接口已有保存的密钥，留空即可直接连接；输入新密钥会替换当前使用的密钥。',
        apiKeySaveFailed: '密钥未能保存，请保留当前页面并重试。',
        model: '模型',
        modelHelp: '连接成功后可从列表选择，也可以按服务要求填写模型名称。',
        availableModel: '可用模型列表',
        connect: '连接并读取模型',
        autoConnect: '启动时自动连接',
        autoConnectHelp: '下次打开应用时尝试连接上次使用的服务。',
        thinkingMode: '思考模式（默认关闭）',
        thinkingModeHelp: '关闭后会明确要求兼容模型直接回答，不请求也不显示思考过程；日常角色对话建议关闭。',
        privacy: '密钥按账号保存在本机数据目录；Windows 下使用系统用户级加密。',
        allProviders: '其他供应商与详细连接设置',
        otherProviderActive: '当前使用的是其他连接方式。你可以选择上方常用服务，或打开完整连接设置继续配置。',
        settingUnavailable: '当前接口没有提供这项常用设置，可在完整设置中调整。',
        replyDetailTitle: '回复方式',
        replyDetailBody: '只保留最常调整的生成选项，并解释它们会怎样影响回复。',
        stylePresetsTitle: '选择回复范式',
        stylePresetsBody: '范式会在每次角色回复前作为表达规则交给模型，不再用固定 token 数模拟长短。',
        stylePresetsSafe: '只影响回复的表达方式，不改写角色卡、世界设定或记忆。DeepSeek 前台回复由 API 自行决定输出长度。',
        styleOff: '跟随角色原设',
        styleOffBody: '不注入额外写作范式，完全沿用角色卡和当前对话要求。',
        styleOffTag: '关闭注入',
        styleBalanced: '均衡叙事',
        styleBalancedBody: '叙述与对话保持适中，适合大多数日常角色扮演。',
        styleBalancedTag: '适中 · 自然',
        styleNovel: '长篇小说',
        styleNovelBody: '篇幅更长、描写更丰富，适合连续场景和章节式创作。',
        styleNovelTag: '长篇 · 丰富',
        styleDialogue: '对话推进',
        styleDialogueBody: '回复更紧凑、节奏更快，适合角色之间来回交流。',
        styleDialogueTag: '紧凑 · 灵活',
        styleConcise: '简洁回复',
        styleConciseBody: '快速给出重点，适合短回合、指令或轻量聊天。',
        styleConciseTag: '短小 · 稳定',
        styleApplied: '已应用',
        styleAppliedTail: '，之后的角色回复会使用这套表达规则。',
        providerOutput: '回复长度由模型服务决定',
        providerOutputHelp: 'DeepSeek 前台聊天不再发送 Leslie 的输出 token 上限；模型仍受自身上下文、服务端上限和停止条件约束。其他接口保留兼容性上限。',
        creativity: '自由发挥程度',
        creativityHelp: '较低更稳定，较高更多变化；它对应原来的 Temperature。',
        streaming: '逐字显示回复',
        streamingHelp: '开启后，模型生成的文字会边生成边显示。',
        advancedReply: '高级采样与完整回复设置',
        characterDetailTitle: '角色与会话',
        characterDetailBody: '先确认当前角色，再进入选择、编辑或相关设定。',
        currentCharacter: '当前角色',
        noCharacter: '尚未选择角色',
        characterGuide: '角色卡仍使用 SillyTavern 原格式保存，这里只整理常用操作入口。',
        chooseCharacter: '选择或新建角色',
        editCharacter: '编辑当前角色',
        goPersona: '设置我的身份',
        goWorld: '设置世界与记忆',
        personaDetailTitle: '我的身份',
        personaDetailBody: '说明你在故事中是谁，以及这段说明怎样加入对话。',
        currentPersona: '当前身份',
        noPersona: '尚未选择身份',
        personaDescription: '身份描述',
        personaDescriptionHelp: '例如年龄、外貌、性格或角色应该知道的玩家背景。',
        personaPosition: '加入对话的位置',
        personaPositionHelp: '保持当前设置通常即可；特殊角色扮演再调整。',
        autoLockPersona: '自动绑定到当前聊天',
        autoLockPersonaHelp: '切换身份后，让该聊天下次继续使用同一个身份。',
        managePersonas: '选择或新建身份',
        renamePersona: '重命名当前身份',
        worldDetailTitle: '世界与记忆',
        worldDetailBody: '选择当前聊天可以引用的背景资料，复杂触发规则仍放在完整编辑器中。',
        activeWorlds: '启用的世界资料',
        activeWorldsHelp: '可多选。被选中的资料库会按关键词和规则参与对话。',
        recursiveWorld: '允许资料互相触发',
        recursiveWorldHelp: '一条资料提到另一条关键词时，可以继续引用相关内容。',
        manageWorlds: '打开完整世界资料编辑器',
        demoTitle: '演示模式',
        demoBody: '切换到独立的数据空间，用于展示新功能、调试界面和制作截图。正式角色、聊天和密钥不会被复制。',
        demoNormalStatus: '当前使用正式空间',
        demoActiveStatus: '当前使用隔离的演示空间',
        demoLoadingStatus: '正在确认当前空间…',
        demoEnter: '进入演示模式',
        demoExit: '退出演示模式',
        demoSwitching: '正在切换…',
        demoError: '无法确认或切换演示空间，请稍后重试。',
        demoStorageNote: '切换会先保存待处理的设置并重新载入页面。同一浏览器会话中的其他标签页也需要刷新。',
        demoBannerTitle: '演示模式',
        demoBannerBody: '当前数据与正式空间隔离',
    },
    en: {
        launcher: 'Settings',
        close: 'Close settings',
        backToChat: 'Back to chats',
        settings: 'Settings',
        subtitle: 'DreamLand settings',
        introEyebrow: 'Everyday settings',
        introTitle: 'Keep the essentials in sight',
        introBody: 'This page reorganizes access without removing or rewriting SillyTavern features. Common options stay close at hand, while complex tools remain available under Advanced.',
        safeNote: 'This interface does not change chats, character cards, or prompt order.',
        quickTitle: 'Appearance & comfort',
        quickBody: 'MomoTalk uses the default rose accent. Display mode and appearance are saved per user space and reflected on the login page.',
        theme: 'Theme',
        themeHelp: 'Choose the base SillyTavern theme',
        language: 'Language',
        languageHelp: 'The page reloads after a change',
        reducedMotion: 'Reduce motion',
        reducedMotionHelp: 'Use fewer animations for steadier reading',
        performance: 'Prioritize performance',
        performanceHelp: 'Disable background blur on slower devices',
        privacyModeTitle: 'Privacy mode',
        privacyModeBody: 'Mask the conversation list, chat header, messages, composer, and connection status independently.',
        privacyModeDetailTitle: 'Screen privacy mode',
        privacyModeDetailBody: 'Uses the original desktop UI regions and blurs only the blocks you choose without moving or rewriting chat data.',
        privacyModeEnabled: 'Turn on privacy mode',
        privacyModeEnabledHelp: 'Toggle it anytime from the eye button in the chat header or conversation sidebar.',
        privacyModePreview: 'Mask preview',
        privacyModePreviewHelp: 'This preview follows the live chat UI. Blocks with the crossed-out eye will be blurred.',
        privacyModeBlocks: 'Choose masked blocks',
        privacyModeBlocksHelp: 'On means masked while privacy mode is active; off means the block remains visible.',
        privacyConversations: 'Conversation list',
        privacyConversationsHelp: 'Character names, search text, and recent-message previews.',
        privacyHeader: 'Chat header',
        privacyHeaderHelp: 'Current avatar, character name, status, and story line.',
        privacyMessages: 'Message content',
        privacyMessagesHelp: 'Text, images, and message actions in the current chat.',
        privacyComposer: 'Composer',
        privacyComposerHelp: 'Unsent drafts, guided replies, and input controls.',
        privacyConnection: 'Connection status',
        privacyConnectionHelp: 'Model and connection details at the bottom of the sidebar.',
        privacyVisualOnly: 'This is a local screen mask, not data encryption. Chat data remains available to assistive technology and developer tools.',
        spacesTitle: 'User spaces',
        spacesBody: 'Select, create, and switch separate accounts and chat spaces.',
        spacesLoading: 'Loading user spaces…',
        spacesCurrent: 'Current space',
        spacesProtected: 'Password login is enabled',
        spacesInactive: 'Multi-user login is not enabled yet',
        spacesSetupHelp: 'Set a password for the default space on this computer; enter its current password if one exists. Activation encrypts existing data and retains an encrypted backup. A lost password cannot decrypt the vault.',
        spacesPasswordRequired: 'Enter a password; it cannot be empty.',
        spacesPasswordTip: 'There is no length requirement; shorter passwords are easier to guess.',
        spacesLocalOnly: 'Initial setup is available only on the DreamLand computer.',
        spacesPassword: 'Password',
        spacesConfirm: 'Confirm password',
        spacesEnable: 'Enable user spaces',
        spacesMismatch: 'The passwords do not match.',
        spacesCreateTitle: 'Create a user space',
        spacesName: 'Display name',
        spacesHandle: 'Account handle',
        spacesCreate: 'Create space',
        spacesSwitch: 'Switch user',
        spacesSwitching: 'Securing space and switching…',
        spacesCreateSuccess: 'User space created.',
        spacesError: 'Could not update user spaces. Try again.',
        essentialsTitle: 'Essentials',
        essentialsBody: 'Find settings by what you want to do, not by internal terminology.',
        modelTitle: 'Model connection',
        modelBody: 'Choose a model service, enter its address and key, and check the connection.',
        replyTitle: 'Reply style',
        replyBody: 'Adjust response length, randomness, and generation presets. Changes affect future replies.',
        voiceTitle: 'Character voice',
        voiceBody: 'Connect Volcengine, assign voices, and speak automatically after replies.',
        voiceDetailTitle: 'Volcengine character voice',
        voiceDetailBody: 'Configure credentials, voices, and automatic narration without changing reply text or prompts.',
        characterTitle: 'Characters & chats',
        characterBody: 'Choose or create characters and access existing conversations.',
        personaTitle: 'My identity',
        personaBody: 'Define who you are in the conversation and how characters address you.',
        worldTitle: 'World & memory',
        worldBody: 'Manage story background, locations, rules, and automatically referenced notes.',
        connected: 'Connected',
        configured: 'Configured',
        checking: 'Checking',
        disconnected: 'Not connected',
        open: 'Open',
        advancedTitle: 'Advanced settings',
        advancedBody: 'Complex options are kept together here. Most conversations do not need them.',
        promptTitle: 'Prompts & formatting',
        promptBody: 'Control how messages are assembled for the model. Incorrect settings can noticeably change replies.',
        extensionsTitle: 'Extensions',
        extensionsBody: 'Manage optional translation, speech, image generation, and other tools.',
        backgroundTitle: 'Backgrounds',
        backgroundBody: 'Upload, organize, and choose chat backgrounds.',
        fullSettingsTitle: 'All interface settings',
        fullSettingsBody: 'Open every original SillyTavern interface and behavior option.',
        lockedTitle: 'Advanced options are tucked away',
        lockedBody: 'Every feature is still available. Reveal these controls only when you need precise customization.',
        unlock: 'Show advanced settings',
        relock: 'Hide advanced settings',
        footer: 'DreamLand appearance preferences can be changed at any time; other settings remain available in their original panels.',
        back: 'Back to settings',
        simpleDetail: 'Common settings',
        navigation: 'Settings categories',
        overviewTitle: 'General & appearance',
        overviewBody: 'Theme, language, and everyday preferences',
        coreGroup: 'Conversation',
        roleGroup: 'Character data',
        advancedGroup: 'Advanced & compatibility',
        contentEyebrow: 'Settings detail',
        originalSave: 'Settings are saved locally',
        fullSettings: 'Open all settings',
        fullSettingsHelp: 'Use this only for other providers or precise parameters.',
        modelDetailTitle: 'Model connection',
        modelDetailBody: 'Choose a common connection and configure its address, key, and model here.',
        serviceTitle: 'Choose a connection',
        serviceBody: 'Your choice also updates SillyTavern’s original API type.',
        apiKindTitle: 'Choose an API type first',
        apiKindBody: 'Online APIs use a provider key. Local APIs connect to a model server running on your computer.',
        onlineApi: 'Online API',
        onlineApiBody: 'Cloud services such as DeepSeek and OpenAI',
        localApi: 'Local API',
        localApiBody: 'Local models such as Ollama and llama.cpp',
        chooseProvider: 'Choose one connection below, then enter its corresponding details.',
        serviceDeepSeek: 'DeepSeek',
        serviceDeepSeekBody: 'The official DeepSeek online API.',
        serviceCustom: 'OpenAI-compatible',
        serviceCustomBody: 'For third-party online APIs and relay services.',
        serviceOpenRouter: 'OpenRouter',
        serviceOpenRouterBody: 'Use one key to access models from multiple providers.',
        serviceClaude: 'Anthropic Claude',
        serviceClaudeBody: 'Connect to Anthropic’s official Claude API.',
        serviceGemini: 'Google Gemini',
        serviceGeminiBody: 'Connect to Gemini through Google AI Studio.',
        serviceOllama: 'Ollama',
        serviceOllamaBody: 'Connect to Ollama models running on this computer.',
        serviceLlamaCpp: 'llama.cpp',
        serviceLlamaCppBody: 'Connect to a local llama.cpp server.',
        serviceKoboldCpp: 'KoboldCpp',
        serviceKoboldCppBody: 'Connect to a local KoboldCpp server.',
        serviceTextGen: 'Text Generation WebUI',
        serviceTextGenBody: 'Connect to an oobabooga WebUI API.',
        serviceLocalGeneric: 'Generic local API',
        serviceLocalGenericBody: 'Connect to another compatible local inference server.',
        localModelTitle: 'Connect a local model',
        localModelBody: 'Select a GGUF model in the computer’s models folder, then start and connect from desktop or a phone on the same LAN.',
        localModelPath: 'Shared model folder',
        localModelOpenFolder: 'Open model folder',
        localModelFolderFailed: 'Could not open the model folder. Use the path shown above.',
        localModelRefresh: 'Scan again',
        localModelScanning: 'Scanning the model folder…',
        localModelDesktopOnly: 'Managed startup is unavailable. Check that the computer service is running and scan again, or connect manually in advanced settings.',
        localModelEmpty: 'No one-click GGUF model found. Place a single-file GGUF in this folder or a subfolder, then scan again.',
        localModelRuntimeMissing: 'Models were found, but the managed KoboldCpp runtime is not installed. Use advanced settings for an existing service.',
        localModelMethod: 'Automatic connection: KoboldCpp',
        localModelMethodHelp: 'These GGUF models can be loaded through this method. No address or port is needed. Runtime support and available memory still determine whether loading succeeds.',
        localModelSelect: 'Select a model',
        localModelConnect: 'Connect selected model',
        localModelConnecting: 'Starting the model and connecting…',
        localModelConnected: 'Local model configured and connection started:',
        localModelReadyFailure: 'The model service did not become ready in time. Check the runtime logs or advanced settings.',
        localModelStop: 'Stop local model',
        localModelAdvanced: 'Show advanced connection settings',
        localModelAdvancedHelp: 'Ollama, llama.cpp, other runtimes, manual addresses and ports',
        localModelDetect: 'Detect and configure automatically',
        localModelDetectHelp: 'The DreamLand computer checks for a running model, then starts the selected GGUF model if none is running.',
        localModelDetectChecking: 'Finding or starting the local model…',
        localModelDetectSuccess: 'Detected and configured:',
        localModelDetectFailure: 'No compatible model is running and no managed GGUF model is available. Check the models folder or runtime.',
        localModelLoading: 'Enable local model loading',
        localModelLoadingHelp: 'When disabled, DreamLand will not connect to or call the local model. Model files are not deleted.',
        localModelLoadingDisabled: 'Local model loading is disabled. Turn on the switch first.',
        localModelLoadingEnabledStatus: 'Local model loading is enabled.',
        localModelLoadingDisabledStatus: 'Local model loading is disabled; the project will not connect to a local model.',
        desktopServicesTitle: 'Local services',
        desktopServicesBody: 'Start or stop optional desktop components from DreamLand without separate launch scripts.',
        desktopServicesUnavailable: 'Manage these services in the DreamLand desktop app. Browser and LAN pages can only view settings.',
        desktopServiceAiri: 'AIRI companion',
        desktopServiceAiriBody: 'Connects to the active character, chat, memory, and voice. The first start may build AIRI.',
        desktopServiceModel: 'Managed local model',
        desktopServiceModelBody: 'Starts or stops the project KoboldCpp runtime; select the model above.',
        desktopServiceStart: 'Start',
        desktopServiceStop: 'Stop',
        desktopServiceStarting: 'Working',
        desktopServiceRunning: 'Running',
        desktopServiceStopped: 'Stopped',
        desktopServiceMissing: 'Not configured',
        desktopServiceFailed: 'The local service action failed.',
        serviceOpenAI: 'OpenAI',
        serviceOpenAIBody: 'Connect directly to the official OpenAI API.',
        endpoint: 'Server address',
        endpointHelp: 'Enter the base URL. OpenAI-compatible addresses usually end in /v1.',
        apiKey: 'API key',
        apiKeyHelp: 'Connect or switch APIs to save this key. Saved keys are not shown in the input.',
        apiKeySavedHelp: 'A key is saved for this API. Leave this blank to reconnect, or enter a replacement key.',
        apiKeySaveFailed: 'The key could not be saved. Stay on this page and try again.',
        model: 'Model',
        modelHelp: 'Choose after connecting, or enter the model name required by your service.',
        availableModel: 'Available models',
        connect: 'Connect and load models',
        autoConnect: 'Connect automatically on startup',
        autoConnectHelp: 'Try the last-used service when the app opens again.',
        thinkingMode: 'Thinking mode (off by default)',
        thinkingModeHelp: 'Keep this off for direct replies. Compatible models will be told not to reason, and hidden thoughts will not be requested or shown.',
        privacy: 'Keys stay in the local per-account data directory. On Windows they use user-level system encryption.',
        allProviders: 'Other providers and detailed connection settings',
        otherProviderActive: 'Another connection type is active. Choose a common service above, or continue in the full connection settings.',
        settingUnavailable: 'This common control is not available for the current API. You can adjust it in all settings.',
        replyDetailTitle: 'Reply style',
        replyDetailBody: 'Keep the generation options people change most often, with plain-language explanations.',
        stylePresetsTitle: 'Choose a response mode',
        stylePresetsBody: 'The selected mode is injected as a presentation rule before each character reply instead of simulating style with a fixed token count.',
        stylePresetsSafe: 'This changes presentation only, not character cards, world facts, or memories. DeepSeek foreground replies let the API choose the output length.',
        styleOff: 'Follow character defaults',
        styleOffBody: 'Inject no extra writing mode and follow the character card and current conversation.',
        styleOffTag: 'Injection off',
        styleBalanced: 'Balanced story',
        styleBalancedBody: 'A natural mix of narration and dialogue for most roleplay chats.',
        styleBalancedTag: 'Medium · Natural',
        styleNovel: 'Long-form novel',
        styleNovelBody: 'Longer, richer writing for continuous scenes and chapter-style creation.',
        styleNovelTag: 'Long · Rich',
        styleDialogue: 'Dialogue-driven',
        styleDialogueBody: 'Tighter, faster replies for back-and-forth character conversation.',
        styleDialogueTag: 'Tight · Lively',
        styleConcise: 'Concise replies',
        styleConciseBody: 'Quickly reaches the point for short turns, instructions, and lightweight chat.',
        styleConciseTag: 'Short · Steady',
        styleApplied: 'Applied ',
        styleAppliedTail: '. Future character replies will use this presentation rule.',
        providerOutput: 'The model service decides reply length',
        providerOutputHelp: 'DeepSeek foreground chat no longer receives a Leslie output-token cap. The model still obeys its own context window, service limits, and stop conditions. Other APIs retain compatibility limits.',
        creativity: 'Creative freedom',
        creativityHelp: 'Lower is steadier; higher allows more variation. This is the original Temperature setting.',
        streaming: 'Show text as it is generated',
        streamingHelp: 'Display the reply gradually while the model is writing it.',
        advancedReply: 'Advanced sampling and all reply settings',
        characterDetailTitle: 'Characters & chats',
        characterDetailBody: 'Check the current character, then choose, edit, or open related settings.',
        currentCharacter: 'Current character',
        noCharacter: 'No character selected',
        characterGuide: 'Character cards still use SillyTavern’s original format. This page only organizes common actions.',
        chooseCharacter: 'Choose or create a character',
        editCharacter: 'Edit current character',
        goPersona: 'Set my identity',
        goWorld: 'Set world & memory',
        personaDetailTitle: 'My identity',
        personaDetailBody: 'Describe who you are in the story and how that description enters the conversation.',
        currentPersona: 'Current identity',
        noPersona: 'No identity selected',
        personaDescription: 'Identity description',
        personaDescriptionHelp: 'For example: age, appearance, personality, or player background the character should know.',
        personaPosition: 'Position in the conversation',
        personaPositionHelp: 'The current setting is usually best; change it only for special roleplay setups.',
        autoLockPersona: 'Keep this identity with the chat',
        autoLockPersonaHelp: 'After switching identity, use it again the next time this chat opens.',
        managePersonas: 'Choose or create an identity',
        renamePersona: 'Rename current identity',
        worldDetailTitle: 'World & memory',
        worldDetailBody: 'Choose background references for this chat. Complex activation rules remain in the full editor.',
        activeWorlds: 'Active world references',
        activeWorldsHelp: 'Multiple selections are allowed. Selected lorebooks can contribute content using keywords and rules.',
        recursiveWorld: 'Allow references to trigger each other',
        recursiveWorldHelp: 'When one entry mentions another keyword, related entries may also be included.',
        manageWorlds: 'Open the full world reference editor',
        demoTitle: 'Demo mode',
        demoBody: 'Switch to an isolated data space for feature demos, UI work, and screenshots. Real characters, chats, and keys are not copied.',
        demoNormalStatus: 'Using the regular space',
        demoActiveStatus: 'Using the isolated demo space',
        demoLoadingStatus: 'Checking the current space…',
        demoEnter: 'Enter demo mode',
        demoExit: 'Exit demo mode',
        demoSwitching: 'Switching…',
        demoError: 'The demo space could not be checked or switched. Try again.',
        demoStorageNote: 'Pending settings are saved before the page reloads. Other tabs in this browser session also need to be refreshed.',
        demoBannerTitle: 'Demo mode',
        demoBannerBody: 'Data is isolated from your regular space',
    },
};

let settingsOverlay;
let settingsLauncher;
let lastFocusedElement;
let closeTimer;
let activeDetail;
let detailBindingController;
let detailObservers = [];
let desktopServiceStatus = null;
const desktopServiceBusy = new Set();
let activeModelServiceId;
let selectedLocalModelId;
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
    try {
        userSpacesState = await userSpaceRequest('/api/leslie/user-spaces/status');
    } catch (error) {
        console.error('[Leslie User Spaces] Status failed:', error);
        userSpacesState = { error: true };
    }
    if (activeDetail === 'spaces') showDetail('spaces');
}

async function changeUserSpace(action) {
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
 * controls. Both managed startup and running-model detection delegate to the
 * existing Text Completion handlers after a model is ready.
 * @param {Record<string, string>} copy Active UI copy.
 * @returns {string} Local model setup markup.
 */
function renderLocalModelCatalog(copy) {
    if (!desktopServiceStatus?.localModels) {
        return `<small class="leslie-local-model-description">${copy.localModelScanning}</small>`;
    }
    if (desktopServiceStatus.available === false) {
        return `<div class="leslie-detail-callout"><i class="fa-solid fa-desktop" aria-hidden="true"></i><span>${copy.localModelDesktopOnly}</span></div>`;
    }
    const models = desktopServiceStatus.localModels.models;
    if (!models.length) {
        return `<div class="leslie-detail-callout"><i class="fa-solid fa-folder-open" aria-hidden="true"></i><span>${copy.localModelEmpty}</span></div>`;
    }
    if (!models.some(model => model.id === selectedLocalModelId)) {
        selectedLocalModelId = desktopServiceStatus.services?.localModel?.modelId || models[0].id;
    }
    const state = desktopServiceStatus.services?.localModel;
    const busy = desktopServiceBusy.has('localModel') || state?.state === 'busy';
    const options = models.map(model => `<option value="${escapeHtml(model.id)}" ${model.id === selectedLocalModelId ? 'selected' : ''}>${escapeHtml(model.id)} · ${(model.sizeBytes / 1024 ** 3).toFixed(1)} GB</option>`).join('');
    return `<div class="leslie-local-runtime-card">
        <div class="leslie-local-runtime-heading"><span class="fa-solid fa-dragon" aria-hidden="true"></span><div><strong>${copy.localModelMethod}</strong><small>${copy.localModelMethodHelp}</small></div></div>
        <label class="leslie-local-model-picker"><strong>${copy.localModelSelect}</strong><select data-leslie-local-model-select ${busy ? 'disabled' : ''}>${options}</select></label>
        ${state?.state === 'running' ? `<small class="leslie-local-model-status" data-state="success">${copy.desktopServiceRunning}：${escapeHtml(state.modelId || 'KoboldCpp')}</small>` : ''}
        <div class="leslie-local-model-actions">
            <button type="button" class="leslie-settings-primary-button" data-leslie-local-model-connect ${!isLocalModelLoadingEnabled() || !state?.runtimeInstalled || busy ? 'disabled' : ''}><i class="fa-solid fa-plug" aria-hidden="true"></i><span>${busy ? copy.localModelConnecting : copy.localModelConnect}</span></button>
            ${state?.state === 'running' && typeof globalThis.leslieDesktopServices?.runAction === 'function' ? `<button type="button" class="leslie-settings-secondary-button" data-leslie-local-model-stop ${busy ? 'disabled' : ''}>${copy.localModelStop}</button>` : ''}
        </div>
        ${state?.runtimeInstalled ? '' : `<small class="leslie-local-model-status" data-state="error">${copy.localModelRuntimeMissing}</small>`}
    </div>`;
}

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
            <div class="leslie-local-model-grid">
                <span>${copy.localModelPath}</span>
                <code data-leslie-local-model-directory>${escapeHtml(desktopServiceStatus?.localModels?.directory || 'models/')}</code>
            </div>
            <div class="leslie-local-model-actions">
                <button type="button" class="leslie-settings-secondary-button" data-leslie-local-model-folder ${typeof globalThis.leslieDesktopServices?.openModelsFolder === 'function' ? '' : 'disabled'}><i class="fa-solid fa-folder-open" aria-hidden="true"></i><span>${copy.localModelOpenFolder}</span></button>
                <button type="button" class="leslie-settings-secondary-button" data-leslie-local-model-refresh><i class="fa-solid fa-rotate" aria-hidden="true"></i><span>${copy.localModelRefresh}</span></button>
            </div>
            <label class="leslie-detail-switch-row leslie-local-model-loading-toggle" for="leslie-local-model-loading">
                <span><strong>${copy.localModelLoading}</strong><small>${copy.localModelLoadingHelp}</small></span>
                <input id="leslie-local-model-loading" type="checkbox" role="switch" data-leslie-local-model-toggle ${localModelLoadingEnabled ? 'checked' : ''}>
            </label>
            <small class="leslie-local-model-loading-status" data-leslie-local-model-loading-status>${localModelLoadingEnabled ? copy.localModelLoadingEnabledStatus : copy.localModelLoadingDisabledStatus}</small>
            <div data-leslie-local-model-catalog>${renderLocalModelCatalog(copy)}</div>
            <div class="leslie-local-model-actions"><button type="button" class="leslie-settings-secondary-button" data-leslie-local-model-detect ${localModelLoadingEnabled ? '' : 'disabled'}>${copy.localModelDetect}</button></div>
            <small class="leslie-local-model-description">${copy.localModelDetectHelp}</small>
            <small class="leslie-local-model-detect-status" data-leslie-local-model-detect-status aria-live="polite"></small>
        </section>`;
}

function updateLocalModelControls() {
    if (activeDetail !== 'model' || !settingsOverlay) {
        return;
    }
    const directory = settingsOverlay.querySelector('[data-leslie-local-model-directory]');
    if (directory) {
        directory.textContent = desktopServiceStatus?.localModels?.directory || 'models/';
    }
    const catalog = settingsOverlay.querySelector('[data-leslie-local-model-catalog]');
    if (catalog) {
        catalog.innerHTML = renderLocalModelCatalog(COPY[getCopyLocale()]);
    }
}

function getDesktopServiceCopy(service, copy) {
    return service === 'airi'
        ? { title: copy.desktopServiceAiri, body: copy.desktopServiceAiriBody, icon: 'fa-solid fa-wand-magic-sparkles' }
        : { title: copy.desktopServiceModel, body: copy.desktopServiceModelBody, icon: 'fa-solid fa-microchip' };
}

function getDesktopServiceStateCopy(serviceState, copy) {
    if (serviceState?.configured === false) {
        return copy.desktopServiceMissing;
    }
    if (serviceState?.state === 'running') {
        return copy.desktopServiceRunning;
    }
    if (serviceState?.state === 'busy') {
        return copy.desktopServiceStarting;
    }
    return copy.desktopServiceStopped;
}

function renderDesktopServices(copy) {
    const desktopApiAvailable = typeof globalThis.leslieDesktopServices?.getStatus === 'function';
    const available = desktopApiAvailable && desktopServiceStatus?.available !== false;
    const rows = [['airi'], ['localModel']].map(([service]) => {
        const details = getDesktopServiceCopy(service, copy);
        const state = desktopServiceStatus?.services?.[service] ?? { state: desktopApiAvailable ? 'busy' : 'stopped', configured: true };
        const running = state.state === 'running';
        const busy = state.state === 'busy' || desktopServiceBusy.has(service);
        const disabled = !available || busy || state.configured === false;
        return `<article class="leslie-desktop-service-row is-${escapeHtml(state.state)}" data-leslie-desktop-service="${service}">
            <span class="leslie-desktop-service-icon ${details.icon}" aria-hidden="true"></span>
            <span class="leslie-desktop-service-copy"><strong>${details.title}</strong><small>${details.body}</small></span>
            <span class="leslie-desktop-service-status" data-leslie-desktop-service-status>${getDesktopServiceStateCopy(state, copy)}</span>
            <button type="button" class="leslie-settings-primary-button" data-leslie-desktop-service-action="${running ? 'stop' : 'start'}" data-leslie-desktop-service-name="${service}" ${disabled ? 'disabled' : ''}>${busy ? copy.desktopServiceStarting : running ? copy.desktopServiceStop : copy.desktopServiceStart}</button>
        </article>`;
    }).join('');
    return `<section class="leslie-detail-card leslie-desktop-services-card" aria-labelledby="leslie-desktop-services-title">
        <div class="leslie-detail-card-heading"><h3 id="leslie-desktop-services-title">${copy.desktopServicesTitle}</h3><p>${copy.desktopServicesBody}</p></div>
        ${available ? '' : `<div class="leslie-detail-callout"><i class="fa-solid fa-desktop"></i><span>${copy.desktopServicesUnavailable}</span></div>`}
        <div class="leslie-desktop-service-list">${rows}</div>
    </section>`;
}

function updateDesktopServiceControls() {
    if (activeDetail !== 'model' || !settingsOverlay) {
        return;
    }
    const copy = COPY[getCopyLocale()];
    for (const service of ['airi', 'localModel']) {
        const row = settingsOverlay.querySelector(`[data-leslie-desktop-service="${service}"]`);
        const state = desktopServiceStatus?.services?.[service];
        const button = row?.querySelector('[data-leslie-desktop-service-action]');
        const status = row?.querySelector('[data-leslie-desktop-service-status]');
        if (!row || !(button instanceof HTMLButtonElement) || !status || !state) {
            continue;
        }
        const running = state.state === 'running';
        const busy = state.state === 'busy' || desktopServiceBusy.has(service);
        row.className = `leslie-desktop-service-row is-${state.state}`;
        status.textContent = getDesktopServiceStateCopy(state, copy);
        button.dataset.leslieDesktopServiceAction = running ? 'stop' : 'start';
        button.textContent = busy ? copy.desktopServiceStarting : running ? copy.desktopServiceStop : copy.desktopServiceStart;
        button.disabled = typeof globalThis.leslieDesktopServices?.runAction !== 'function'
            || busy || state.configured === false || desktopServiceStatus?.available === false;
    }
}

async function requestHostLocalModel(path, body) {
    const response = await fetch(`/api/leslie/local-model/${path}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Local model request failed (${response.status}).`);
    }
    return result;
}

async function refreshDesktopServiceStatus() {
    try {
        desktopServiceStatus = typeof globalThis.leslieDesktopServices?.getStatus === 'function'
            ? await globalThis.leslieDesktopServices.getStatus()
            : await requestHostLocalModel('status');
        updateDesktopServiceControls();
        updateLocalModelControls();
    } catch (error) {
        console.warn('[Leslie settings] Could not read desktop service status.', error);
        desktopServiceStatus = { available: false, localModels: { models: [] }, services: {} };
        updateDesktopServiceControls();
        updateLocalModelControls();
    }
}

async function runDesktopServiceAction(button) {
    const service = button.dataset.leslieDesktopServiceName;
    const action = button.dataset.leslieDesktopServiceAction;
    if (!service || !action || typeof globalThis.leslieDesktopServices?.runAction !== 'function') {
        return;
    }
    const copy = COPY[getCopyLocale()];
    desktopServiceBusy.add(service);
    updateDesktopServiceControls();
    try {
        desktopServiceStatus = await globalThis.leslieDesktopServices.runAction(service, action, service === 'localModel' && action === 'start' ? selectedLocalModelId : undefined);
        if (service === 'localModel' && action === 'stop') {
            disconnectLocalModelInApp();
        }
        toastr.success(`${getDesktopServiceCopy(service, copy).title}：${getDesktopServiceStateCopy(desktopServiceStatus?.services?.[service], copy)}`, copy.desktopServicesTitle);
    } catch (error) {
        const message = String(error?.message || copy.desktopServiceFailed).replace(/^Error invoking remote method '[^']+':\s*/i, '');
        toastr.error(message, copy.desktopServicesTitle);
    } finally {
        desktopServiceBusy.delete(service);
        await refreshDesktopServiceStatus();
        updateDesktopServiceControls();
        updateLocalModelControls();
    }
}

async function connectManagedLocalModel() {
    const copy = COPY[getCopyLocale()];
    if (!isLocalModelLoadingEnabled()) {
        toastr.warning(copy.localModelLoadingDisabled, copy.localModelTitle);
        return;
    }
    const selected = desktopServiceStatus?.localModels?.models?.find(model => model.id === selectedLocalModelId);
    const desktopAction = typeof globalThis.leslieDesktopServices?.runAction === 'function';
    if (!selected || !desktopServiceStatus?.services?.localModel?.runtimeInstalled
        || (!desktopAction && !desktopServiceStatus?.remoteManaged)) {
        toastr.error(copy.localModelEmpty, copy.localModelTitle);
        return;
    }
    desktopServiceBusy.add('localModel');
    updateLocalModelControls();
    const progress = settingsOverlay?.querySelector('[data-leslie-local-model-detect-status]');
    if (progress) {
        progress.textContent = copy.localModelConnecting;
        progress.dataset.state = 'loading';
    }
    try {
        desktopServiceStatus = desktopAction
            ? await globalThis.leslieDesktopServices.runAction('localModel', 'start', selected.id)
            : (await requestHostLocalModel('start', { modelId: selected.id })).status;
        let probe = null;
        for (let attempt = 0; attempt < 20 && !probe; attempt++) {
            probe = desktopAction
                ? await probeLeslieLocalRuntime('koboldcpp', { timeoutMs: 1500 })
                : (await requestHostLocalModel('probe')).probe;
            if (!probe) {
                await new Promise(resolve => window.setTimeout(resolve, 500));
            }
        }
        if (!probe) {
            throw new Error(copy.localModelReadyFailure);
        }
        const model = probe.models.find(name => name.includes(selected.name)) || probe.models[0];
        await applyLocalModel({ runtime: probe.runtime, endpoint: probe.endpoint, model });
        const completedProgress = settingsOverlay?.querySelector('[data-leslie-local-model-detect-status]');
        if (completedProgress) {
            completedProgress.textContent = `${copy.localModelConnected} ${selected.name}`;
            completedProgress.dataset.state = 'success';
        }
        toastr.success(`${copy.localModelConnected} ${selected.name}`, copy.localModelTitle);
    } catch (error) {
        const message = String(error?.message || copy.localModelReadyFailure).replace(/^Error invoking remote method '[^']+':\s*/i, '');
        const visibleProgress = settingsOverlay?.querySelector('[data-leslie-local-model-detect-status]');
        if (visibleProgress) {
            visibleProgress.textContent = message;
            visibleProgress.dataset.state = 'error';
        }
        toastr.error(message, copy.localModelTitle);
    } finally {
        desktopServiceBusy.delete('localModel');
        await refreshDesktopServiceStatus();
        updateLocalModelControls();
    }
}

async function stopManagedLocalModel() {
    if (typeof globalThis.leslieDesktopServices?.runAction !== 'function') {
        return;
    }
    desktopServiceBusy.add('localModel');
    updateLocalModelControls();
    try {
        desktopServiceStatus = await globalThis.leslieDesktopServices.runAction('localModel', 'stop');
        disconnectLocalModelInApp();
    } catch (error) {
        toastr.error(String(error?.message || COPY[getCopyLocale()].desktopServiceFailed), COPY[getCopyLocale()].localModelTitle);
    } finally {
        desktopServiceBusy.delete('localModel');
        await refreshDesktopServiceStatus();
        updateLocalModelControls();
    }
}

/**
 * Render the model connection detail page.
 * @returns {string} Page markup.
 */
function renderModelDetail() {
    const copy = COPY[getCopyLocale()];
    const activeService = getActiveModelService();
    activeModelKind ??= MODEL_SERVICES[activeService]?.kind || 'online';
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
    ].map(([kind, icon, title, body]) => `
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
    const localContent = `${renderLocalModelSetup(copy)}
        <details class="leslie-local-advanced" ${localAdvancedOpen ? 'open' : ''}>
            <summary><span><strong>${copy.localModelAdvanced}</strong><small>${copy.localModelAdvancedHelp}</small></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
            <div class="leslie-local-advanced-content">
                ${serviceSection}
                ${fieldsSection}
                ${renderDesktopServices(copy)}
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
        ${activeModelKind === 'local' ? localContent : `${serviceSection}${renderDesktopServices(copy)}${fieldsSection}${fullSettingsButton}`}`;
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
                                    <span><strong>聊天背景显示</strong><small>使用“背景”中导入的图片；角色图沿用角色卡</small></span>
                                    <select id="dreamland-background-select" data-dreamland-preference="background"><option value="off">纯色界面</option><option value="soft">柔和遮罩</option><option value="visible">清晰背景</option></select>
                                </label>
                                <label class="leslie-quick-control" for="leslie-display-mode-select">
                                    <span><strong>明暗模式</strong><small>亮色、暗色或跟随系统；与登录页同步</small></span>
                                    <select id="leslie-display-mode-select"><option value="auto">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select>
                                </label>
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
                            ${renderSettingsRow({ target: 'backgrounds-button', icon: 'fa-solid fa-panorama', title: copy.backgroundTitle, body: copy.backgroundBody })}
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
        void refreshDesktopServiceStatus();
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
 * Apply detected model defaults through SillyTavern's existing local API
 * controls, then run the normal connection check.
 * @param {{runtime: string, endpoint: string, model: string}} detected Detected runtime metadata.
 * @returns {Promise<void>} Resolves after the original connection action was triggered.
 */
function applyLocalModel(detected) {
    const runtime = detected.runtime;
    const runtimeConfig = getLeslieLocalRuntime(runtime);
    const settings = getLeslieLocalSettings(runtime, detected.model);
    const serviceId = runtimeConfig.apiType === textgen_types.LLAMACPP ? 'llamacpp' : 'koboldcpp';
    const endpointValue = String(detected.endpoint || settings.endpoint).trim();
    const mainApi = document.getElementById('main_api');
    if (!(mainApi instanceof HTMLSelectElement)) {
        return Promise.reject(new Error('当前页面还没有加载完整的模型连接设置。'));
    }

    textgenerationwebui_settings.server_urls ??= {};
    // Prevent the original provider change handler from issuing a duplicate
    // request before the detector has filled all generation parameters.
    textgenerationwebui_settings.server_urls[runtimeConfig.apiType] = '';
    return new Promise((resolve, reject) => {
        void selectModelService(serviceId, () => {
            const endpointId = runtimeConfig.apiType === textgen_types.LLAMACPP
                ? 'llamacpp_api_url_text'
                : 'koboldcpp_api_url_text';
            const endpoint = document.getElementById(endpointId);
            if (endpoint instanceof HTMLInputElement) {
                endpoint.value = endpointValue;
                endpoint.dispatchEvent(new Event('input', { bubbles: true }));
            }

            if (runtimeConfig.apiType === textgen_types.LLAMACPP) {
                textgenerationwebui_settings.llamacpp_model = String(detected.model);
                const model = document.getElementById('llamacpp_model');
                if (model instanceof HTMLSelectElement) {
                    model.value = String(detected.model);
                }
            }

            for (const [name, value] of Object.entries(settings.generation)) {
                const source = document.getElementById(`${name}_textgenerationwebui`);
                if (!(source instanceof HTMLInputElement)) {
                    continue;
                }
                if (source.type === 'checkbox') {
                    source.checked = Boolean(value);
                } else {
                    source.value = String(value);
                }
                source.dispatchEvent(new Event('input', { bubbles: true }));
            }

            setGenerationParamsFromPreset({
                max_length: settings.context,
                genamt: settings.responseTokens,
            });
            if (isLeslieQwenRoleplayModel(detected.model)) {
                selectInstructPreset('ChatML', { quiet: true });
                selectContextPreset('ChatML', { quiet: true });
            }
            saveSettingsDebounced();
            document.getElementById('api_button_textgenerationwebui')?.click();
            resolve();
        }).then(selected => {
            if (!selected) {
                reject(new Error(COPY[getCopyLocale()].apiKeySaveFailed));
            }
        }, reject);
    });
}

/**
 * Detect and configure the local roleplay model without exposing it as another
 * API provider. KoboldCpp and llama.cpp remain available as underlying local
 * runtimes in the full connection settings.
 * @param {HTMLButtonElement} button Detection button.
 */
async function detectAndApplyLocalModel(button) {
    if (!isLocalModelLoadingEnabled()) {
        const copy = COPY[getCopyLocale()];
        toastr.warning(copy.localModelLoadingDisabled, copy.localModelTitle);
        return;
    }

    const copy = COPY[getCopyLocale()];
    const status = settingsOverlay?.querySelector('[data-leslie-local-model-detect-status]');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (status) {
        status.dataset.state = 'checking';
        status.textContent = copy.localModelDetectChecking;
    }

    try {
        const response = await fetch('/api/leslie/local-model/detect', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        if (!response.ok) {
            throw new Error(copy.localModelDetectFailure);
        }
        const { detected } = await response.json();
        if (!detected) {
            await refreshDesktopServiceStatus();
            const selected = desktopServiceStatus?.localModels?.models?.find(model => model.id === selectedLocalModelId);
            const canStart = desktopServiceStatus?.available && desktopServiceStatus?.services?.localModel?.runtimeInstalled
                && (desktopServiceStatus?.remoteManaged || typeof globalThis.leslieDesktopServices?.runAction === 'function');
            if (!selected || !canStart) {
                throw new Error(copy.localModelDetectFailure);
            }
            await connectManagedLocalModel();
            return;
        }
        await applyLocalModel(detected);
        const runtimeLabel = getLeslieLocalRuntime(detected.runtime).label;
        toastr.success(`${copy.localModelDetectSuccess} ${runtimeLabel} · ${detected.model}`, copy.localModelTitle);
    } catch (error) {
        const message = error instanceof Error ? error.message : copy.localModelDetectFailure;
        if (status) {
            status.dataset.state = 'error';
            status.textContent = message;
        }
        toastr.error(message, copy.localModelTitle);
    } finally {
        button.disabled = !isLocalModelLoadingEnabled();
        button.setAttribute('aria-busy', 'false');
    }
}

/**
 * Trigger the original connect action for the selected service.
 */
async function connectSelectedModelService() {
    const serviceId = getActiveModelService();
    const service = MODEL_SERVICES[serviceId];
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
    settingsOverlay?.querySelectorAll('[data-leslie-local-model-detect]').forEach((button) => {
        if (button instanceof HTMLButtonElement) {
            button.disabled = !enabled;
            button.title = enabled ? '' : copy.localModelLoadingDisabled;
        }
    });
    const status = settingsOverlay?.querySelector('[data-leslie-local-model-loading-status]');
    if (status) {
        status.textContent = enabled ? copy.localModelLoadingEnabledStatus : copy.localModelLoadingDisabledStatus;
    }
    updateLocalModelControls();
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
    topSettings.insertBefore(settingsLauncher, characterDrawer);

    settingsOverlay = createSettingsOverlay();
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
    settingsOverlay.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : null;
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
        if (target?.closest('[data-leslie-local-model-folder]')) {
            event.preventDefault();
            event.stopPropagation();
            try {
                await globalThis.leslieDesktopServices.openModelsFolder();
            } catch {
                toastr.error(COPY[getCopyLocale()].localModelFolderFailed, COPY[getCopyLocale()].localModelTitle);
            }
            return;
        }
        if (target?.closest('[data-leslie-local-model-refresh]')) {
            event.preventDefault();
            event.stopPropagation();
            await refreshDesktopServiceStatus();
            return;
        }
        if (target?.closest('[data-leslie-local-model-connect]')) {
            event.preventDefault();
            event.stopPropagation();
            void connectManagedLocalModel();
            return;
        }
        if (target?.closest('[data-leslie-local-model-stop]')) {
            event.preventDefault();
            event.stopPropagation();
            void stopManagedLocalModel();
            return;
        }
        const localModelButton = target?.closest('[data-leslie-local-model-detect]');
        if (localModelButton instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            if (localModelButton instanceof HTMLButtonElement) {
                detectAndApplyLocalModel(localModelButton);
            }
            return;
        }
        const desktopServiceButton = target?.closest('[data-leslie-desktop-service-action]');
        if (desktopServiceButton instanceof HTMLButtonElement) {
            event.preventDefault();
            event.stopPropagation();
            void runDesktopServiceAction(desktopServiceButton);
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
        if (target?.matches('[data-leslie-local-model-select]')) {
            selectedLocalModelId = target.value;
            return;
        }
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
