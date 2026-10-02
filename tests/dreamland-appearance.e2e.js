/* global document, localStorage, window, getComputedStyle, globalThis */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ channel: 'msedge', viewport: { width: 1280, height: 900 } });

const screenshotDirectory = process.env.LESLIE_SCREENSHOT_DIR || 'test-results';
async function capture(page, name) {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await expect(page.locator('#toast-container .toast')).toHaveCount(0, { timeout: 15000 });
    await page.screenshot({ animations: 'disabled', path: path.join(screenshotDirectory, `${name}.png`) });
}

async function removeSyntheticCard(page, name) {
    expect(name).toMatch(/^合成(?:手动验收| JSON 验收) /);
    expect(await page.evaluate(async name => {
        const app = await import('/script.js');
        const character = app.characters.find(character => character.name === name);
        const response = await fetch('/api/characters/delete', {
            method: 'POST', headers: app.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: character.avatar, delete_chats: false }),
        });
        return response.ok;
    }, name)).toBe(true);
}

async function prepare(page) {
    await page.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
    await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
    await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
    if (process.env.LESLIE_SYNTHETIC_SHOWCASE) {
        await page.route('**/api/secrets/read', route => route.fulfill({ json: {} }));
        await page.route('**/api/chats/get', route => route.fulfill({ json: [
            { user_name: 'User', character_name: '星澄', chat_metadata: {} },
            { name: '星澄', is_user: false, is_system: false, mes: '*窗外的天空渐渐染上暮色。*\n\n你回来啦。今天也想听你讲讲，有没有遇到什么值得记住的小事？', send_date: '2026-10-01T12:00:00.000Z' },
        ] }));
        await page.route('**/api/chats/save', route => route.fulfill({ json: { result: 'ok' } }));
    }
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await finishInitialization(page);
}

test('synthetic showcase covers home, chat, memory, moments, workshop and model settings', async ({ page }) => {
    // This screenshot scenario must never run against a real user's data root.
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Run only against an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    if (process.env.LESLIE_SHOWCASE_STYLE === 'blue') await expect(page.locator('body')).toHaveAttribute('data-ba-assets', 'ready');
    await chooseMode(page, 'light');
    await page.locator('.dreamland-navigation [data-action="home"]').click();
    await expect(page.locator('.leslieHomePanel')).toBeVisible();
    await capture(page, 'dreamland-showcase-home');
    await page.locator('.leslie-conversation-item').filter({ hasText: '星澄 · 界面演示' }).click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await page.evaluate(async () => {
        const app = await import('/script.js');
        for (const message of [
            { name: 'User', is_user: true, mes: '带上星图吧，今晚我们一起去天台看流星。' },
            { name: '星澄', is_user: false, mes: '*她把星图折好，轻轻放进背包。*\n\n好呀。路上的故事也慢慢讲给我听吧。\n\n> 每一个小小的约定，都可以成为新的开始。' },
        ]) {
            const entry = { ...message, is_system: false, send_date: '2026-10-01T12:00:00.000Z' };
            app.chat.push(entry);
            app.addOneMessage(entry);
        }
    });
    await capture(page, 'dreamland-showcase-chat');
    await page.locator('#leslie-memory-launcher').click();
    await expect(page.locator('#leslie-memory-panel')).toBeVisible();
    await expect(page.locator('#leslie-memory-status')).not.toContainText('正在读取');
    await capture(page, 'dreamland-showcase-memory');
    await page.keyboard.press('Escape');
    await expect(page.locator('#leslie-memory-panel')).toBeHidden();
    await page.locator('.dreamland-navigation [data-action="moments"]').click();
    await expect(page.locator('.leslie-moments-page')).toBeVisible();
    await capture(page, 'dreamland-showcase-moments');
    await page.keyboard.press('Escape');
    await page.locator('.dreamland-navigation [data-action="workshop"]').click();
    await expect(page.locator('.leslie-character-workshop')).toBeVisible();
    await capture(page, 'dreamland-showcase-workshop');
    if (await isBa(page)) await page.locator('.dreamland-navigation [data-action="home"]').click();
    else await page.locator('[data-workshop-action="close"]').click();
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await page.locator('.leslie-settings-nav-item[data-leslie-detail="model"]').click();
    await expect(page.locator('#leslie-settings-overlay')).toBeVisible();
    await capture(page, 'dreamland-showcase-model');
});

