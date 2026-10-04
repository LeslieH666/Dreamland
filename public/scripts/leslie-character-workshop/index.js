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
import { buildRehearsalScenesRequest, createRehearsalSession, validateRehearsalReply, buildRehearsalFollowupRequest, normalizeRehearsalFollowup, buildRehearsalAuditRequest, normalizeRehearsalAudit, withRehearsalExamples, preserveRehearsalExamples } from './rehearsal.js';
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
    CHARACTER_BLUEPRINT_SECTIONS,
    assessBlueprintFidelity,
    buildCharacterBlueprintPrompt,
    normalizeCharacterBlueprint,
    renderCharacterBlueprintMarkup,
} from './blueprint.js';
import { isLocalModelLoadingEnabled } from '../leslie-local-model-core.js';
import { accountStorage } from '../util/AccountStorage.js';
import { buildRandomWorkshopInput, RANDOM_FIELDS, readRandomPreferences, saveRandomPreferences } from './random.js';
import { createWorkshopNameHistory, generateUniqueWorkshopBrief, withChosenWorkshopName, assertChosenWorkshopName } from './names.js';
import { initializeBlueprintSteps } from './blueprint-steps.js';
import { toggleAppearanceChoice, syncAppearanceChoices } from './appearance.js';
import { buildRevisionRequest, prepareRevision, assertRevisionCurrent } from './revision.js';

const workshopNameHistory = createWorkshopNameHistory();

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
    rehearsal: null,
    avatarFiles: null,
    avatarPreviewUrl: '',
    chosenName: '',
    revisionProposal: null,
};

let overlay;
let blueprintSteps;

function createRandomControls() {
    const controls = document.createElement('div');
    controls.className = 'leslie-workshop-random';
    controls.innerHTML = '<button type="button" data-workshop-action="random" class="leslie-random-card" title="随机角色卡" aria-label="随机生成角色卡"><img src="/img/blue-archive/bundled/Event_Icon_CardShop.png" alt=""></button><button type="button" data-workshop-action="random-preferences" class="leslie-random-options" title="角色偏好 / XP" aria-label="设置随机角色偏好"><img src="/img/blue-archive/bundled/Event_Icon_MinigameOption.png" alt=""></button>';
    const panel = document.createElement('section');
    panel.className = 'leslie-random-preferences';
    panel.hidden = true;
    panel.setAttribute('aria-label', '随机角色偏好 / XP');
    panel.innerHTML = '<header><strong>角色偏好 / XP</strong><button type="button" data-workshop-action="random-preferences-close" aria-label="关闭偏好">×</button></header><p>选择的内容必须保留，其余随机构思。与下方创作表单独立。</p><div class="leslie-random-fields"></div><label>必须包含<textarea data-random-include maxlength="1200" rows="2"></textarea></label><label>排除内容<textarea data-random-exclude maxlength="1200" rows="2"></textarea></label><footer><button type="button" data-workshop-action="random-preferences-reset">恢复默认</button><button type="button" data-workshop-action="random-preferences-save">保存偏好</button></footer>';
    for (const field of RANDOM_FIELDS) {
        const label = document.createElement('label');
        label.textContent = field.label;
        const input = document.createElement(field.options ? 'select' : 'input');
        input.dataset.randomField = field.key;
        if (field.options) {
            input.add(new Option('不限，随机构思', ''));
            for (const option of field.options) input.add(new Option(option, option));
        } else { input.maxLength = 300; input.placeholder = '不限，随机构思'; }
        label.append(input);
        panel.querySelector('.leslie-random-fields').append(label);
    }
    overlay.querySelector('.leslie-character-workshop-panel').append(controls, panel);
}

function openRandomPreferences() {
    const preferences = readRandomPreferences(accountStorage);
    overlay.querySelectorAll('[data-random-field]').forEach(input => { input.value = preferences.fields[input.dataset.randomField] || ''; });
    query('[data-random-include]').value = preferences.mustInclude;
    query('[data-random-exclude]').value = preferences.exclude;
    query('.leslie-random-preferences').hidden = false;
    query('[data-random-field]').focus();
}

