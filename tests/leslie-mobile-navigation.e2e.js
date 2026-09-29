import { expect, test } from '@playwright/test';

/* global document, history, localStorage, requestAnimationFrame, window */

test.use({ channel: 'msedge' });

async function preparePage(page) {
    await page.route('**/api/horde/status', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
    }));
    await page.route('**/api/horde/text-models', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await page.locator('.popup[open]').evaluateAll(popups => popups.forEach(popup => popup.close()));
}

function collectConsoleErrors(page) {
    const errors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });
    return errors;
}

async function expectHealthyPage(page) {
    expect(await page.locator('body').innerText()).not.toHaveLength(0);
    await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')).toHaveCount(0);
}

async function probeMessageMotion(page, isUser = false) {
    return page.evaluate(async (userMessage) => {
        const probe = document.createElement('div');
        probe.className = 'mes';
        probe.setAttribute('is_user', String(userMessage));
        const block = document.createElement('div');
        block.className = 'mes_block';
        block.textContent = 'Synthetic motion probe';
        probe.append(block);
        document.getElementById('chat').append(probe);
        await new Promise(resolve => requestAnimationFrame(resolve));
        const result = {
            marked: probe.classList.contains('leslie-message-enter'),
            animations: probe.getAnimations({ subtree: true }).length,
        };
        probe.remove();
        return result;
    }, isUser);
}

test('mobile starts on contacts and enters a dedicated chat page', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page);
    await expectHealthyPage(page);

    const body = page.locator('body');
    const sidebar = page.locator('#leslie-conversation-sidebar');
    const shell = page.locator('#sheld');
    const firstConversation = page.locator('#leslie-conversation-list .leslie-conversation-item').first();

    await expect(sidebar).toBeVisible();
    await expect(shell).toHaveAttribute('aria-hidden', 'true');
    await expect(body).not.toHaveClass(/leslie-mobile-chat-open/);
    await expect(firstConversation).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/leslie-mobile-contacts.png', fullPage: true });

    await firstConversation.click();
    await expect(body).toHaveClass(/leslie-mobile-chat-open/);
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute('aria-hidden', 'false');
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.leslie-mobile-back')).toBeVisible();
    const messageChrome = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.className = 'mes';
        document.querySelector('#chat').append(probe);
        const style = window.getComputedStyle(probe);
        const result = { backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth };
        probe.remove();
        return result;
    });
    expect(messageChrome).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', borderTopWidth: '0px' });
    await page.screenshot({ path: 'test-results/leslie-mobile-chat.png', fullPage: true });

    await page.locator('.leslie-mobile-back').click();
    await expect(body).not.toHaveClass(/leslie-mobile-chat-open/);
    await expect(sidebar).toBeVisible();
    await expect(shell).toHaveAttribute('aria-hidden', 'true');

    await firstConversation.click();
    await expect(body).toHaveClass(/leslie-mobile-chat-open/);
    await page.evaluate(() => history.back());
    await expect(body).not.toHaveClass(/leslie-mobile-chat-open/);
    await expect(sidebar).toBeVisible();
    expect(consoleErrors).toEqual([]);
});

test('desktop keeps contacts and chat visible together', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await preparePage(page);
    await expectHealthyPage(page);

    const sidebar = page.locator('#leslie-conversation-sidebar');
    const shell = page.locator('#sheld');
    await expect(sidebar).toBeVisible();
    await expect(shell).toBeVisible();
    await expect(page.locator('.leslie-sidebar-actions [data-leslie-privacy-quick-toggle]')).toBeVisible();
    await expect(page.locator('#leslie-chat-actions [data-leslie-privacy-quick-toggle]')).toBeHidden();
    await expect(sidebar).not.toHaveAttribute('aria-hidden', /.+/);
    await expect(shell).not.toHaveAttribute('aria-hidden', /.+/);
    await expect(page.locator('.leslie-mobile-back')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'cupertino');

    const cupertinoMotion = await probeMessageMotion(page, true);
    expect(cupertinoMotion.marked).toBe(true);
    expect(cupertinoMotion.animations).toBeGreaterThan(0);

    const chatMenuButton = page.locator('#leslie-chat-actions [data-action="chat-more"]');
    await chatMenuButton.click();
    await expect(page.locator('#leslie-chat-more-menu')).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#leslie-chat-more-menu')).toBeHidden();

    const appearanceButton = page.locator('.leslie-sidebar-actions .leslie-theme-toggle');
    await appearanceButton.click();
    await expect(page.locator('#leslie-theme-menu')).toBeVisible();
    await expect(page.locator('#leslie-theme-menu [data-leslie-design-language="cupertino"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#leslie-theme-menu [data-leslie-theme-mode="light"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('leslie.theme.preference'))).toBe('light');

    await appearanceButton.click();
    await page.locator('#leslie-theme-menu [data-leslie-design-language="classic"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'classic');
    expect(await page.evaluate(() => localStorage.getItem('leslie.design.language'))).toBe('classic');
    expect(await probeMessageMotion(page)).toEqual({ marked: false, animations: 0 });

    await appearanceButton.click();
    await page.locator('#leslie-theme-menu [data-leslie-design-language="cupertino"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'cupertino');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await probeMessageMotion(page)).toEqual({ marked: false, animations: 0 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await appearanceButton.click();
    await page.locator('#leslie-theme-menu [data-leslie-theme-mode="auto"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-theme-preference', 'auto');
    expect(await page.evaluate(() => localStorage.getItem('leslie.theme.preference'))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/leslie-desktop-two-column.png', fullPage: true });
    expect(consoleErrors).toEqual([]);
});
