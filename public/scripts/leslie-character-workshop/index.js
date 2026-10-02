/**
 * Leslie AI-assisted character workshop.
 *
 * The workshop creates an in-memory draft, then hands it to SillyTavern's
 * existing character editor. It never saves character data by itself.
 */

import {
    create_save,
    generateRaw,
    isGenerating,
    name1,
    name2,
    online_status,
    stopGeneration,
} from '../../script.js';
import { presentDreamlandPage, registerDreamlandPage, returnToDreamlandChat, usesDreamlandPages } from '../dreamland-pages.js';

let manualPage = false;
import {
    assessCharacterCard,
    canonicalizeDialogueRoleLabels,
    cardToCreateState,
    formatAvatarPrompt,
    normalizeAvatarPrompt,
    normalizeCharacterCard,
    normalizeCreativeBrief,
    normalizeKnowledgeCheck,
    parseStructuredResponse,
    protectRoleMacrosForGeneration,
} from './core.js';
import {
    buildBriefRequest,
    buildDraftRequest,
    buildKnowledgeCheckRequest,
    buildRepairRequest,
    buildReviewRequest,
    LESLIE_CHARACTER_WRITING_SKILL,
} from './writing-skill.js';
import { parseCharacterCardJsonText } from './importer.js';
import {
    WORKSHOP_PROVIDER,
    buildLocalChatCompletionRequest,
    extractLocalCompletionText,
    getLocalChatCompletionUrl,
    getLocalWorkshopSettings,
    getWorkshopProviderLabel,
    probeLocalWorkshopProvider,
} from './provider.js';
import {
    assessBlueprintFidelity,
    buildCharacterBlueprintPrompt,
    normalizeCharacterBlueprint,
    renderCharacterBlueprintMarkup,
} from './blueprint.js';
import { isLocalModelLoadingEnabled } from '../leslie-local-model-core.js';

const STAGES = ['brief', 'research', 'draft', 'review', 'ready'];
const PREVIEW_FIELDS = [
    ['name', '角色姓名', 'input'],
    ['description', '角色是谁'],
    ['personality', '性格与说话方式'],
    ['scenario', '世界、关系与开场'],
    ['first_mes', '首条消息'],
    ['mes_example', '示例对话'],
    ['system_prompt', '核心边界'],
    ['post_history_instructions', '每轮输出契约'],
    ['creator_notes', '创作者备注'],
    ['alternate_greetings', '备用开场（每段之间空一行）', 'list'],
    ['tags', '标签（使用逗号分隔）', 'tags'],
    ['depth_prompt', '核心锚点', 'depth'],
];

const state = {
    runId: 0,
    running: false,
    cancelled: false,
    bypassNextCreateClick: false,
    previousFocus: null,
    brief: null,
    knowledgeCheck: null,
    draft: null,
    finalCard: null,
    avatarPrompt: null,
    modelReview: null,
    localReview: null,
    importSource: '',
    importNotices: [],
    provider: WORKSHOP_PROVIDER.CHAT,
    localProviderModel: '',
    abortController: null,
    blueprint: normalizeCharacterBlueprint({}),
    manuallyEdited: false,
    avatarFiles: null,
    avatarPreviewUrl: '',
};

let overlay;