test('login branding uses local style with synthetic user list', async ({ page }) => {
    const style = 'blue';
    await page.addInitScript(style => {
        localStorage.setItem('dreamland.appearance.style', style);
        localStorage.setItem('leslie.theme.preference', 'light');
    }, style);
    await page.route('**/dreamland-login-preview', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync('../public/login.html', 'utf8') }));
    await page.route('**/api/users/list', route => route.fulfill({ json: [{ handle: 'dreamland-qa', name: '合成演示空间', avatar: '/img/dreamland/icon.svg', password: true }] }));
    await page.goto('/dreamland-login-preview');
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', style);
    if (style === 'blue') await expect(page.locator('body')).toHaveAttribute('data-ba-assets', 'ready');
    await expect(page.locator('#logoBlock')).toContainText('DreamLand');
    await expect(page.locator('#dialogue_popup')).toBeVisible();
    await capture(page, 'dreamland-showcase-login');
});

test('enlarged text and long Markdown keep chat controls reachable', async ({ page }) => {
    await prepare(page);
    await chooseStyle(page, 'blue');
    await page.locator('.leslie-conversation-item').first().click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await page.evaluate(async () => {
        const app = await import('/script.js');
        const entry = { name: 'Synthetic Guide', is_user: false, is_system: false, mes: '### 合成排版测试\n\n**中文长名称与正文**\n\n```js\nconst synthetic = "' + 'a'.repeat(240) + '";\n```', send_date: '2026-10-01T12:00:00.000Z' };
        app.chat.push(entry);
        app.addOneMessage(entry);
    });
    await page.locator('#send_textarea').fill('合成草稿');
    // At 150% browser zoom, 1280 × 900 becomes an ~853 × 600 CSS viewport.
    await page.setViewportSize({ width: 853, height: 600 });
    await expect(page.locator('#send_textarea')).toBeVisible();
    await expect(page.locator('#leslie-chat-actions [data-action="chat-more"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.leslie-conversation-item').first().click();
    await expect(page.locator('#sheld')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#leslie-conversation-sidebar')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#send_textarea')).toHaveValue('合成草稿');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture(page, 'dreamland-blue-markdown-mobile');
});

async function finishInitialization(page) {
    await expect(page.locator('#preloader')).toBeHidden();
    // The loader closes before first-run onboarding finishes initializing chats.
    await page.locator('.popup[open]:has(#onboarding_ui_language_select), #chat > .leslieHomePanel, #chat > .mes').first().waitFor({ state: 'visible' });
    const onboarding = page.locator('.popup[open]:has(#onboarding_ui_language_select)');
    if (await onboarding.isVisible()) await onboarding.locator('.popup-button-ok').click();
    await expect(page.locator('#chat > .leslieHomePanel, #chat > .mes').first()).toBeVisible();
    await expect(page.locator('#leslie-conversation-sidebar')).toBeVisible();
}

async function chooseStyle(page) {
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'blue');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'dreamland');
}

async function isBa(page) {
    return await page.locator('body').getAttribute('data-dreamland-style') === 'blue'
        && await page.locator('body').getAttribute('data-leslie-design-language') === 'dreamland';
}

async function openAppearance(page) {
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    if (await page.evaluate(() => window.innerWidth <= 700 && document.getElementById('leslie-settings-overlay').classList.contains('leslie-settings-mobile-detail'))) {
        await page.locator('[data-leslie-settings-nav-back]').click();
    }
    await page.locator('.leslie-settings-nav-item[data-leslie-settings-home]').click();
}

async function leaveSettings(page) {
    if (await isBa(page)) await page.locator('.dreamland-navigation [data-action="home"]').click();
    else if (await page.locator('.leslie-settings-close').isVisible()) await page.locator('.leslie-settings-close').click();
}

async function chooseMode(page, mode) {
    if (await isBa(page)) {
        await openAppearance(page);
        await page.locator('#leslie-display-mode-select').selectOption(mode);
        await leaveSettings(page);
    } else {
        await page.locator('.leslie-theme-toggle').click();
        await page.locator(`#leslie-theme-menu [data-leslie-theme-mode="${mode}"]`).click();
    }
}


