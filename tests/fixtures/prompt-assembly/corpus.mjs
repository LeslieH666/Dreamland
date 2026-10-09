/**
 * Synthetic fixture corpus for the prompt-assembly regression baseline.
 *
 * Everything here is invented for testing: no real character cards, chats,
 * credentials or memories. The corpus is deliberately **deterministic** so a
 * recorded baseline can be compared byte for byte:
 *   - every World Info entry has probability 100 and no sticky/cooldown/delay;
 *   - recursion, group scoring and newline collapsing are off;
 *   - no regex extensions are configured.
 *
 * Scope note (Phase 2.5 / 附 I Q2): this corpus targets the chat-completion
 * family (main_api === 'openai') only.
 */

/** World Info position values, mirrored from public/scripts/world-info.js. */
export const WI_POSITION = Object.freeze({
    before: 0,
    after: 1,
    ANTop: 2,
    ANBottom: 3,
    atDepth: 4,
});

/** Persona description positions, mirrored from public/scripts/personas.js. */
export const PERSONA_POSITION = Object.freeze({
    IN_PROMPT: 0,
    TOP_AN: 2,
    BOTTOM_AN: 3,
    AT_DEPTH: 4,
    NONE: 9,
});

/** Persona names used by the fixtures (never a real person). */
export const FIXTURE_USER_NAME = '合成用户';
export const FIXTURE_PERSONA_AVATAR = 'fixture-user.png';

/** The two synthetic character cards. */
export const CHARACTERS = [
    {
        avatar: 'fixture-aurora.png',
        name: '极光（合成）',
        description: '完全虚构的测试角色，用于验证提示词组装。她是天文台的记录员。',
        personality: '克制、精确，喜欢把观察写成条目。',
        scenario: '在一座虚构的天文台里整理上一季的观测记录。',
        first_mes: '记录本翻到新的一页。你想先看哪一段观测？',
        mes_example: [
            '<START>',
            '{{user}}: 今晚的云量怎么样？',
            '{{char}}: 云量三成，西侧有薄云，适合观测低空目标。',
            '<START>',
            '{{user}}: 记录写完了吗？',
            '{{char}}: 还差最后两行，等我核对完坐标。',
        ].join('\n'),
        creator_notes: '合成测试卡，不包含任何真实角色。',
        system_prompt: '保持记录员的口吻，回答简短。',
        post_history_instructions: '不要编造未在记录中出现的数据。',
        alternate_greetings: ['记录本已经合上。要不要重新翻开？'],
        depth_prompt: { prompt: '提醒：所有观测数据都来自虚构的天文台。', depth: 2, role: 0 },
        tags: ['合成测试'],
    },
    {
        avatar: 'fixture-borealis.png',
        name: '北纬（合成）',
        description: '完全虚构的测试角色，负责天文台的设备维护。',
        personality: '直接、务实，说话简短。',
        scenario: '在天文台里检查望远镜的镜筒。',
        first_mes: '镜筒需要重新校准。你来得正好。',
        mes_example: '',
        creator_notes: '合成测试卡。',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        depth_prompt: { prompt: '', depth: 4, role: 0 },
        tags: ['合成测试'],
    },
];

/** A deterministic world book exercising every injection position. */
export const WORLD_BOOK = {
    name: 'fixture-lore',
    entries: [
        {
            uid: 0,
            comment: '常驻：台址背景',
            key: [],
            keysecondary: [],
            content: '[设定] 天文台位于虚构的北纬四十七度高地，海拔两千一百米。',
            constant: true,
            position: WI_POSITION.before,
            order: 100,
            depth: 4,
            probability: 100,
            disable: false,
        },
        {
            uid: 1,
            comment: '关键词命中：记录本',
            key: ['记录本', '观测记录'],
            keysecondary: [],
            content: '[设定] 记录本使用统一格式，每页左上角填写日期与天气。',
            constant: false,
            position: WI_POSITION.after,
            order: 90,
            depth: 4,
            probability: 100,
            disable: false,
        },
        {
            uid: 2,
            comment: '深度注入：校准',
            key: ['校准'],
            keysecondary: [],
            content: '[设定] 校准流程需要两人确认。',
            constant: false,
            position: WI_POSITION.atDepth,
            order: 80,
            depth: 2,
            role: 0,
            probability: 100,
            disable: false,
        },
        {
            uid: 3,
            comment: '作者注上方：天气',
            key: ['天气'],
            keysecondary: [],
            content: '[设定] 高地的天气变化很快。',
            constant: false,
            position: WI_POSITION.ANTop,
            order: 70,
            depth: 4,
            probability: 100,
            disable: false,
        },
        {
            uid: 4,
            comment: '未命中（对照组）',
            key: ['绝对不会出现的词'],
            keysecondary: [],
            content: '[设定] 这条不应出现在任何提示词里。',
            constant: false,
            position: WI_POSITION.before,
            order: 60,
            depth: 4,
            probability: 100,
            disable: false,
        },
    ],
};