function createWorkshopMarkup() {
    const element = document.createElement('section');
    element.id = 'leslie-character-workshop';
    element.className = 'leslie-character-workshop';
    element.hidden = true;
    element.dataset.open = 'false';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-labelledby', 'leslie-character-workshop-title');
    element.innerHTML = `
        <div class="leslie-character-workshop-panel">
            <header class="leslie-character-workshop-header">
                <div class="leslie-character-workshop-heading">
                    <span class="leslie-character-workshop-logo fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
                    <span>
                        <small>QUALITY-FIRST CREATION</small>
                        <strong id="leslie-character-workshop-title">AI 角色工坊</strong>
                    </span>
                </div>
                <div class="leslie-character-workshop-header-actions">
                    <span class="leslie-character-workshop-connection" data-workshop-connection></span>
                    <button type="button" class="leslie-character-workshop-icon-button fa-solid fa-xmark" data-workshop-action="close" aria-label="关闭角色工坊"></button>
                </div>
            </header>

            <div class="leslie-character-workshop-layout">
                <aside class="leslie-character-workshop-rail" aria-label="创作进度">
                    <div class="leslie-character-workshop-rail-copy">
                        <span>一次一张</span>
                        <strong>先理解，再核对，最后审校。</strong>
                        <p>AI 不会生成头像，只会附带手动图片提示词。最终草稿会先进入原角色编辑器，由你确认。</p>
                    </div>
                    <ol class="leslie-character-workshop-steps">
                        <li data-workshop-stage="brief"><span>1</span><div><strong>创作简报</strong><small>锁定硬事实与边界</small></div></li>
                        <li data-workshop-stage="research"><span>2</span><div><strong>AI 知识核对</strong><small>按所选接口执行</small></div></li>
                        <li data-workshop-stage="draft"><span>3</span><div><strong>完整写作</strong><small>只生成一个候选</small></div></li>
                        <li data-workshop-stage="review"><span>4</span><div><strong>独立审校</strong><small>检查失真、边界与节奏</small></div></li>
                        <li data-workshop-stage="ready"><span>5</span><div><strong>人工确认</strong><small>补头像后再保存</small></div></li>
                    </ol>
                    <div class="leslie-character-workshop-privacy">
                        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                        <span>不会读取现有角色卡、聊天、记忆或密钥。本地选项只访问 127.0.0.1 的已加载模型。</span>
                    </div>
                </aside>

                <main class="leslie-character-workshop-main">
                    <section class="leslie-character-workshop-intro">
                        <span class="leslie-character-workshop-eyebrow">结构化角色蓝图</span>
                        <h2>确定的你来填，其余交给 AI</h2>
                        <p>所有字段都可以留空。你填写的内容会被视为锁定事实，空白项由 AI 合理补全；生成后还可以直接手动修改，不会自动再次调用 AI。</p>
                        <div class="leslie-character-workshop-options">
                            <label>
                                <span>创作类型</span>
                                <select data-workshop-mode>
                                    <option value="auto">让 AI 判断</option>
                                    <option value="original">原创角色</option>
                                    <option value="adaptation">原作复刻</option>
                                </select>
                            </label>
                            <label class="leslie-character-workshop-toggle">
                                <input type="checkbox" data-workshop-knowledge-check checked>
                                <span><strong>需要时由当前 AI 核对知识</strong><small>不需要第二套 API；模型不支持联网时只做非实时核对</small></span>
                            </label>
                        </div>
                        <div class="leslie-character-workshop-blueprint" data-workshop-blueprint>
                            ${renderCharacterBlueprintMarkup()}
                        </div>
                        <label class="leslie-character-workshop-freeform">
                            <span><strong>自由补充</strong><small>上面没有覆盖的要求写在这里；留空也可以直接生成完整角色。</small></span>
                            <textarea data-workshop-prompt rows="6" maxlength="12000" placeholder="例如：希望她表面冷淡但会用实际行动帮助别人；故事从一次意外停电开始……"></textarea>
                        </label>
                        <div class="leslie-character-workshop-api-note">
                            <i class="fa-solid fa-link" aria-hidden="true"></i>
                            <span><strong>可切换角色卡生成接口</strong><small>默认复用当前聊天 API；选择当前本地模型只作用于本次角色卡草稿生成，不改变聊天设置。生成结果只在内存中预览，不会自动保存。</small></span>
                        </div>
                        <label class="leslie-character-workshop-provider">
                            <span>角色卡生成接口</span>
                            <select data-workshop-provider>
                                <option value="chat">当前聊天 API（DeepSeek 等）</option>
                                <option value="local">当前本地模型 · KoboldCpp</option>
                            </select>
                            <small data-workshop-provider-status>默认使用当前聊天 API；本地接口仅用于角色卡工坊。</small>
                        </label>

                        <details class="leslie-character-workshop-json-import">
                            <summary>
                                <span><i class="fa-solid fa-box-open" aria-hidden="true"></i> 已经有角色卡 JSON</span>
                                <small>接收公益角色网站复制的 V2 JSON，也兼容普通 V2 / V3 文本</small>
                            </summary>
                            <div class="leslie-character-workshop-json-import-body">
                                <div class="leslie-character-workshop-json-import-heading">
                                    <div>
                                        <strong>从公益角色网站带入</strong>
                                        <p>在网站选择“复制 JSON 到剪贴板”，回到这里读取并检查。内容只在本机内存中处理，不会自动保存。</p>
                                    </div>
                                    <a href="https://sillytavern-helper.clarixe.top/" target="_blank" rel="noopener noreferrer">打开角色网站</a>
                                </div>
                                <textarea data-workshop-import-json rows="7" maxlength="1500000" spellcheck="false" placeholder='粘贴以 { "spec": "chara_card_v2", "data": { ... } } 开头的 JSON'></textarea>
                                <div class="leslie-character-workshop-json-import-actions">
                                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="paste-json">读取剪贴板并检查</button>
                                    <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="inspect-json">检查粘贴内容</button>
                                </div>
                                <p class="leslie-character-workshop-json-import-note" data-workshop-import-note>一次只接收一张角色卡；图片仍需在原角色编辑器中补充。</p>
                            </div>
                        </details>
                    </section>

                    <div class="leslie-character-workshop-status" data-workshop-status hidden>
                        <span class="leslie-character-workshop-spinner" aria-hidden="true"></span>
                        <div><strong data-workshop-status-title></strong><p data-workshop-status-body></p></div>
                    </div>
                    <div class="leslie-character-workshop-error" data-workshop-error hidden></div>

                    <section class="leslie-character-workshop-result" data-workshop-section="brief" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>01</span><div><h3>AI 理解的创作简报</h3><p>明确要求不会被擅自修改；补全部分会单独列出。</p></div></div></div>
                        <div data-workshop-brief></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="knowledge" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>02</span><div><h3>当前 AI 的知识核对</h3><p data-workshop-knowledge-summary></p></div></div></div>
                        <div class="leslie-character-workshop-knowledge" data-workshop-knowledge></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="quality" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>04</span><div><h3>质量审校</h3><p>模型复审与本地硬规则同时通过，才会进入最终预览。</p></div></div></div>
                        <div data-workshop-quality></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="preview" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>05</span><div><h3 data-workshop-card-name>角色卡编辑与确认</h3><p>这是 AI 完成的第一版。你可以直接修改任意字段；修改后不会再让 AI 介入。</p></div></div></div>
                        <div class="leslie-character-workshop-preview" data-workshop-preview></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="avatar" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>IMG</span><div><h3>角色头像</h3><p>可以直接上传照片，也可以复制 AI 提供的提示词去其他图片工具生成。</p></div></div></div>
                        <div class="leslie-character-workshop-avatar-upload">
                            <div class="leslie-character-workshop-avatar-preview" data-workshop-avatar-preview>
                                <i class="fa-solid fa-user" aria-hidden="true"></i>
                                <img data-workshop-avatar-image alt="角色头像预览" hidden>
                            </div>
                            <div>
                                <strong>上传角色卡照片</strong>
                                <p data-workshop-avatar-file-note>尚未选择图片；也可以稍后在原角色编辑器中添加。</p>
                                <div class="leslie-character-workshop-avatar-actions">
                                    <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="choose-avatar">选择图片</button>
                                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="remove-avatar" hidden>移除</button>
                                </div>
                                <input id="leslie-workshop-avatar-file" data-workshop-avatar-file type="file" accept="image/*" hidden>
                            </div>
                        </div>
                        <div class="leslie-character-workshop-avatar-prompt" data-workshop-avatar-prompt></div>
                    </section>
                </main>
            </div>

            <footer class="leslie-character-workshop-footer">
                <span data-workshop-footer-note>写作规则 ${LESLIE_CHARACTER_WRITING_SKILL.version} · 只生成一张</span>
                <div>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="manual">改用手动创建</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="download" hidden>下载 JSON 草稿</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="copy-avatar" hidden>复制头像提示词</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="review" hidden>可选：让 AI 再审校</button>
                    <button type="button" class="leslie-character-workshop-button is-danger" data-workshop-action="cancel" hidden>停止创作</button>
                    <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="generate">开始深度创作</button>
                    <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="apply" hidden>带入角色编辑器</button>
                </div>
            </footer>
        </div>`;
    return element;
}

function query(selector) {
    return overlay.querySelector(selector);
}

function setHidden(selector, hidden) {
    const element = query(selector);
    if (element) {
        element.hidden = hidden;
    }
}

function assessWorkshopCard(card, context = {}) {
    const review = assessCharacterCard(card, context);
    if (state.manuallyEdited) {
        return review;
    }
    const fidelity = assessBlueprintFidelity(normalizeCharacterCard(card), state.blueprint);
    if (fidelity.missing.length > 0) {
        review.score = Math.max(0, review.score - Math.min(35, fidelity.missing.length * 7));
        review.blocking.push(...fidelity.missing.map(fact => ({
            code: `missing_locked_${fact.key}`,
            message: `没有完整保留用户锁定字段“${fact.label}”：${fact.value}`,
        })));
    } else if (fidelity.total > 0) {
        review.passed.push({ code: 'locked_facts', message: `已保留 ${fidelity.total} 项用户锁定设定。` });
    }
    return { ...review, fidelity };
}

