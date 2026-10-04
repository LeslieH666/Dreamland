import { DIALOGUE_EXPRESSION_OPTIONS } from './dialogue-style.js';
import { APPEARANCE_CHOICES } from './appearance.js';

const SELECT_OPTIONS = Object.freeze({
    gender: ['女性', '男性', '非二元', '自定义', '不指定'],
    adultStatus: ['明确成年', '未成年', '年龄不适用', '暂不指定'],
    ageStage: ['儿童', '青少年', '青年', '成年', '中年', '老年', '非人类阶段', '不指定'],
    species: ['人类', '精灵', '兽人/亚人', '机器人/人工智能', '神话或超自然存在', '自定义', '不指定'],
    occupationCategory: ['学生', '教育', '研究/技术', '商业/服务', '艺术/创作', '医疗', '公共服务', '战斗/冒险', '无固定职业', '自定义'],
    era: ['现代', '近现代历史', '古代/中世纪', '近未来', '遥远未来', '架空时代', '不指定'],
    familiarity: ['陌生人', '刚认识', '认识但不熟', '熟人', '朋友', '亲密关系', '家人', '同事/同学', '敌对', '自定义'],
    trust: ['警惕', '低', '中立', '较高', '高度信任', '随剧情决定'],
    relationshipPace: ['缓慢发展', '自然发展', '可较快发展', '保持当前关系', '由剧情决定'],
    replyLength: ['极简', '简短', '均衡', '详细', '由场景决定'],
    actionRatio: ['几乎无动作', '少量动作', '对话与动作均衡', '较多动作描写'],
    worldType: ['现实世界', '现代架空', '校园', '奇幻', '科幻', '末日', '历史', '游戏/动漫原作', '自定义'],
});

