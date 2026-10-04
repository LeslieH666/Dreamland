/* global document, getComputedStyle, innerWidth */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ channel: 'msedge', viewport: { width: 1280, height: 900 } });
const screenshotDirectory = process.env.LESLIE_SCREENSHOT_DIR || 'test-results';

test('glass controls preview, persist and share with login while chat headers retain their tint', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    test.setTimeout(90000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/secrets/read', route => route.fulfill({ json: {} }));
    await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
    await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
    await page.goto('/');
    await page.locator('#preloader').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    const transparency = page.locator('#dreamland-glass-transparency');
    const blur = page.locator('#dreamland-glass-blur');
    await expect(transparency).toBeVisible();
    await expect(page.locator('.dreamland-glass-preview')).toBeVisible();
    const css = selector => page.locator(selector).evaluate(element => {
        const style = getComputedStyle(element);
        return { color: style.backgroundColor, blur: style.backdropFilter };
    });

    async function setRange(input, value) {
        await input.fill(value);
        await input.dispatchEvent('input');
    }
    await setRange(transparency, '65');
    await setRange(blur, '36');
    await expect(page.locator('[data-dreamland-glass-value="glassTransparency"]')).toHaveText('65%');
    await expect(page.locator('[data-dreamland-glass-value="glassBlur"]')).toHaveText('36 px');
    for (const selector of ['.leslie-settings-header', '.dreamland-glass-preview-white', '.dreamland-glass-preview-login']) {
        expect((await css(selector)).color).toContain('0.35');
        expect((await css(selector)).blur).toBe('blur(36px)');
    }
    expect((await css('#leslie-chat-header')).color).toContain('0.35');
    expect((await css('#leslie-chat-header')).blur).toBe('blur(36px)');
    await page.evaluate(async () => {
        const preferences = await import('/scripts/leslie-user-preferences.js');
        await preferences.flushUserSpacePreferences();
    });
    await page.reload();
    await page.locator('#preloader').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await expect(transparency).toHaveValue('65');
    await expect(blur).toHaveValue('36');
    for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(transparency).toBeVisible();
        await expect(page.locator('.dreamland-glass-preview')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        fs.mkdirSync(screenshotDirectory, { recursive: true });
        await page.locator('.dreamland-glass-settings').screenshot({ path: `${screenshotDirectory}/glass-settings-${width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#leslie-display-mode-select').selectOption('dark');
    expect((await css('.dreamland-glass-preview-white')).color).toContain('0.35');
    await page.locator('.dreamland-navigation [data-action="workshop"]').click();
    expect((await css('.leslie-character-workshop-header')).blur).toBe('blur(36px)');
    expect((await css('.leslie-character-workshop-header')).color).toContain('0.35');
    await page.route('**/glass-login-preview', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync('../public/login.html', 'utf8') }));
    await page.route('**/api/users/mode', route => route.fulfill({ json: { encryptedSpaces: true } }));
    await page.route('**/api/users/list', route => route.fulfill({ json: [{ handle: 'synthetic-glass', name: '合成空间', avatar: '/img/dreamland/icon.svg', password: true }] }));
    await page.goto('/glass-login-preview');
    await expect(page.locator('.userSelect')).toBeVisible();
    expect((await css('#dialogue_popup')).color).toContain('0.35');
    expect((await css('#dialogue_popup')).blur).toBe('blur(36px)');
    expect(await page.locator('#dialogue_popup').evaluate(element => getComputedStyle(element).borderImageSource)).toBe('none');
    await page.goto('/');
    await page.locator('#preloader').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await page.locator('[data-dreamland-glass-reset]').click();
    await expect(transparency).toHaveValue('28');
    await expect(blur).toHaveValue('24');
    await setRange(transparency, '100');
    await setRange(blur, '0');
    expect((await css('.dreamland-glass-preview-white')).color).toContain('0)');
    expect((await css('.dreamland-glass-preview-white')).blur).toBe('blur(0px)');
    await page.locator('[data-dreamland-glass-reset]').click();
    // A real content node must pass beneath the actual header, not a static scene layer.
    async function verifyUnderHeader(scrollSelector, headerSelector, name) {
        const viewport = page.locator(scrollSelector);
        await viewport.evaluate(element => {
            const marker = document.createElement('div');
            marker.dataset.glassScrollMarker = 'true';
            marker.style.cssText = 'height:180px;min-height:180px;flex:0 0 180px;background:rgb(220,70,90);color:white;position:relative;z-index:0';
            marker.textContent = 'Synthetic scrolling content';
            const spacer = document.createElement('div');
            spacer.dataset.glassScrollSpacer = 'true';
            spacer.style.cssText = 'height:1600px;min-height:1600px;flex:0 0 1600px';
            element.append(spacer);
            element.prepend(marker);
            element.scrollTop += marker.getBoundingClientRect().top - element.getBoundingClientRect().top;
        });
        const marker = viewport.locator('[data-glass-scroll-marker]');
        const header = page.locator(headerSelector);
        const bounds = await marker.boundingBox();
        const bar = await header.boundingBox();
        expect(bounds.y).toBeLessThan(bar.y + bar.height);
        expect(bounds.y + bounds.height).toBeGreaterThan(bar.y);
        const before = await header.screenshot();
        await marker.evaluate(element => { element.style.background = 'rgb(40,170,100)'; });
        const after = await header.screenshot();
        expect(before.equals(after)).toBe(false);
        fs.mkdirSync(screenshotDirectory, { recursive: true });
        await header.screenshot({ path: `${screenshotDirectory}/glass-scroll-${name}.png` });
        await marker.evaluate(element => element.remove());
        await viewport.evaluate(element => { element.querySelector('[data-glass-scroll-spacer]')?.remove(); element.scrollTop = 0; });
    }
    await page.locator('.dreamland-navigation [data-action="moments"]').click();
    await expect(page.locator('.leslie-moments-content-pane')).toBeVisible();
    await expect(page.locator('.leslie-moments-busy')).toHaveCount(0);
    await verifyUnderHeader('.leslie-moments-content-pane', '.leslie-moments-header', 'moments');
    await page.locator('.dreamland-navigation [data-action="chat"]').click();
    await verifyUnderHeader('#chat', '#leslie-chat-header', 'chat');
    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    expect(errors).toEqual([]);
});
