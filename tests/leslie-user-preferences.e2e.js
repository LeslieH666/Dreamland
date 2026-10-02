/* global document, localStorage */
/* eslint-disable playwright/no-conditional-in-test */
import { expect, test } from '@playwright/test';

test.use({ channel: 'msedge', viewport: { width: 1280, height: 900 }, actionTimeout: 10000 });
const password = 'synthetic-space-password';

async function api(page, url, body) {
    const token = await (await page.request.get('/csrf-token')).json();
    const response = await page.request.post(url, { headers: { 'X-CSRF-Token': token.token }, data: body });
    expect(response.ok()).toBe(true);
    return response;
}

async function ready(page) {
    await expect(page.locator('#preloader')).toBeHidden({ timeout: 30000 });
    const onboarding = page.locator('.popup[open]:has(#onboarding_ui_language_select)');
    await page.locator('.popup[open]:has(#onboarding_ui_language_select), #chat > .leslieHomePanel, #chat > .mes').first().waitFor({ state: 'visible', timeout: 30000 });
    if (await onboarding.isVisible()) await onboarding.locator('.popup-button-ok').click();
    await expect(page.locator('#leslie-conversation-sidebar')).toBeVisible();
}

async function login(page, handle) {
    await page.goto('/login?noauto=true');
    await page.locator('.userSelect').filter({ has: page.locator('.userHandle', { hasText: handle }) }).click();
    await page.locator('#userPassword').fill(password);
    await page.locator('#loginButton').click();
    await expect(page.locator('.dreamland-login-progress')).toBeVisible();
    await expect(page).toHaveURL(/\/(?:\?.*)?$/, { timeout: 60000 });
    await ready(page);
}

async function settings(page) {
    if (!await page.locator('#leslie-settings-overlay[data-open="true"]').isVisible()) await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await page.locator('.leslie-settings-nav-item[data-leslie-settings-home]').click();
}

async function switchUser(page) {
    await settings(page);
    await page.locator('.leslie-settings-nav-item[data-leslie-detail="spaces"]').click();
    await page.locator('[data-leslie-space-switch]').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 60000 });
}

test('synthetic spaces retain preferences, isolate demo content and theme the login page', async ({ page }) => {
    test.skip(!process.env.LESLIE_USER_SPACES_QA, 'Creates accounts only on the isolated user-space QA server.'); // eslint-disable-line playwright/no-skipped-test
    test.setTimeout(150000);
    await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
    await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
    await page.route('**/api/secrets/read', route => route.fulfill({ json: {} }));
    const mode = await (await page.request.get('/api/users/mode')).json();
    if (!mode.encryptedSpaces) {
        await page.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
        await page.goto('/');
        await ready(page);
        await api(page, '/api/leslie/user-spaces/activate', { password });
    }
    await login(page, 'default-user');
    await settings(page);
    await page.locator('#leslie-palette-select').selectOption('rose');
    await page.locator('#leslie-display-mode-select').selectOption('dark');
    await page.locator('.leslie-settings-nav-item[data-leslie-detail="model"]').click();
    await page.locator('[data-leslie-api-kind="local"]').click();
    await page.locator('#leslie-local-model-loading').uncheck();
    await page.evaluate(() => localStorage.setItem('synthetic-private-draft', 'synthetic draft to clear'));
    await expect.poll(async () => (await (await page.request.get('/api/leslie/preferences')).json()).values['leslie-local-model-loading-enabled']).toBe('false');
    const users = await (await api(page, '/api/users/list', {})).json();
    if (!users.some(user => user.handle === 'synthetic-guest')) await api(page, '/api/users/create', { handle: 'synthetic-guest', name: 'Synthetic Guest', password });
    await settings(page);
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#leslie-settings-overlay [data-leslie-demo-toggle]').click()]);
    await expect(page.locator('#leslie-demo-mode-banner')).toBeVisible({ timeout: 30000 });
    await ready(page);
    await expect(page.locator('.leslie-conversation-item').filter({ hasText: '星澄 · 星空演示' })).toBeVisible();
    await page.locator('.leslie-conversation-item').filter({ hasText: '星澄 · 星空演示' }).click();
    await expect(page.locator('#chat > .mes')).toHaveCount(16);
    await page.locator('#leslie-memory-launcher').click();
    await expect(page.locator('#leslie-memory-status')).not.toContainText('正在读取');
    await expect(page.locator('#leslie-memory-panel')).toContainText('尊重彼此的表达');
    await page.locator('.leslie-memory-tab[data-tab="growth"]').click();
    await expect(page.locator('#leslie-memory-panel')).toContainText('主动邀请朋友');
    await page.locator('.leslie-memory-tab[data-tab="relationship"]').click();
    await expect.poll(async () => Number(await page.locator('.leslie-relationship-overall strong').textContent())).toBeGreaterThan(0);
    await page.locator('#leslie-memory-panel [data-action="close"]').click();
    await page.locator('.dreamland-navigation [data-action="moments"]').click();
    await expect(page.locator('.leslie-moments-page')).toContainText('柠檬饼干');
    await expect(page.locator('.leslie-moments-page')).toContainText('下次也一起去吧');
    await page.locator('.dreamland-navigation [data-action="home"]').click();
    await settings(page);
    await page.locator('#leslie-palette-select').selectOption('clay');
    await page.locator('#leslie-display-mode-select').selectOption('light');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#leslie-settings-overlay [data-leslie-demo-toggle]').click()]);
    await ready(page);
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'blue');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'dark');
    await expect(page.locator('.leslie-conversation-item').filter({ hasText: '星澄 · 星空演示' })).toHaveCount(0);
    await switchUser(page);
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'blue');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'dark');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-palette', 'rose');
    expect(await page.evaluate(() => localStorage.getItem('synthetic-private-draft'))).toBeNull();
    await login(page, 'synthetic-guest');
    await settings(page);
    await page.locator('#leslie-palette-select').selectOption('slate');
    await page.locator('#leslie-display-mode-select').selectOption('light');
    await switchUser(page);
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-palette', 'slate');
    await page.locator('.userSelect').filter({ has: page.locator('.userHandle', { hasText: 'default-user' }) }).click();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-palette', 'rose');
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'blue');
    await login(page, 'default-user');
    expect((await (await page.request.get('/api/leslie/preferences')).json()).values['dreamland.appearance.style']).toBe('blue');
    expect(await page.evaluate(() => localStorage.getItem('dreamland.appearance.style'))).toBe('blue');
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'blue');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'dark');
    await settings(page);
    await page.locator('.leslie-settings-nav-item[data-leslie-detail="model"]').click();
    await page.locator('[data-leslie-api-kind="local"]').click();
    await expect(page.locator('#leslie-local-model-loading')).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-leslie-settings-nav-back]').click();
    await page.locator('.leslie-settings-nav-item[data-leslie-detail="spaces"]').click();
    await page.locator('[data-leslie-space-switch]').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 60000 });
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-style', 'blue');
    await expect(page.locator('.userSelect').first()).toBeVisible();
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
});
