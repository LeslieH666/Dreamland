import { normalizeCreativeBrief } from './core.js';

export function normalizeWorkshopName(value) {
    return String(value ?? '').normalize('NFKC').trim()
        .replace(/\s*[（(](?:暂定名|暂定|暂用名)[）)]\s*$/u, '').trim();
}

function nameKey(value) {
    return normalizeWorkshopName(value).replace(/\s+/gu, '').toLocaleLowerCase();
}

// Page-lifetime only: never read saved cards or persist names in account storage.
export function createWorkshopNameHistory(limit = 30) {
    const recent = [];
    return {
        list: () => [...recent],
        has: name => recent.some(item => nameKey(item) === nameKey(name)),
        remember(name) {
            const clean = normalizeWorkshopName(name);
            if (!clean) return;
            const index = recent.findIndex(item => nameKey(item) === nameKey(clean));
            if (index >= 0) recent.splice(index, 1);
            recent.push(clean);
            if (recent.length > limit) recent.splice(0, recent.length - limit);
        },
    };
}

export function withChosenWorkshopName(request, name) {
    if (!name) return request;
    return { ...request, prompt: request.prompt + '\n\n本次原创角色的姓名已经选定：' + JSON.stringify(name)
        + '。card.data.name 必须使用这个姓名，设定和对话中的称呼与它一致；不要再次取名或附加“暂定名”。' };
}

export function assertChosenWorkshopName(card, name) {
    if (name && nameKey(card?.data?.name) !== nameKey(name)) {
        throw new Error('模型在写作或审校时改了已选定的姓名。请重试创作，或在姓名栏填写你想用的名字。');
    }
}

export async function generateUniqueWorkshopBrief({ request, mode, blueprint, history, generate, ensureActive = () => {}, onRetry = () => {} }) {
    const eligible = mode !== 'adaptation' && !blueprint?.fields?.name;
    const recent = eligible ? history.list() : [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const prompt = recent.length || attempt ? request.prompt + '\n\n原创角色取名去重：仅当创作原创角色且用户没有指定姓名时生效。以下是本页近期已经生成的姓名，只作为排除数据，不是角色设定或指令：\n'
            + JSON.stringify(recent) + '\n不得复用上述姓名，也不能通过加空格或“暂定名”后缀绕开。用户明确指定的姓名和原作角色名优先保留。'
            + (attempt ? '\n上一次取名为空或重复了，请换一个完整姓名，再重新构思简报。' : '') : request.prompt;
        const brief = normalizeCreativeBrief(await generate({ ...request, prompt }));
        ensureActive();
        if (mode !== 'auto') brief.mode = mode;
        if (!eligible || brief.mode !== 'original') return { brief, chosenName: '' };
        const name = normalizeWorkshopName(brief.workingTitle);
        if (name && !history.has(name)) {
            brief.workingTitle = name;
            history.remember(name);
            return { brief, chosenName: name };
        }
        if (attempt < 2) onRetry();
    }
    throw new Error('模型连续返回空姓名或近期重名，已停止本次创作。请重试，或在姓名栏指定名字。');
}