function setConnectionBadge() {
    const badge = query('[data-workshop-connection]');
    const connected = state.provider === WORKSHOP_PROVIDER.LOCAL
        ? Boolean(state.localProviderConnected)
        : online_status && online_status !== 'no_connection';
    badge.textContent = connected ? '● 模型已连接' : '○ 模型未连接';
    badge.classList.toggle('is-connected', connected);
}

function updateProviderStatus(message, connected = null) {
    const status = query('[data-workshop-provider-status]');
    if (!status) {
        return;
    }
    status.textContent = message;
    status.dataset.connected = connected === null ? '' : String(Boolean(connected));
    setConnectionBadge();
}

function getSelectedProvider() {
    return query('[data-workshop-provider]')?.value === WORKSHOP_PROVIDER.LOCAL
        ? WORKSHOP_PROVIDER.LOCAL
        : WORKSHOP_PROVIDER.CHAT;
}

function syncProviderUi() {
    state.provider = getSelectedProvider();
    state.localProviderConnected = false;
    state.localProviderModel = '';
    if (state.provider === WORKSHOP_PROVIDER.LOCAL) {
        updateProviderStatus('本地接口：127.0.0.1:5001 · 生成前会自动检查', null);
    } else {
        updateProviderStatus('默认使用当前聊天 API；本地接口仅用于角色卡工坊。', null);
    }
}

function setStage(stage, status = 'active') {
    const stageIndex = STAGES.indexOf(stage);
    overlay.querySelectorAll('[data-workshop-stage]').forEach((item, index) => {
        item.classList.toggle('is-active', index === stageIndex && status === 'active');
        item.classList.toggle('is-complete', index < stageIndex || (index === stageIndex && status === 'complete'));
    });
}

function showStatus(title, body, stage) {
    const status = query('[data-workshop-status]');
    status.hidden = false;
    query('[data-workshop-status-title]').textContent = title;
    query('[data-workshop-status-body]').textContent = body;
    if (stage) {
        setStage(stage);
    }
}

function hideStatus() {
    setHidden('[data-workshop-status]', true);
}

function showError(message) {
    const error = query('[data-workshop-error]');
    error.textContent = message;
    error.hidden = false;
}

function clearError() {
    const error = query('[data-workshop-error]');
    error.textContent = '';
    error.hidden = true;
}

function setRunning(running) {
    state.running = running;
    query('[data-workshop-action="generate"]').hidden = running || Boolean(state.finalCard);
    query('[data-workshop-action="cancel"]').hidden = !running;
    query('[data-workshop-action="manual"]').disabled = running;
    query('[data-workshop-action="close"]').disabled = running;
    query('[data-workshop-prompt]').disabled = running;
    query('[data-workshop-mode]').disabled = running;
    query('[data-workshop-provider]').disabled = running;
    query('[data-workshop-knowledge-check]').disabled = running;
    overlay.querySelectorAll('[data-workshop-field]').forEach(field => {
        field.disabled = running;
    });
    query('[data-workshop-import-json]').disabled = running;
    query('[data-workshop-action="paste-json"]').disabled = running;
    query('[data-workshop-action="inspect-json"]').disabled = running;
}

function resetResults() {
    clearAvatarSelection();
    state.brief = null;
    state.knowledgeCheck = null;
    state.draft = null;
    state.finalCard = null;
    state.avatarPrompt = null;
    state.modelReview = null;
    state.localReview = null;
    state.importSource = '';
    state.importNotices = [];
    state.blueprint = normalizeCharacterBlueprint({});
    state.manuallyEdited = false;
    ['brief', 'knowledge', 'quality', 'preview', 'avatar'].forEach(section => setHidden(`[data-workshop-section="${section}"]`, true));
    setHidden('[data-workshop-action="download"]', true);
    setHidden('[data-workshop-action="review"]', true);
    setHidden('[data-workshop-action="apply"]', true);
    setHidden('[data-workshop-action="copy-avatar"]', true);
    const importNote = query('[data-workshop-import-note]');
    importNote.textContent = '一次只接收一张角色卡；图片仍需在原角色编辑器中补充。';
    delete importNote.dataset.status;
    setStage('brief');
}

function openWorkshop() {
    if (usesDreamlandPages() && manualPage) {
        showManualPage();
        return;
    }
    state.previousFocus = document.activeElement;
    const page = presentDreamlandPage('workshop', overlay, () => { overlay.dataset.open = 'false'; });
    overlay.hidden = false;
    syncProviderUi();
    setConnectionBadge();
    if (!page) {
        document.documentElement.classList.add('leslie-character-workshop-open');
        document.body.classList.add('leslie-character-workshop-open');
    }
    requestAnimationFrame(() => {
        overlay.dataset.open = 'true';
        query('[data-workshop-field="name"]')?.focus();
    });
}

function closeWorkshop() {
    if (returnToDreamlandChat('workshop')) return;
    if (state.running) {
        return;
    }

    overlay.dataset.open = 'false';
    document.documentElement.classList.remove('leslie-character-workshop-open');
    document.body.classList.remove('leslie-character-workshop-open');
    window.setTimeout(() => {
        overlay.hidden = true;
        if (state.previousFocus instanceof HTMLElement) {
            state.previousFocus.focus();
        }
    }, 180);
}

function appendTextList(container, title, values, emptyText = '无') {
    const group = document.createElement('div');
    group.className = 'leslie-character-workshop-brief-group';
    const heading = document.createElement('strong');
    heading.textContent = title;
    group.append(heading);
    const list = document.createElement('ul');
    const items = Array.isArray(values) ? values.filter(Boolean) : [values].filter(Boolean);

    for (const value of items.length ? items : [emptyText]) {
        const item = document.createElement('li');
        item.textContent = String(value);
        list.append(item);
    }

    group.append(list);
    container.append(group);
}

function renderBrief() {
    const container = query('[data-workshop-brief]');
    container.replaceChildren();
    container.className = 'leslie-character-workshop-brief-grid';
    appendTextList(container, '硬事实', state.brief.hardFacts);
    appendTextList(container, '主题核心', state.brief.themeCore);
    appendTextList(container, '性格矛盾', state.brief.personalityTensions);
    appendTextList(container, '认知边界', state.brief.knowledgeBoundaries);
    appendTextList(container, '关系与开场', [state.brief.relationshipStart, state.brief.openingHook]);
    appendTextList(container, '克制补全', state.brief.assumptions, '没有额外补全');
    setHidden('[data-workshop-section="brief"]', false);
}

