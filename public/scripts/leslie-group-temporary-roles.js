import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from './popup.js';
import { uuidv4 } from './utils.js';
import {
    MAX_TEMPORARY_ROLES,
    TEMPORARY_ROLE_STATES,
    createTemporaryRole,
    getTemporaryRoleMetadata,
} from './leslie-group-temporary-roles-core.js';

export * from './leslie-group-temporary-roles-core.js';

const CONTROL_ID = 'leslie_group_temporary_roles';

const STATE_LABELS = Object.freeze({
    [TEMPORARY_ROLE_STATES.ACTIVE]: '活跃',
    [TEMPORARY_ROLE_STATES.DORMANT]: '休眠',
    [TEMPORARY_ROLE_STATES.ARCHIVED]: '已归档',
});

function createField(labelText, input) {
    const label = document.createElement('label');
    label.className = 'flex-container flexFlowColumn flexGap5';
    label.style.marginBottom = '10px';

    const labelCaption = document.createElement('span');
    labelCaption.textContent = labelText;
    label.append(labelCaption, input);
    return label;
}

function createTextInput(name, placeholder, maximumLength, multiline = false) {
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.className = 'text_pole wide100p';
    input.name = name;
    input.placeholder = placeholder;
    input.maxLength = maximumLength;
    if (multiline) {
        input.rows = 3;
    }
    return input;
}

function createActionButton(label, action, roleId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button menu_button_icon';
    button.dataset.tempRoleAction = action;
    button.dataset.tempRoleId = roleId;
    button.textContent = label;
    return button;
}

export function mountTemporaryRoleControls() {
    if (document.getElementById(CONTROL_ID) || !document.getElementById('rm_group_top_bar')) {
        return;
    }

    const controls = document.createElement('div');
    controls.id = CONTROL_ID;
    controls.className = 'wide100p flex-container flexFlowColumn flexGap5 marginTopBot5';
    controls.style.display = 'none';

    const heading = document.createElement('div');
    heading.className = 'flex-container flexWrap alignitemscenter flexGap10';

    const title = document.createElement('strong');
    title.textContent = '当前会话临时角色';

    const createButton = document.createElement('button');
    createButton.id = 'leslie_group_temp_role_create';
    createButton.type = 'button';
    createButton.className = 'menu_button menu_button_icon';
    createButton.textContent = '新建临时角色';

    const proposeButton = document.createElement('button');
    proposeButton.id = 'leslie_group_temp_role_ai_propose';
    proposeButton.type = 'button';
    proposeButton.className = 'menu_button menu_button_icon';
    proposeButton.textContent = 'AI 提议角色';

    const archiveButton = document.createElement('button');
    archiveButton.id = 'leslie_group_temp_role_ai_archive';
    archiveButton.type = 'button';
    archiveButton.className = 'menu_button menu_button_icon';
    archiveButton.textContent = '检查角色退场';

    const note = document.createElement('small');
    note.textContent = '仅保存在当前群聊 JSONL 中，不会进入角色库；AI 只能提出草案，创建与归档都需要确认。';

    const automation = document.createElement('div');
    automation.className = 'wide100p flex-container flexWrap alignitemscenter flexGap10';
    automation.innerHTML = `
        <label class="checkbox_label whitespacenowrap">
            <input id="leslie_group_temp_role_auto_proposal" type="checkbox">
            <span>自动建议新角色</span>
        </label>
        <label class="checkbox_label whitespacenowrap">
            <input id="leslie_group_temp_role_auto_archive" type="checkbox">
            <span>自动建议退场</span>
        </label>
        <label class="flex-container alignitemscenter flexGap5 whitespacenowrap">
            <span>每</span>
            <input id="leslie_group_temp_role_review_interval" class="text_pole textarea_compact widthUnset" type="number" min="4" max="40" step="1" value="8">
            <span>条消息审查</span>
        </label>
    `;

    const list = document.createElement('div');
    list.id = 'leslie_group_temp_role_list';
    list.className = 'wide100p flex-container flexFlowColumn flexGap5';

    heading.append(title, createButton, proposeButton, archiveButton);
    controls.append(heading, note, automation, list);

    const anchor = document.getElementById('leslie_group_orchestrator_controls') ?? document.getElementById('rm_group_top_bar');
    anchor.insertAdjacentElement('afterend', controls);
}