export const CHARACTER_BLUEPRINT_SECTIONS = Object.freeze([
    {
        id: 'identity',
        title: '基础身份',
        description: '只填你确定的内容；任何空白项都会交给 AI 补全。',
        open: true,
        fields: [
            { key: 'name', label: '姓名', placeholder: '留空则由 AI 命名' },
            { key: 'gender', label: '性别 / 性别认同', type: 'select', options: SELECT_OPTIONS.gender },
            { key: 'age', label: '具体年龄', placeholder: '例如：24 岁、诞生 300 年' },
            { key: 'adultStatus', label: '年龄边界', type: 'select', options: SELECT_OPTIONS.adultStatus },
            { key: 'ageStage', label: '年龄阶段', type: 'select', options: SELECT_OPTIONS.ageStage },
            { key: 'species', label: '种族 / 物种', type: 'select', options: SELECT_OPTIONS.species },
            { key: 'occupationCategory', label: '职业类别', type: 'select', options: SELECT_OPTIONS.occupationCategory },
            { key: 'occupation', label: '具体职业或身份', placeholder: '例如：独立书店夜班店员' },
        ],
    },
    {
        id: 'appearance',
        title: '外貌设定',
        description: '精确数值会被视为硬事实；不想限制外貌时可以全部留空。',
        fields: [
            { key: 'height', label: '身高', placeholder: '例如：168 cm' },
            { key: 'weight', label: '体重', placeholder: '例如：55 kg；可不填' },
            { key: 'bodyType', label: '体型与体态', placeholder: '例如：清瘦、站姿挺直' },
            { key: 'hair', label: '发型与发色', placeholder: '简短描述' },
            { key: 'eyes', label: '眼睛', placeholder: '瞳色、眼神或特征' },
            { key: 'clothing', label: '常用服装', placeholder: '风格或标志性穿着' },
            { key: 'distinctiveFeatures', label: '显著特征', placeholder: '伤疤、饰品、气质等', wide: true },
        ],
    },
    {
        id: 'personality',
        title: '性格与行为',
        description: '建议优先填写“性格矛盾”，它比堆叠形容词更能稳定角色反应。',
        fields: [
            { key: 'coreTraits', label: '核心性格', placeholder: '例如：克制、敏锐、固执' },
            { key: 'personalityTension', label: '性格矛盾', placeholder: '例如：警觉但好奇' },
            { key: 'values', label: '价值观', placeholder: '最看重或绝不妥协的事' },
            { key: 'goals', label: '当前目标', placeholder: '角色现在真正想完成什么' },
            { key: 'flaws', label: '缺点与弱点', placeholder: '会造成真实阻力的缺点' },
            { key: 'fears', label: '恐惧与禁忌', placeholder: '害怕、回避或不能接受的事' },
            { key: 'habits', label: '习惯与小动作', placeholder: '例如：思考时转动戒指' },
            { key: 'likes', label: '爱好与喜欢', placeholder: '用逗号分隔即可' },
            { key: 'dislikes', label: '厌恶与不喜欢', placeholder: '用逗号分隔即可' },
            { key: 'stressResponse', label: '压力下的反应', placeholder: '冲突、紧张或受伤时怎样反应', wide: true },
        ],
    },
    {
        id: 'background',
        title: '经历与背景',
        description: '这里填写的是创作开始前已经发生的固定经历，不是未来剧情。',
        fields: [
            { key: 'origin', label: '出身与成长环境', placeholder: '地点、阶层、文化环境等', wide: true },
            { key: 'family', label: '家庭与重要关系', placeholder: '只写需要固定的人物和关系', wide: true },
            { key: 'educationExperience', label: '教育与职业经历', placeholder: '简短时间线', wide: true },
            { key: 'keyExperiences', label: '关键人生事件', type: 'textarea', rows: 3, placeholder: '可以分条填写真正塑造角色的经历', wide: true },
            { key: 'currentSituation', label: '当前处境', placeholder: '角色现在面临什么问题', wide: true },
            { key: 'secrets', label: '秘密或隐藏目标', placeholder: '没有可以留空', wide: true },
        ],
    },
    {
        id: 'relationship',
        title: '玩家关系与认知边界',
        description: '用来防止角色过早亲密、读心或替玩家做决定。',
        fields: [
            { key: 'userIdentity', label: '玩家身份', placeholder: '玩家在故事中的身份；留空则保持开放' },
            { key: 'relationshipStart', label: '关系起点', placeholder: '例如：第一次见面的邻居' },
            { key: 'familiarity', label: '初始熟悉度', type: 'select', options: SELECT_OPTIONS.familiarity },
            { key: 'trust', label: '初始信任', type: 'select', options: SELECT_OPTIONS.trust },
            { key: 'relationshipPace', label: '关系发展速度', type: 'select', options: SELECT_OPTIONS.relationshipPace },
            { key: 'knownAboutUser', label: '角色已知的玩家信息', placeholder: '只写开场时确实知道的内容', wide: true },
            { key: 'unknownAboutUser', label: '角色不知道的事', placeholder: '明确禁止凭空知道的内容', wide: true },
            { key: 'boundaries', label: '互动与内容边界', type: 'textarea', rows: 2, placeholder: '身体接触、恋爱、冲突或其他禁区', wide: true },
        ],
    },
    {
        id: 'dialogue',
        title: '对话风格',
        description: '让角色说话更顺口、情绪更有区别；不填表达张力时默认鲜明，仍按人设反应。',
        fields: [
            { key: 'addressUser', label: '对玩家的称呼', placeholder: '称呼或称呼变化规则' },
            { key: 'tone', label: '语言与口吻', placeholder: '例如：直来直去，烦了就顶嘴，认错还嘴硬' },
            { key: 'expressionIntensity', label: '表达张力', type: 'select', options: DIALOGUE_EXPRESSION_OPTIONS },
            { key: 'replyLength', label: '默认回复长度', type: 'select', options: SELECT_OPTIONS.replyLength },
            { key: 'actionRatio', label: '动作描写比例', type: 'select', options: SELECT_OPTIONS.actionRatio },
            { key: 'verbalHabits', label: '口癖与用词习惯', placeholder: '没有则留空' },
            { key: 'forbiddenStyle', label: '禁止的表达方式', placeholder: '例如：不机械提问、不说教', wide: true },
        ],
    },
    {
        id: 'opening',
        title: '世界与开场',
        description: '确定第一幕发生在哪里，以及玩家能立即回应什么。',
        fields: [
            { key: 'worldType', label: '世界类型', type: 'select', options: SELECT_OPTIONS.worldType },
            { key: 'era', label: '所属时代', type: 'select', options: SELECT_OPTIONS.era },
            { key: 'worldSetting', label: '世界设定', placeholder: '只写与角色和开场直接相关的部分', wide: true },
            { key: 'openingPlace', label: '开场地点', placeholder: '例如：深夜即将打烊的便利店' },
            { key: 'openingTime', label: '开场时间', placeholder: '季节、日期或时段' },
            { key: 'openingTrigger', label: '开场事件', type: 'textarea', rows: 2, placeholder: '发生了什么，让双方现在需要互动', wide: true },
        ],
    },
]);

