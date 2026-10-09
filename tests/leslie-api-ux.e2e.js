import { E2E_BROWSER_CHANNEL } from './fixtures/e2e-browser.js';
import { expect, test } from '@playwright/test';

test.use({
    channel: E2E_BROWSER_CHANNEL,
    viewport: { width: 1280, height: 900 },
});

async function setCheckboxState(locator, checked) {
    if (await locator.isChecked() !== checked) {
        await locator.setChecked(checked);
    }
}

async function restoreThinkingSettings(page, thinking, effort, thinkingWasEnabled, originalEffort) {
    const needsRestore = await thinking.isChecked() !== thinkingWasEnabled || await effort.inputValue() !== originalEffort;
    if (!needsRestore) {
        return;
    }
    const settingsRestored = page.waitForResponse(response => response.url().endsWith('/api/settings/save') && response.ok());
    await setCheckboxState(thinking, thinkingWasEnabled);
    await effort.selectOption(originalEffort);
    await settingsRestored;
}

test('Leslie reports failed connection checks accurately and keeps thinking easy to disable', async ({ page }) => {
    await page.route('**/api/backends/chat-completions/status', async route => {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":true}' });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));

    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
    await page.locator('[data-leslie-detail="model"]').first().click();

    const simpleThinking = page.locator('#leslie-model-thinking-mode');
    const originalThinking = page.locator('#openai_show_thoughts');
    const reasoningEffort = page.locator('#openai_reasoning_effort');
    await expect(simpleThinking).toBeVisible();
    const thinkingWasEnabled = await originalThinking.isChecked();
    const originalEffort = await reasoningEffort.inputValue();
    await expect(simpleThinking).toHaveJSProperty('checked', thinkingWasEnabled);

    await setCheckboxState(simpleThinking, true);
    const settingsSaved = page.waitForResponse(response => response.url().endsWith('/api/settings/save') && response.ok());
    await simpleThinking.uncheck();
    await settingsSaved;
    await expect(originalThinking).not.toBeChecked();
    await expect(reasoningEffort).toHaveValue('auto');

    await page.locator('[data-leslie-model-connect]').click();
    const modelStatus = page.locator('[data-leslie-model-status]');
    await expect(modelStatus).not.toHaveClass(/is-checking/, { timeout: 10_000 });
    await expect(modelStatus).not.toHaveClass(/is-connected/);
    await expect(modelStatus).toHaveClass(/is-(configured|unconfigured)/);
    await expect(page.locator('[data-leslie-model-connect]')).toBeEnabled();
    await page.screenshot({ path: 'test-results/leslie-api-ux.png', fullPage: true });

    await restoreThinkingSettings(page, originalThinking, reasoningEffort, thinkingWasEnabled, originalEffort);
});
