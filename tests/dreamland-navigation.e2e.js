/* global document, localStorage, getComputedStyle */
import { expect, test } from '@playwright/test';

test.use({ channel: 'msedge', viewport: { width: 1280, height: 900 } });

test('five colored navigation icons separate home from chat and preserve the live draft', async ({ page }) => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    await page.addInitScript(() => localStorage.setItem('language', 'zh-cn'));
    await page.route('**/api/secrets/read', route => route.fulfill({ json: {} }));
    await page.goto('/');
    await page.locator('#preloader').waitFor({ state: 'hidden' });
    await page.evaluate(async () => {
        const app = await import('/script.js');
        await fetch('/api/leslie/demo-mode/switch', {
            method: 'POST', headers: app.getRequestHeaders(), body: JSON.stringify({ enabled: true }),
        });
    });
    await page.reload();
    await page.locator('#preloader').waitFor({ state: 'hidden' });
    const nav = page.locator('.dreamland-navigation');
    await expect(page.locator('body')).toHaveAttribute('data-ba-assets', 'ready');
    expect(await nav.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.action)))
        .toEqual(['home', 'chat', 'moments', 'workshop', 'settings']);
    await nav.locator('[data-action="chat"]').click();
    await expect(page.locator('#chat > .mes').first()).toBeVisible();
    const message = await page.locator('#chat > .mes').first().elementHandle();
    await page.locator('#send_textarea').fill('首页切换应保留这条合成草稿');
    for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await nav.locator('[data-action="home"]').click();
        await expect(page.locator('.dreamland-home-content .leslieHomePanel')).toBeVisible();
        await expect(nav.locator('[data-action="home"]')).toHaveAttribute('aria-current', 'page');
        await nav.locator('[data-action="chat"]').click();
        await expect(page.locator('#send_textarea')).toBeVisible();
        await expect(page.locator('#send_textarea')).toHaveValue('首页切换应保留这条合成草稿');
        expect(await message.evaluate(node => node === document.querySelector('#chat > .mes'))).toBe(true);
        for (const icon of await nav.locator('i').all()) {
            const style = await icon.evaluate(element => {
                const css = getComputedStyle(element);
                return { mask: css.maskImage, size: css.backgroundSize, image: css.backgroundImage };
            });
            expect(style.mask).toBe('none');
            expect(style.size).toBe('contain');
            expect(style.image).toContain('/bundled/');
        }
    }
    await nav.locator('[data-action="settings"]').click();
    if (await page.locator('[data-leslie-settings-nav-back]').isVisible()) {
        await page.locator('[data-leslie-settings-nav-back]').click();
    }
    await page.locator('[data-leslie-settings-about]').click();
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-page', 'about');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-dreamland-page', 'settings');
});