function renderKnowledgeCheck() {
    const section = query('[data-workshop-section="knowledge"]');
    const container = query('[data-workshop-knowledge]');
    const summary = query('[data-workshop-knowledge-summary]');
    container.replaceChildren();

    if (!state.brief?.requiresKnowledgeCheck) {
        summary.textContent = '本次创作不需要额外知识核对。';
        const note = document.createElement('div');
        note.className = 'leslie-character-workshop-empty';
        note.textContent = '已跳过知识核对；原创内容会以你的提示词和创作简报为唯一事实来源。';
        container.append(note);
    } else {
        const knowledgeCheck = state.knowledgeCheck || normalizeKnowledgeCheck({});
        const facts = knowledgeCheck.facts;
        summary.textContent = `${knowledgeCheck.summary || '当前模型已完成一次知识核对。'} 该步骤复用当前聊天 API；若模型本身不支持联网，这不是实时检索结果。`;

        facts.forEach((fact, index) => {
            const article = document.createElement('article');
            const number = document.createElement('span');
            number.textContent = String(index + 1).padStart(2, '0');
            const copy = document.createElement('div');
            const claim = document.createElement('strong');
            claim.textContent = fact.claim;
            const confidence = document.createElement('small');
            confidence.textContent = `置信度：${({ high: '高', medium: '中', low: '低' })[fact.confidence] || '低'}`;
            const basis = document.createElement('p');
            basis.textContent = fact.basis || '模型未提供判断依据，请人工确认。';
            copy.append(claim, confidence, basis);
            article.append(number, copy);
            container.append(article);
        });

        if (facts.length === 0) {
            const note = document.createElement('div');
            note.className = 'leslie-character-workshop-empty';
            note.textContent = '当前模型没有给出足够可靠的知识结论；角色卡会保守处理，并在质量审校中提示人工确认。';
            container.append(note);
        }

        if (knowledgeCheck.uncertainties.length > 0) {
            const uncertainty = document.createElement('div');
            uncertainty.className = 'leslie-character-workshop-knowledge-uncertainties';
            appendTextList(uncertainty, '仍需人工确认', knowledgeCheck.uncertainties);
            container.append(uncertainty);
        }
    }

    section.hidden = false;
}

function clearAvatarSelection() {
    if (state.avatarPreviewUrl) {
        URL.revokeObjectURL(state.avatarPreviewUrl);
    }
    state.avatarFiles = null;
    state.avatarPreviewUrl = '';
    const input = query('[data-workshop-avatar-file]');
    if (input) {
        input.value = '';
    }
    const image = query('[data-workshop-avatar-image]');
    const placeholder = query('[data-workshop-avatar-preview] i');
    if (image) {
        image.removeAttribute('src');
        image.hidden = true;
    }
    if (placeholder) {
        placeholder.hidden = false;
    }
    const note = query('[data-workshop-avatar-file-note]');
    if (note) {
        note.textContent = '尚未选择图片；也可以稍后在原角色编辑器中添加。';
    }
    setHidden('[data-workshop-action="remove-avatar"]', true);
}

function handleAvatarSelection(input) {
    const file = input.files?.[0];
    if (!file) {
        clearAvatarSelection();
        return;
    }
    if (!file.type.startsWith('image/')) {
        clearAvatarSelection();
        showError('请选择常见图片文件作为角色头像。');
        return;
    }
    if (state.avatarPreviewUrl) {
        URL.revokeObjectURL(state.avatarPreviewUrl);
    }
    state.avatarFiles = input.files;
    state.avatarPreviewUrl = URL.createObjectURL(file);
    const image = query('[data-workshop-avatar-image]');
    image.src = state.avatarPreviewUrl;
    image.hidden = false;
    query('[data-workshop-avatar-preview] i').hidden = true;
    query('[data-workshop-avatar-file-note]').textContent = `${file.name} · 带入编辑器后可继续裁剪和更换。`;
    setHidden('[data-workshop-action="remove-avatar"]', false);
    clearError();
}

function renderAvatarPrompt() {
    const section = query('[data-workshop-section="avatar"]');
    const container = query('[data-workshop-avatar-prompt]');
    const avatarPrompt = normalizeAvatarPrompt(state.avatarPrompt || {});
    container.replaceChildren();

    section.hidden = !state.finalCard;
    setHidden('[data-workshop-action="copy-avatar"]', !avatarPrompt.positive);
    if (!avatarPrompt.positive) {
        const note = document.createElement('div');
        note.className = 'leslie-character-workshop-empty';
        note.textContent = '当前草稿没有头像提示词，你仍然可以直接上传一张角色照片。';
        container.append(note);
        return;
    }

    const fields = [
        ['正向提示词', avatarPrompt.positive],
        ['负向提示词', avatarPrompt.negative || '无额外负向提示词'],
    ];
    for (const [label, value] of fields) {
        const block = document.createElement('div');
        block.className = 'leslie-character-workshop-avatar-field';
        const heading = document.createElement('strong');
        heading.textContent = label;
        const content = document.createElement('pre');
        content.textContent = value;
        block.append(heading, content);
        container.append(block);
    }

    const meta = document.createElement('p');
    meta.className = 'leslie-character-workshop-avatar-meta';
    meta.textContent = `推荐比例：${avatarPrompt.aspectRatio || '2:3'}${avatarPrompt.notes ? ` · ${avatarPrompt.notes}` : ''}`;
    container.append(meta);
    section.hidden = false;
}