function saveRandomControls(reset = false) {
    const fields = Object.fromEntries([...overlay.querySelectorAll('[data-random-field]')].map(input => [input.dataset.randomField, input.value]));
    saveRandomPreferences(accountStorage, reset ? {} : { version: 1, fields, mustInclude: query('[data-random-include]').value, exclude: query('[data-random-exclude]').value });
    query('.leslie-random-preferences').hidden = true;
    query('[data-workshop-action="random"]').focus();
}

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

                    <section class="leslie-character-workshop-result" data-workshop-section="rehearsal" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>演</span><div><h3>你来演这个角色</h3><p>AI 当玩家，你写角色的回应。三组各聊两轮；你的原话会保留在终版示例里。</p></div></div></div>
                        <div data-workshop-rehearsal></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="quality" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>04</span><div><h3>质量审校</h3><p>模型复审与本地硬规则同时通过，才会进入最终预览。</p></div></div></div>
                        <div data-workshop-quality></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="preview" hidden>
                        <div class="leslie-character-workshop-section-heading"><div><span>05</span><div><h3 data-workshop-card-name>角色卡编辑与确认</h3><p>这是 AI 完成的第一版。你可以直接修改任意字段；修改后不会再让 AI 介入。</p></div></div></div>
                        <div class="leslie-character-workshop-preview" data-workshop-preview></div>
                    </section>

                    <section class="leslie-character-workshop-result" data-workshop-section="revision" hidden>
                        <details class="leslie-workshop-revision">
                            <summary>局部修改 · 外貌 / 图片提示词</summary>
                            <p>先生成修改方案，确认后才更新草稿。外貌只替换角色描述中的对应片段，其他角色字段保留。</p>
                            <label>修改范围<select data-revision-scope><option value="appearance">外貌与图片提示词</option><option value="avatar">仅图片提示词</option></select></label>
                            <label>想怎么改<textarea data-revision-instruction rows="3" maxlength="2000" placeholder="例如：把黑色短发改成银白长发，衣服换成深蓝外套；其他设定不动。"></textarea></label>
                            <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="propose-revision" title="仅生成所选范围的修改方案，查看前后差异后再决定是否应用">生成局部修改方案</button>
                            <div data-revision-proposal hidden></div>
                            <div class="leslie-workshop-revision-actions" data-revision-confirm hidden>
                                <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="accept-revision">应用这次局部修改</button>
                                <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="reject-revision">撤回方案，保留原稿</button>
                            </div>
                        </details>
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
                    <button type="button" class="leslie-character-workshop-button is-danger" data-workshop-action="discard" title="放弃当前未保存草稿，清空填写内容并重新开始">放弃并清空</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="manual">改用手动创建</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="download" hidden>下载 JSON 草稿</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="copy-avatar" hidden>复制头像提示词</button>
                    <button type="button" class="leslie-character-workshop-button is-quiet" data-workshop-action="review" hidden>可选：让 AI 再审校</button>
                    <button type="button" class="leslie-character-workshop-button is-danger" data-workshop-action="cancel" hidden>停止创作</button>
                    <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="generate">全自动创作</button>
                    <button type="button" class="leslie-character-workshop-button is-primary" data-workshop-action="rehearse">先试演三个场景</button>
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
    const review = assessCharacterCard(card, { ...context, requireWorkshopExamples: !state.manuallyEdited && Boolean(context.brief) });
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
    const rehearsing = Boolean(state.rehearsal && !state.finalCard);
    overlay.querySelectorAll('[data-workshop-action^="random"]').forEach(button => { button.disabled = running || rehearsing; });
    query('[data-workshop-action="random"]').setAttribute('aria-busy', String(running));
    query('[data-workshop-action="generate"]').hidden = running || rehearsing || Boolean(state.finalCard);
    query('[data-workshop-action="rehearse"]').hidden = running || rehearsing || Boolean(state.finalCard);
    overlay.querySelectorAll('[data-rehearsal-action], [data-rehearsal-reply]').forEach(control => { control.disabled = running; });
    query('[data-workshop-action="cancel"]').hidden = !running;
    query('[data-workshop-action="manual"]').disabled = running;
    query('[data-workshop-action="close"]').disabled = running;
    query('[data-workshop-prompt]').disabled = running || rehearsing;
    query('[data-workshop-mode]').disabled = running || rehearsing;
    query('[data-workshop-provider]').disabled = running || rehearsing;
    query('[data-workshop-knowledge-check]').disabled = running || rehearsing;
    overlay.querySelectorAll('[data-workshop-field]').forEach(field => {
        field.disabled = running || rehearsing;
    });
    overlay.querySelectorAll('[data-blueprint-complete]').forEach(button => { button.disabled = running || rehearsing; });
    overlay.querySelectorAll('[data-appearance-choice], [data-revision-scope], [data-revision-instruction], [data-workshop-card-field], [data-avatar-field], [data-workshop-action$="revision"]').forEach(control => { control.disabled = running || rehearsing; });
    overlay.querySelectorAll('[data-blueprint-section] > summary').forEach(summary => { summary.setAttribute('aria-disabled', String(running || rehearsing)); });
    query('[data-workshop-import-json]').disabled = running || rehearsing;
    query('[data-workshop-action="paste-json"]').disabled = running || rehearsing;
    query('[data-workshop-action="inspect-json"]').disabled = running || rehearsing;
}

