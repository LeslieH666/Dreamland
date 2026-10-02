import { expect, test } from '@playwright/test';

/* global document, history, localStorage, requestAnimationFrame, window */

test.use({ channel: 'msedge' });

async function preparePage(page) {
    if (process.env.LESLIE_SYNTHETIC_SHOWCASE) {
        await page.route('**/api/secrets/read', route => route.fulfill({ json: {} }));
        await page.route('**/api/quick-replies/save', route => route.fulfill({ json: {} }));
    }
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
    await expect(page.locator('[data-action="line-story"]')).toBeVisible();
    await expect(page.locator('[data-action="line-reality"]')).toBeVisible();
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
    // A saved old layout must migrate without disturbing ordinary chat.
    await page.addInitScript(() => localStorage.setItem('leslie.design.language', 'cupertino'));
    const consoleErrors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await preparePage(page);
    await expectHealthyPage(page);

    const sidebar = page.locator('#leslie-conversation-sidebar');
    const shell = page.locator('#sheld');
    await expect(sidebar).toBeVisible();
    await expect(shell).toBeVisible();
    await expect(page.locator('.leslie-sidebar-actions')).toBeHidden();
    await expect(page.locator('#leslie-chat-actions [data-leslie-privacy-quick-toggle]')).toBeHidden();
    await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
    await expect(shell).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('.leslie-mobile-back')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-design-language', 'dreamland');

    // Chat actions are available after entering a conversation, not on the home page.
    await page.locator('#leslie-conversation-list .leslie-conversation-item').first().click();
    await expect(page.locator('#chat > .mes')).not.toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/leslie-chat-transitioning/);

    expect(await probeMessageMotion(page)).toEqual({ marked: false, animations: 0 });

    const chatMenuButton = page.locator('#leslie-chat-actions [data-action="chat-more"]');
    await chatMenuButton.click();
    await expect(page.locator('#leslie-chat-more-menu')).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#leslie-chat-more-menu')).toBeHidden();

    await page.locator('.dreamland-navigation [data-action="settings"]').click();
    await page.locator('.leslie-settings-nav-item[data-leslie-settings-home]').click();
    await expect(page.locator('#dreamland-language-select')).toHaveCount(0);
    await page.locator('#leslie-display-mode-select').selectOption('light');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#leslie-display-mode-select').selectOption('auto');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'dark');
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await expect(page.locator('body')).toHaveAttribute('data-leslie-color-scheme', 'light');
    await page.locator('.dreamland-navigation [data-action="home"]').click();
    expect(await probeMessageMotion(page)).toEqual({ marked: false, animations: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/leslie-desktop-two-column.png', fullPage: true });
    expect(consoleErrors).toEqual([]);
});