function renderQuality() {
    const container = query('[data-workshop-quality]');
    container.replaceChildren();
    container.className = 'leslie-character-workshop-quality-grid';
    const modelTotal = Number(state.modelReview?.scores?.total);
    const localScore = Number(state.localReview?.score ?? 0);
    const adaptationWithoutLiveSources = state.brief?.mode === 'adaptation'
        && /(?:无法|不支持|没有).{0,8}(?:实时)?联网|不是实时检索/u.test(state.knowledgeCheck?.summary || '');
    const combinedScore = Number.isFinite(modelTotal)
        ? Math.round((Math.min(100, Math.max(0, modelTotal)) * 0.45) + (localScore * 0.55))
        : localScore;
    const issues = [
        ...(state.localReview?.blocking || []).map(item => item.message),
        ...(state.localReview?.warnings || []).map(item => item.message),
    ];
    const score = document.createElement('div');
    score.className = 'leslie-character-workshop-score';
    score.dataset.grade = combinedScore >= 90 ? 'excellent' : combinedScore >= 75 ? 'good' : 'warning';
    const scoreNumber = document.createElement('strong');
    scoreNumber.textContent = String(combinedScore);
    const scoreCopy = document.createElement('span');
    scoreCopy.textContent = state.brief?.mode === 'adaptation'
        ? '结构与行为质量分 / 100'
        : '综合质量分 / 100';
    score.append(scoreNumber, scoreCopy);

    const summary = document.createElement('div');
    summary.className = 'leslie-character-workshop-review-copy';
    const heading = document.createElement('strong');
    heading.textContent = issues.length === 0
        ? '最终稿已通过全部本地硬规则，AI 独立复审已完成。'
        : state.modelReview?.summary || '已完成模型复审与本地规则检查。';
    const details = document.createElement('p');
    details.textContent = `本地规则 ${localScore} 分；模型复审 ${Number.isFinite(modelTotal) ? `${modelTotal} 分` : '未提供总分'}。${adaptationWithoutLiveSources ? ' 原作事实未经过实时网页来源验证，不计入此分数。' : ''}`;
    summary.append(heading, details);
    container.append(score, summary);

    const findings = document.createElement('div');
    findings.className = 'leslie-character-workshop-findings';
    appendTextList(findings, issues.length ? '仍需留意' : '本地硬规则', issues, '全部通过');
    const hasModelScore = Number.isFinite(modelTotal);
    appendTextList(
        findings,
        state.importSource && !hasModelScore ? '兼容处理' : '审校修改',
        state.modelReview?.changesMade,
        state.importSource && !hasModelScore ? '无需额外转换' : '模型未列出具体修改',
    );
    container.append(findings);
    setHidden('[data-workshop-section="quality"]', false);
}

function getEditableCardValue(data, field, type) {
    if (type === 'list') {
        return Array.isArray(data[field]) ? data[field].join('\n\n') : '';
    }
    if (type === 'tags') {
        return Array.isArray(data[field]) ? data[field].join(', ') : '';
    }
    if (type === 'depth') {
        return data.extensions?.depth_prompt?.prompt || '';
    }
    return String(data[field] ?? '');
}

function syncManualCardEdits({ refreshQuality = false, markEdited = false } = {}) {
    if (!state.finalCard) {
        return;
    }
    const nextCard = normalizeCharacterCard(state.finalCard);
    for (const control of overlay.querySelectorAll('[data-workshop-card-field]')) {
        const field = control.dataset.workshopCardField;
        const type = control.dataset.workshopCardType || '';
        const value = control.value.replace(/\r\n/g, '\n').trim();
        if (type === 'list') {
            nextCard.data[field] = value.split(/\n\s*\n/g).map(item => item.trim()).filter(Boolean);
        } else if (type === 'tags') {
            nextCard.data[field] = value.split(/[,，\n]/g).map(item => item.trim()).filter(Boolean);
        } else if (type === 'depth') {
            nextCard.data.extensions.depth_prompt.prompt = value;
        } else {
            nextCard.data[field] = value;
        }
    }
    state.finalCard = normalizeCharacterCard(nextCard);
    if (markEdited) {
        state.manuallyEdited = true;
    }
    state.localReview = assessWorkshopCard(state.finalCard, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });
    query('[data-workshop-card-name]').textContent = `${state.finalCard.data.name || '未命名角色'} · 角色卡编辑与确认`;
    if (refreshQuality && state.manuallyEdited) {
        state.modelReview = {
            summary: '你已经手动修改了 AI 初稿；当前结果只进行本地规则检查，不会自动再次调用 AI。',
            changesMade: ['保留用户手动修改，未进行 AI 重写。'],
        };
        renderQuality();
        refreshDraftActions();
    }
}

function refreshDraftActions() {
    const missingFields = state.localReview?.blocking?.length > 0;
    const belowQualityFloor = Number(state.localReview?.score ?? 0) < 75;
    setHidden('[data-workshop-action="apply"]', missingFields || belowQualityFloor);
    let footerNote = '草稿尚未保存。带入后请补头像并逐项确认。';
    if (state.manuallyEdited) {
        footerNote = '已保留你的手动修改；不会自动再次调用 AI。可直接带入原角色编辑器。';
    }
    if (missingFields) {
        footerNote = '手动版本仍有关键字段为空，暂不能带入编辑器；可直接在上方补写，无需 AI。';
    } else if (belowQualityFloor) {
        footerNote = `本地质量分 ${state.localReview.score}，低于 75 分门槛；可直接修改上方字段，也可主动选择 AI 再审校。`;
    } else if (state.brief?.mode === 'adaptation' && /(?:无法|不支持|没有).{0,8}(?:实时)?联网|不是实时检索/u.test(state.knowledgeCheck?.summary || '')) {
        footerNote = '草稿尚未保存；当前原作事实未经过实时网页来源验证，请先人工核对，再带入编辑器。';
    } else if (state.importSource) {
        footerNote = `${state.importSource} JSON 已通过结构检查，尚未保存。`;
    }
    query('[data-workshop-footer-note]').textContent = footerNote;
}

function renderPreview() {
    const data = state.finalCard.data;
    const container = query('[data-workshop-preview]');
    container.replaceChildren();
    query('[data-workshop-card-name]').textContent = `${data.name || '未命名角色'} · 角色卡编辑与确认`;

    const notice = document.createElement('div');
    notice.className = 'leslie-character-workshop-edit-notice';
    notice.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span><strong>现在可以直接编辑</strong><small>修改会立即保留在当前草稿中；不会自动发送给 AI。失去焦点后会重新运行本地完整性检查。</small></span>';
    container.append(notice);

    for (const [field, label, type = 'textarea'] of PREVIEW_FIELDS) {
        const details = document.createElement('details');
        if (field === 'name' || field === 'first_mes') {
            details.open = true;
        }
        const summary = document.createElement('summary');
        summary.textContent = label;
        const control = document.createElement(type === 'input' ? 'input' : 'textarea');
        control.className = 'leslie-character-workshop-card-editor';
        control.dataset.workshopCardField = field;
        control.dataset.workshopCardType = type;
        control.value = getEditableCardValue(data, field, type);
        control.maxLength = type === 'input' ? 200 : 24000;
        if (control instanceof HTMLTextAreaElement) {
            control.rows = ['description', 'mes_example'].includes(field) ? 10 : 5;
        }
        details.append(summary, control);
        container.append(details);
    }

    setHidden('[data-workshop-section="preview"]', false);
    setHidden('[data-workshop-action="download"]', false);
    setHidden('[data-workshop-action="review"]', false);
    refreshDraftActions();
}