function resetResults() {
    state.chosenName = '';
    state.revisionProposal = null;
    query('[data-revision-instruction]').value = '';
    setHidden('[data-revision-proposal]', true);
    setHidden('[data-revision-confirm]', true);
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
    state.rehearsal = null;
    ['brief', 'knowledge', 'rehearsal', 'quality', 'preview', 'revision', 'avatar'].forEach(section => setHidden(`[data-workshop-section="${section}"]`, true));
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
    saveRehearsalReplies();
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
        ['正向提示词（可直接修改）', avatarPrompt.positive, 'positive'],
        ['负向提示词（可直接修改）', avatarPrompt.negative, 'negative'],
    ];
    for (const [label, value, key] of fields) {
        const block = document.createElement('div');
        block.className = 'leslie-character-workshop-avatar-field';
        const heading = document.createElement('strong');
        heading.textContent = label;
        const content = document.createElement('textarea');
        content.value = value;
        content.dataset.avatarField = key;
        content.setAttribute('aria-label', label);
        content.rows = 4;
        content.maxLength = key === 'positive' ? 2400 : 1200;
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
    if (state.chosenName && state.finalCard.data.name !== state.chosenName) {
        // A human rename becomes authoritative, including on subsequent review.
        state.chosenName = state.finalCard.data.name;
        workshopNameHistory.remember(state.chosenName);
    }
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
    setHidden('[data-workshop-section="revision"]', false);
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

async function runWorkshop(randomInput = null, rehearse = false) {
    if (state.running || (state.rehearsal && !state.finalCard)) return;
    const freeform = randomInput?.freeform ?? query('[data-workshop-prompt]').value.trim();
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
        const selectedMode = randomInput?.mode ?? query('[data-workshop-mode]').value;
        state.blueprint = randomInput?.blueprint ?? collectCharacterBlueprint();
        const structuredPrompt = buildCharacterBlueprintPrompt({ blueprint: state.blueprint, freeform, mode: selectedMode });
        const modelSafePrompt = protectRoleMacrosForGeneration(structuredPrompt);
        const namedBrief = await generateUniqueWorkshopBrief({
            request: buildBriefRequest(modelSafePrompt, selectedMode), mode: selectedMode, blueprint: state.blueprint,
            history: workshopNameHistory, generate: request => generateStructured(request, runId),
            ensureActive: () => ensureRunActive(runId),
            onRetry: () => showStatus('这个名字刚用过，正在换一个', 'AI 会重新取名，再继续写角色卡。', 'brief'),
        });
        state.brief = namedBrief.brief;
        state.chosenName = namedBrief.chosenName;
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

        if (rehearse) {
            showStatus('正在准备三个试演场景', 'AI 只出玩家台词，角色怎么说由你决定。', 'draft');
            state.rehearsal = createRehearsalSession(await generateStructured(buildRehearsalScenesRequest(state.brief, state.blueprint, state.knowledgeCheck), runId));
            renderRehearsal();
            hideStatus();
            query('[data-workshop-section="rehearsal"]').scrollIntoView({ block: 'start' });
            return;
        }
        await createWorkshopCard(runId, Boolean(randomInput));
    } catch (error) {
        if (runId === state.runId && !state.cancelled) {
            hideStatus();
            console.error('Leslie character workshop failed', error);
            showError(error?.message || '角色创作没有完成。你的正式角色卡和聊天没有受到影响，可以修改提示词后重试。');
        }
    } finally {
        if (runId === state.runId) {
            state.abortController = null;
            setRunning(false);
        }
    }
}