test('BA pages keep chat and form drafts, occupy the main area and support back navigation', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    await page.locator('.leslie-conversation-item').first().click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await page.locator('#send_textarea').fill('页面切换保留的合成草稿');
    const message = await page.locator('#chat > .mes').first().elementHandle();
    await expect(page.locator('.leslie-sidebar-actions')).toBeHidden();
    await expect(page.locator('#leslie-moments-launcher')).toBeHidden();
    for (const name of ['moments', 'workshop', 'background', 'settings', 'about']) {
        await page.locator(`.dreamland-navigation [data-action="${name}"]`).click();
        await expect(page.locator('body')).toHaveAttribute('data-dreamland-page', name);
        await expect(page.locator('#dreamland-page-host [aria-modal="true"]:visible')).toHaveCount(0);
        const host = await page.locator('#dreamland-page-host').boundingBox();
        const sidebar = await page.locator('#leslie-conversation-sidebar').boundingBox();
        expect(Math.abs(host.x - sidebar.width)).toBeLessThan(2);
        expect(host.y).toBe(0);
        expect(host.height).toBe(900);
        expect(Math.abs(host.width + sidebar.width - 1280)).toBeLessThan(2);
        if (name === 'moments') await page.locator('#leslie-moments-content').fill('朋友圈的合成草稿');
        if (name === 'workshop') await page.locator('[data-workshop-field="name"]').fill('保留的工坊姓名');
    }
    await page.goBack();
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-page', 'settings');
    await page.locator('.dreamland-navigation [data-action="workshop"]').click();
    await expect(page.locator('[data-workshop-field="name"]')).toHaveValue('保留的工坊姓名');
    await page.locator('.dreamland-navigation [data-action="moments"]').click();
    await expect(page.locator('#leslie-moments-content')).toHaveValue('朋友圈的合成草稿');
    await page.locator('.dreamland-navigation [data-action="home"]').click();
    await expect(page.locator('#send_textarea')).toHaveValue('页面切换保留的合成草稿');
    expect(await message.evaluate(node => node === document.querySelector('#chat > .mes'))).toBe(true);

});

for (const width of [1280, 390]) {
    test(`BA backgrounds leave no overlay or layout space after navigation at ${width}px`, async ({ page }) => {
        test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
        await prepare(page);
        await chooseStyle(page, 'blue');
        await page.setViewportSize({ width, height: 844 });
        const background = page.locator('#Backgrounds');
        const host = page.locator('#dreamland-page-host');
        for (const name of ['moments', 'workshop', 'settings', 'about']) {
            await page.locator('.dreamland-navigation [data-action="background"]').click();
            await expect(background).toBeVisible();
            await page.locator(`.dreamland-navigation [data-action="${name}"]`).click();
            await expect(background).toBeHidden();
            const visibleView = host.locator(':scope > [data-dreamland-page-view]:visible');
            await expect(visibleView).toHaveCount(1);
            const bounds = await visibleView.boundingBox();
            const area = await host.boundingBox();
            expect(Math.abs(bounds.y - area.y)).toBeLessThan(1);
            expect(Math.abs(bounds.height - area.height)).toBeLessThan(1);
        }
        await page.locator('.dreamland-navigation [data-action="background"]').click();
        await page.locator('.dreamland-navigation [data-action="home"]').click();
        await expect(background).toBeHidden();
        await expect(host).toBeHidden();
        await page.locator('.dreamland-navigation [data-action="background"]').click();
        await page.locator('.dreamland-navigation [data-action="workshop"]').click();
        await page.goBack();
        await expect(background).toBeVisible();
        await page.goForward();
        await expect(background).toBeHidden();
        await expect(page.locator('[data-workshop-field="name"]')).toBeVisible();
    });
}

test('BA memory drawer has room for desktop details and fits the mobile viewport', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    await page.locator('.leslie-conversation-item').first().click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await page.locator('#leslie-memory-launcher').click();
    const panel = page.locator('#leslie-memory-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#leslie-memory-status')).not.toContainText('正在读取');
    const desktop = await panel.boundingBox();
    expect(desktop.width).toBeGreaterThanOrEqual(800);
    expect(desktop.x + desktop.width).toBe(1280);
    const details = await panel.locator('.leslie-memory-main').boundingBox();
    expect(details.width).toBeGreaterThanOrEqual(550);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await panel.boundingBox();
    expect(mobile.x).toBeGreaterThanOrEqual(0);
    expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await panel.locator('[data-action="close"]').click();
    await expect(panel).toBeHidden();
});