/**
 * Build the settings payload written to `<userRoot>/settings.json`.
 * @param {{ personaPosition?: number }} [options] Options.
 * @returns {object} Settings object.
 */
export function buildSettings({ personaPosition = PERSONA_POSITION.IN_PROMPT } = {}) {
    return {
        firstRun: false,
        username: FIXTURE_USER_NAME,
        user_avatar: FIXTURE_PERSONA_AVATAR,
        main_api: 'openai',
        max_context: 8192,
        amount_gen: 256,
        swipes: true,
        power_user: {
            persona_description: '合成用户：负责整理观测记录，说话简短。',
            persona_description_position: personaPosition,
            persona_description_depth: 2,
            persona_description_role: 0,
            persona_description_lorebook: '',
            personas: { [FIXTURE_PERSONA_AVATAR]: FIXTURE_USER_NAME },
            persona_descriptions: {
                [FIXTURE_PERSONA_AVATAR]: {
                    description: '合成用户：负责整理观测记录，说话简短。',
                    title: '合成用户',
                    position: personaPosition,
                    depth: 2,
                    role: 0,
                    lorebook: '',
                },
            },
            instruct: { enabled: false },
            sysprompt: { enabled: true, content: '你是一个虚构天文台的记录员助手。', post_history: '保持记录员口吻。' },
            prefer_character_prompt: false,
            prefer_character_jailbreak: false,
            pin_examples: false,
            strip_examples: false,
            collapse_newlines: false,
            token_padding: 64,
            always_force_name2: false,
            console_log_prompts: false,
        },
        oai_settings: {
            chat_completion_source: 'custom',
            custom_url: 'http://127.0.0.1:9099/v1',
            custom_model: 'fixture-model',
            openai_max_context: 8000,
            openai_max_tokens: 256,
            stream_openai: false,
            squash_system_messages: false,
            continue_prefill: false,
            names_behavior: 0,
            wi_format: '{0}',
            scenario_format: '{{scenario}}',
            personality_format: '{{personality}}',
        },
        world_info_settings: {
            world_info_depth: 2,
            world_info_min_activations: 0,
            world_info_min_activations_depth_max: 0,
            world_info_budget: 25,
            world_info_include_names: true,
            world_info_recursive: false,
            world_info_overflow_alert: false,
            world_info_case_sensitive: false,
            world_info_match_whole_words: false,
            world_info_use_group_scoring: false,
            world_info_character_strategy: 'character_first',
            world_info_budget_cap: 0,
            world_info_max_recursion_steps: 0,
            world_info: { globalSelect: [WORLD_BOOK.name], charLore: [] },
        },
        textgenerationwebui_settings: {},
        extension_settings: {
            note: { default: '', defaultPosition: 1, defaultDepth: 4, defaultRole: 0, allowWIScan: false, chara: [] },
            memory: { enabled: false },
            regex: [],
        },
    };
}

/**
 * Chat histories: metadata plus messages, written as JSONL.
 * `persona` and `leslie_memory` metadata are added by the seeder.
 */
