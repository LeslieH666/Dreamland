/* global document, localStorage, innerWidth, getComputedStyle, requestAnimationFrame */
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';

test('three-scene rehearsal preserves human originals through generation and manual editing', async () => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    test.setTimeout(90000);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(10000);
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
    await page.route('**/api/secrets/read', route => route.fulfill({ json: {} }));
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const data = await response.json();
        const settings = JSON.parse(data.settings);
        settings.firstRun = false;
        data.settings = JSON.stringify(settings);
        await route.fulfill({ json: data });
    });
    await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
    await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
    const calls = [];
    let briefCalls = 0;
    let delayNextBrief = false;
    let releaseBrief;
    const first = ['别催，我看着呢。', '啊？就这还夸我。', '嗯……刚才是我话重了。'];
    const second = ['行，是我看漏了。', '知道了，谢了。', '行了，这事过了。'];
    const card = { data: {
        name: '合成试演角色', description: '24 岁成年虚构书店店员，不知道用户未提供的信息。黑色短发。',
        personality: '嘴硬但会认错，关系与信任缓慢发展。', scenario: '认识一个月的同事正在书店闲聊。',
        first_mes: '这本你还看吗？',
        mes_example: Array.from({ length: 3 }, (_, i) => `<START>\n[USER]: 补充提问 ${i}？\n[CHAR]: 嗯，等等。`).join('\n'),
        system_prompt: '不替用户决定台词、行动或情绪。保持认知边界，关系缓慢发展。',
        post_history_instructions: '简短回复，完成一个主要互动节拍。',
        extensions: { depth_prompt: { prompt: '书店店员，嘴硬，会认错。', depth: 0, role: 'system' } },
    } };
    await page.route('http://127.0.0.1:5001/v1/models', route => route.fulfill({ json: { data: [{ id: 'synthetic-model' }] } }));
    await page.route('http://127.0.0.1:5001/v1/chat/completions', async route => {
        const input = route.request().postDataJSON();
        const prompt = input.messages[1].content;
        calls.push(prompt);
        let output;
        if (prompt.includes('阶段 1/4')) {
            if (delayNextBrief) {
                delayNextBrief = false;
                await new Promise(resolve => { releaseBrief = resolve; });
            }
            briefCalls++;
            output = { mode: 'original', workingTitle: briefCalls < 3 ? '合成试演角色' : '合成新姓名', hardFacts: ['24 岁'], requiresKnowledgeCheck: false };
        }
        else if (prompt.includes('提出三个短对话场景')) output = { scenes: Array.from({ length: 3 }, (_, i) => ({ title: `场景 ${i + 1}`, setting: '书店里的普通闲聊。', playerLine: `玩家第一句 ${i}？` })) };
        else if (prompt.includes('接住人类刚写的角色回应')) output = { playerLine: '那我等一下，你慢慢来。' };
        else if (prompt.includes('只分析人类已经写下')) output = { habits: [{ habit: '短句里会改口', scene: 0, turn: 0, quote: '别催' }], conflicts: [{ message: '合成冲突提醒，需要用户判断', scene: 0, turn: 0, fact: '24 岁' }] };
        else if (prompt.includes('局部修改范围：')) output = {
            patches: prompt.includes('范围：仅图片提示词') ? [] : [{ old: '黑色短发。', new: '银白长发。' }],
            appearanceFields: prompt.includes('范围：仅图片提示词') ? {} : { hair: '长发、银白发' },
            avatar_prompt: { positive: 'Synthetic silver-haired portrait.', negative: 'text', aspect_ratio: '2:3' },
        };
        else output = {
            card: { ...card, data: {
                ...card.data, name: briefCalls < 3 ? '合成试演角色' : '合成新姓名',
                mes_example: briefCalls < 3 ? card.data.mes_example : Array.from({ length: 6 }, (_, i) => `<START>\n[USER]: 合成提问 ${i}？\n[CHAR]: 嗯，等等。\n[USER]: 还没好吗？\n[CHAR]: 快了，别急。`).join('\n'),
            } },
            avatar_prompt: { positive: 'Synthetic adult bookstore clerk portrait.', negative: 'text, watermark', aspect_ratio: '2:3' },
            review: { summary: '合成审校' },
        };
        await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(output) } }] } });
    });
    try {
        await page.goto(process.env.LESLIE_TEST_BASE_URL || 'http://127.0.0.1:8139/');
        await page.locator('#preloader').waitFor({ state: 'hidden', timeout: 30000 });
        await page.locator('.dreamland-navigation [data-action="workshop"]').click();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const sections = page.locator('[data-blueprint-section]');
        await expect(sections.first()).toHaveAttribute('open', '');
        await page.locator('[data-workshop-field="name"]').fill('合成分类角色');
        const count = await sections.count();
        for (let i = 0; i < count; i++) {
            await expect(sections.nth(i)).toHaveAttribute('open', '');
            await sections.nth(i).locator('[data-blueprint-complete]').click();
            await expect(sections.nth(i).locator('[data-blueprint-check]')).toBeVisible();
            await expect(sections.nth(i)).not.toHaveAttribute('open', '');
        }
        fs.mkdirSync('test-results/workshop-rehearsal', { recursive: true });
        await page.locator('[data-workshop-blueprint]').screenshot({ path: 'test-results/workshop-rehearsal/blueprint-complete-desktop.png' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('[data-workshop-blueprint]').screenshot({ path: 'test-results/workshop-rehearsal/blueprint-complete-mobile.png' });
        await page.setViewportSize({ width: 1280, height: 900 });
        const duration = await sections.first().locator('summary').evaluate(summary => {
            summary.click();
            return summary.parentElement.querySelector('.leslie-blueprint-body').getAnimations()[0].effect.getTiming().duration;
        });
        expect(duration).toBe(260);
        await expect(page.locator('[data-workshop-field="name"]')).toHaveValue('合成分类角色');
        await page.locator('[data-workshop-field="name"]').fill('合成分类修改');
        await expect(sections.first().locator('[data-blueprint-check]')).toBeHidden();
        await expect(sections.nth(1).locator('[data-blueprint-check]')).toBeVisible();
        await sections.first().locator('summary').evaluate(summary => { summary.click(); summary.click(); });
        await expect(sections.first()).toHaveAttribute('open', '');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await sections.first().locator('[data-blueprint-complete]').click();
        await expect(sections.first()).not.toHaveAttribute('open', '');
        await expect(sections.nth(1)).toHaveAttribute('open', '');
        const hair = page.locator('[data-workshop-field="hair"]');
        await hair.fill('手写补充');
        await page.locator('[data-appearance-field="hair"][data-appearance-choice="长发"]').click();
        await page.locator('[data-appearance-field="hair"][data-appearance-choice="银白发"]').click();
        await expect(hair).toHaveValue('手写补充、长发、银白发');
        await page.locator('[data-appearance-field="hair"][data-appearance-choice="短发"]').click();
        await expect(hair).toHaveValue('手写补充、银白发、短发');
        await expect(page.locator('[data-appearance-field="hair"][data-appearance-choice="长发"]')).toHaveAttribute('aria-pressed', 'false');
        await sections.nth(1).screenshot({ path: 'test-results/workshop-rehearsal/appearance-choices-desktop.png' });
        await page.setViewportSize({ width: 390, height: 844 });
        await sections.nth(1).screenshot({ path: 'test-results/workshop-rehearsal/appearance-choices-mobile.png' });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('[data-workshop-action="discard"]').click();
        await expect(sections.first()).toHaveAttribute('open', '');
        await expect(page.locator('[data-blueprint-check]:visible')).toHaveCount(0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(async () => (await import('/scripts/leslie-local-model-core.js')).setLocalModelLoadingEnabled(true));
        await page.locator('[data-workshop-provider]').selectOption('local');
        await page.locator('[data-workshop-knowledge-check]').uncheck();
        await page.locator('[data-workshop-action="rehearse"]').click();
        await expect(page.locator('[data-workshop-section="rehearsal"]')).toBeVisible();
        await expect(page.locator('[data-rehearsal-reply="1"]')).toHaveCount(0);
        await page.locator('[data-rehearsal-reply="0"]').fill(first[0]);
        await page.locator('[data-rehearsal-action="followup"]').click();
        await expect(page.locator('[data-rehearsal-reply="1"]')).toBeVisible();
        expect(calls[2]).toContain(first[0]);
        await page.locator('[data-rehearsal-reply="1"]').fill(second[0]);
        await page.locator('[data-rehearsal-reply="0"]').fill('改第一句，旧第二轮要失效。');
        await page.locator('[data-rehearsal-action="next"]').click();
        await expect(page.locator('[data-rehearsal-reply="1"]')).toHaveCount(0);
        await page.locator('[data-rehearsal-reply="0"]').fill(first[0]);
        await page.locator('[data-rehearsal-action="followup"]').click();
        await expect(page.locator('[data-rehearsal-reply="1"]')).toBeVisible();
        await page.locator('[data-rehearsal-reply="1"]').fill(second[0]);
        await page.locator('[data-rehearsal-action="next"]').click();
        await expect(page.locator('[data-workshop-rehearsal] h4').first()).toHaveText('场景 2');
        await page.locator('[data-rehearsal-reply="0"]').fill(first[1]);
        await page.locator('.dreamland-navigation [data-action="home"]').click();
        await page.locator('.dreamland-navigation [data-action="workshop"]').click();
        await expect(page.locator('[data-rehearsal-reply="0"]')).toHaveValue(first[1]);
        await page.locator('[data-rehearsal-action="followup"]').click();
        await expect(page.locator('[data-rehearsal-reply="1"]')).toBeVisible();
        await page.locator('[data-rehearsal-reply="1"]').fill(second[1]);
        await page.locator('[data-rehearsal-action="next"]').click();
        await page.locator('[data-rehearsal-reply="0"]').fill(first[2]);
        await page.locator('[data-rehearsal-action="followup"]').click();
        await expect(page.locator('[data-rehearsal-reply="1"]')).toBeVisible();
        await page.locator('[data-rehearsal-reply="1"]').fill(second[2]);
        await expect(page.locator('[data-rehearsal-action="confirm"]')).toHaveText('用试演原话生成角色卡');
        await expect(page.locator('[data-rehearsal-action="confirm"]')).toHaveAttribute('title', /保留你写的所有有效台词/);
        await expect(page.locator('.leslie-rehearsal-actions button:visible')).toHaveCount(1);
        await expect(page.locator('[data-rehearsal-action="automatic"]')).toBeHidden();
        expect(await page.locator('.leslie-rehearsal-scene').evaluateAll(buttons => buttons.every(button => getComputedStyle(button).boxShadow === 'none' && button.title.includes('保留')))).toBe(true);
        await page.locator('.leslie-rehearsal-more > summary').click();
        await expect(page.locator('[data-rehearsal-action="automatic"]')).toHaveText('舍弃试演，交给 AI 重写');
        await expect(page.locator('[data-rehearsal-action="automatic"]')).toHaveAttribute('title', /放弃全部人工试演台词/);
        await page.locator('[data-rehearsal-action="audit"]').click();
        await expect(page.locator('.leslie-rehearsal-conflict')).toContainText('第 1 组第 1 句');
        await expect(page.locator('[data-rehearsal-reply="0"]')).toHaveValue(first[2]);
        expect(await page.locator('[data-rehearsal-action="confirm"]').evaluate(button => getComputedStyle(button, '::before').transform)).not.toBe('none');
        fs.mkdirSync('test-results/workshop-rehearsal', { recursive: true });
        await page.locator('.leslie-rehearsal-actions').screenshot({ path: 'test-results/workshop-rehearsal/actions-desktop.png' });
        await page.locator('.leslie-rehearsal-more > summary').click();
        expect(await page.locator('.leslie-rehearsal-tools button').evaluateAll(buttons => buttons.every(button => getComputedStyle(button, '::before').transform !== 'none' && button.title.length > 15))).toBe(true);
        await page.locator('.leslie-rehearsal-actions').screenshot({ path: 'test-results/workshop-rehearsal/actions-expanded.png' });
        await page.locator('.leslie-rehearsal-more > summary').click();
        await page.locator('[data-workshop-section="rehearsal"]').evaluate(element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: 'test-results/workshop-rehearsal/desktop.png' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.leslie-rehearsal-actions').screenshot({ path: 'test-results/workshop-rehearsal/actions-mobile.png' });
        await page.locator('[data-workshop-section="rehearsal"]').evaluate(element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: 'test-results/workshop-rehearsal/mobile.png' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator('[data-rehearsal-action="confirm"]').click();
        await expect(page.locator('[data-workshop-section="preview"]')).toBeVisible({ timeout: 15000 });
        const examples = page.locator('[data-workshop-card-field="mes_example"]');
        const text = await examples.inputValue();
        expect(text.match(/<START>/g)).toHaveLength(6);
        expect(text).toContain(first[0]);
        expect(text).toContain(second[2]);
        expect(text).toContain('补充提问 2');
        await expect(page.locator('[data-workshop-action="apply"]')).toBeVisible();
        await page.locator('details').filter({ has: examples }).locator('summary').click();
        await examples.fill(text.replace(first[0], '人类再次手动修改。'));
        await page.locator('[data-workshop-action="review"]').click();
        await expect(page.locator('[data-workshop-status]')).toBeHidden();
        expect(calls.at(-1)).not.toContain('人工试演优先规则');
        await page.locator('[data-workshop-action="random"]').click();
        await expect(page.locator('[data-workshop-card-field="name"]')).toHaveValue('合成新姓名');
        expect(briefCalls).toBe(3);
        const lastBrief = calls.filter(prompt => prompt.includes('阶段 1/4')).at(-1);
        expect(lastBrief).toContain('合成试演角色');
        expect(lastBrief).toContain('上一次取名为空或重复了');
        expect(calls.at(-1)).toContain('card.data.name 必须使用这个姓名');
        const beforeRevision = await page.locator('[data-workshop-card-field]').evaluateAll(fields => Object.fromEntries(fields.map(field => [field.dataset.workshopCardField, field.value])));
        await page.locator('.leslie-workshop-revision > summary').click();
        await page.locator('[data-revision-instruction]').fill('黑色短发改成银白长发，其他不动');
        await page.locator('[data-workshop-action="propose-revision"]').click();
        await expect(page.locator('[data-revision-proposal]')).toBeVisible();
        await expect(page.locator('[data-workshop-card-field="description"]')).toHaveValue(beforeRevision.description);
        await page.locator('[data-workshop-action="reject-revision"]').click();
        await expect(page.locator('[data-workshop-card-field="description"]')).toHaveValue(beforeRevision.description);
        await page.locator('[data-workshop-action="propose-revision"]').click();
        await expect(page.locator('[data-revision-proposal]')).toBeVisible();
        await page.locator('.leslie-workshop-revision').screenshot({ path: 'test-results/workshop-rehearsal/revision-desktop.png' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.leslie-workshop-revision').screenshot({ path: 'test-results/workshop-rehearsal/revision-mobile.png' });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('[data-workshop-action="accept-revision"]').click();
        const afterRevision = await page.locator('[data-workshop-card-field]').evaluateAll(fields => Object.fromEntries(fields.map(field => [field.dataset.workshopCardField, field.value])));
        expect(afterRevision).toEqual({ ...beforeRevision, description: beforeRevision.description.replace('黑色短发。', '银白长发。') });
        await expect(hair).toHaveValue('长发、银白发');
        await expect(page.locator('[data-avatar-field="positive"]')).toHaveValue('Synthetic silver-haired portrait.');
        await page.locator('[data-revision-scope]').selectOption('avatar');
        await page.locator('[data-revision-instruction]').fill('修改构图，角色卡不动');
        await page.locator('[data-workshop-action="propose-revision"]').click();
        await expect(page.locator('[data-revision-proposal]')).toBeVisible();
        await page.locator('[data-workshop-action="accept-revision"]').click();
        expect(await page.locator('[data-workshop-card-field]').evaluateAll(fields => Object.fromEntries(fields.map(field => [field.dataset.workshopCardField, field.value])))).toEqual(afterRevision);
        await page.locator('[data-avatar-field="positive"]').fill('Manual synthetic portrait prompt.');
        await page.locator('[data-workshop-action="propose-revision"]').click();
        await expect(page.locator('[data-revision-proposal]')).toBeVisible();
        await page.locator('[data-avatar-field="positive"]').fill('New manual prompt.');
        await expect(page.locator('[data-revision-confirm]')).toBeHidden();
        await expect(page.locator('[data-avatar-field="positive"]')).toHaveValue('New manual prompt.');
        await page.setViewportSize({ width: 1280, height: 900 });
        const footer = page.locator('.leslie-character-workshop-footer');
        await expect(page.locator('[data-workshop-action="apply"]')).toBeVisible();
        await expect(page.locator('[data-workshop-action="copy-avatar"]')).toBeVisible();
        const toolStyles = await footer.locator('button:visible').evaluateAll(buttons => buttons.map(button => ({
            name: button.dataset.workshopAction,
            baseTransform: getComputedStyle(button, '::before').transform,
            labelTransform: getComputedStyle(button).transform,
        })));
        expect(toolStyles.every(style => style.baseTransform !== 'none')).toBe(true);
        expect(toolStyles.every(style => style.labelTransform === 'none')).toBe(true);
        await footer.screenshot({ path: 'test-results/workshop-rehearsal/footer-desktop.png' });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await footer.locator('button:visible').evaluateAll(buttons => buttons.every(button => {
            const bounds = button.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
        }))).toBe(true);
        await footer.screenshot({ path: 'test-results/workshop-rehearsal/footer-mobile.png' });
        await page.locator('[data-workshop-field="age"]').fill('24');
        await page.locator('[data-workshop-prompt]').fill('合成待丢弃要求');
        await page.locator('.leslie-character-workshop-json-import > summary').click();
        await page.locator('[data-workshop-import-json]').fill(JSON.stringify(card));
        await page.locator('[data-workshop-action="discard"]').click();
        await expect(page.locator('[data-workshop-section="preview"]')).toBeHidden();
        await expect(page.locator('[data-workshop-section="rehearsal"]')).toBeHidden();
        await expect(page.locator('[data-workshop-field="age"]')).toHaveValue('');
        await expect(page.locator('[data-workshop-prompt]')).toHaveValue('');
        await expect(page.locator('[data-workshop-import-json]')).toHaveValue('');
        await expect(page.locator('[data-workshop-action="generate"]')).toBeVisible();
        await expect(page.locator('[data-workshop-action="apply"]')).toBeHidden();
        await expect(page.locator('[data-workshop-provider]')).toHaveValue('local');
        delayNextBrief = true;
        await page.locator('[data-workshop-action="generate"]').click();
        await expect.poll(() => typeof releaseBrief).toBe('function');
        await expect(sections.first().locator('[data-blueprint-complete]')).toBeDisabled();
        await expect(sections.first().locator('summary')).toHaveAttribute('aria-disabled', 'true');
        await page.locator('[data-workshop-action="discard"]').click();
        releaseBrief();
        await expect.poll(() => briefCalls).toBe(4);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.locator('[data-workshop-status]')).toBeHidden();
        await expect(page.locator('[data-workshop-error]')).toBeHidden();
        await expect(page.locator('[data-workshop-section="preview"]')).toBeHidden();
        await expect(page.locator('[data-workshop-action="generate"]')).toBeEnabled();
        expect(errors).toEqual([]);
    } finally { await browser.close(); }
});
