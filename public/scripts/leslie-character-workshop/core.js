const REQUIRED_CARD_FIELDS = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'system_prompt',
    'post_history_instructions',
];

const REPLY_CONTRACT_PATTERN = /(?:短(?:回复|对话)|最多.{0,8}(?:两行|2\s*行)|一个(?:主要)?(?:互动|情绪|对话)?(?:节拍|反应)|(?:遵循|尊重|按|依照).{0,16}(?:回复长度|篇幅|长度要求)|one\s+(?:reaction|beat)|two\s+lines?|concise)/i;
const USER_CONTROL_PATTERN = /(?:(?:不得|不要|禁止).{0,14}(?:替|代替|控制|决定)|不(?:会)?替).{0,10}(?:用户|玩家)|do\s+not.{0,18}(?:control|decide|speak\s+for).{0,12}(?:user|player)/i;
const RELATIONSHIP_PATTERN = /(?:关系|信任|亲密).{0,12}(?:不|不得|不能|逐步|慢速)|(?:relationship|trust|intimacy).{0,14}(?:gradual|slow|do\s+not|never)/i;
const KNOWLEDGE_PATTERN = /(?:不知道|不知情|不能凭空|认知边界|knowledge\s+boundary|does\s+not\s+know|cannot\s+know)/i;
const SPOKEN_GREETING_PATTERN = /[“”「」『』"']|(?:^|\n)\s*[-—]\s*\S/u;
const EARLY_RELATIONSHIP_PATTERN = /(?:第一次|初次|刚认识|陌生|first\s+meet|stranger)/i;
const PREMATURE_INTIMACY_PATTERN = /(?:缘分|命中注定|注定|比.{0,8}(?:书|工作|一切|什么都)重要|(?:在这|我会).{0,5}等你|为了你|destin(?:y|ed)|meant\s+to\s+be)/i;

function hasSpokenGreeting(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        return false;
    }
    if (SPOKEN_GREETING_PATTERN.test(text)) {
        return true;
    }

    const withoutLeadingActions = text
        .replace(/^\s*(?:\*[^*]+\*|（[^）]+）|\([^)]*\)|【[^】]+】)\s*/u, '')
        .trim();
    return withoutLeadingActions.length >= 2;
}

/**
 * Keeps portable Character Card role macros from being expanded to the active
 * SillyTavern account names before the workshop model sees the user's request.
 * @param {string} prompt User-authored workshop prompt.
 * @returns {string}
 */
export function protectRoleMacrosForGeneration(prompt) {
    return String(prompt ?? '')
        .replace(/\{\{\s*user\s*\}\}/gi, '[USER]')
        .replace(/\{\{\s*char\s*\}\}/gi, '[CHAR]');
}

/**
 * Finds the first complete JSON object in a model response.
 * @param {string} response Model response.
 * @returns {string}
 */
