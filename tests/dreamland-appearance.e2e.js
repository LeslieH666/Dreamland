/* global document, localStorage, window */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ channel: 'msedge', viewport: { width: 1280, height: 900 } });

const screenshotDirectory = process.env.LESLIE_SCREENSHOT_DIR || 'test-results';
async function capture(page, name) {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ animations: 'disabled', path: path.join(screenshotDirectory, `${name}.png`) });
}

async function prepare(page) {
    await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
    await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
    if (process.env.LESLIE_SYNTHETIC_SHOWCASE) {
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
    await chooseStyle(page, 'clear');
    await page.locator('.leslie-theme-toggle').click();
    await page.locator('#leslie-theme-menu [data-leslie-theme-mode="light"]').click();
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
    await page.locator('[data-workshop-action="close"]').click();
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await page.locator('.leslie-settings-nav-item[data-leslie-detail="model"]').click();
    await expect(page.locator('#leslie-settings-overlay')).toBeVisible();
    await capture(page, 'dreamland-showcase-model');
});

test('login branding uses local style with synthetic user list', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('dreamland.appearance.style', 'paper');
        localStorage.setItem('leslie.theme.preference', 'light');
    });
    await page.route('**/dreamland-login-preview', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync('../public/login.html', 'utf8') }));
    await page.route('**/api/users/list', route => route.fulfill({ json: [{ handle: 'dreamland-qa', name: '合成演示空间', avatar: '/img/dreamland/icon.svg', password: true }] }));
    await page.goto('/dreamland-login-preview');
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'paper');
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

async function chooseStyle(page, style) {
    await page.locator('.leslie-theme-toggle').click();
    await page.locator(`#leslie-theme-menu [data-dreamland-style="${style}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', style);
    await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'dreamland');
}

for (const style of ['clear', 'moon', 'paper', 'blue']) {
    test(`${style}: switch preserves chat controls, drafts and saved appearance`, async ({ page }) => {
        await prepare(page);
        await page.locator('.leslie-conversation-item').first().click();
        await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
        await page.locator('#send_textarea').fill('合成草稿：今晚去看流星吧。');
        const before = await page.locator('#chat > .mes').allTextContents();
        await chooseStyle(page, style);
        await page.locator('.leslie-theme-toggle').click();
        await page.locator(`#leslie-theme-menu [data-leslie-theme-mode="${style === 'moon' ? 'dark' : 'light'}"]`).click();
        await expect(page.locator('#send_textarea')).toHaveValue('合成草稿：今晚去看流星吧。');
        expect(await page.locator('#chat > .mes').allTextContents()).toEqual(before);
        await expect(page.locator('#leslie-chat-actions [data-action="chat-more"]')).toBeVisible();
        await page.locator('#leslie-chat-actions [data-action="chat-more"]').click();
        await expect(page.locator('.leslie-chat-more-menu [data-action="world-info"]')).toBeVisible();
        await page.locator('#leslie-chat-actions [data-action="chat-more"]').click();
        await capture(page, `dreamland-${style}-chat`);
        await page.reload();
        await finishInitialization(page);
        await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', style);
        await page.locator('.leslie-theme-toggle').click();
        await page.locator('#leslie-theme-menu [data-leslie-design-language="classic"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'classic');
        await expect(page.locator('.dreamland-navigation')).toBeHidden();
        await chooseStyle(page, style);
        expect(await page.evaluate(() => localStorage.getItem('dreamland.appearance.style'))).toBe(style);
    });

    test(`${style}: desktop and mobile appearance is readable and reachable`, async ({ page }) => {
        await prepare(page);
        await chooseStyle(page, style);
        await page.locator('.leslie-theme-toggle').click();
        await page.locator('#leslie-theme-menu [data-leslie-theme-mode="light"]').click();
        await page.locator('.dreamland-navigation [data-action="home"]').click();
        await expect(page.locator('.leslieHomePanel')).toBeVisible();
        await capture(page, `dreamland-${style}-home`);
        await page.locator('.dreamland-navigation [data-action="settings"]').click();
        await expect(page.locator('#dreamland-style-select')).toHaveValue(style);
        await page.locator('#dreamland-decoration-select').selectOption('off');
        await expect(page.locator('body')).toHaveAttribute('data-dreamland-decoration', 'off');
        for (const background of ['soft', 'visible', 'off']) {
            await page.locator('#dreamland-background-select').selectOption(background);
            await expect(page.locator('body')).toHaveAttribute('data-dreamland-background', background);
        }
        await capture(page, `dreamland-${style}-settings`);
        await page.locator('[data-leslie-settings-close]').click();
        await page.locator('.dreamland-navigation [data-action="about"]').click();
        await expect(page.locator('.dreamland-about')).toContainText('非商业');
        await expect(page.locator('.dreamland-about')).toContainText('Blue Archive');
        await page.locator('.popup[open] .popup-button-ok').click();
        await page.locator('.leslie-theme-toggle').click();
        await page.locator('#leslie-theme-menu [data-leslie-theme-mode="dark"]').click();
        await capture(page, `dreamland-${style}-dark`);
        for (const width of [700, 390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await expect(page.locator('.dreamland-navigation [data-action="about"]')).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.locator('.leslie-theme-toggle').click();
            await expect(page.locator('#leslie-theme-menu [data-dreamland-style="blue"]')).toBeVisible();
            await page.locator('#leslie-theme-menu [data-leslie-theme-mode="dark"]').click();
            await capture(page, `dreamland-${style}-${width}`);
        }
    });
}
