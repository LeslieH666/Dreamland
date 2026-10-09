/**
 * Pure configuration for DreamLand's local model connection helper.
 * DreamLand does not host or start these runtimes; the user runs them and
 * points DreamLand at the endpoint. Keep this separate from DOM and
 * SillyTavern imports so it can be tested.
 */

export const LESLIE_LOCAL_MODEL = Object.freeze({
    modelFile: 'Qwen3.5-text-9B-NSFW-RP-RolePlay.Q4_K_M.gguf',
    modelName: 'Qwen3.5 9B RP Q4_K_M',
    context: 8192,
    responseTokens: 384,
    runtimes: Object.freeze({
        koboldcpp: Object.freeze({
            apiType: 'koboldcpp',
            endpoint: 'http://127.0.0.1:5001',
            label: 'KoboldCpp',
        }),
        llamacpp: Object.freeze({
            apiType: 'llamacpp',
            endpoint: 'http://127.0.0.1:8080',
            label: 'llama.cpp',
        }),
    }),
    generation: Object.freeze({
        temp: 0.7,
        top_p: 0.8,
        top_k: 40,
        min_p: 0,
        rep_pen: 1.05,
        rep_pen_range: 4096,
        streaming: true,
        do_sample: true,
        add_bos_token: true,
        skip_special_tokens: true,
        include_reasoning: false,
    }),
});

export const LOCAL_MODEL_LOADING_STORAGE_KEY = 'leslie-local-model-loading-enabled';

const PEACH_ROLEPLAY_MODEL_PATTERN = /peach[\s._-]*2(?:\.0)?[\s._-]*9b[\s._-]*8k[\s._-]*roleplay/i;
const QWEN_ROLEPLAY_MODEL_PATTERN = /qwen[\s._-]*3\.5[\s._-]*text[\s._-]*9b[\s._-]*nsfw[\s._-]*rp[\s._-]*roleplay/i;
const ROLEPLAY_META_HEADING_PATTERN = /^\s*(?:背景|场景|场景设定|环境|地点|时间|天气|状态|设定|对话|旁白|background|scene|setting|dialogue|status)\s*[:：]/iu;
const ROLEPLAY_META_TERM_PATTERN = /(?:背景|场景|环境|地点|时间|天气|状态|设定|对话|旁白|background|scene|setting|dialogue|status)/iu;
const ROLEPLAY_BRACKET_LINE_PATTERN = /^\s*(?:\[[^\]\r\n]{1,80}\]\s*){1,4}$/u;
const ROLEPLAY_MECHANICAL_QUESTION_PATTERN = /(?:要不要|可以吗|对吧|是不是|你觉得呢|好吗|好不好|行不行|愿不愿意|的吗|吗|呢)[?？]/u;
const ROLEPLAY_MECHANICAL_QUESTION_TAIL_PATTERN = /(?:要不要|可以吗|对吧|是不是|你觉得呢|好吗|好不好|行不行|愿不愿意|的吗|吗|呢)(?=[?？])/gu;

/**
 * Keep Peach roleplay replies moving forward instead of turning every turn
 * into a permission check. This is appended only for the bundled Peach model
 * and does not alter other local or remote model prompts.
 */
export const LESLIE_LOCAL_ROLEPLAY_GUIDANCE = [
    '本轮只生成角色的自然回复，不解释写作过程。',
    '优先用角色的动作、感受、判断或对白推进场景。',
    '用户已经给出明确动作或陈述时，直接承接并推进，不要把回应改写成确认式提问。',
    '本轮回复默认必须不含问号；不得请求确认、许可、偏好或同意。把问题改成观察、动作或陈述，并以动作或陈述结尾。',
    '用户已经明确同意的行为不要反复索取确认；不要替用户决定行动、情绪或台词。',
    'Hard output rule: this reply must contain zero question marks. Do not ask for confirmation, permission, preference, or agreement. Do not turn the user\'s statement into a question. Replace any question with an observation, action, or declarative sentence. End with an action or declarative sentence, never a question.',
].join('\n');

export const LESLIE_QWEN_ROLEPLAY_GUIDANCE = [
    '以角色卡中的身份、关系、性格、语气和边界为准，自然承接当前对话。',
    '只写角色自身的言语、动作和感受，不代写用户的行动、心理或台词。',
    '用户已给出明确行动或陈述时直接回应；只有角色确实需要信息时才提问，不要用例行反问结束每轮。',
    '不要解释角色卡、提示词或写作过程。',
].join('\n');

/**
 * Neutralize residual confirmation-question habits from Peach without
 * rewriting ordinary questions from other models or model families.
 * @param {string} text Generated Peach roleplay text.
 * @returns {string} Text with known mechanical question tails neutralized.
 */