export function renderTemporaryRoleControls(chatMetadata, { visible = false } = {}) {
    mountTemporaryRoleControls();
    const controls = document.getElementById(CONTROL_ID);
    const list = document.getElementById('leslie_group_temp_role_list');
    if (!controls || !list) {
        return;
    }

    controls.style.display = visible ? '' : 'none';
    list.replaceChildren();
    if (!visible) {
        return;
    }

    const metadata = getTemporaryRoleMetadata(chatMetadata);
    $('#leslie_group_temp_role_auto_proposal').prop('checked', metadata.automation.proposal_enabled);
    $('#leslie_group_temp_role_auto_archive').prop('checked', metadata.automation.archive_suggestions_enabled);
    $('#leslie_group_temp_role_review_interval').val(metadata.automation.review_interval_messages);
    $('#leslie_group_temp_role_ai_archive').prop('disabled', !metadata.temporary_roles.some(role => role.state === TEMPORARY_ROLE_STATES.ACTIVE));
    const roles = metadata.temporary_roles;
    if (!roles.length) {
        const empty = document.createElement('small');
        empty.textContent = '本聊天还没有临时角色。';
        list.append(empty);
        return;
    }

    for (const role of roles) {
        const row = document.createElement('div');
        row.className = 'wide100p flex-container flexWrap alignitemscenter flexGap5';
        row.dataset.tempRoleId = role.id;

        const name = document.createElement('span');
        name.textContent = role.name;

        const state = document.createElement('small');
        state.textContent = `（${STATE_LABELS[role.state] ?? role.state}）`;

        row.append(name, state, createActionButton('详情', 'view', role.id));
        if (role.state === TEMPORARY_ROLE_STATES.ACTIVE) {
            row.append(
                createActionButton('让 TA 发言', 'speak', role.id),
                createActionButton('休眠', TEMPORARY_ROLE_STATES.DORMANT, role.id),
                createActionButton('归档', TEMPORARY_ROLE_STATES.ARCHIVED, role.id),
            );
        } else {
            row.append(createActionButton('恢复活跃', TEMPORARY_ROLE_STATES.ACTIVE, role.id));
            if (role.state === TEMPORARY_ROLE_STATES.DORMANT) {
                row.append(createActionButton('归档', TEMPORARY_ROLE_STATES.ARCHIVED, role.id));
            }
        }
        list.append(row);
    }
}

export function setTemporaryRoleReviewBusy(busy) {
    $('#leslie_group_temp_role_create, #leslie_group_temp_role_ai_propose, #leslie_group_temp_role_ai_archive, #leslie_group_temp_role_auto_proposal, #leslie_group_temp_role_auto_archive, #leslie_group_temp_role_review_interval, [data-temp-role-action]').prop('disabled', Boolean(busy));
    $('#leslie_group_temp_role_ai_propose').text(busy ? 'AI 审查中…' : 'AI 提议角色');
}

function parseListInput(value) {
    return String(value ?? '')
        .split(/[\n；;]/u)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 6);
}