function createImportedCardBrief(card) {
    const data = card.data;
    return {
        mode: 'imported',
        workingTitle: data.name,
        hardFacts: ['把待审角色卡中已经明确写出的身份、经历、关系和边界视为硬事实，不得擅自替换。'],
        themeCore: ['保留原卡创作意图，只修复一致性、字段职责与互动质量问题。'],
        personalityTensions: [],
        knowledgeBoundaries: ['不得为补全格式而虚构角色卡没有提供的新经历或原作事实。'],
        userIdentity: '沿用待审角色卡中的 {{user}} 定义。',
        relationshipStart: data.scenario,
        openingHook: data.first_mes,
        replyStyle: data.post_history_instructions,
        contentBoundaries: ['不替 {{user}} 决定台词、行动、情绪、同意或关系升级。'],
        assumptions: ['这是一份外部导入卡；审校只能做必要修复，不扩写无关设定。'],
        requiresKnowledgeCheck: false,
        knowledgeQuestions: [],
        qualityTargets: ['字段完整', '人格稳定', '短对话自然', '用户控制权清楚'],
    };
}

function inspectPastedJson() {
    if (state.running) {
        return;
    }

    clearError();
    try {
        const result = parseCharacterCardJsonText(query('[data-workshop-import-json]').value);
        resetResults();
        state.finalCard = result.card;
        state.importSource = result.sourceLabel;
        state.importNotices = result.notices;
        state.brief = createImportedCardBrief(result.card);
        state.modelReview = {
            summary: `已完成 ${result.sourceLabel} ${result.sourceSpec} 的兼容性与本地质量检查，尚未调用 AI 改写。`,
            changesMade: result.notices,
        };
        state.localReview = assessWorkshopCard(state.finalCard);
        renderQuality();
        renderPreview();
        renderAvatarPrompt();
        setStage('ready', 'complete');
        setRunning(false);

        const note = query('[data-workshop-import-note]');
        const warningCount = state.localReview.warnings.length;
        const missingFields = state.localReview.blocking.length > 0;
        const belowQualityFloor = state.localReview.score < 75;
        if (missingFields) {
            note.textContent = `结构读取成功，但有 ${state.localReview.blocking.length} 个关键字段缺失。请先点“再审校一次”，由 AI 补全后再带入。`;
        } else if (belowQualityFloor) {
            note.textContent = `结构读取成功，但本地质量分 ${state.localReview.score} 低于 75 分门槛。请先让 AI 深度审校。`;
        } else {
            note.textContent = `结构读取成功；本地质量分 ${state.localReview.score}，另有 ${warningCount} 项建议。你可以直接带入，也可以先让 AI 深度审校。`;
        }
        note.dataset.status = missingFields || belowQualityFloor ? 'warning' : 'success';
        query('[data-workshop-section="quality"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        showError(error?.message || '无法读取这份角色卡 JSON。');
        const note = query('[data-workshop-import-note]');
        note.textContent = '没有写入或覆盖任何角色数据。请检查复制内容后重试。';
        note.dataset.status = 'error';
    }
}

async function pasteAndInspectJson() {
    clearError();
    if (!navigator.clipboard?.readText) {
        showError('当前环境不能自动读取剪贴板。请在输入框中按 Ctrl+V，再点“检查粘贴内容”。');
        query('[data-workshop-import-json]').focus();
        return;
    }

    try {
        const text = await navigator.clipboard.readText();
        query('[data-workshop-import-json]').value = text;
        inspectPastedJson();
    } catch (error) {
        console.warn('Leslie character workshop clipboard read failed', error);
        showError('没有取得剪贴板读取权限。请在输入框中按 Ctrl+V，再点“检查粘贴内容”。');
        query('[data-workshop-import-json]').focus();
    }
}

async function generateLocalRaw(request) {
    if (!isLocalModelLoadingEnabled()) {
        throw new Error('本地模型加载已关闭，请先在“设置 → 模型连接”中打开。');
    }
    const settings = getLocalWorkshopSettings(state.localProviderModel || undefined);
    const response = await fetch(getLocalChatCompletionUrl(settings), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildLocalChatCompletionRequest(request, settings)),
        signal: state.abortController?.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `本地模型生成失败（HTTP ${response.status}）。`);
    }
    return extractLocalCompletionText(payload);
}

async function generateWithSelectedProvider(request) {
    if (state.provider === WORKSHOP_PROVIDER.LOCAL) {
        return generateLocalRaw(request);
    }
    return generateRaw({
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        responseLength: request.responseLength,
        trimNames: false,
    });
}

async function generateStructured(request, runId) {
    const response = await generateWithSelectedProvider(request);

    if (runId !== state.runId || state.cancelled) {
        throw new Error('创作已取消。');
    }

    try {
        return parseStructuredResponse(response);
    } catch (error) {
        showStatus('正在修复模型格式', '内容已经生成，但 JSON 格式不完整。AI 正在做一次格式修复，不会重写你的要求。');
        const repair = buildRepairRequest(response, error.message);
        const repairedResponse = await generateWithSelectedProvider(repair);
        if (runId !== state.runId || state.cancelled) {
            throw new Error('创作已取消。');
        }
        return parseStructuredResponse(repairedResponse);
    }
}

function ensureRunActive(runId) {
    if (runId !== state.runId || state.cancelled) {
        throw new Error('创作已取消。');
    }
}

function collectCharacterBlueprint() {
    const values = {};
    for (const field of overlay.querySelectorAll('[data-workshop-field]')) {
        values[field.dataset.workshopField] = field.value;
    }
    return normalizeCharacterBlueprint(values);
}

function updateBlueprintFieldState(control) {
    const field = control.closest('.leslie-character-workshop-blueprint-field');
    const note = field?.querySelector('small');
    const hasValue = Boolean(control.value.trim());
    field?.classList.toggle('has-value', hasValue);
    if (note) {
        note.textContent = hasValue ? '已锁定为用户事实' : '留空则由 AI 生成';
    }
}