const FIELD_LOOKUP = new Map(CHARACTER_BLUEPRINT_SECTIONS.flatMap(section => section.fields).map(field => [field.key, field]));
const FIELD_TARGETS = Object.freeze({
    name: ['name'],
    gender: ['description'], age: ['description'], adultStatus: ['description', 'system_prompt'], ageStage: ['description'],
    species: ['description'], occupationCategory: ['description'], occupation: ['description'],
    height: ['description'], weight: ['description'], bodyType: ['description'], hair: ['description'], eyes: ['description'],
    clothing: ['description', 'system_prompt'], distinctiveFeatures: ['description'],
    coreTraits: ['personality', 'description', 'system_prompt'], personalityTension: ['personality', 'description', 'system_prompt'],
    values: ['personality', 'description', 'system_prompt'], goals: ['personality', 'description', 'scenario'],
    flaws: ['personality', 'description', 'system_prompt'], fears: ['personality', 'description'],
    habits: ['personality', 'description', 'mes_example'], likes: ['personality', 'description'],
    dislikes: ['personality', 'description'], stressResponse: ['personality', 'description'],
    origin: ['description'], family: ['description'], educationExperience: ['description'], keyExperiences: ['description'],
    currentSituation: ['description', 'scenario'], secrets: ['description'],
    userIdentity: ['scenario'], relationshipStart: ['scenario'], familiarity: ['scenario'], trust: ['scenario', 'personality'],
    relationshipPace: ['system_prompt', 'personality'], knownAboutUser: ['scenario', 'description'],
    unknownAboutUser: ['description', 'system_prompt'], boundaries: ['system_prompt', 'personality', 'post_history_instructions'],
    addressUser: ['personality', 'system_prompt', 'mes_example'], tone: ['personality', 'system_prompt', 'mes_example'], replyLength: ['post_history_instructions'],
    actionRatio: ['post_history_instructions'], verbalHabits: ['personality', 'mes_example'],
    forbiddenStyle: ['post_history_instructions', 'personality', 'system_prompt'],
    expressionIntensity: ['personality', 'mes_example', 'post_history_instructions'],
    worldType: ['scenario'], era: ['scenario'], worldSetting: ['scenario'], openingPlace: ['scenario', 'first_mes'],
    openingTime: ['scenario', 'first_mes'], openingTrigger: ['scenario', 'first_mes'],
});
const SEMANTIC_CONTROL_FIELDS = new Set([
    'adultStatus', 'ageStage', 'occupationCategory', 'familiarity', 'trust', 'relationshipPace',
    'replyLength', 'actionRatio', 'expressionIntensity', 'worldType', 'era',
]);

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function renderField(field) {
    const className = field.wide ? ' is-wide' : '';
    const attributes = `data-workshop-field="${escapeHtml(field.key)}" maxlength="${field.type === 'textarea' ? 1200 : 300}"`;
    let control = '';
    if (field.type === 'select') {
        const options = field.options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
        control = `<select ${attributes}><option value="">留空，由 AI 补全</option>${options}</select>`;
    } else if (field.type === 'textarea') {
        control = `<textarea ${attributes} rows="${field.rows || 2}" placeholder="${escapeHtml(field.placeholder || '留空则由 AI 补全')}"></textarea>`;
    } else {
        control = `<input ${attributes} type="text" placeholder="${escapeHtml(field.placeholder || '留空则由 AI 补全')}">`;
    }
    if (APPEARANCE_CHOICES[field.key]) {
        const choices = APPEARANCE_CHOICES[field.key].map(([label, values], group) => `<div class="leslie-appearance-choice-group"><small>${escapeHtml(label)}</small><div>${values.map(value => `<button type="button" class="leslie-appearance-choice" data-appearance-field="${field.key}" data-appearance-group="${group}" data-appearance-choice="${escapeHtml(value)}" aria-pressed="false" title="选择${escapeHtml(value)}；再次点击取消，可继续在输入框里补充">${escapeHtml(value)}</button>`).join('')}</div></div>`).join('');
        return `<div class="leslie-character-workshop-blueprint-field${className}"><label><span>${escapeHtml(field.label)}</span>${control}</label><small>可选常用项，也可以自由填写；留空交给 AI。</small><div class="leslie-appearance-choices">${choices}</div></div>`;
    }
    return `<label class="leslie-character-workshop-blueprint-field${className}"><span>${escapeHtml(field.label)}</span>${control}<small>留空则由 AI 生成</small></label>`;
}

