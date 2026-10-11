/**
 * Character workshop draft generation.
 *
 * The web workshop builds its prompts in the browser and calls the chat API from the page,
 * so there was nothing server-side to reuse. The `/api/v1` route therefore needs its own
 * prompt and its own output contract.
 *
 * Scope, deliberately narrow: one round trip that turns a short brief into the fields a
 * character card needs. Nothing is persisted here — the caller saves the draft through the
 * existing `POST /characters`, which owns card creation, so this module never writes.
 *
 * The prompt/parse pair is exported separately from the route so the parsing rules (the part
 * that silently corrupts a draft when it is wrong) can be unit-tested without a model.
 */

/** Fields a generated draft is allowed to carry, in card order. */
export const DRAFT_FIELDS = Object.freeze(['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example']);

/** Per-field caps, generous enough for a real card but small enough to reject a runaway reply. */
const FIELD_LIMITS = Object.freeze({
    name: 60,
    description: 1200,
    personality: 1200,
    scenario: 1200,
    first_mes: 2000,
    mes_example: 2000,
});

/**
 * Build the model request for a draft.
 * @param {{brief?: string, style?: string, language?: string}} value Request.
 * @returns {{systemPrompt: string, prompt: string, responseLength: number}} Model input.
 */
export function buildWorkshopDraftPrompt(value = {}) {
    const brief = String(value.brief ?? '').trim();
    const style = String(value.style ?? '').trim();
    const language = String(value.language ?? '中文').trim() || '中文';
    if (!brief) {
        const error = new Error('A character brief is required.');
        error.code = 'INVALID_INPUT';
        throw error;
    }
    if (brief.length > 4000) {
        const error = new Error('The character brief is too long (4000 characters maximum).');
        error.code = 'INVALID_INPUT';
        throw error;
    }

    const systemPrompt = [
        '你是一名角色卡设计师，为沉浸式角色扮演应用撰写角色设定。',
        `请使用${language}撰写。`,
        '严格按照用户给出的设定撰写，不要添加与设定冲突的内容。',
        '只返回一个 JSON 对象，不要包含解释、注释或 Markdown 代码块。',
        `JSON 的键必须是：${DRAFT_FIELDS.join('、')}。`,
        '各字段含义：name 是角色名；description 是外貌与身份概述；personality 是性格与说话风格；',
        'scenario 是角色所处的背景设定；first_mes 是角色对用户说的第一句话，用第一人称、可直接用于对话；',
        'mes_example 是可选的对话示例，格式为「{{user}}: ...\\n{{char}}: ...」，没有就留空字符串。',
    ].join('\n');

    const prompt = [
        '角色设定：',
        brief,
        style ? `\n写作风格要求：${style}` : '',
    ].join('\n');

    return { systemPrompt, prompt, responseLength: 1000 };
}

/**
 * Strip the wrappers models add even when told not to: Markdown fences and any prose around
 * the object. Returns the raw JSON text.
 * @param {string} text Model output.
 * @returns {string} The JSON substring, or an empty string when none was found.
 */
function extractJsonObject(text) {
    const trimmed = String(text ?? '').trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1].trim() : trimmed;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    return start !== -1 && end > start ? body.slice(start, end + 1) : '';
}

/**
 * Turn model output into a draft, or throw a coded error.
 *
 * A reply that is not usable JSON, or that carries no `name`/`first_mes`, is a failure rather
 * than an empty draft: returning a hollow card would look like success to the caller and get
 * saved as a broken character.
 * @param {string} text Model output.
 * @returns {object} Draft with only the allowed fields.
 */
export function parseWorkshopDraft(text) {
    const json = extractJsonObject(text);
    if (!json) {
        const error = new Error('The model did not return a JSON object.');
        error.code = 'INVALID_OUTPUT';
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch {
        const error = new Error('The model returned malformed JSON.');
        error.code = 'INVALID_OUTPUT';
        throw error;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const error = new Error('The model did not return a JSON object.');
        error.code = 'INVALID_OUTPUT';
        throw error;
    }

    const draft = {};
    for (const field of DRAFT_FIELDS) {
        const raw = parsed[field];
        const value = typeof raw === 'string' ? raw.trim() : (raw == null ? '' : String(raw).trim());
        draft[field] = value.slice(0, FIELD_LIMITS[field]);
    }

    if (!draft.name || !draft.first_mes) {
        const error = new Error('The draft is missing a name or an opening message.');
        error.code = 'INVALID_OUTPUT';
        throw error;
    }
    return draft;
}