test('BA manual editor preserves fields across navigation and saves through the original form', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Saves only in an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    await page.locator('.dreamland-navigation [data-action="workshop"]').click();
    await page.locator('[data-workshop-action="manual"]').click();
    await expect(page.locator('#dreamland-page-host #form_create')).toBeVisible();
    const name = `合成手动验收 ${Date.now()}`;
    await page.locator('#character_name_pole').fill(name);
    await page.locator('#description_textarea').fill('只用于整页编辑器验收的合成角色。');
    await page.locator('.dreamland-navigation [data-action="about"]').click();
    await expect(page.locator('#rm_ch_create_block')).toBeHidden();
    await page.locator('.dreamland-navigation [data-action="workshop"]').click();
    await expect(page.locator('#character_name_pole')).toHaveValue(name);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#create_button_label')).toBeVisible();
    const response = page.waitForResponse(response => response.url().includes('/api/characters/create'));
    await page.locator('#create_button_label').click();
    expect((await response).ok()).toBe(true);
    await expect.poll(() => page.evaluate(async name => {
        const app = await import('/script.js');
        return app.characters.some(character => character.name === name);
    }, name)).toBe(true);
    await capture(page, 'momotalk-full-page-manual-mobile');
    await removeSyntheticCard(page, name);
});

test('BA JSON workshop handoff retains extensions and saves the reviewed character', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Saves only in an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    await page.locator('.dreamland-navigation [data-action="workshop"]').click();
    const name = `合成 JSON 验收 ${Date.now()}`;
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: {
        name,
        description: '一名独立书店店员。她不知道玩家没有亲口说出的经历，不能凭空知道场外信息。',
        personality: '警觉但好奇，有自己的计划。关系与信任必须逐步发展。',
        scenario: '她与 {{user}} 刚认识，雨夜里在即将打烊的书店门口相遇。',
        first_mes: '*她扶住门。* “要进来避一会儿吗？”',
        mes_example: '<START>\n{{char}}: “先等等。”\n<START>\n{{char}}: “我还没想好。”\n<START>\n{{char}}: “这件事我不知道。”\n<START>\n{{char}}: “可以。”',
        system_prompt: '保持角色独立意志和认知边界。不得替用户决定台词、行动、情绪或关系升级。',
        post_history_instructions: '每轮只写一个即时反应，使用短回复，最多两行；不得替用户说话。',
        alternate_greetings: ['“你也是来等雨停的？”'],
        extensions: { synthetic_roundtrip: { enabled: true } },
    } };
    await page.locator('.leslie-character-workshop-json-import > summary').click();
    await page.locator('[data-workshop-import-json]').fill(JSON.stringify(card));
    await page.locator('[data-workshop-action="inspect-json"]').click();
    await expect(page.locator('[data-workshop-action="apply"]')).toBeVisible();
    await page.locator('[data-workshop-action="apply"]').click();
    await expect(page.locator('#dreamland-page-host #character_name_pole')).toHaveValue(name);
    const response = page.waitForResponse(response => response.url().includes('/api/characters/create'));
    await page.locator('#create_button_label').click();
    expect((await response).ok()).toBe(true);
    await expect.poll(() => page.evaluate(async name => {
        const app = await import('/script.js');
        const data = app.characters.find(character => character.name === name)?.data;
        return data?.extensions?.synthetic_roundtrip?.enabled === true && data.alternate_greetings?.length === 1;
    }, name)).toBe(true);
    await removeSyntheticCard(page, name);
});