async function createWorkshopCard(runId, scrollToPreview = false) {
    showStatus('正在创作完整角色卡', '只生成一个候选；同时附带一份可复制的头像图片提示词，但不会调用图片生成。', 'draft');
    const draftResponse = await generateStructured(withChosenWorkshopName(withRehearsalExamples(buildDraftRequest(state.brief, state.knowledgeCheck, state.blueprint), state.rehearsal), state.chosenName), runId);
    ensureRunActive(runId);
    state.draft = canonicalizeDialogueRoleLabels(draftResponse, {
        userLabel: name1,
        characterLabels: [name2],
    });
    state.draft = preserveRehearsalExamples(state.draft, state.rehearsal);
    assertChosenWorkshopName(state.draft, state.chosenName);
    state.avatarPrompt = normalizeAvatarPrompt(draftResponse);
    const draftReview = assessWorkshopCard(state.draft, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });

    showStatus('正在进行独立审校', 'AI 会重新检查硬事实、知识置信边界、人物一致性、用户控制权、关系节奏和头像提示词，再交付修订稿。', 'review');
    const reviewResponse = await generateStructured(withChosenWorkshopName(withRehearsalExamples(buildReviewRequest(state.brief, state.draft, state.knowledgeCheck, draftReview, state.avatarPrompt, state.blueprint), state.rehearsal), state.chosenName), runId);
    ensureRunActive(runId);
    assertChosenWorkshopName(normalizeCharacterCard(reviewResponse.card ?? reviewResponse), state.chosenName);
    state.finalCard = canonicalizeDialogueRoleLabels(reviewResponse.card ?? reviewResponse, {
        userLabel: name1,
        characterLabels: [name2, state.draft.data.name],
    });
    state.finalCard = preserveRehearsalExamples(state.finalCard, state.rehearsal);
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
    if (scrollToPreview) query('[data-workshop-section="preview"]').scrollIntoView({ block: 'start' });
}

function clearRevisionProposal() {
    state.revisionProposal = null;
    setHidden('[data-revision-proposal]', true);
    setHidden('[data-revision-confirm]', true);
}

async function proposeRevision() {
    if (!state.finalCard || state.running || isGenerating()) return;
    const instruction = query('[data-revision-instruction]').value.trim();
    if (!instruction) { showError('先写下你想改的外貌或图片提示词。'); return; }
    state.provider = getSelectedProvider();
    if (state.provider === WORKSHOP_PROVIDER.LOCAL && !isLocalModelLoadingEnabled()) { showError('请先打开本地模型加载开关。'); return; }
    if (state.provider === WORKSHOP_PROVIDER.CHAT && (!online_status || online_status === 'no_connection')) { showError('请先连接当前聊天模型。原草稿仍然保留。'); return; }
    syncManualCardEdits();
    clearRevisionProposal();
    clearError();
    state.cancelled = false;
    state.abortController = new AbortController();
    const runId = ++state.runId;
    setRunning(true);
    try {
        if (state.provider === WORKSHOP_PROVIDER.LOCAL) {
            const connection = await probeLocalWorkshopProvider({ signal: state.abortController.signal });
            state.localProviderModel = connection.model;
        }
        showStatus('正在生成局部修改方案', '原草稿保留，确认方案后才更新。', 'review');
        const scope = query('[data-revision-scope]').value;
        const base = structuredClone(state.finalCard);
        const avatar = structuredClone(state.avatarPrompt ?? {});
        const blueprint = structuredClone(state.blueprint);
        const response = await generateStructured(buildRevisionRequest(base, avatar, blueprint, scope, instruction), runId);
        ensureRunActive(runId);
        const proposal = prepareRevision(base, avatar, blueprint, scope, response);
        assertRevisionCurrent(proposal, state.finalCard, state.avatarPrompt ?? {}, state.blueprint);
        state.revisionProposal = proposal;
        const container = query('[data-revision-proposal]');
        container.replaceChildren();
        appendTextList(container, '外貌片段：修改前 → 修改后', proposal.patches.map(patch => `${patch.old}\n→ ${patch.new}`), '角色描述保持原样。');
        appendTextList(container, '图片提示词：修改前 → 修改后', [`正向：${avatar.positive ?? ''}\n→ ${proposal.avatar.positive}`, `负向：${avatar.negative ?? ''}\n→ ${proposal.avatar.negative}`, `比例：${avatar.aspectRatio ?? '2:3'} → ${proposal.avatar.aspectRatio}`]);
        const labels = CHARACTER_BLUEPRINT_SECTIONS.find(section => section.id === 'appearance').fields;
        appendTextList(container, '同步到外貌表单', Object.entries(proposal.fields).map(([key, value]) => `${labels.find(field => field.key === key).label}：${value}`), '外貌表单保持原样。');
        setHidden('[data-revision-proposal]', false);
        setHidden('[data-revision-confirm]', false);
        container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        hideStatus();
    } catch (error) {
        if (runId === state.runId && !state.cancelled) { hideStatus(); showError(error.message || '局部修改失败，原草稿仍然保留。'); }
    } finally {
        if (runId === state.runId) { state.abortController = null; setRunning(false); }
    }
}