export function renderCharacterBlueprintMarkup() {
    return CHARACTER_BLUEPRINT_SECTIONS.map(section => `
        <details class="leslie-character-workshop-blueprint-section" data-blueprint-section="${escapeHtml(section.id)}"${section.open ? ' open' : ''}>
            <summary><span><strong>${escapeHtml(section.title)}</strong><small>${escapeHtml(section.description)}</small></span><span class="leslie-blueprint-check" data-blueprint-check hidden aria-label="本项已确认">✓</span></summary>
            <div class="leslie-blueprint-body">
                <div class="leslie-character-workshop-blueprint-grid">${section.fields.map(renderField).join('')}</div>
                <div class="leslie-blueprint-step-actions"><small>留空项交给 AI 补全，确认后继续下一项。</small><button type="button" class="leslie-character-workshop-button is-primary" data-blueprint-complete title="确认本分类的填写内容，显示完成勾标并展开下一分类；留空项仍可由 AI 补全。">✓ ${section === CHARACTER_BLUEPRINT_SECTIONS.at(-1) ? '确认并完成填写' : '确认本项，继续下一项'}</button></div>
            </div>
        </details>`).join('');
}

export function normalizeCharacterBlueprint(values = {}) {
    const fields = {};
    for (const [key] of FIELD_LOOKUP) {
        const value = String(values[key] ?? '').replace(/\r\n/g, '\n').trim();
        if (value) {
            fields[key] = value;
        }
    }
    return { version: 1, fields };
}

export function summarizeCharacterBlueprint(blueprint = {}) {
    const source = blueprint?.fields && typeof blueprint.fields === 'object' ? blueprint.fields : {};
    const lockedFacts = [];
    const aiFillFields = [];
    for (const [key, field] of FIELD_LOOKUP) {
        const value = String(source[key] ?? '').trim();
        if (value) {
            lockedFacts.push({ key, label: field.label, value, source: 'user' });
        } else {
            aiFillFields.push({ key, label: field.label });
        }
    }
    return { lockedFacts, aiFillFields };
}

export function buildCharacterBlueprintPrompt({ blueprint = {}, freeform = '', mode = 'auto' } = {}) {
    const summary = summarizeCharacterBlueprint(blueprint);
    return JSON.stringify({
        schema: 'leslie-character-blueprint-v1',
        mode,
        rules: [
            'lockedFacts 是用户明确填写的事实，不得删除、改写或弱化。',
            'aiFillFields 代表用户主动留空的字段，可由 AI 合理生成；空白不是缺陷。',
            'AI 补全内容必须彼此一致，并在 assumptions 中标明。',
            'freeformNotes 是额外要求，不得覆盖 lockedFacts。',
        ],
        lockedFacts: summary.lockedFacts,
        aiFillFields: summary.aiFillFields,
        freeformNotes: String(freeform ?? '').trim(),
    }, null, 2);
}

function normalizeComparableText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replaceAll(/\{\{user\}\}|用户|user/g, '玩家')
        .replaceAll(/(?:厘米|公分)/g, 'cm')
        .replaceAll(/(?:千克|公斤)/g, 'kg')
        .replaceAll(/[\s，。；、,.!?！？：:：'"“”‘’（）()《》【】[\]_-]+/g, '');
}

function isFactCovered(value, text) {
    const normalizedValue = normalizeComparableText(value);
    if (!normalizedValue) {
        return true;
    }
    if (text.includes(normalizedValue)) {
        return true;
    }
    const fragments = String(value).split(/[\n，。；、;,]/g)
        .map(normalizeComparableText)
        .filter(fragment => fragment.length >= 2);
    if (fragments.length < 2) {
        return false;
    }
    const covered = fragments.filter(fragment => text.includes(fragment)).length;
    return covered >= Math.ceil(fragments.length * 0.6);
}

export function assessBlueprintFidelity(card = {}, blueprint = {}) {
    const data = card?.data ?? card ?? {};
    const summary = summarizeCharacterBlueprint(blueprint);
    const missing = [];
    const covered = [];
    for (const fact of summary.lockedFacts) {
        if (SEMANTIC_CONTROL_FIELDS.has(fact.key)) {
            covered.push(fact);
            continue;
        }
        const targets = FIELD_TARGETS[fact.key] || ['description', 'personality', 'scenario', 'system_prompt'];
        const targetText = normalizeComparableText(targets.map(target => data[target] ?? '').join('\n'));
        if (isFactCovered(fact.value, targetText)) {
            covered.push(fact);
        } else {
            missing.push(fact);
        }
    }
    return { missing, covered, total: summary.lockedFacts.length };
}
