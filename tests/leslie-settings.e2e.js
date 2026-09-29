/* eslint-disable playwright/no-conditional-in-test */
/* global document, localStorage, sessionStorage */
import { expect, test } from '@playwright/test';

test.use({
    channel: 'msedge',
    viewport: { width: 1280, height: 900 },
});

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
    await expect(page.locator('#preloader')).toBeHidden({ timeout: 30_000 });
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));
}

test('Leslie settings keeps essentials clear and advanced tools guarded', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });

    await preparePage(page);

    const launcher = page.locator('#leslie-settings-launcher');
    await expect(page.locator('#leslie-conversation-sidebar')).toBeVisible();
    await expect(launcher).toBeHidden();
    await expect(page.locator('#ai-config-button > .drawer-toggle')).toBeHidden();
    await expect(page.locator('#rightNavHolder > .drawer-toggle')).toBeHidden();

    const conversationSidebarBox = await page.locator('#leslie-conversation-sidebar').boundingBox();

    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();

    const overlay = page.locator('#leslie-settings-overlay');
    const panel = page.locator('.leslie-settings-panel');
    const settingsMaster = page.locator('.leslie-settings-master');
    const settingsContent = page.locator('.leslie-settings-content-pane');
    const settingsNavigation = page.locator('.leslie-settings-navigation');
    const advancedPreview = page.locator('.leslie-advanced-preview');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('opacity', '1');
    await expect(page.locator('.leslie-settings-backdrop')).toHaveCount(0);
    await expect(panel).not.toHaveAttribute('aria-modal', 'true');
    await expect.poll(async () => Math.abs((await panel.boundingBox()).x)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await panel.boundingBox()).y)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await panel.boundingBox()).width - 1280)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await panel.boundingBox()).height - 900)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await settingsMaster.boundingBox()).width - conversationSidebarBox.width)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await settingsContent.boundingBox()).x - conversationSidebarBox.width)).toBeLessThanOrEqual(1);
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));
    await expect(settingsNavigation.locator('[data-leslie-detail="model"]')).toBeVisible();
    await expect(settingsNavigation.locator('[data-leslie-detail="character"]')).toBeVisible();
    await expect(advancedPreview).toHaveAttribute('aria-hidden', 'true');
    await expect(advancedPreview.locator('button').first()).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('#leslie-advanced-relock')).toBeHidden();
    await expect(page.locator('#leslie-theme-select')).toHaveValue(await page.locator('#themes').inputValue());

    await settingsNavigation.locator('[data-leslie-detail="model"]').click();
    await expect(page.locator('#leslie-settings-home')).toBeHidden();
    await expect(page.locator('#leslie-settings-detail')).toBeVisible();
    await expect(page.locator('.leslie-detail-hero h2')).toHaveText('Model connection');
    await expect(page.locator('[data-leslie-api-kind]')).toHaveCount(2);
    await page.locator('[data-leslie-api-kind="online"]').click();
    await expect(page.locator('[data-leslie-api-kind="online"]')).toHaveClass(/is-active/);
    await expect(page.locator('.leslie-service-card')).toHaveCount(6);
    await expect(page.locator('[data-leslie-service="deepseek"]')).toBeVisible();
    await page.locator('[data-leslie-api-kind="local"]').click();
    await expect(page.locator('[data-leslie-api-kind="local"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-leslie-local-model-directory]')).toContainText('models/');
    await expect(page.locator('[data-leslie-local-model-catalog]')).toBeVisible();
    await expect(page.locator('.leslie-local-advanced')).not.toHaveAttribute('open');
    await page.locator('.leslie-local-advanced > summary').click();
    await expect(page.locator('.leslie-service-card')).toHaveCount(5);
    await expect(page.locator('[data-leslie-service="ollama"]')).toBeVisible();
    await expect(page.locator('#leslie-local-model-loading')).toBeChecked();
    await expect(page.locator('[data-leslie-local-model-detect]')).toBeEnabled();
    await expect(page.locator('[data-leslie-local-model-setup]')).toHaveCount(0);
    await page.locator('#leslie-local-model-loading').uncheck();
    await expect(page.locator('[data-leslie-local-model-detect]')).toBeDisabled();
    await page.locator('#leslie-local-model-loading').check();
    await expect(page.locator('[data-leslie-local-model-detect]')).toBeEnabled();
    await page.locator('[data-leslie-api-kind="online"]').click();
    await expect(page.locator('[data-leslie-drawer-target="sys-settings-button"]')).toBeVisible();

    await settingsNavigation.locator('[data-leslie-detail="reply"]').click();
    const mainApi = await page.locator('#main_api').inputValue();
    const replyLengthSource = { openai: '#openai_max_tokens' }[mainApi] ?? '#amount_gen';
    const originalLength = await page.locator(replyLengthSource).inputValue();
    const originalCreativity = await page.locator('#leslie-reply-creativity').inputValue();
    await expect(page.locator('[data-leslie-reply-style]')).toHaveCount(5);
    await expect(page.locator('#leslie-reply-length')).toHaveCount(0);
    await expect(page.locator('#leslie-reply-context')).toHaveCount(0);
    await page.locator('[data-leslie-reply-style="novel"]').click();
    await expect(page.locator(replyLengthSource)).toHaveValue(originalLength);
    await expect(page.locator('#leslie-reply-creativity')).toHaveValue(originalCreativity);
    await expect(page.locator('[data-leslie-reply-style="novel"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.leslie-detail-callout')).toContainText('model service decides reply length');
    await expect.poll(() => page.evaluate(async () => {
        const { extension_settings } = await import('/scripts/extensions.js');
        return extension_settings.leslieReplyStyle?.style;
    })).toBe('novel');
    const injection = await page.evaluate(async () => {
        const script = await import('/script.js');
        await document.defaultView.LeslieReplyStylePreparePrompt([], 8192, () => {}, 'normal');
        const prompt = structuredClone(script.extension_prompts.leslie_reply_style);
        await document.defaultView.LeslieReplyStylePreparePrompt([], 8192, () => {}, 'quiet');
        return { prompt, quietValue: script.extension_prompts.leslie_reply_style?.value };
    });
    expect(injection.prompt.value).toContain('Use cohesive, vivid literary prose');
    expect(injection.prompt.value).toContain('Do not target a fixed word count or token count.');
    expect(injection.prompt.value).not.toMatch(/\b(180|360|500|1500)\b/);
    expect(injection.quietValue).toBe('');

    for (const [detail, title] of [['character', 'Characters & chats'], ['persona', 'My identity'], ['world', 'World & memory']]) {
        await settingsNavigation.locator(`[data-leslie-detail="${detail}"]`).click();
        await expect(page.locator('.leslie-detail-hero h2')).toHaveText(title);
    }

    await page.locator('[data-leslie-settings-anchor="advanced"]').click();
    await expect(page.locator('#leslie-settings-home')).toBeVisible();
    await expect(page.locator('#leslie-settings-detail')).toBeHidden();
    await page.locator('#leslie-advanced-unlock').click();
    await expect(advancedPreview).toHaveAttribute('aria-hidden', 'false');
    await expect(advancedPreview.locator('button').first()).not.toHaveAttribute('tabindex', '-1');
    await expect(page.locator('#leslie-advanced-relock')).toBeVisible();

    await page.locator('[data-leslie-drawer-target="advanced-formatting-button"]').click();
    await expect(overlay).toBeHidden();
    await expect(page.locator('#AdvancedFormatting')).toHaveClass(/openDrawer/);

    expect(consoleErrors).toEqual([]);
});