async function runWorkshop() {
    const freeform = query('[data-workshop-prompt]').value.trim();
    state.provider = getSelectedProvider();
    if (state.provider === WORKSHOP_PROVIDER.LOCAL && !isLocalModelLoadingEnabled()) {
        showError('本地模型加载已关闭，请先到“设置 → 模型连接”打开开关。');
        return;
    }
    if (state.provider === WORKSHOP_PROVIDER.CHAT && (!online_status || online_status === 'no_connection')) {
        showError('当前没有连接可用模型。请先到“设置 → 模型连接”完成连接，再回来创作。');
        return;
    }
    if (isGenerating()) {
        showError('当前正在生成聊天回复。请先停止回复，再开始角色创作。');
        return;
    }

    resetResults();
    clearError();
    state.cancelled = false;
    state.localProviderConnected = false;
    state.abortController = new AbortController();
    const runId = ++state.runId;
    setRunning(true);

    try {
        if (state.provider === WORKSHOP_PROVIDER.LOCAL) {
            showStatus('正在检查本地模型', '确认 KoboldCpp 已加载所选模型，再开始角色卡 JSON 流程。', 'brief');
            const localConnection = await probeLocalWorkshopProvider({ signal: state.abortController.signal });
            state.localProviderConnected = localConnection.connected;
            state.localProviderModel = localConnection.model;
            updateProviderStatus(`已连接：${localConnection.model}`, true);
        }
        showStatus('正在整理创作简报', 'AI 会先区分硬要求和可补全部分，避免一上来就堆设定。', 'brief');
        const selectedMode = query('[data-workshop-mode]').value;
        state.blueprint = collectCharacterBlueprint();
        const structuredPrompt = buildCharacterBlueprintPrompt({ blueprint: state.blueprint, freeform, mode: selectedMode });
        const modelSafePrompt = protectRoleMacrosForGeneration(structuredPrompt);
        const briefResponse = await generateStructured(buildBriefRequest(modelSafePrompt, selectedMode), runId);
        state.brief = normalizeCreativeBrief(briefResponse);
        if (selectedMode !== 'auto') {
            state.brief.mode = selectedMode;
            state.brief.requiresKnowledgeCheck = selectedMode === 'adaptation' || state.brief.requiresKnowledgeCheck;
        }
        ensureRunActive(runId);
        renderBrief();
        setStage('research');

        const knowledgeCheckEnabled = query('[data-workshop-knowledge-check]').checked;
        if (!knowledgeCheckEnabled) {
            state.brief.requiresKnowledgeCheck = false;
            state.brief.knowledgeQuestions = [];
        }

        if (state.brief.requiresKnowledgeCheck) {
            showStatus(`正在用${getWorkshopProviderLabel(state.provider)}核对知识`, '模型若没有联网能力，必须标出不确定项，不得虚构网址或出处。', 'research');
            const knowledgeResponse = await generateStructured(buildKnowledgeCheckRequest(state.brief), runId);
            ensureRunActive(runId);
            state.knowledgeCheck = normalizeKnowledgeCheck(knowledgeResponse);
        } else {
            state.knowledgeCheck = normalizeKnowledgeCheck({ summary: '已按创作简报跳过知识核对。' });
        }
        renderKnowledgeCheck();

        showStatus('正在创作完整角色卡', '只生成一个候选；同时附带一份可复制的头像图片提示词，但不会调用图片生成。', 'draft');
        const draftResponse = await generateStructured(buildDraftRequest(state.brief, state.knowledgeCheck, state.blueprint), runId);
        ensureRunActive(runId);
        state.draft = canonicalizeDialogueRoleLabels(draftResponse, {
            userLabel: name1,
            characterLabels: [name2],
        });
        state.avatarPrompt = normalizeAvatarPrompt(draftResponse);
        const draftReview = assessWorkshopCard(state.draft, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });

        showStatus('正在进行独立审校', 'AI 会重新检查硬事实、知识置信边界、人物一致性、用户控制权、关系节奏和头像提示词，再交付修订稿。', 'review');
        const reviewResponse = await generateStructured(buildReviewRequest(state.brief, state.draft, state.knowledgeCheck, draftReview, state.avatarPrompt, state.blueprint), runId);
        ensureRunActive(runId);
        state.finalCard = canonicalizeDialogueRoleLabels(reviewResponse.card ?? reviewResponse, {
            userLabel: name1,
            characterLabels: [name2, state.draft.data.name],
        });
        const reviewedAvatarPrompt = normalizeAvatarPrompt(reviewResponse);
        if (reviewedAvatarPrompt.positive) {
            state.avatarPrompt = reviewedAvatarPrompt;
        }
        state.modelReview = reviewResponse.review ?? {};
        state.manuallyEdited = false;
        state.localReview = assessWorkshopCard(state.finalCard, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });
        renderQuality();
        renderPreview();
        renderAvatarPrompt();
        hideStatus();
        setStage('ready', 'complete');
    } catch (error) {
        hideStatus();
        if (!state.cancelled) {
            console.error('Leslie character workshop failed', error);
            showError(error?.message || '角色创作没有完成。你的正式角色卡和聊天没有受到影响，可以修改提示词后重试。');
        }
    } finally {
        state.abortController = null;
        setRunning(false);
    }
}

async function rerunReview() {
    if (!state.finalCard || state.running || isGenerating()) {
        return;
    }
    state.provider = getSelectedProvider();
    if (state.provider === WORKSHOP_PROVIDER.LOCAL && !isLocalModelLoadingEnabled()) {
        showError('本地模型加载已关闭，请先到“设置 → 模型连接”打开开关。');
        return;
    }
    if (state.provider === WORKSHOP_PROVIDER.CHAT && (!online_status || online_status === 'no_connection')) {
        showError('当前没有连接可用模型。你仍可查看本地检查结果，或连接模型后再做 AI 深度审校。');
        return;
    }

    clearError();
    state.cancelled = false;
    state.abortController = new AbortController();
    state.localProviderConnected = false;
    const runId = ++state.runId;
    setRunning(true);
    setHidden('[data-workshop-action="review"]', true);
    setHidden('[data-workshop-action="apply"]', true);
    try {
        syncManualCardEdits();
        if (state.provider === WORKSHOP_PROVIDER.LOCAL) {
            showStatus('正在检查本地模型', '确认 KoboldCpp 仍在运行，再开始第二次审校。', 'review');
            const localConnection = await probeLocalWorkshopProvider({ signal: state.abortController.signal });
            state.localProviderConnected = localConnection.connected;
            state.localProviderModel = localConnection.model;
            updateProviderStatus(`已连接：${localConnection.model}`, true);
        }
        showStatus('正在进行第二次审校', '这次会把上一版最终稿当作待审稿，只修复问题，不扩写无关设定。', 'review');
        const currentReview = assessWorkshopCard(state.finalCard, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });
        const response = await generateStructured(buildReviewRequest(state.brief, state.finalCard, state.knowledgeCheck, currentReview, state.avatarPrompt, state.blueprint), runId);
        ensureRunActive(runId);
        state.finalCard = canonicalizeDialogueRoleLabels(response.card ?? response, {
            userLabel: name1,
            characterLabels: [name2, state.finalCard.data.name],
        });
        const reviewedAvatarPrompt = normalizeAvatarPrompt(response);
        if (reviewedAvatarPrompt.positive) {
            state.avatarPrompt = reviewedAvatarPrompt;
        }
        state.modelReview = response.review ?? {};
        state.manuallyEdited = false;
        state.localReview = assessWorkshopCard(state.finalCard, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });
        renderQuality();
        renderPreview();
        renderAvatarPrompt();
        hideStatus();
        setStage('ready', 'complete');
    } catch (error) {
        hideStatus();
        if (!state.cancelled) {
            showError(error?.message || '第二次审校没有完成，上一版草稿仍然保留。');
        }
    } finally {
        state.abortController = null;
        setRunning(false);
    }
}