for (const width of [320, 390, 430]) {
    test(`BA mobile ${width}px switches and creates both world lines without a race`, async ({ page }) => {
        test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
        await prepare(page);
        await chooseStyle(page, 'blue');
        await page.setViewportSize({ width, height: 844 });
        let release;
        let hold = false;
        await page.route('**/api/characters/chats', async route => {
            if (hold && route.request().postDataJSON()?.metadata) {
                hold = false;
                await new Promise(resolve => { release = resolve; });
            }
            await route.fulfill({ json: [{ file_name: 'synthetic-story.jsonl', last_mes: '2026-10-01T10:00:00Z', chat_items: 1, chat_metadata: { leslie_world_line: { kind: 'story' } } }] });
        });
        await page.route('**/api/chats/get', route => route.fulfill({ json: route.request().postDataJSON().file_name === 'synthetic-story' ? [
            { user_name: 'User', character_name: 'Synthetic', chat_metadata: { leslie_world_line: { schemaVersion: 1, kind: 'story' } } },
            { name: 'Synthetic', is_user: false, mes: '故事线的合成开场。', send_date: '2026-10-01T10:00:00Z' },
        ] : [] }));
        await page.locator('.leslie-conversation-item').first().click();
        await expect(page.locator('[data-action="line-story"]')).toHaveAttribute('aria-pressed', 'true');
        await page.evaluate(() => {
            globalThis.syntheticRealityOpenings = 0;
            globalThis.LeslieRealityPrepareOpening = async ({ personaSourceKey }) => {
                globalThis.syntheticRealityOpenings++;
                return { text: '现实线的合成开场。', metadata: { schemaVersion: 1, kind: 'reality', personaSourceKey, createdAt: new Date().toISOString() } };
            };
        });
        for (const action of ['line-story', 'line-reality', 'new-chat']) {
            const bounds = await page.locator(`#leslie-chat-header [data-action="${action}"]`).boundingBox();
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
            expect(Math.round(bounds.height)).toBeGreaterThanOrEqual(40);
        }
        hold = true;
        await page.locator('[data-action="line-reality"]').click();
        await expect(page.locator('[data-action="new-chat"]')).toBeDisabled();
        await expect.poll(() => Boolean(release)).toBe(true);
        release();
        await expect(page.locator('[data-action="line-reality"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-action="new-chat"]')).toBeEnabled();
        await expect(page.locator('.leslie-new-chat-label')).toHaveText('新建现实线');
        await page.locator('[data-action="new-chat"]').click();
        await expect.poll(() => page.evaluate(() => globalThis.syntheticRealityOpenings)).toBe(2);
        await expect(page.locator('[data-action="new-chat"]')).toBeEnabled();
        await page.locator('[data-action="line-story"]').click();
        await expect(page.locator('[data-action="line-story"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-action="new-chat"]')).toBeEnabled();
        await expect(page.locator('.leslie-new-chat-label')).toHaveText('新建故事线');
        await page.locator('[data-action="new-chat"]').click();
        await expect(page.locator('[data-action="new-chat"]')).toBeEnabled();
        const created = await page.evaluate(async () => {
            const app = await import('/script.js');
            return { name: app.characters[app.this_chid].chat, kind: app.chat_metadata.leslie_world_line.kind };
        });
        expect(created.name).toContain('故事线');
        expect(created.kind).toBe('story');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.locator('.dreamland-navigation [data-action="settings"]').click();
        const host = await page.locator('#dreamland-page-host').boundingBox();
        const nav = await page.locator('.dreamland-navigation').boundingBox();
        expect(host.x).toBe(0);
        expect(host.width).toBe(width);
        expect(host.y + host.height).toBe(nav.y);
        await page.goBack();
        await expect(page.locator('#send_textarea')).toBeVisible();
        await capture(page, `momotalk-world-lines-${width}`);
        for (const name of ['settings', 'workshop', 'moments', 'background', 'about']) {
            await page.locator(`.dreamland-navigation [data-action="${name}"]`).click();
            expect(await page.locator('#dreamland-page-host').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            await expect(page.locator('.dreamland-navigation [data-action="home"]')).toBeVisible();
            if (width === 320) await capture(page, `momotalk-mobile-page-${name}`);
        }
    });
}

test('BA mobile keyboard viewport leaves the composer reachable and restores navigation', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.leslie-conversation-item').first().click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/leslie-chat-transitioning/);
    await page.locator('#send_textarea').fill('键盘适配的合成草稿');
    await page.locator('#send_textarea').focus();
    // Emulate a keyboard shrinking the visual viewport without resizing the layout viewport.
    await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 500 });
        window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-keyboard', '');
    await expect(page.locator('.dreamland-navigation')).toBeHidden();
    await expect.poll(async () => {
        const composer = await page.locator('#send_textarea').boundingBox();
        return composer.y + composer.height;
    }).toBeLessThanOrEqual(500);
    await page.evaluate(() => {
        delete window.visualViewport.height;
        window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('.dreamland-navigation')).toBeVisible();
    await expect(page.locator('#send_textarea')).toHaveValue('键盘适配的合成草稿');
});