function neutralizeLesliePeachMechanicalQuestions(text) {
    if (!ROLEPLAY_MECHANICAL_QUESTION_PATTERN.test(text)) {
        return text;
    }

    return text
        .replace(/要不要(?=[^。！？\r\n]{0,40}[?？])/gu, '你可以')
        .replace(/你是不是(?=[^。！？\r\n]{0,40}[?？])/gu, '你似乎')
        .replace(/是不是(?=[^。！？\r\n]{0,40}[?？])/gu, '似乎')
        .replace(/可以吗(?=[?？])/gu, '可以')
        .replace(/(?:好吗|好不好|行不行|愿不愿意)(?=[?？])/gu, '可以')
        .replace(/对吧(?=[?？])/gu, '确实如此')
        .replace(/你觉得呢(?=[?？])/gu, '')
        .replace(ROLEPLAY_MECHANICAL_QUESTION_TAIL_PATTERN, '')
        .replace(/[?？]/gu, '。');
}

/**
 * Whether a connected local model is the bundled Peach roleplay model.
 * @param {unknown} model Model identifier reported by the runtime.
 * @returns {boolean} True for the bundled Peach roleplay model.
 */
export function isLesliePeachRoleplayModel(model) {
    return PEACH_ROLEPLAY_MODEL_PATTERN.test(String(model ?? ''));
}

export function isLeslieQwenRoleplayModel(model) {
    return QWEN_ROLEPLAY_MODEL_PATTERN.test(String(model ?? ''));
}

/**
 * Remove a known Peach failure mode where the model continues from roleplay
 * into a bracketed state/scene template and then repeats dialogue. This is
 * deliberately conservative and model-scoped so ordinary local models keep
 * their native output behavior.
 * @param {unknown} text Generated local-model text.
 * @param {{model?: unknown}} [options] Runtime metadata.
 * @returns {string} Cleaned roleplay text.
 */
export function cleanLeslieLocalRoleplayOutput(text, { model = '' } = {}) {
    if (typeof text !== 'string' || !text || !isLesliePeachRoleplayModel(model)) {
        return typeof text === 'string' ? text : '';
    }

    const normalizedText = neutralizeLesliePeachMechanicalQuestions(text);
    const lines = normalizedText.split(/\r?\n/);
    for (let index = 1; index < lines.length; index++) {
        if (!ROLEPLAY_BRACKET_LINE_PATTERN.test(lines[index])) {
            continue;
        }

        const tail = lines.slice(index).join('\n');
        if (ROLEPLAY_META_TERM_PATTERN.test(tail) && lines.slice(index + 1).some(line => ROLEPLAY_META_HEADING_PATTERN.test(line))) {
            return lines.slice(0, index).join('\n').trimEnd();
        }
    }

    for (let index = 1; index < lines.length; index++) {
        if (ROLEPLAY_META_HEADING_PATTERN.test(lines[index])) {
            return lines.slice(0, index).join('\n').trimEnd();
        }
    }

    return normalizedText;
}

/**
 * Whether DreamLand is allowed to use the configured local model service.
 * This is intentionally a browser-local preference and does not touch model
 * files or the external runtime process.
 * @param {Storage | undefined} [storage] Storage implementation for testing.
 * @returns {boolean} True when local model loading is enabled.
 */
export function isLocalModelLoadingEnabled(storage = globalThis.localStorage) {
    if (globalThis.navigator?.userAgent?.includes('DreamLandAndroidClient/')
        || globalThis.navigator?.userAgent?.includes('DreamLandAndroidStandalone/')) {
        return false;
    }
    try {
        return storage?.getItem(LOCAL_MODEL_LOADING_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

/**
 * Persist the local model loading preference without exposing any credentials.
 * @param {boolean} enabled Whether local model usage should be allowed.
 * @param {Storage | undefined} [storage] Storage implementation for testing.
 * @returns {boolean} The normalized preference.
 */
export function setLocalModelLoadingEnabled(enabled, storage = globalThis.localStorage) {
    const normalized = Boolean(enabled);
    try {
        storage?.setItem(LOCAL_MODEL_LOADING_STORAGE_KEY, String(normalized));
    } catch {
        // A blocked browser storage should not break ordinary chat settings.
    }
    return normalized;
}

export function getLeslieLocalRuntime(runtime) {
    return LESLIE_LOCAL_MODEL.runtimes[runtime] ?? LESLIE_LOCAL_MODEL.runtimes.koboldcpp;
}

export function getLeslieLocalRuntimeKeys() {
    return Object.keys(LESLIE_LOCAL_MODEL.runtimes);
}

export function getLeslieLocalSettings(runtime, model = LESLIE_LOCAL_MODEL.modelName) {
    const selectedRuntime = getLeslieLocalRuntime(runtime);
    const peachGeneration = isLesliePeachRoleplayModel(model) ? {
        temp: 0.65,
        min_p: 0.04,
        rep_pen: 1.06,
    } : {};
    return {
        apiType: selectedRuntime.apiType,
        endpoint: selectedRuntime.endpoint,
        context: LESLIE_LOCAL_MODEL.context,
        responseTokens: LESLIE_LOCAL_MODEL.responseTokens,
        generation: { ...LESLIE_LOCAL_MODEL.generation, ...peachGeneration },
    };
}