function buildAuditedCard() {
    return normalizeCharacterCard(state.finalCard);
}

function showManualPage() {
    const editor = document.getElementById('rm_ch_create_block');
    if (!editor) return;
    if (!editor.querySelector('.dreamland-native-editor-header')) {
        const header = document.createElement('header');
        header.className = 'dreamland-native-editor-header';
        header.innerHTML = '<h1>角色创建与导入</h1><button type="button">返回 AI 工坊</button>';
        header.querySelector('button').addEventListener('click', () => {
            manualPage = false;
            openWorkshop();
        });
        editor.prepend(header);
    }
    presentDreamlandPage('workshop', editor);
}

function openOriginalCreateEditor() {
    if (usesDreamlandPages()) {
        state.bypassNextCreateClick = true;
        document.getElementById('rm_button_create')?.click();
        manualPage = true;
        showManualPage();
        return;
    }
    closeWorkshop();
    state.bypassNextCreateClick = true;
    const rightNavPanel = document.querySelector('#right-nav-panel');
    const rightNavDrawer = rightNavPanel?.closest('.drawer');
    const drawerIsOpen = rightNavPanel?.classList.contains('openDrawer');
    if (!drawerIsOpen) {
        rightNavDrawer?.querySelector('.drawer-toggle')?.click();
    }
    window.setTimeout(() => document.querySelector('#rm_button_create')?.click(), drawerIsOpen ? 0 : 140);
}

function applyDraft() {
    syncManualCardEdits({ refreshQuality: true });
    if (!state.finalCard || state.localReview?.blocking?.length || state.localReview?.score < 75) {
        return;
    }

    const card = buildAuditedCard();
    Object.assign(create_save, cardToCreateState(card), { avatar: state.avatarFiles });
    openOriginalCreateEditor();
    const source = state.importSource || 'AI 草稿';
    const avatarNote = state.avatarFiles ? '所选头像也已带入，可继续裁剪。' : '请补头像。';
    window.toastr?.success(`${source}已带入原角色编辑器。${avatarNote}逐项确认后再保存。`, '角色卡尚未保存');
}

function downloadDraft() {
    if (!state.finalCard) {
        return;
    }

    syncManualCardEdits({ refreshQuality: true });
    const card = buildAuditedCard();
    const safeName = card.data.name.replace(/[\\/:*?"<>|]/g, '_') || 'character-draft';
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeName}.draft.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

async function copyAvatarPrompt() {
    const text = formatAvatarPrompt(state.avatarPrompt || {});
    if (!text) {
        showError('当前草稿还没有可复制的头像提示词。');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        window.toastr?.success('已复制正向提示词、负向提示词和推荐比例。', '头像提示词已复制');
    } catch (error) {
        console.warn('Leslie character workshop clipboard write failed', error);
        showError('浏览器没有允许自动写入剪贴板。请在“手动生成头像提示词”区域中手动选择并复制。');
        query('[data-workshop-section="avatar"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function cancelWorkshopRun() {
    if (!state.running) {
        return;
    }
    state.cancelled = true;
    state.runId++;
    state.abortController?.abort();
    state.abortController = null;
    stopGeneration();
    hideStatus();
    showError('已停止本次创作。没有保存或覆盖任何角色数据。');
    setRunning(false);
}

function bindWorkshopEvents() {
    document.addEventListener('click', event => {
        const createButton = event.target instanceof Element ? event.target.closest('#rm_button_create') : null;
        if (!createButton) {
            return;
        }
        if (state.bypassNextCreateClick) {
            state.bypassNextCreateClick = false;
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        openWorkshop();
    }, true);

    overlay.addEventListener('click', event => {
        const action = event.target instanceof Element ? event.target.closest('[data-workshop-action]')?.dataset.workshopAction : '';
        if (action === 'close') closeWorkshop();
        if (action === 'manual') openOriginalCreateEditor();
        if (action === 'generate') runWorkshop();
        if (action === 'cancel') cancelWorkshopRun();
        if (action === 'review') rerunReview();
        if (action === 'apply') applyDraft();
        if (action === 'download') downloadDraft();
        if (action === 'copy-avatar') copyAvatarPrompt();
        if (action === 'choose-avatar') query('[data-workshop-avatar-file]').click();
        if (action === 'remove-avatar') clearAvatarSelection();
        if (action === 'paste-json') pasteAndInspectJson();
        if (action === 'inspect-json') inspectPastedJson();
    });

    overlay.addEventListener('input', event => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
            if (event.target.matches('[data-workshop-field]')) {
                updateBlueprintFieldState(event.target);
            }
            if (event.target.matches('[data-workshop-card-field]')) {
                syncManualCardEdits({ markEdited: true });
            }
        }
    });

    overlay.addEventListener('change', event => {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-workshop-avatar-file]')) {
            handleAvatarSelection(event.target);
            return;
        }
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
            if (event.target.matches('[data-workshop-field]')) {
                updateBlueprintFieldState(event.target);
            }
        }
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
            if (event.target.matches('[data-workshop-card-field]')) {
                syncManualCardEdits({ refreshQuality: true, markEdited: true });
            }
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !overlay.hidden && !state.running) {
            closeWorkshop();
        }
    });
}

function initializeWorkshop() {
    overlay = createWorkshopMarkup();
    document.body.append(overlay);
    registerDreamlandPage('workshop', openWorkshop);
    bindWorkshopEvents();
    setStage('brief');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWorkshop, { once: true });
} else {
    initializeWorkshop();
}