test('mobile local API quick setup asks the LeslieTavern host to detect a running model', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let detectRequests = 0;
    await page.route('**/api/leslie/local-model/detect', route => {
        detectRequests++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                detected: {
                    runtime: 'koboldcpp',
                    apiType: 'koboldcpp',
                    endpoint: 'http://127.0.0.1:5001',
                    model: 'Qwen3.5-text-9B-NSFW-RP-RolePlay.Q4_K_M.gguf',
                },
            }),
        });
    });
    await preparePage(page);
    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
    await page.locator('.leslie-settings-navigation [data-leslie-detail="model"]').click();
    await page.locator('[data-leslie-api-kind="local"]').click();

    const quickSetup = page.locator('[data-leslie-local-model-detect]');
    await expect(quickSetup).toBeVisible();
    await expect(quickSetup).toBeEnabled();
    await expect(page.locator('.leslie-local-advanced')).not.toHaveAttribute('open');
    await quickSetup.click();
    await expect.poll(() => detectRequests).toBe(1);
    await expect(page.locator('#main_api')).toHaveValue('textgenerationwebui');
    await expect(page.locator('#textgen_type')).toHaveValue('koboldcpp');
    await expect(page.locator('#koboldcpp_api_url_text')).toHaveValue('http://127.0.0.1:5001/');
});