function findJsonObject(response) {
    const tagged = response.match(/<leslie-json>\s*([\s\S]*?)\s*<\/leslie-json>/i)?.[1];
    const source = tagged || response.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
    const start = source.indexOf('{');

    if (start < 0) {
        throw new Error('模型没有返回 JSON 对象。');
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index++) {
        const character = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (character === '\\' && inString) {
            escaped = true;
            continue;
        }

        if (character === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (character === '{') {
            depth++;
        } else if (character === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error('模型返回的 JSON 不完整。');
}

/**
 * Parses a structured response wrapped in the Leslie JSON marker.
 * @param {string} response Model response.
 * @returns {object}
 */
export function parseStructuredResponse(response) {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error('模型返回了空内容。');
    }

    return JSON.parse(findJsonObject(response));
}

/**
 * Normalizes a model-generated creative brief before it controls research.
 * @param {object} payload Generated brief or a wrapper containing `brief`.
 * @returns {object}
 */
export function normalizeCreativeBrief(payload) {
    const source = payload?.brief ?? payload ?? {};
    const toList = value => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [];
    const knowledgeQuestions = source.knowledgeQuestions ?? source.researchQueries;
    return {
        mode: source.mode === 'adaptation' ? 'adaptation' : 'original',
        workingTitle: String(source.workingTitle ?? '').trim(),
        hardFacts: toList(source.hardFacts),
        themeCore: toList(source.themeCore),
        personalityTensions: toList(source.personalityTensions),
        knowledgeBoundaries: toList(source.knowledgeBoundaries),
        userIdentity: String(source.userIdentity ?? '').trim(),
        relationshipStart: String(source.relationshipStart ?? '').trim(),
        openingHook: String(source.openingHook ?? '').trim(),
        replyStyle: String(source.replyStyle ?? '').trim(),
        contentBoundaries: toList(source.contentBoundaries),
        assumptions: toList(source.assumptions),
        requiresKnowledgeCheck: source.requiresKnowledgeCheck === true
            || source.requiresKnowledgeCheck === 'true'
            || source.requiresResearch === true
            || source.requiresResearch === 'true',
        knowledgeQuestions: toList(knowledgeQuestions).slice(0, 3),
        qualityTargets: toList(source.qualityTargets),
    };
}

/**
 * Normalizes an evidence check performed by the currently configured chat model.
 * This deliberately contains no URLs: a model without browsing must not invent sources.
 * @param {object} payload Model response.
 * @returns {{summary: string, facts: object[], uncertainties: string[], requiresUserConfirmation: boolean}}
 */
export function normalizeKnowledgeCheck(payload) {
    const source = payload?.knowledge_check ?? payload?.knowledgeCheck ?? payload ?? {};
    const facts = Array.isArray(source.facts) ? source.facts : [];
    const uncertainties = Array.isArray(source.uncertainties) ? source.uncertainties : [];
    return {
        summary: String(source.summary ?? '').trim(),
        facts: facts.map(item => ({
            claim: String(item?.claim ?? '').trim(),
            confidence: ['high', 'medium', 'low'].includes(item?.confidence) ? item.confidence : 'low',
            basis: String(item?.basis ?? '').trim(),
        })).filter(item => item.claim).slice(0, 12),
        uncertainties: uncertainties.map(item => String(item).trim()).filter(Boolean).slice(0, 8),
        requiresUserConfirmation: source.requiresUserConfirmation === true || source.requiresUserConfirmation === 'true',
    };
}

/**
 * Normalizes a manual avatar-generation prompt. No image is generated or saved.
 * @param {object} payload Model response or avatar prompt object.
 * @returns {{positive: string, negative: string, aspectRatio: string, notes: string}}
 */
export function normalizeAvatarPrompt(payload) {
    const source = payload?.avatar_prompt ?? payload?.avatarPrompt ?? payload ?? {};
    const aspectRatio = String(source.aspect_ratio ?? source.aspectRatio ?? '2:3').trim();
    return {
        positive: String(source.positive ?? '').replace(/\s+/g, ' ').trim().slice(0, 2400),
        negative: String(source.negative ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200),
        aspectRatio: /^\d{1,2}:\d{1,2}$/.test(aspectRatio) ? aspectRatio : '2:3',
        notes: String(source.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
    };
}

/**
 * Formats an avatar prompt for copying into a separate image-generation tool.
 * @param {object} prompt Avatar prompt.
 * @returns {string}
 */
export function formatAvatarPrompt(prompt) {
    const normalized = normalizeAvatarPrompt(prompt);
    if (!normalized.positive) {
        return '';
    }
    const parts = [
        `正向提示词：\n${normalized.positive}`,
        normalized.negative ? `负向提示词：\n${normalized.negative}` : '',
        `推荐画幅：${normalized.aspectRatio}`,
        normalized.notes ? `使用备注：\n${normalized.notes}` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
}

/**
 * Produces the stable CCV3 shape used by the workshop preview.
 * @param {object} payload Generated card or a wrapper containing `card`.
 * @returns {object}
 */
export function normalizeCharacterCard(payload) {
    const candidate = payload?.card ?? payload ?? {};
    const source = candidate?.data ?? candidate;
    const sourceExtensions = source?.extensions && typeof source.extensions === 'object' ? source.extensions : {};
    const sourceDepthPrompt = sourceExtensions?.depth_prompt && typeof sourceExtensions.depth_prompt === 'object'
        ? sourceExtensions.depth_prompt
        : {};
    const tags = Array.isArray(source?.tags)
        ? source.tags.map(tag => String(tag).trim()).filter(Boolean)
        : String(source?.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean);
    const alternateGreetings = Array.isArray(source?.alternate_greetings)
        ? source.alternate_greetings.map(message => String(message).trim()).filter(Boolean)
        : [];
    const talkativeness = Number(sourceExtensions?.talkativeness ?? source?.talkativeness ?? 0.5);
    const data = {
        name: String(source?.name ?? '').trim(),
        description: String(source?.description ?? '').trim(),
        personality: String(source?.personality ?? '').trim(),
        scenario: String(source?.scenario ?? '').trim(),
        first_mes: String(source?.first_mes ?? source?.first_message ?? '').trim(),
        mes_example: String(source?.mes_example ?? '').trim(),
        creator_notes: String(source?.creator_notes ?? candidate?.creatorcomment ?? '').trim(),
        system_prompt: String(source?.system_prompt ?? '').trim(),
        post_history_instructions: String(source?.post_history_instructions ?? '').trim(),
        alternate_greetings: alternateGreetings,
        tags: tags,
        creator: String(source?.creator ?? 'Leslie AI 角色工坊').trim(),
        character_version: String(source?.character_version ?? '1.0').trim(),
        extensions: {
            ...sourceExtensions,
            talkativeness: Number.isFinite(talkativeness) ? Math.min(1, Math.max(0, talkativeness)) : 0.5,
            fav: Boolean(sourceExtensions?.fav ?? false),
            world: String(sourceExtensions?.world ?? ''),
            depth_prompt: {
                prompt: String(sourceDepthPrompt?.prompt ?? '').trim(),
                depth: Number.isFinite(Number(sourceDepthPrompt?.depth)) ? Math.max(0, Number(sourceDepthPrompt.depth)) : 0,
                role: ['system', 'user', 'assistant'].includes(sourceDepthPrompt?.role) ? sourceDepthPrompt.role : 'system',
            },
        },
    };

    return {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        name: data.name,
        description: data.description,
        personality: data.personality,
        scenario: data.scenario,
        first_mes: data.first_mes,
        mes_example: data.mes_example,
        creatorcomment: data.creator_notes,
        avatar: 'none',
        talkativeness: data.extensions.talkativeness,
        fav: data.extensions.fav,
        tags: data.tags,
        data: data,
    };
}

/**
 * Converts model-facing dialogue labels back to portable Character Card macros.
 * SillyTavern expands {{user}} and {{char}} inside generation prompts, so the
 * workshop also accepts those active names and neutral [USER]/[CHAR] markers.
 * @param {object} card Character card.
 * @param {object} [labels] Active chat labels.
 * @param {string} [labels.userLabel] Current user name.
 * @param {string[]} [labels.characterLabels] Current and generated character names.
 * @returns {object}
 */
export function canonicalizeDialogueRoleLabels(card, { userLabel = '', characterLabels = [] } = {}) {
    const normalized = normalizeCharacterCard(card);
    const userAliases = new Set(['[user]', '<user>', 'user', '{{user}}', String(userLabel).trim().toLocaleLowerCase()].filter(Boolean));
    const characterAliases = new Set([
        '[char]',
        '[character]',
        '<char>',
        '<bot>',
        'char',
        'character',
        '{{char}}',
        normalized.data.name.toLocaleLowerCase(),
        ...characterLabels.map(label => String(label).trim().toLocaleLowerCase()),
    ].filter(Boolean));

    const examples = normalized.data.mes_example.split('\n').map(line => {
        const match = line.match(/^(\s*)([^:：\n]{1,80})\s*[:：](.*)$/u);
        if (!match) {
            return line;
        }

        const [, indentation, speaker, content] = match;
        const alias = speaker.trim().toLocaleLowerCase();
        if (userAliases.has(alias)) {
            return `${indentation}{{user}}:${content}`;
        }
        if (characterAliases.has(alias)) {
            return `${indentation}{{char}}:${content}`;
        }
        return line;
    }).join('\n');

    const restorePortableMarkers = value => String(value ?? '')
        .replace(/\[USER\]/gi, '{{user}}')
        .replace(/\[CHAR(?:ACTER)?\]/gi, '{{char}}');
    const portableFields = [
        'description',
        'personality',
        'scenario',
        'first_mes',
        'mes_example',
        'creator_notes',
        'system_prompt',
        'post_history_instructions',
    ];
    normalized.data.mes_example = examples;
    for (const field of portableFields) {
        normalized.data[field] = restorePortableMarkers(normalized.data[field]);
        normalized[field] = normalized.data[field];
    }
    normalized.data.alternate_greetings = normalized.data.alternate_greetings.map(restorePortableMarkers);
    normalized.alternate_greetings = normalized.data.alternate_greetings;
    normalized.data.extensions.depth_prompt.prompt = restorePortableMarkers(normalized.data.extensions.depth_prompt.prompt);
    return normalized;
}

/**
 * Counts example dialogue blocks in a card.
 * @param {string} examples Dialogue examples.
 * @returns {number}
 */
export function countDialogueExamples(examples) {
    return (String(examples).match(/<START>/gi) || []).length;
}

function parseDialogueExampleTurns(block) {
    const labels = [...block.matchAll(/^[\t ]*(?:\{\{\s*(user|char)\s*\}\}|\[(USER|CHAR)\])[\t ]*[:：][\t ]*/gmi)];
    return labels.map((label, index) => ({
        role: (label[1] || label[2]).toLowerCase(),
        text: block.slice(label.index + label[0].length, labels[index + 1]?.index ?? block.length).trim(),
    }));
}

/**
 * Runs deterministic quality checks that do not depend on the reviewing model.
 * @param {object} card Character card.
 * @param {object} [context] Review context.
 * @param {object} [context.brief] Normalized creative brief.
 * @param {object} [context.knowledgeCheck] Knowledge check from the configured chat model.
 * @param {boolean} [context.requireWorkshopExamples] Enforce new-card example requirements, excluding imported cards.
 * @returns {{score: number, blocking: object[], warnings: object[], passed: object[]}}
 */
export function assessCharacterCard(card, { brief = {}, knowledgeCheck = {}, requireWorkshopExamples = false } = {}) {
    const normalized = normalizeCharacterCard(card);
    const data = normalized.data;
    const blocking = [];
    const warnings = [];
    const passed = [];
    let score = 100;

    for (const field of REQUIRED_CARD_FIELDS) {
        if (!data[field]) {
            blocking.push({ code: `missing_${field}`, message: `缺少必填字段：${field}` });
            score -= 11;
        }
    }

    const examples = countDialogueExamples(data.mes_example);
    if (examples < 4) {
        warnings.push({ code: 'few_examples', message: `示例对话只有 ${examples} 组，建议保持 4～8 组。` });
        score -= 9;
    } else if (examples > 8) {
        warnings.push({ code: 'many_examples', message: `示例对话有 ${examples} 组，可能稀释角色重点。` });
        score -= 3;
    } else {
        passed.push({ code: 'examples', message: `示例对话数量合适（${examples} 组）。` });
    }

    const dialogueBlocks = data.mes_example.split(/<START>/gi).slice(1).map(parseDialogueExampleTurns);
    if (requireWorkshopExamples && brief.mode !== 'imported') {
        const continuous = dialogueBlocks.filter(turns => turns.some((turn, index) => turn.role === 'user'
            && turns.slice(index, index + 4).length === 4
            && turns.slice(index, index + 4).every((item, offset) => item.text && item.role === (offset % 2 ? 'char' : 'user')))).length;
        if (examples < 6 || examples > 8 || continuous < 2) {
            blocking.push({ code: 'workshop_example_structure', message: `新生成卡需 6～8 组示例，其中至少两组在同一个 <START> 内连续互动两轮；当前 ${examples} 组、${continuous} 组连续互动。修复现有组，续接不要另起 <START>。` });
            score -= 9;
        } else {
            passed.push({ code: 'workshop_example_structure', message: '新生成示例数量及连续两轮互动符合要求。' });
        }
    }
    const incompleteBlocks = dialogueBlocks.filter(turns => !turns.some(turn => turn.role === 'user')
        || turns.some((turn, index) => !turn.text || (turn.role === 'user' && turns[index + 1]?.role !== 'char')));
    if (examples > 0 && incompleteBlocks.length > 0) {
        warnings.push({ code: 'dialogue_roles', message: `${incompleteBlocks.length} 组示例缺少完整的用户触发与角色回应，或发言顺序不完整；其他组的多轮发言不能补足这一组。` });
        score -= 8;
    } else if (examples > 0) {
        passed.push({ code: 'dialogue_roles', message: '每组示例都包含用户触发与角色回应。' });
    }

    const repeatedReplies = new Map();
    for (const turn of dialogueBlocks.flat()) {
        if (turn.role !== 'char') continue;
        const text = turn.text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase();
        if (text.length >= 8) repeatedReplies.set(text, (repeatedReplies.get(text) || 0) + 1);
    }
    if ([...repeatedReplies.values()].some(count => count >= 3)) {
        warnings.push({ code: 'repeated_dialogue', message: '至少三次角色回应使用了相同的较长台词；建议检查是否在不同情境中重复套话。此提醒不扣分，也不判断角色是否自然。' });
    }

    if (!REPLY_CONTRACT_PATTERN.test(data.post_history_instructions)) {
        warnings.push({ code: 'reply_contract', message: '输出契约没有明确互动节拍或遵循用户回复长度的要求。' });
        score -= 7;
    } else {
        passed.push({ code: 'reply_contract', message: '已明确互动节奏或回复长度契约。' });
    }

    const controlText = `${data.system_prompt}\n${data.post_history_instructions}`;
    if (!USER_CONTROL_PATTERN.test(controlText)) {
        warnings.push({ code: 'user_control', message: '没有明确禁止替用户决定台词、行动或情绪。' });
        score -= 9;
    } else {
        passed.push({ code: 'user_control', message: '已保护用户的行动与决定权。' });
    }

    const relationshipText = `${data.personality}\n${data.system_prompt}\n${data.post_history_instructions}`;
    if (!RELATIONSHIP_PATTERN.test(relationshipText)) {
        warnings.push({ code: 'relationship_pacing', message: '没有明确关系与信任需要自然发展。' });
        score -= 6;
    } else {
        passed.push({ code: 'relationship_pacing', message: '关系发展边界清楚。' });
    }

    const relationshipStart = `${brief?.relationshipStart ?? ''}\n${data.scenario}`;
    const performedDialogue = `${data.first_mes}\n${data.mes_example}`;
    if (EARLY_RELATIONSHIP_PATTERN.test(relationshipStart) && PREMATURE_INTIMACY_PATTERN.test(performedDialogue)) {
        warnings.push({ code: 'premature_intimacy', message: '初识阶段出现“缘分、比某物重要、等你”等过早亲密套话。' });
        score -= 7;
    } else if (EARLY_RELATIONSHIP_PATTERN.test(relationshipStart)) {
        passed.push({ code: 'earned_intimacy', message: '初识对话没有提前透支亲密感。' });
    }

    const knowledgeText = `${data.description}\n${data.system_prompt}`;
    if (!KNOWLEDGE_PATTERN.test(knowledgeText)) {
        warnings.push({ code: 'knowledge_boundary', message: '角色的认知边界不够明确。' });
        score -= 6;
    } else {
        passed.push({ code: 'knowledge_boundary', message: '角色认知边界清楚。' });
    }

    if (data.first_mes.length > 700) {
        warnings.push({ code: 'long_greeting', message: '首条消息偏长，可能把开场一次写完。' });
        score -= 6;
    } else if (data.first_mes.length > 0) {
        passed.push({ code: 'greeting', message: '首条消息长度适合直接接话。' });
    }

    if (data.first_mes && !hasSpokenGreeting(data.first_mes)) {
        warnings.push({ code: 'silent_greeting', message: '首条消息只有动作或叙述，缺少一句可直接接话的角色台词。' });
        score -= 8;
    } else if (data.first_mes) {
        passed.push({ code: 'spoken_greeting', message: '首条消息包含可直接回应的角色台词。' });
    }

    if (brief?.requiresKnowledgeCheck) {
        const facts = Array.isArray(knowledgeCheck?.facts) ? knowledgeCheck.facts : [];
        const reliableFacts = facts.filter(item => item.confidence === 'high' || item.confidence === 'medium');
        const uncertainties = Array.isArray(knowledgeCheck?.uncertainties) ? knowledgeCheck.uncertainties : [];
        if (reliableFacts.length < 3) {
            warnings.push({ code: 'weak_knowledge_check', message: '该角色需要知识核对，但当前聊天模型只给出少量中高置信事实。' });
            score -= 10;
        } else {
            passed.push({ code: 'knowledge_check', message: `当前聊天模型整理了 ${reliableFacts.length} 条中高置信事实。` });
        }
        if (uncertainties.length > 0 || knowledgeCheck?.requiresUserConfirmation) {
            warnings.push({ code: 'knowledge_uncertainty', message: `仍有 ${uncertainties.length || 1} 项不确定内容需要人工确认。` });
            score -= 5;
        }
    }

    if (!data.extensions.depth_prompt.prompt) {
        warnings.push({ code: 'depth_prompt', message: '缺少靠近最新消息的短状态锚点。' });
        score -= 5;
    } else {
        passed.push({ code: 'depth_prompt', message: '已设置深度 0 的状态锚点。' });
    }

    return {
        score: Math.max(0, score),
        blocking: blocking,
        warnings: warnings,
        passed: passed,
    };
}

/**
 * Maps a reviewed card onto SillyTavern's existing create form state.
 * @param {object} card Character card.
 * @returns {object}
 */
export function cardToCreateState(card) {
    const data = normalizeCharacterCard(card).data;
    return {
        name: data.name,
        description: data.description,
        creator_notes: data.creator_notes,
        post_history_instructions: data.post_history_instructions,
        character_version: data.character_version,
        system_prompt: data.system_prompt,
        tags: data.tags.join(', '),
        creator: data.creator,
        personality: data.personality,
        first_message: data.first_mes,
        scenario: data.scenario,
        mes_example: data.mes_example,
        world: data.extensions.world,
        talkativeness: data.extensions.talkativeness,
        alternate_greetings: data.alternate_greetings,
        depth_prompt_prompt: data.extensions.depth_prompt.prompt,
        depth_prompt_depth: data.extensions.depth_prompt.depth,
        depth_prompt_role: data.extensions.depth_prompt.role,
        extensions: data.extensions,
        extra_books: [],
    };
}