test('BA mobile group chats retain story-only controls and a normal composer', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    const avatars = await page.evaluate(async () => (await import('/script.js')).characters.slice(0, 2).map(character => character.avatar));
    await page.route('**/api/groups/all', route => route.fulfill({ json: [{ id: 'synthetic-group', name: '合成群聊', members: avatars, disabled_members: [], chat_id: 'synthetic-group-chat', chats: ['synthetic-group-chat'], auto_mode_delay: 5 }] }));
    await page.route('**/api/chats/group/get', route => route.fulfill({ json: [
        { chat_metadata: { tainted: true, integrity: 'synthetic-only' } },
        { name: 'Synthetic', is_user: false, mes: '合成群聊的开场。', send_date: '2026-10-01T10:00:00Z' },
    ] }));
    await page.route('**/api/chats/group/save', route => route.fulfill({ json: { result: 'ok' } }));
    await page.evaluate(async () => {
        const app = await import('/script.js');
        await (await import('/scripts/group-chats.js')).getGroups();
        await app.eventSource.emit(app.event_types.GROUP_UPDATED);
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator('.leslie-conversation-item[data-entity-id="synthetic-group"]').click();
    await expect(page.locator('[data-action="line-story"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="line-reality"]')).toBeDisabled();
    await expect(page.locator('[data-action="line-reality"]')).toHaveAttribute('title', '群聊目前仅支持故事线');
    await expect(page.locator('.leslie-new-chat-label')).toHaveText('新建群聊');
    await expect(page.locator('#send_textarea')).toBeVisible();
});

test('MomoTalk uses local game sprites in chat, home and settings', async ({ page }) => {
    test.skip(!process.env.LESLIE_BA_ASSET_PACK, 'Requires the separately installed local artwork pack.'); // eslint-disable-line playwright/no-skipped-test
    await prepare(page);
    await chooseStyle(page, 'blue');
    await expect(page.locator('body')).toHaveAttribute('data-ba-assets', 'ready');
    await expect(page.locator('.dreamland-momotalk-brand')).toBeVisible();
    await page.locator('.leslie-conversation-item').first().click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-ba-bubbles', '');
    expect(await page.locator('#chat > .mes .mes_block').first().evaluate(element => getComputedStyle(element, '::before').borderImageSource)).toContain('School_Chat_BG');
    await page.locator('#send_textarea').fill('原图主题中的合成草稿');
    await capture(page, 'momotalk-original-chat');
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await expect(page.locator('[data-ba-asset-status]')).toContainText('已就绪');
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-page', 'settings');
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).getPropertyValue('--ba-panel'))).toContain('Common_Popup_Bg');
    await capture(page, 'momotalk-original-settings');
    await leaveSettings(page);
    await expect(page.locator('#send_textarea')).toHaveValue('原图主题中的合成草稿');
    await chooseMode(page, 'dark');
    expect(await page.locator('#chat > .mes .mes_block').first().evaluate(element => getComputedStyle(element, '::before').borderImageSource)).toContain('School_Chat_BG_Dark');
    expect(await page.locator('#leslie-chat-header').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(93, 61, 74)');
    await page.evaluate(async () => {
        const app = await import('/script.js');
        const entry = { name: 'User', is_user: true, is_system: false, mes: '今晚一起去天台看流星吧。', send_date: '2026-10-01T12:00:00Z' };
        app.chat.push(entry);
        app.addOneMessage(entry);
    });
    expect(await page.locator('#chat > .mes[is_user="true"] .mes_block').last().evaluate(element => getComputedStyle(element, '::before').borderImageSource)).toContain('School_Chat_BG_Outgoing_Dark');
    await capture(page, 'momotalk-original-chat-dark');
    for (const name of ['settings', 'workshop', 'moments', 'background', 'about']) {
        await page.locator(`.dreamland-navigation [data-action="${name}"]`).click();
        await capture(page, `momotalk-full-page-${name}-dark`);
    }
    await page.locator('.dreamland-navigation [data-action="home"]').click();
    for (const width of [853, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        if (width <= 700 && await page.locator('.leslie-conversation-item').first().isVisible()) await page.locator('.leslie-conversation-item').first().click();
        await expect(page.locator('#send_textarea')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await capture(page, `momotalk-original-chat-${width}`);
    }
});

for (const missing of ['all', 'bubble']) {
    test(`MomoTalk keeps chat usable when ${missing} artwork is unavailable`, async ({ page }) => {
        test.skip(missing === 'bubble' && !process.env.LESLIE_BA_ASSET_PACK, 'Partial recovery requires a local pack.'); // eslint-disable-line playwright/no-skipped-test
        await page.route(missing === 'all' ? '**/img/blue-archive/bundled/**' : '**/img/blue-archive/bundled/School_Chat_BG.png*', route => route.abort());
        await prepare(page);
        await chooseStyle(page, 'blue');
        await expect(page.locator('body')).toHaveAttribute('data-ba-assets', missing === 'all' ? 'missing' : 'partial', { timeout: 15000 });
        if (missing === 'all') {
            await chooseMode(page, 'light');
            for (const action of ['home', 'moments']) {
                const icon = page.locator('.dreamland-navigation [data-action="' + action + '"] i');
                await expect(icon).not.toHaveAttribute('data-ba-icon');
                await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                expect(await icon.evaluate(element => getComputedStyle(element, '::before').visibility)).toBe('visible');
            }
            await capture(page, 'momotalk-readable-fallback-navigation');
        }
        await page.locator('.leslie-conversation-item').first().click();
        await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
        await page.locator('#send_textarea').fill('素材不可用时的合成草稿');
        await page.locator('.dreamland-navigation [data-action="settings"]').click();
        await expect(page.locator('#dreamland-style-select')).toHaveCount(0);
        await leaveSettings(page);


        await expect(page.locator('#send_textarea')).toHaveValue('素材不可用时的合成草稿');
        await page.unroute(missing === 'all' ? '**/img/blue-archive/bundled/**' : '**/img/blue-archive/bundled/School_Chat_BG.png*');
        await openAppearance(page);
        await page.locator('[data-ba-asset-retry]').click();
        await expect(page.locator('body')).toHaveAttribute('data-ba-assets', 'ready', { timeout: 15000 });
        for (const action of ['home', 'moments']) {
            const icon = page.locator('.dreamland-navigation [data-action="' + action + '"] i');
            await expect(icon).toHaveAttribute('data-ba-icon');
            await expect(icon).toHaveCSS('background-image', /blue-archive\/bundled\//);
        }
        await expect(page.locator('[data-ba-asset-status]')).toContainText('已就绪');
        await leaveSettings(page);
        await expect(page.locator('#send_textarea')).toHaveValue('素材不可用时的合成草稿');
    });
}

test('single layout keeps colors independent and follows the system on desktop and mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await prepare(page);
    await openAppearance(page);
    await expect(page.locator('#dreamland-style-select, #dreamland-language-select, #leslie-theme-select')).toHaveCount(0);
    await page.locator('#leslie-display-mode-select').selectOption('auto');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'dark');
    const mode = await page.locator('body').getAttribute('data-dreamland-style');
    for (const palette of ['rose', 'jade', 'iris', 'clay', 'slate']) {
        await page.locator('#leslie-palette-select').selectOption(palette);
        await expect(page.locator('body')).toHaveAttribute('data-leslie-color-palette', palette);
        await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', mode);
    }
    await page.locator('#leslie-palette-select').selectOption('rose');
    await page.locator('#leslie-display-mode-select').selectOption('light');
    await capture(page, 'momotalk-clean-appearance-desktop');
    await page.reload();
    await finishInitialization(page);
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-palette', 'rose');
    await openAppearance(page);
    for (const width of [700, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await openAppearance(page);
        await expect(page.locator('#leslie-palette-select')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await capture(page, 'momotalk-clean-appearance-' + width);
    }
});

test('first-request image failure automatically recovers without refreshing the page', async ({ page }) => {
    let failed = false;
    await page.route('**/img/blue-archive/bundled/School_Chat_BG.png*', async route => {
        if (!failed) { failed = true; await route.abort(); }
        else await route.continue();
    });
    await prepare(page);
    await expect(page.locator('body')).toHaveAttribute('data-ba-assets', 'ready', { timeout: 15000 });
    expect(failed).toBe(true);
    const bubble = await page.locator('body').evaluate(element => element.style.getPropertyValue('--ba-bubble'));
    expect(bubble).toContain('retry=1');
    await openAppearance(page);
    await expect(page.locator('[data-ba-asset-status]')).toContainText('已就绪');
    await expect(page.locator('[data-ba-asset-retry]')).toBeEnabled();
});