export async function promptForTemporaryRole({ existingNames = [], messageIndex = 0, draft = null, proposalReason = '' } = {}) {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = draft
        ? `AI 建议理由：${proposalReason || '当前剧情可能需要这个角色。'} 请检查并编辑草案；确认后才会创建。`
        : `临时角色只属于当前聊天，最多 ${MAX_TEMPORARY_ROLES} 个。先填写剧情所需的最小角色卡。`;

    const name = createTextInput('name', '例如：旅店老板', 80);
    const sceneRole = createTextInput('scene_role', '在当前剧情中的职责或出场原因', 400, true);
    const description = createTextInput('description', '身份、外貌和必要背景', 1_200, true);
    const personality = createTextInput('personality', '性格与行为倾向', 600, true);
    const speechStyle = createTextInput('speech_style', '语气、口癖或措辞习惯', 300, true);
    const knowledgeBoundary = createTextInput('knowledge_boundary', '角色知道什么、不该知道什么', 600, true);
    const goals = createTextInput('goals', '每行一项当前目标', 1_200, true);
    const constraints = createTextInput('constraints', '每行一项行为或剧情限制', 1_200, true);
    const talkativeness = document.createElement('input');
    talkativeness.className = 'text_pole widthUnset';
    talkativeness.name = 'talkativeness';
    talkativeness.type = 'number';
    talkativeness.min = '0';
    talkativeness.max = '1';
    talkativeness.step = '0.1';
    name.value = String(draft?.name ?? '');
    sceneRole.value = String(draft?.scene_role ?? '');
    description.value = String(draft?.description ?? '');
    personality.value = String(draft?.personality ?? '');
    speechStyle.value = String(draft?.speech_style ?? '');
    knowledgeBoundary.value = String(draft?.knowledge_boundary ?? '');
    goals.value = Array.isArray(draft?.goals) ? draft.goals.join('\n') : '';
    constraints.value = Array.isArray(draft?.constraints) ? draft.constraints.join('\n') : '';
    talkativeness.value = String(draft?.talkativeness ?? 0.5);

    const speakImmediately = document.createElement('input');
    speakImmediately.type = 'checkbox';
    speakImmediately.checked = Boolean(draft);
    const speakImmediatelyLabel = document.createElement('label');
    speakImmediatelyLabel.className = 'checkbox_label';
    const speakImmediatelyText = document.createElement('span');
    speakImmediatelyText.textContent = '创建后立即让该角色接入本轮剧情';
    speakImmediatelyLabel.append(speakImmediately, speakImmediatelyText);

    content.append(
        intro,
        createField('名称（必填）', name),
        createField('剧情职责', sceneRole),
        createField('简要描述', description),
        createField('性格', personality),
        createField('说话方式', speechStyle),
        createField('知识边界', knowledgeBoundary),
        createField('当前目标', goals),
        createField('限制', constraints),
        createField('发言积极度（0–1）', talkativeness),
        speakImmediatelyLabel,
    );

    const result = await callGenericPopup($(content), POPUP_TYPE.CONFIRM, '', {
        wide: true,
        large: true,
        okButton: '创建',
        cancelButton: '取消',
        allowVerticalScrolling: true,
        leftAlign: true,
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    const roleName = name.value.trim();
    if (!roleName) {
        throw new TypeError('临时角色名称不能为空。');
    }
    const duplicateNames = new Set(existingNames.map(item => String(item).trim().toLocaleLowerCase()).filter(Boolean));
    if (duplicateNames.has(roleName.toLocaleLowerCase())) {
        throw new RangeError('当前群聊已经存在同名成员或临时角色。');
    }

    const role = createTemporaryRole({
        name: roleName,
        scene_role: sceneRole.value,
        description: description.value,
        personality: personality.value,
        speech_style: speechStyle.value,
        knowledge_boundary: knowledgeBoundary.value,
        goals: parseListInput(goals.value),
        constraints: parseListInput(constraints.value),
        talkativeness: talkativeness.value,
    }, {
        id: `temp_${uuidv4()}`,
        createdAtMessage: Math.max(0, Number(messageIndex) || 0),
    });
    return { role, speakImmediately: speakImmediately.checked };
}

export async function promptForTemporaryRoleArchive(suggestions, roles) {
    const roleMap = new Map((Array.isArray(roles) ? roles : []).map(role => [role.id, role]));
    const validSuggestions = (Array.isArray(suggestions) ? suggestions : []).filter(item => roleMap.has(item.roleId));
    if (!validSuggestions.length) {
        return [];
    }

    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent = 'AI 认为以下角色可能已经退场。只有勾选并确认的角色会归档；历史消息不会删除。';
    content.append(intro);

    for (const suggestion of validSuggestions) {
        const role = roleMap.get(suggestion.roleId);
        const label = document.createElement('label');
        label.className = 'flex-container alignitemsstart flexGap10 marginTopBot5';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.tempRoleArchiveId = role.id;
        const description = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = role.name;
        description.append(name, document.createTextNode(`：${suggestion.reason}`));
        label.append(checkbox, description);
        content.append(label);
    }

    const result = await callGenericPopup($(content), POPUP_TYPE.CONFIRM, '', {
        wide: true,
        okButton: '归档所选角色',
        cancelButton: '暂不归档',
        allowVerticalScrolling: true,
        leftAlign: true,
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }
    return Array.from(content.querySelectorAll('[data-temp-role-archive-id]:checked'))
        .map(input => input.dataset.tempRoleArchiveId)
        .filter(Boolean);
}

export async function showTemporaryRoleDetails(role) {
    if (!role) {
        return;
    }

    const content = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = role.name;
    content.append(heading);
    const fields = [
        ['状态', STATE_LABELS[role.state] ?? role.state],
        ['剧情职责', role.scene_role],
        ['描述', role.description],
        ['性格', role.personality],
        ['说话方式', role.speech_style],
        ['知识边界', role.knowledge_boundary],
        ['发言积极度', String(role.talkativeness)],
    ];
    for (const [label, value] of fields) {
        if (!value) {
            continue;
        }
        const paragraph = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = `${label}：`;
        paragraph.append(strong, document.createTextNode(value));
        content.append(paragraph);
    }

    await callGenericPopup($(content), POPUP_TYPE.DISPLAY, '', { wide: true, allowVerticalScrolling: true, leftAlign: true });
}
