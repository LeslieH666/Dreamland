import {
    LESLIE_LOCAL_MODEL,
    LESLIE_LOCAL_ROLEPLAY_GUIDANCE,
    LESLIE_QWEN_ROLEPLAY_GUIDANCE,
    cleanLeslieLocalRoleplayOutput,
    getLeslieLocalRuntime,
    getLeslieLocalRuntimeKeys,
    getLeslieLocalSettings,
    isLeslieQwenRoleplayModel,
    isLocalModelLoadingEnabled,
    setLocalModelLoadingEnabled,
} from '../public/scripts/leslie-local-model-core.js';

describe('Leslie local model setup', () => {
    test('exposes both supported local runtimes', () => {
        expect(getLeslieLocalRuntimeKeys()).toEqual(['koboldcpp', 'llamacpp']);
        expect(getLeslieLocalRuntime('koboldcpp').endpoint).toBe('http://127.0.0.1:5001');
        expect(getLeslieLocalRuntime('llamacpp').endpoint).toBe('http://127.0.0.1:8080');
    });

    test('falls back to KoboldCpp for unknown runtimes', () => {
        expect(getLeslieLocalRuntime('unknown')).toEqual(getLeslieLocalRuntime('koboldcpp'));
    });

    test('returns conservative 8GB-friendly generation defaults', () => {
        const settings = getLeslieLocalSettings('koboldcpp');
        expect(settings.context).toBe(8192);
        expect(settings.responseTokens).toBe(384);
        expect(settings.generation.streaming).toBe(true);
        expect(settings.generation.temp).toBe(0.7);
        expect(settings.generation.top_p).toBe(0.8);
        expect(settings.generation.min_p).toBe(0);
        expect(settings.generation.rep_pen).toBe(1.05);
        expect(settings.generation.include_reasoning).toBe(false);
        expect(LESLIE_LOCAL_MODEL.modelFile).toBe('Qwen3.5-text-9B-NSFW-RP-RolePlay.Q4_K_M.gguf');
        expect(isLeslieQwenRoleplayModel('koboldcpp/Qwen3.5-text-9B-NSFW-RP-RolePlay.Q4_K_M.gguf')).toBe(true);
        expect(getLeslieLocalSettings('koboldcpp', 'Peach-2.0-9B-8k-Roleplay').generation.temp).toBe(0.65);
    });

    test('includes a focused roleplay guidance contract for the adapted model', () => {
        expect(LESLIE_LOCAL_ROLEPLAY_GUIDANCE).toContain('本轮回复默认必须不含问号');
        expect(LESLIE_LOCAL_ROLEPLAY_GUIDANCE).toContain('不要把回应改写成确认式提问');
        expect(LESLIE_LOCAL_ROLEPLAY_GUIDANCE).toContain('不得请求确认、许可、偏好或同意');
        expect(LESLIE_LOCAL_ROLEPLAY_GUIDANCE).toContain('this reply must contain zero question marks');
        expect(LESLIE_LOCAL_ROLEPLAY_GUIDANCE).toContain('不要替用户决定行动、情绪或台词');
    });

    test('guides Qwen toward card fidelity without banning in-character questions', () => {
        expect(LESLIE_QWEN_ROLEPLAY_GUIDANCE).toContain('角色卡中的身份');
        expect(LESLIE_QWEN_ROLEPLAY_GUIDANCE).toContain('只有角色确实需要信息时才提问');
        expect(LESLIE_QWEN_ROLEPLAY_GUIDANCE).not.toContain('不含问号');
    });

    test('stores a reversible local-model loading gate independently of model settings', () => {
        const values = new Map();
        const storage = {
            getItem: key => values.get(key),
            setItem: (key, value) => values.set(key, value),
        };

        expect(isLocalModelLoadingEnabled(storage)).toBe(true);
        expect(setLocalModelLoadingEnabled(false, storage)).toBe(false);
        expect(isLocalModelLoadingEnabled(storage)).toBe(false);
        expect(setLocalModelLoadingEnabled(true, storage)).toBe(true);
        expect(isLocalModelLoadingEnabled(storage)).toBe(true);
    });

    test('removes Peach state and scene metadata after a roleplay reply', () => {
        const output = [
            '*A valid roleplay paragraph.*',
            '“A short line of dialogue.”',
            '[state]',
            '[scene][time]',
            'Scene setting: unrelated metadata',
            '',
            'Dialogue:',
            '*Repeated roleplay text.*',
        ].join('\n');

        expect(cleanLeslieLocalRoleplayOutput(output, { model: 'koboldcpp/Peach-2.0-9B-8k-Roleplay.Q4_K_M' }))
            .toBe('*A valid roleplay paragraph.*\n“A short line of dialogue.”');
    });

    test('neutralizes Peach confirmation questions while preserving the scene', () => {
        const output = '你也来还书的吗？要不要进来避雨？';
        expect(cleanLeslieLocalRoleplayOutput(output, { model: 'koboldcpp/Peach-2.0-9B-8k-Roleplay.Q4_K_M' }))
            .toBe('你也来还书。你可以进来避雨。');
    });

    test('leaves other local models and ordinary bracketed prose unchanged', () => {
        const output = '[mood]\nThe character continues naturally.';
        expect(cleanLeslieLocalRoleplayOutput(output, { model: 'other-local-model' })).toBe(output);
        expect(cleanLeslieLocalRoleplayOutput(output, { model: 'koboldcpp/Peach-2.0-9B-8k-Roleplay.Q4_K_M' })).toBe(output);
    });
});
