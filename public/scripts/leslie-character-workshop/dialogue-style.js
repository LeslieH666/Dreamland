export const DIALOGUE_EXPRESSION_OPTIONS = Object.freeze(['克制', '鲜明', '戏剧化']);

export const DIALOGUE_BRIEF_GUIDANCE = '说话风格简报：replyStyle 用 2～3 个短句说明常用句式、触发情绪后的说法和缓下来后的余波，别写性格分析长文。区分情绪变化速度、表达强度和关系发展速度；慢热不等于没脾气。用户指定的口吻、长度、动作比例和表达张力优先；未指定张力时默认鲜明，放大已有特点，不改变核心性格。其余简报字段也只写必要信息，qualityTargets 列角色辨识度、情绪变化可信度和口语自然度。';

const EXPRESSION_GUIDANCE = Object.freeze({
    克制: '情绪通过少说、改称呼、停顿或语气变冷表现；有触发就有反应，不把克制写成毫无情绪。',
    鲜明: '让已有性格更明显：急性子可以炸毛，爱逞强的可以嘴硬，活泼的可以脱口而出，冷淡的可以更冷、更短；温柔的人也能烦、委屈或拒绝。',
    戏剧化: '有足够刺激时，可以更急、更冲、更得意或更别扭，允许明显的改口与反差；不能每句话都大喊、堆感叹号，也不能让克制的人突然变成话痨。',
});

const SPOKEN_DIALOGUE_GUIDANCE = `口语和情绪要求：
- 写这个人当场会说的话，别写整理好的发言稿。现代日常角色用具体、顺口的词，古代、正式或非中文角色保持自己的语言背景。
- 可以省主语、短句接短句、说半句后改口。比如“啊？真的假的？”、“别催，我看着呢。”、“……行，是我搞错了。”只用来说明顺口的节奏，不得照抄成每个角色的统一口癖。不强制每句都碎、不每句都加“啊、嘛、呢”或省略号。
- 少用“我理解你的感受”“我会一直陪着你”“如果你愿意……”这类万能回应，也别把台词写成“我可以……不过……”的完整声明。是否安慰、解释、提问或拒绝，由这个人的性格和眼前的事决定；不能每轮都先接纳、再分析、再建议、最后温柔收尾。正常、具体的安慰不因这些提醒被一律删除。
- 情绪按实际刺激和人设变化：夸奖未必反驳，关心未必拒绝，温柔也可以生气。普通闲聊保持这个人的常态，不把所有触发都写成冷脸或顶嘴；足够强的刺激才放大反应。信任和关系按既定节奏发展。
- 夸张要放大角色本来的特点。用实际用词、句长、称呼和节奏表现情绪，不能只写“生气地说”而台词仍像客服。不同情绪不要只替换形容词，口癖也不要每组重复。
- 情绪有余波：刚生气不会一句话后毫无缘由地恢复客气，嘴硬的人认错也可能还不服气。需要缓和时，要有对方实际说出的新信息或当前场景中的原因。
- 情绪通过台词本身的选词、改口和语气表达，别靠旁白解释。不要给台词逐句加引号再接“他说”“语气变冷了”。用户选择少量动作时，动作可以完全省略，必要时括号里带一个短细节即可。
- 只回应眼前输入，没要求就不补任务交接、手续说明或下一步安排。场景已经给出的事实不能否认，也不能编新理由为失误开脱；嘴硬体现在说法，而不是改写发生的事。
- 按用户选择的长度和动作比例输出；没指定时默认简短，完成一个主要互动节拍。混合情绪也可以在一句话里说出来。
- 上述是给创作者的检查标准，只用于写作和审校，不复制到卡片的 personality、system_prompt、post_history_instructions 或 depth_prompt。卡片只保留这个人的习惯和短小的实际聊天规则。`;

/**
 * Returns positive output instructions, separate from workshop writing guidance.
 * @param {object} blueprint User-selected presentation controls.
 * @returns {string} Compact runtime contract.
 */
export function buildDialogueOutputContract(blueprint = {}) {
    const fields = blueprint?.fields ?? {};
    const length = fields.replyLength || '简短';
    const actions = fields.actionRatio || '少量动作';
    const rhythm = length === '简短' ? '简短回复，通常 1～3 句台词，接住当下这句话就停。'
        : `回复长度：${length}，围绕当前互动按需要展开。`;
    const movement = actions === '少量动作' ? '台词为主，动作可省，必要时括号里带一个短细节。'
        : `动作比例：${actions}，动作只描写角色自己。`;
    return `${rhythm}${movement}按自己的口吻直接说话，情绪接着上轮变化；遵守当前事实与关系节奏，不替用户决定台词、行动或情绪。`;
}

/**
 * Builds workshop-only writing guidance without changing card or chat schemas.
 * @param {object} blueprint User-locked creative controls.
 * @param {object} options Workflow context.
 * @param {boolean} [options.review] Preserve the voice when revising a card.
 * @param {boolean} [options.imported] Preserve an imported card's existing controls.
 * @returns {string} Stage-specific dialogue guidance.
 */
export function buildDialogueStyleGuidance(blueprint = {}, { review = false, imported = false } = {}) {
    const fields = blueprint?.fields ?? {};
    const expression = DIALOGUE_EXPRESSION_OPTIONS.includes(fields.expressionIntensity)
        ? fields.expressionIntensity
        : imported ? '' : '鲜明';
    const controls = [
        expression ? `表达张力：${expression}。${EXPRESSION_GUIDANCE[expression]}` : '导入卡未指定新的表达张力时，沿用原卡的情绪强度和口吻，不自动套用鲜明风格。',
        fields.replyLength ? `用户指定回复长度：${fields.replyLength}。` : '',
        fields.actionRatio ? `用户指定动作比例：${fields.actionRatio}。` : '',
        imported ? '导入卡已有的语言、回复长度、动作比例、示例数量和个人声音优先，未要求改变时保留；原卡没有相关要求时才使用默认值。' : '',
    ].filter(Boolean).join('\n');
    const stageGuidance = review
        ? '审校说话风格：检查角色辨识度、情绪变化可信度、口语自然度。保留符合人设的锋芒、缺点和余波，不把台词润色成完整声明。优先删除多余的旁白、解释和重复规则，已经顺口的台词原样保留。新生成卡检查 6～8 组示例和至少两组连续互动：连续组必须在同一个 <START> 下依次写 [USER]、[CHAR]、[USER]、[CHAR]，续接不能另起 <START>。只修缺项，不增加新组来稀释原卡。导入卡不为了凑数或增加轮次而重写已经有效的示例。'
        : '示例写作：生成 6～8 组，每组以 <START> 开头。先写两组连续互动，每组同一个 <START> 下依次写 [USER]:、[CHAR]:、[USER]:、[CHAR]:，第二轮前不加 <START>；余下各组一轮即可。选择常态闲聊和不同情绪触发，用户触发也要顺口。角色回应直接写能说出口的台词；少量动作时可只写台词。每组保持既定关系起点，示例不代表已经发生的事实；不要加情绪标签、旁白解释或创作说明。';
    return `${controls}\n\n${SPOKEN_DIALOGUE_GUIDANCE}\n\n${stageGuidance}`;
}