test('authenticated browser can read the host model catalog without exposing process paths', async ({ page }) => {
    await preparePage(page);
    const result = await page.evaluate(async () => {
        const { getRequestHeaders } = await import('/script.js');
        const response = await fetch('/api/leslie/local-model/status', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        const rejectedModel = await fetch('/api/leslie/local-model/start', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ modelId: '../outside.gguf' }),
        });
        const rejectedCsrf = await fetch('/api/leslie/local-model/status', { method: 'POST' });
        return { code: response.status, body: await response.json(), invalidCode: rejectedModel.status, csrfCode: rejectedCsrf.status };
    });
    expect(result.code).toBe(200);
    expect(result.body).toMatchObject({ available: true, remoteManaged: true, localModels: { directory: 'models/' } });
    expect(result.body.localModels.models).toEqual(expect.any(Array));
    expect(result.body.services.localModel).not.toHaveProperty('pid');
    expect(result.body.services.localModel).not.toHaveProperty('path');
    expect(result.invalidCode).toBe(400);
    expect(result.csrfCode).toBe(403);
});

test('mobile quick setup starts the selected computer model when none is running', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let startedModelId = '';
    const modelId = 'synthetic-roleplay.gguf';
    const status = () => ({
        available: true,
        remoteManaged: true,
        localModels: { directory: 'models/', models: [{ id: modelId, name: 'synthetic-roleplay', sizeBytes: 24 }] },
        services: { localModel: { state: startedModelId ? 'running' : 'stopped', configured: true, runtimeInstalled: true, modelId: startedModelId || null } },
    });
    await page.route('**/api/leslie/local-model/status', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(status()),
    }));
    await page.route('**/api/leslie/local-model/start', route => {
        startedModelId = route.request().postDataJSON().modelId;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: status() }) });
    });
    await page.route('**/api/leslie/local-model/probe', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ probe: { runtime: 'koboldcpp', endpoint: 'http://127.0.0.1:5001', models: ['synthetic-roleplay'] } }),
    }));
    await page.route('**/api/leslie/local-model/detect', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ detected: null }),
    }));

    await preparePage(page);
    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
    await page.locator('.leslie-settings-navigation [data-leslie-detail="model"]').click();
    await page.locator('[data-leslie-api-kind="local"]').click();
    await expect(page.locator('[data-leslie-local-model-select]')).toHaveValue(modelId);
    await page.locator('[data-leslie-local-model-detect]').click();

    await expect.poll(() => startedModelId).toBe(modelId);
    await expect(page.locator('#main_api')).toHaveValue('textgenerationwebui');
    await expect(page.locator('#textgen_type')).toHaveValue('koboldcpp');
    await expect(page.locator('#koboldcpp_api_url_text')).toHaveValue('http://127.0.0.1:5001/');
    await expect(page.locator('[data-leslie-local-model-detect-status]')).toHaveAttribute('data-state', 'success');
});

test('Leslie settings becomes a full-screen settings page on phones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page);
    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));

    const overlay = page.locator('#leslie-settings-overlay');
    const panel = page.locator('.leslie-settings-panel');
    const settingsMaster = page.locator('.leslie-settings-master');
    const settingsContent = page.locator('.leslie-settings-content-pane');
    const settingsNavigation = page.locator('.leslie-settings-navigation');
    await expect(overlay).toHaveCSS('opacity', '1');
    await expect.poll(async () => Math.abs((await panel.boundingBox()).width - 390)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await panel.boundingBox()).height - 844)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await settingsMaster.boundingBox()).x)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await settingsMaster.boundingBox()).width - 390)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await settingsContent.boundingBox()).x - 390)).toBeLessThanOrEqual(1);
    const navigationRows = await settingsNavigation.locator('[data-leslie-detail]').evaluateAll((elements) => elements.slice(0, 3).map((element) => element.getBoundingClientRect().y));
    expect(navigationRows[1]).toBeGreaterThan(navigationRows[0]);
    expect(navigationRows[2]).toBeGreaterThan(navigationRows[1]);

    await settingsNavigation.locator('[data-leslie-detail="reply"]').click();
    await expect(overlay).toHaveClass(/leslie-settings-mobile-detail/);
    await expect.poll(async () => Math.abs((await settingsContent.boundingBox()).x)).toBeLessThanOrEqual(1);
    await expect(page.locator('#leslie-settings-detail')).toBeVisible();
    await expect(page.locator('.leslie-detail-hero h2')).toHaveText('Reply style');
    await expect(page.locator('[data-leslie-reply-style]')).toHaveCount(5);
    await expect(page.locator('[data-leslie-reply-style="novel"]')).toContainText('Long-form novel');
    const presetColumns = await page.locator('.leslie-style-presets').evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).gridTemplateColumns.split(' '));
    expect(presetColumns).toHaveLength(2);
    const detailColumns = await page.locator('.leslie-detail-grid').first().evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).gridTemplateColumns.split(' '));
    expect(detailColumns).toHaveLength(1);
    await expect(page.locator('#leslie-reply-length')).toHaveCount(0);
    await expect(page.locator('[data-leslie-drawer-target="ai-config-button"]')).toBeVisible();

    await page.locator('[data-leslie-settings-nav-back]').click();
    await expect(overlay).not.toHaveClass(/leslie-settings-mobile-detail/);
    await expect.poll(async () => Math.abs((await settingsMaster.boundingBox()).x)).toBeLessThanOrEqual(1);
});

