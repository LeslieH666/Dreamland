import {
    DEFAULT_GROUP_ORCHESTRATOR_SETTINGS,
    GROUP_ORCHESTRATOR_PRESETS,
    normalizeGroupOrchestratorSettings,
    planSmartGroupTurn,
} from './leslie-group-orchestrator-core.js';

export {
    DEFAULT_GROUP_ORCHESTRATOR_SETTINGS,
    normalizeGroupOrchestratorSettings,
    planSmartGroupTurn,
};

const CONTROL_ID = 'leslie_group_orchestrator_controls';

function toggleControlState() {
    const enabled = $('#leslie_group_orchestrator_enabled').prop('checked');
    $('#leslie_group_orchestrator_preset, #leslie_group_orchestrator_max_speakers').prop('disabled', !enabled);
}

export function mountGroupOrchestratorControls() {
    if ($(`#${CONTROL_ID}`).length || !$('#rm_group_top_bar').length) {
        return;
    }

    $('#rm_group_top_bar').after(`
        <div id="${CONTROL_ID}" class="wide100p flex-container flexWrap alignitemscenter flexGap10 marginTopBot5" title="只改变现有群成员的发言选择；关闭后继续使用原群聊回复策略。">
            <label class="checkbox_label whitespacenowrap">
                <input id="leslie_group_orchestrator_enabled" type="checkbox">
                <span>智能发言（实验）</span>
            </label>
            <label class="flex-container alignitemscenter flexGap5 whitespacenowrap">
                <span>风格</span>
                <select id="leslie_group_orchestrator_preset" class="text_pole textarea_compact widthUnset">
                    <option value="${GROUP_ORCHESTRATOR_PRESETS.BALANCED}">平衡</option>
                    <option value="${GROUP_ORCHESTRATOR_PRESETS.FOCUSED}">剧情集中</option>
                    <option value="${GROUP_ORCHESTRATOR_PRESETS.LIVELY}">热闹群聊</option>
                </select>
            </label>
            <label class="flex-container alignitemscenter flexGap5 whitespacenowrap">
                <span>每轮最多</span>
                <input id="leslie_group_orchestrator_max_speakers" class="text_pole textarea_compact widthUnset" type="number" min="1" max="4" step="1" value="2">
                <span>人</span>
            </label>
        </div>
    `);

    $('#leslie_group_orchestrator_enabled').on('input', toggleControlState);
    toggleControlState();
}

export function readGroupOrchestratorControls() {
    return normalizeGroupOrchestratorSettings({
        schema_version: DEFAULT_GROUP_ORCHESTRATOR_SETTINGS.schema_version,
        enabled: $('#leslie_group_orchestrator_enabled').prop('checked'),
        preset: $('#leslie_group_orchestrator_preset').val(),
        max_speakers: Number($('#leslie_group_orchestrator_max_speakers').val()),
        max_auto_replies: DEFAULT_GROUP_ORCHESTRATOR_SETTINGS.max_auto_replies,
    });
}

export function syncGroupOrchestratorControls(group) {
    mountGroupOrchestratorControls();
    const settings = normalizeGroupOrchestratorSettings(group?.leslie_group_orchestrator);
    $('#leslie_group_orchestrator_enabled').prop('checked', settings.enabled);
    $('#leslie_group_orchestrator_preset').val(settings.preset);
    $('#leslie_group_orchestrator_max_speakers').val(settings.max_speakers);
    toggleControlState();
}
