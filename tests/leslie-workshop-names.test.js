import { expect, test, jest } from '@jest/globals';
import { createWorkshopNameHistory, generateUniqueWorkshopBrief, normalizeWorkshopName, withChosenWorkshopName, assertChosenWorkshopName } from '../public/scripts/leslie-character-workshop/names.js';

function options(history = createWorkshopNameHistory()) {
    return { request: { prompt: 'synthetic brief', systemPrompt: 'synthetic system', responseLength: 1800 }, mode: 'original', blueprint: { fields: {} }, history };
}

test('repeated generation excludes previous names and retries a spaced/suffixed duplicate', async () => {
    const input = options();
    const first = await generateUniqueWorkshopBrief({ ...input, generate: async () => ({ workingTitle: '林小满' }) });
    expect(first.chosenName).toBe('林小满');
    const generate = jest.fn().mockResolvedValueOnce({ workingTitle: '林 小满（暂定名）' }).mockResolvedValueOnce({ workingTitle: '陶枝' });
    const next = await generateUniqueWorkshopBrief({ ...input, generate });
    expect(next.chosenName).toBe('陶枝');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0].prompt).toContain('林小满');
    expect(generate.mock.calls[1][0].prompt).toContain('上一次取名为空或重复了');
    expect(generate.mock.calls[1][0].systemPrompt).toBe(input.request.systemPrompt);
    expect(input.history.list()).toEqual(['林小满', '陶枝']);
});

test('a model that keeps returning duplicate names stops after three attempts', async () => {
    const input = options();
    input.history.remember('林小满');
    const generate = jest.fn(async () => ({ workingTitle: '林小满' }));
    await expect(generateUniqueWorkshopBrief({ ...input, generate })).rejects.toThrow('连续返回空姓名或近期重名');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(input.history.list()).toEqual(['林小满']);
});

test('empty names are retried instead of reserving a fallback name', async () => {
    const input = options();
    const generate = jest.fn().mockResolvedValueOnce({ workingTitle: '' }).mockResolvedValueOnce({ workingTitle: '陶枝（暂定名）' });
    expect((await generateUniqueWorkshopBrief({ ...input, generate })).chosenName).toBe('陶枝');
    expect(input.history.list()).toEqual(['陶枝']);
});

test('adaptation and auto modes preserve repeated canonical names', async () => {
    for (const mode of ['adaptation', 'auto']) {
        const input = options();
        input.history.remember('合成原作人物');
        const generate = jest.fn(async () => ({ mode: 'adaptation', workingTitle: '合成原作人物' }));
        const result = await generateUniqueWorkshopBrief({ ...input, mode, generate });
        expect(result.chosenName).toBe('');
        expect(result.brief.workingTitle).toBe('合成原作人物');
        expect(generate).toHaveBeenCalledTimes(1);
    }
});

test('an explicitly entered name bypasses deduplication', async () => {
    const input = options();
    input.history.remember('林小满');
    const generate = jest.fn(async () => ({ workingTitle: '林小满' }));
    const result = await generateUniqueWorkshopBrief({ ...input, blueprint: { fields: { name: '林小满' } }, generate });
    expect(result.chosenName).toBe('');
    expect(generate.mock.calls[0][0].prompt).toBe(input.request.prompt);
});

test('original mode remains authoritative when the model mislabels the brief', async () => {
    const input = options();
    input.history.remember('林小满');
    const generate = jest.fn().mockResolvedValueOnce({ mode: 'adaptation', workingTitle: '林小满' }).mockResolvedValueOnce({ workingTitle: '陶枝' });
    expect((await generateUniqueWorkshopBrief({ ...input, generate })).chosenName).toBe('陶枝');
});

test('cancellation and API errors cannot reserve names or trigger extra calls', async () => {
    const input = options();
    const generate = jest.fn(async () => ({ workingTitle: '陶枝' }));
    await expect(generateUniqueWorkshopBrief({ ...input, generate, ensureActive: () => { throw new Error('cancelled'); } })).rejects.toThrow('cancelled');
    expect(input.history.list()).toEqual([]);
    const failed = jest.fn(async () => { throw new Error('API failed'); });
    await expect(generateUniqueWorkshopBrief({ ...input, generate: failed })).rejects.toThrow('API failed');
    expect(failed).toHaveBeenCalledTimes(1);
});

test('recent names are bounded, returned by copy and isolated between page sessions', () => {
    const history = createWorkshopNameHistory(2);
    history.remember('林小满'); history.remember('陶枝'); history.remember('林小满'); history.remember('顾念');
    expect(history.list()).toEqual(['林小满', '顾念']);
    history.list().push('假的');
    expect(history.has('假的')).toBe(false);
    expect(createWorkshopNameHistory().has('林小满')).toBe(false);
    expect(normalizeWorkshopName('  林小满(暂定名)  ')).toBe('林小满');
});

test('draft and review lock the chosen name and detect model renaming', () => {
    const request = { prompt: 'synthetic draft', responseLength: 5200 };
    expect(withChosenWorkshopName(request, '陶枝').prompt).toContain('card.data.name 必须使用这个姓名');
    expect(withChosenWorkshopName(request, '')).toBe(request);
    expect(() => assertChosenWorkshopName({ data: { name: '林小满' } }, '陶枝')).toThrow('改了已选定的姓名');
    expect(() => assertChosenWorkshopName({ data: { name: '陶枝' } }, '陶枝')).not.toThrow();
    expect(() => assertChosenWorkshopName({ data: { name: '导入的原作名' } }, '')).not.toThrow();
});