test('Leslie settings follows the saved Chinese interface language', async ({ page }) => {
    await page.addInitScript({ content: 'localStorage.setItem("language", "zh-cn");' });
    await preparePage(page);
    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();

    const settingsNavigation = page.locator('.leslie-settings-navigation');
    await expect(page.locator('#leslie-settings-title')).toHaveText('设置');
    await expect(page.locator('.leslie-settings-intro h2')).toHaveText('把常用的留在眼前');
    await expect(settingsNavigation.locator('[data-leslie-detail="model"] strong')).toHaveText('模型连接');
    await settingsNavigation.locator('[data-leslie-detail="model"]').click();
    await expect(page.locator('.leslie-detail-hero h2')).toHaveText('模型连接');
    await expect(page.getByRole('heading', { name: '选择连接方式', exact: true })).toBeVisible();
    await settingsNavigation.locator('[data-leslie-detail="reply"]').click();
    await expect(page.locator('.leslie-style-presets-card h3')).toHaveText('选择回复范式');
    await expect(page.locator('[data-leslie-reply-style="novel"]')).toContainText('长篇小说');
});

test('privacy mode masks only the selected original UI blocks and persists the choice', async ({ page }) => {
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('leslie-privacy-test-ready')) {
            localStorage.removeItem('leslie.privacy-mode.v1');
            sessionStorage.setItem('leslie-privacy-test-ready', 'true');
        }
    });
    await preparePage(page);

    await expect(page.locator('[data-leslie-privacy-quick-toggle="sidebar"]')).toBeVisible();
    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
    const privacyNavigation = page.locator('.leslie-settings-navigation [data-leslie-detail="privacy"]');
    await expect(privacyNavigation).toBeVisible();
    await privacyNavigation.click();

    await expect(page.locator('.leslie-detail-hero h2')).toHaveText('Screen privacy mode');
    await expect(page.locator('[data-leslie-privacy-block]')).toHaveCount(5);
    await expect(page.locator('[data-leslie-privacy-master]')).not.toBeChecked();
    await expect(page.locator('[data-leslie-privacy-block="messages"]')).toBeChecked();
    await expect(page.locator('[data-leslie-privacy-block="connection"]')).not.toBeChecked();

    await page.locator('[data-leslie-privacy-master]').check();
    await expect(page.locator('body')).toHaveClass(/leslie-privacy-mode/);
    await expect(page.locator('body')).toHaveAttribute('data-leslie-privacy-messages', 'masked');
    await expect(page.locator('body')).toHaveAttribute('data-leslie-privacy-connection', 'visible');
    await page.locator('[data-leslie-privacy-block="messages"]').uncheck();
    await expect(page.locator('body')).toHaveAttribute('data-leslie-privacy-messages', 'visible');
    await expect(page.locator('[data-leslie-privacy-preview="messages"]')).not.toHaveClass(/is-masked/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden({ timeout: 30_000 });
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));
    await expect(page.locator('body')).toHaveClass(/leslie-privacy-mode/);
    await expect(page.locator('body')).toHaveAttribute('data-leslie-privacy-messages', 'visible');
    await page.locator('[data-leslie-privacy-quick-toggle="sidebar"]').click();
    await expect(page.locator('body')).not.toHaveClass(/leslie-privacy-mode/);
});