function acceptRevision() {
    if (!state.revisionProposal || state.running) return;
    try {
        assertRevisionCurrent(state.revisionProposal, state.finalCard, state.avatarPrompt ?? {}, state.blueprint);
        const proposal = state.revisionProposal;
        state.finalCard = proposal.card;
        state.avatarPrompt = proposal.avatar;
        for (const [key, value] of Object.entries(proposal.fields)) {
            if (value) state.blueprint.fields[key] = value;
            else delete state.blueprint.fields[key];
            const control = query(`[data-workshop-field="${key}"]`);
            control.value = value;
            control.dispatchEvent(new Event('input', { bubbles: true }));
        }
        clearRevisionProposal();
        state.manuallyEdited = true;
        state.modelReview = { summary: '局部修改已应用，其他角色字段保持原样。' };
        state.localReview = assessWorkshopCard(state.finalCard, { brief: state.brief, knowledgeCheck: state.knowledgeCheck });
        renderQuality(); renderPreview(); renderAvatarPrompt(); clearError();
    } catch (error) { showError(error.message); }
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
        const response = await generateStructured(withChosenWorkshopName(withRehearsalExamples(buildReviewRequest(state.brief, state.finalCard, state.knowledgeCheck, currentReview, state.avatarPrompt, state.blueprint), state.rehearsal), state.chosenName), runId);
        ensureRunActive(runId);
        assertChosenWorkshopName(normalizeCharacterCard(response.card ?? response), state.chosenName);
        state.finalCard = canonicalizeDialogueRoleLabels(response.card ?? response, {
            userLabel: name1,
            characterLabels: [name2, state.finalCard.data.name],
        });
        state.finalCard = preserveRehearsalExamples(state.finalCard, state.rehearsal);
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
        if (runId === state.runId && !state.cancelled) {
            hideStatus();
            showError(error?.message || '第二次审校没有完成，上一版草稿仍然保留。');
        }
    } finally {
        if (runId === state.runId) {
            state.abortController = null;
            setRunning(false);
        }
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

function discardWorkshopDraft() {
    // Invalidate late model responses before clearing any UI or state.
    if (state.running) cancelWorkshopRun();
    else state.runId++;
    state.cancelled = true;
    resetResults();
    overlay.querySelectorAll('[data-workshop-field]').forEach(control => {
        control.value = '';
        updateBlueprintFieldState(control);
    });
    query('[data-workshop-prompt]').value = '';
    query('[data-workshop-import-json]').value = '';
    query('[data-workshop-mode]').value = 'auto';
    query('[data-workshop-knowledge-check]').checked = true;
    blueprintSteps.reset();
    syncAppearanceChoices(overlay);
    query('[data-workshop-footer-note]').textContent = '已清空，可以重新填写或直接生成。';
    hideStatus();
    clearError();
    setRunning(false);
    query('.leslie-character-workshop-main').scrollTo({ top: 0 });
    query('[data-workshop-field="name"]').focus({ preventScroll: true });
}

function saveRehearsalReplies() {
    const session = state.rehearsal;
    if (!session || state.finalCard) return;
    const scene = session.scenes[session.index];
    const first = query('[data-rehearsal-reply="0"]')?.value ?? scene.replies[0];
    const second = query('[data-rehearsal-reply="1"]')?.value ?? scene.replies[1];
    if (first === scene.replies[0] && second === scene.replies[1]) return;
    if (first !== scene.replies[0]) {
        scene.replies = [first, ''];
        scene.followup = '';
    } else {
        scene.replies[1] = second;
    }
    session.audit = null;
    session.confirmed = false;
}

function renderRehearsal() {
    const session = state.rehearsal;
    if (!session) return;
    const container = query('[data-workshop-rehearsal]');
    container.replaceChildren();
    setHidden('[data-workshop-section="rehearsal"]', false);
    const add = (tag, text, className = '') => {
        const element = document.createElement(tag);
        element.textContent = text;
        if (className) element.className = className;
        container.append(element);
        return element;
    };
    const button = (text, action, title, parent = container) => {
        const element = add('button', text, 'leslie-character-workshop-button is-quiet');
        element.type = 'button';
        element.dataset.rehearsalAction = action;
        element.title = title;
        parent.append(element);
        return element;
    };
    if (state.finalCard) {
        add('p', '试演原话已带入下方示例。你可以在角色卡编辑区继续修改。');
        return;
    }
    add('p', '你写角色，AI 写玩家。可以随时关闭页面暂停，回来继续；刷新页面会丢失未保存的试演。');
    const navigation = add('div', '', 'leslie-rehearsal-scenes');
    navigation.setAttribute('aria-label', '切换试演场景');
    session.scenes.forEach((scene, index) => {
        const nav = document.createElement('button');
        nav.type = 'button';
        nav.className = 'leslie-rehearsal-scene';
        nav.dataset.rehearsalAction = 'scene';
        nav.dataset.rehearsalScene = String(index);
        nav.textContent = `${index + 1}. ${scene.title}${scene.replies[1]?.trim() ? ' ✓' : ''}`;
        nav.title = `切换到第 ${index + 1} 组：${scene.title}。已写的台词会保留；✓ 表示本组两句已填写。`;
        nav.setAttribute('aria-pressed', String(index === session.index));
        navigation.append(nav);
    });
    const scene = session.scenes[session.index];
    add('h4', scene.title);
    add('p', scene.setting, 'leslie-rehearsal-setting');
    for (let turn = 0; turn < (scene.followup ? 2 : 1); turn++) {
        add('p', `玩家：${turn ? scene.followup : scene.playerLine}`, 'leslie-rehearsal-player');
        const label = add('label', `角色的第 ${turn + 1} 句`);
        const input = document.createElement('textarea');
        input.dataset.rehearsalReply = String(turn);
        input.rows = 3;
        input.maxLength = 1200;
        input.placeholder = '写这个角色当场会说的话……';
        input.value = scene.replies[turn];
        label.append(input);
    }
    add('small', '改第一句会重新生成玩家接话，第二句需要重写；其他场景的原话仍保留。');
    const canFinish = session.ready || (session.index === session.scenes.length - 1 && scene.followup)
        || session.scenes.every(item => item.followup && item.replies.every(text => text.trim()));
    if (canFinish) {
        if (session.audit) {
            add('h4', 'AI 从你的原话里看到的说话习惯');
            if (!session.audit.habits.length) add('p', '没有可靠的总结，仍直接以你的原话为准。');
            for (const habit of session.audit.habits) add('p', `${habit.habit}（第 ${habit.scene + 1} 组：「${habit.quote}」）`);
            for (const conflict of session.audit.conflicts) add('p', `第 ${conflict.scene + 1} 组第 ${conflict.turn + 1} 句：${conflict.message}；锁定设定：「${conflict.fact}」`, 'leslie-rehearsal-conflict');
            if (session.audit.conflicts.length) {
                add('p', '可以点击上方场景重写台词，或返回修改人设。若 AI 判断有误，也可以明确保留原话；锁定事实不会因此被改写。');
            }
        }
    }
    add('p', canFinish ? '写完后点黄色按钮，保留试演原话生成角色卡。分析人设冲突是可选操作。' : '先写角色的回应，再点蓝色按钮继续。每组聊两轮。', 'leslie-rehearsal-next-hint');
    const actions = add('div', '', 'leslie-rehearsal-actions');
    const primary = button(canFinish ? '用试演原话生成角色卡' : scene.followup ? '下一组场景' : '让 AI 接下一句',
        canFinish ? 'confirm' : scene.followup ? 'next' : 'followup',
        canFinish ? '保留你写的所有有效台词，生成并审校角色卡，不要求先做分析。若已有冲突提示，点击代表选择保留原话；锁定设定仍须保留。'
            : scene.followup ? '保存本组两句角色台词，进入下一组场景。' : '保存你写的第一句，让 AI 只扮演玩家接话，再由你写角色的第二句。', actions);
    primary.classList.add('is-primary');
    if (canFinish) primary.classList.add('is-finish');
    const more = document.createElement('details');
    more.className = 'leslie-rehearsal-more';
    const summary = document.createElement('summary');
    summary.className = 'leslie-character-workshop-button is-quiet';
    summary.textContent = '更多操作 ▾';
    summary.title = '展开跳过、换场景、可选分析及放弃试演等操作。正常完成试演只需主按钮。';
    more.append(summary);
    actions.append(more);
    const tools = document.createElement('div');
    tools.className = 'leslie-rehearsal-tools';
    more.append(tools);
    button('跳过本组', 'skip', session.index === session.scenes.length - 1 ? '保留已经写下的台词，跳过本组未写完的部分，进入生成准备。' : '保留本组已经写下的台词，继续下一组；不要求补完这组。', tools);
    button('重新出本组场景', 'replace', '清空本组的台词并重新出题，其他两组的原话保留。', tools);
    if (canFinish) button('分析口吻与人设冲突（可选）', 'audit', '只总结原话中的说话习惯并提示可能的人设冲突，不生成角色卡，也不改写你的台词。', tools).classList.add('is-primary');
    button('返回修改人设', 'back', '结束这次试演，保留人设表单。修改后需要重新开始试演，当前试演台词会清除。', tools);
    button('舍弃试演，交给 AI 重写', 'automatic', '放弃全部人工试演台词，按当前人设由 AI 自动生成角色卡及新的对话示例。', tools).classList.add('is-danger');
    query('[data-workshop-section="rehearsal"]').scrollIntoView({ block: 'start' });
}

async function handleRehearsalAction(button) {
    saveRehearsalReplies();
    const session = state.rehearsal;
    if (!session || state.finalCard || state.running) return;
    const action = button.dataset.rehearsalAction;
    if (action === 'scene') {
        session.index = Number(button.dataset.rehearsalScene);
        renderRehearsal();
        return;
    }
    if (action === 'back') {
        state.rehearsal = null;
        setHidden('[data-workshop-section="rehearsal"]', true);
        setRunning(false);
        query('[data-workshop-blueprint]').scrollIntoView({ block: 'start' });
        return;
    }
    if (action === 'next' || action === 'skip') {
        try {
            const scene = session.scenes[session.index];
            if (action === 'next') {
                validateRehearsalReply(scene.replies[0]);
                validateRehearsalReply(scene.replies[1]);
                if (!scene.followup) throw new Error('先让 AI 接第二句，再写角色回应。');
            }
            session.ready = session.index === 2;
            if (!session.ready) session.index++;
            clearError();
            renderRehearsal();
        } catch (error) { renderRehearsal(); showError(error.message); }
        return;
    }
    if (isGenerating()) { showError('当前正在生成聊天回复，请先停止回复再继续试演。'); return; }
    clearError();
    state.cancelled = false;
    state.abortController = new AbortController();
    const runId = ++state.runId;
    setRunning(true);
    try {
        const scene = session.scenes[session.index];
        if ((action === 'confirm' || action === 'audit') && !session.ready) {
            validateRehearsalReply(scene.replies[0]);
            validateRehearsalReply(scene.replies[1]);
            if (!scene.followup) throw new Error('先让 AI 接下一句，再写角色的第二句。');
            session.ready = true;
        }
        if (action === 'followup') {
            validateRehearsalReply(scene.replies[0]);
            showStatus('AI 正在接话', '只生成玩家下一句，角色回应由你写。', 'draft');
            scene.followup = normalizeRehearsalFollowup(await generateStructured(buildRehearsalFollowupRequest(state.brief, state.blueprint, scene), runId));
        } else if (action === 'replace') {
            showStatus('正在换场景', '其他场景的原话仍然保留。', 'draft');
            const replacement = createRehearsalSession(await generateStructured(buildRehearsalScenesRequest(state.brief, state.blueprint, state.knowledgeCheck), runId));
            const newScene = replacement.scenes[session.index];
            session.scenes[session.index] = newScene;
            session.ready = false;
            session.audit = null;
        } else if (action === 'audit') {
            showStatus('正在核对你的试演', '只总结有原话依据的习惯，不改写台词。', 'draft');
            session.audit = normalizeRehearsalAudit(await generateStructured(buildRehearsalAuditRequest(state.brief, state.blueprint, session), runId), session, state.brief, state.blueprint);
        } else if (action === 'confirm' || action === 'automatic') {
            if (action === 'automatic') state.rehearsal = null;
            else {
                for (const item of session.scenes) for (const text of item.replies) {
                    if (text.trim()) validateRehearsalReply(text);
                }
                session.confirmed = true;
            }
            await createWorkshopCard(runId, true);
        }
        ensureRunActive(runId);
        hideStatus();
        if (state.rehearsal) renderRehearsal();
    } catch (error) {
        if (runId === state.runId && !state.cancelled) {
            hideStatus();
            showError(error?.message || '试演没有完成，已经写下的原话仍保留，可以重试或直接生成。');
        }
    } finally {
        if (runId === state.runId) {
            state.abortController = null;
            setRunning(false);
        }
    }
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
        const choice = event.target instanceof Element ? event.target.closest('[data-appearance-choice]') : null;
        if (choice && !state.running && !(state.rehearsal && !state.finalCard)) {
            const field = query(`[data-workshop-field="${choice.dataset.appearanceField}"]`);
            const value = toggleAppearanceChoice(field.value, choice.dataset.appearanceField, Number(choice.dataset.appearanceGroup), choice.dataset.appearanceChoice);
            if (value.length > field.maxLength) { showError('描述已经很长了，请先删减一些再添加选项。'); return; }
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const action = event.target instanceof Element ? event.target.closest('[data-workshop-action]')?.dataset.workshopAction : '';
        if (action === 'close') closeWorkshop();
        if (action === 'manual') openOriginalCreateEditor();
        if (action === 'generate') runWorkshop();
        if (action === 'rehearse') runWorkshop(null, true);
        const rehearsalButton = event.target instanceof Element ? event.target.closest('[data-rehearsal-action]') : null;
        if (rehearsalButton && !state.running) handleRehearsalAction(rehearsalButton);
        if (action === 'random') {
            query('.leslie-random-preferences').hidden = true;
            runWorkshop(buildRandomWorkshopInput(readRandomPreferences(accountStorage), crypto.randomUUID()));
        }
        if (action === 'random-preferences') openRandomPreferences();
        if (action === 'random-preferences-close') {
            query('.leslie-random-preferences').hidden = true;
            query('[data-workshop-action="random"]').focus();
        }
        if (action === 'random-preferences-save') saveRandomControls();
        if (action === 'random-preferences-reset') saveRandomControls(true);
        if (action === 'cancel') cancelWorkshopRun();
        if (action === 'discard') discardWorkshopDraft();
        if (action === 'review') rerunReview();
        if (action === 'propose-revision') proposeRevision();
        if (action === 'accept-revision') acceptRevision();
        if (action === 'reject-revision') clearRevisionProposal();
        if (action === 'apply') applyDraft();
        if (action === 'download') downloadDraft();
        if (action === 'copy-avatar') copyAvatarPrompt();
        if (action === 'choose-avatar') query('[data-workshop-avatar-file]').click();
        if (action === 'remove-avatar') clearAvatarSelection();
        if (action === 'paste-json') pasteAndInspectJson();
        if (action === 'inspect-json') inspectPastedJson();
    });

    overlay.addEventListener('input', event => {
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-avatar-field]')) {
            state.avatarPrompt = { ...normalizeAvatarPrompt(state.avatarPrompt ?? {}), [event.target.dataset.avatarField]: event.target.value };
            clearRevisionProposal();
            setHidden('[data-workshop-action="copy-avatar"]', !state.avatarPrompt.positive.trim());
        }
        if (event.target instanceof Element && event.target.matches('[data-workshop-field], [data-revision-instruction]')) {
            clearRevisionProposal();
            syncAppearanceChoices(overlay);
        }
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
            if (event.target.matches('[data-workshop-field]')) {
                updateBlueprintFieldState(event.target);
            }
            if (event.target.matches('[data-workshop-card-field]')) {
                clearRevisionProposal();
                if (event.target.dataset.workshopCardField === 'mes_example') state.rehearsal = null;
                syncManualCardEdits({ markEdited: true });
            }
        }
    });

    overlay.addEventListener('change', event => {
        if (event.target instanceof Element && event.target.matches('[data-revision-scope], [data-workshop-field]')) clearRevisionProposal();
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
            if (!query('.leslie-random-preferences').hidden) {
                query('.leslie-random-preferences').hidden = true;
                query('[data-workshop-action="random"]').focus();
                return;
            }
            closeWorkshop();
        }
    });
}

function initializeWorkshop() {
    overlay = createWorkshopMarkup();
    createRandomControls();
    document.body.append(overlay);
    blueprintSteps = initializeBlueprintSteps(overlay, { isLocked: () => state.running || Boolean(state.rehearsal && !state.finalCard) });
    registerDreamlandPage('workshop', openWorkshop);
    bindWorkshopEvents();
    setStage('brief');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWorkshop, { once: true });
} else {
    initializeWorkshop();
}
