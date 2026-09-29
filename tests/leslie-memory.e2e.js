import { expect, test } from '@playwright/test';

/* global document */

test.use({
    channel: 'msedge',
    viewport: { width: 1280, height: 900 },
});

test.describe.configure({ mode: 'serial' });

async function preparePage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();

    const onboarding = page.locator('.popup[open]:has(.onboarding)').first();
    await onboarding.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await onboarding.isVisible()) {
        await onboarding.locator('.popup-input').fill('Leslie Test Persona');
        await onboarding.locator('.popup-button-ok').click();
        await expect(onboarding).toBeHidden();
    }

    await page.locator('.popup[open]').evaluateAll(popups => popups.forEach(popup => popup.close()));
}

async function openTestCharacter(page) {
    const characters = page.locator('#leslie-conversation-list .leslie-conversation-item[data-entity-type="character"]');
    const character = characters.filter({ hasText: 'Seraphina' }).first();
    await expect(character).toBeVisible();
    await character.click();
    await expect(page.locator('#send_textarea')).toBeVisible();
}

test('Leslie role memory supports its safe manual workflow', async ({ page }) => {
    const consoleErrors = [];
    const failedMemoryResponses = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('response', response => {
        if (response.status() >= 500 && response.url().includes('/api/leslie/memory')) {
            failedMemoryResponses.push(`${response.status()} ${response.url()}`);
        }
    });

    await preparePage(page);
    await openTestCharacter(page);

    const launcher = page.locator('#leslie-memory-launcher');
    await expect(launcher).toBeVisible();
    await launcher.click();

    const overlay = page.locator('#leslie-memory-overlay');
    await expect(overlay).toBeVisible();
    const panel = page.locator('#leslie-memory-panel');
    const panelBox = await panel.boundingBox();
    expect(Math.abs(panelBox.x - ((1280 - panelBox.width) / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(panelBox.y - ((900 - panelBox.height) / 2))).toBeLessThanOrEqual(1);
    await expect(panel).toHaveCSS('border-radius', '14px');
    await expect(page.locator('#leslie-memory-title')).toHaveText('角色记忆');
    await expect(page.locator('#leslie-memory-add-form')).toBeVisible();

    await page.locator('#leslie-memory-summary').fill('浏览器验收：角色答应下次共同讨论重要决定。');
    await page.locator('#leslie-memory-level').selectOption('A');
    await page.locator('#leslie-memory-tags').fill('验收, 承诺');
    await page.locator('#leslie-memory-add-form button[type="submit"]').click();
    await expect(page.locator('.leslie-memory-event-summary').first()).toContainText('共同讨论重要决定');
    await expect(page.locator('.leslie-memory-level.level-a').first()).toBeVisible();

    await page.locator('#leslie-memory-enabled').check();
    await expect(page.locator('#leslie-memory-status')).toContainText('已启用');
    await expect(launcher).toHaveAttribute('data-state', 'enabled');

    await page.locator('[data-tab="relationship"]').click();
    await expect(page.locator('.leslie-memory-relationship-intro')).toContainText('实验性功能');
    await expect(page.locator('.leslie-relationship-bars')).toContainText('好感度');
    await page.locator('#leslie-relationship-enabled').check();
    await expect(page.locator('.leslie-memory-relationship-intro')).toContainText('已开启');

    await page.locator('[data-tab="growth"]').click();
    await page.locator('#leslie-growth-relationship').fill('从初次认识发展为愿意共同讨论决定的伙伴。');
    await page.locator('#leslie-memory-growth-form button[type="submit"]').click();
    await expect(page.locator('#leslie-growth-relationship')).toHaveValue(/共同讨论决定/);

    const injectedPrompts = await page.evaluate(async () => {
        const memoryExtension = await import('/scripts/extensions/leslie-memory/index.js');
        await memoryExtension.preparePrompt([], 8192, null, 'normal');
        const { getContext } = await import('/scripts/st-context.js');
        return getContext().extensionPrompts;
    });
    expect(injectedPrompts.leslie_memory_growth.value).toContain('共同讨论决定');
    expect(injectedPrompts.leslie_memory_events.value).toContain('共同讨论重要决定');
    expect(injectedPrompts.leslie_memory_relationship.value).toContain('互动关系状态');
    expect(injectedPrompts.leslie_memory_relationship.value).toContain('好感度：0/100');
    expect(injectedPrompts.leslie_memory_growth.role).toBe(0);
    expect(injectedPrompts.leslie_memory_events.depth).toBe(4);

    await page.locator('[data-tab="settings"]').click();
    await expect(page.locator('.leslie-memory-identity-card.safe')).toContainText('已隔离');
    await expect(page.locator('.leslie-memory-identity-card.safe')).toContainText('当前 Persona');
    await expect(page.locator('.leslie-memory-core')).toContainText('受保护的原始角色核心');
    await expect(page.locator('.leslie-memory-prompt-preview')).toContainText('当前用户消息的剧情身份');
    const connectionUi = await page.evaluate(async () => {
        const { getContext } = await import('/scripts/st-context.js');
        const modelConnected = getContext().onlineStatus !== 'no_connection';
        return {
            modelConnected,
            noteHidden: document.querySelector('.leslie-memory-connection-note')?.hidden,
            extractDisabled: document.querySelector('[data-action="extract-now"]')?.disabled,
        };
    });
    const connectionNote = page.locator('.leslie-memory-connection-note');
    await expect(connectionNote).toContainText('尚未配置或连接');
    expect(connectionUi.noteHidden).toBe(connectionUi.modelConnected);
    expect(connectionUi.extractDisabled).toBe(!connectionUi.modelConnected);
    await expect(page.locator('[data-action="restore-state"]').first()).toBeVisible();

    expect(failedMemoryResponses).toEqual([]);
    expect(consoleErrors.filter(message => !message.includes('Failed to load resource'))).toEqual([]);
});

test('Leslie role memory explains a stale backend instead of showing a technical 404', async ({ page }) => {
    await preparePage(page);
    await openTestCharacter(page);
    await page.route('**/api/leslie/memory/ensure', route => route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'NOT_FOUND' }),
    }));

    await page.locator('#leslie-memory-launcher').click();
    const banner = page.locator('#leslie-memory-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/error/);
    await expect(banner).toContainText('完全关闭 SillyTavern');
    await expect(banner).toContainText('重新打开');
});

test('Leslie role memory panel fits a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page);
    await openTestCharacter(page);

    await page.locator('#leslie-memory-launcher').click();
    await expect(page.locator('#leslie-memory-overlay')).toHaveClass(/leslie-memory-open/);
    const panel = page.locator('#leslie-memory-panel');
    await expect(panel).toBeVisible();
    await expect.poll(async () => Math.abs((await panel.boundingBox()).width - 390)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await panel.boundingBox()).height - 844)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-tab="memories"]')).toBeVisible();
    await expect(page.locator('[data-tab="settings"]')).toBeVisible();
});