export const CHAT_HISTORY = [
    { name: '极光（合成）', is_user: false, is_system: false, mes: '记录本翻到新的一页。你想先看哪一段观测？' },
    { name: FIXTURE_USER_NAME, is_user: true, is_system: false, mes: '今晚的天气怎么样？适合观测吗？' },
    { name: '极光（合成）', is_user: false, is_system: false, mes: '云量三成，西侧有薄云。记录本上写着类似的夜晚。' },
    { name: FIXTURE_USER_NAME, is_user: true, is_system: false, mes: '那就把这次的观测记录也写上吧。校准的事情要不要现在做？' },
    { name: '极光（合成）', is_user: false, is_system: false, mes: '可以，先校准再记录。设备那边需要两个人确认。' },
];

/** A second history whose final AI message already has swipes. */
export const SWIPE_HISTORY = [
    { name: '极光（合成）', is_user: false, is_system: false, mes: '先把昨天的条目补完吧。' },
    { name: FIXTURE_USER_NAME, is_user: true, is_system: false, mes: '好，从哪一条开始？' },
    {
        name: '极光（合成）', is_user: false, is_system: false, mes: '从云量那一条开始。',
        swipes: ['从云量那一条开始。', '先看风向的记录。'],
        swipe_id: 1,
        swipe_info: [
            { send_date: '2026-01-01T00:00:00.000Z' },
            { send_date: '2026-01-01T00:01:00.000Z' },
        ],
    },
];

/** Group definition referencing both synthetic cards. */
export const GROUP = {
    id: 'fixture-group',
    name: '合成观测小组',
    // `chats` is what makes the group chat openable; without it the browser
    // falls back to an unselected character.
    chats: ['合成 · 群聊'],
    chat_id: '合成 · 群聊',
    members: ['fixture-aurora.png', 'fixture-borealis.png'],
    // The second member is muted so the *speaker plan* is deterministic: natural
    // activation picks speakers with randomness, which would make the recorded
    // message count vary. Both members stay in `members`, so the group card
    // merge and `group_names` are still exercised.
    disabled_members: ['fixture-borealis.png'],
    activation_strategy: 0,
    allow_self_responses: false,
    generation_mode: 0,
    generation_mode_join_prefix: '',
    generation_mode_join_suffix: '',
};

/** Group chat history. */
export const GROUP_HISTORY = [
    { name: '极光（合成）', is_user: false, is_system: false, mes: '小组的观测计划已经贴在门后了。' },
    { name: FIXTURE_USER_NAME, is_user: true, is_system: false, mes: '我和北纬先去看镜筒，回来再记录。' },
    { name: '北纬（合成）', is_user: false, is_system: false, mes: '镜筒已经检查完了，只是需要重新校准。' },
];

/** The captured cases: each becomes one recorded baseline snapshot. */
export const CASES = [
    { id: 'solo-normal', profile: 'default', character: 'fixture-aurora.png', chat: '合成 · 常规', history: CHAT_HISTORY, type: 'normal' },
    { id: 'solo-continue', profile: 'default', character: 'fixture-aurora.png', chat: '合成 · 继续', history: CHAT_HISTORY, type: 'continue' },
    { id: 'solo-swipe', profile: 'default', character: 'fixture-aurora.png', chat: '合成 · 换一条', history: SWIPE_HISTORY, type: 'swipe' },
    { id: 'solo-regenerate', profile: 'default', character: 'fixture-aurora.png', chat: '合成 · 重新生成', history: CHAT_HISTORY, type: 'regenerate' },
    { id: 'solo-impersonate', profile: 'default', character: 'fixture-aurora.png', chat: '合成 · 代替发言', history: CHAT_HISTORY, type: 'impersonate' },
    { id: 'solo-quiet', profile: 'default', character: 'fixture-aurora.png', chat: '合成 · 静默', history: CHAT_HISTORY, type: 'quiet', quietPrompt: '用一句话总结当前的观测进度。' },
    { id: 'group-normal', profile: 'default', group: GROUP, chat: '合成 · 群聊', history: GROUP_HISTORY, type: 'normal' },
    { id: 'solo-persona-depth', profile: 'depth', character: 'fixture-aurora.png', chat: '合成 · 深度人设', history: CHAT_HISTORY, type: 'normal' },
];

/** Profiles = one server data root each (settings differ). */
export const PROFILES = {
    default: { personaPosition: PERSONA_POSITION.IN_PROMPT },
    depth: { personaPosition: PERSONA_POSITION.AT_DEPTH },
};
