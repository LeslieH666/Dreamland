/* global document */
import { E2E_BROWSER_CHANNEL } from './fixtures/e2e-browser.js';
import { expect, test } from '@playwright/test';

test.use({
    channel: E2E_BROWSER_CHANNEL,
    viewport: { width: 1280, height: 900 },
});

test('DeepSeek foreground requests omit the Leslie output cap while quiet jobs stay bounded', async ({ page }) => {
    const requests = [];
    await page.route('**/api/backends/chat-completions/generate', async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic reply.' } }],
            }),
        });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));

    await page.evaluate(async () => {
        const { oai_settings, sendOpenAIRequest } = await import('/scripts/openai.js');
        Object.assign(oai_settings, {
            chat_completion_source: 'deepseek',
            deepseek_model: 'deepseek-chat',
            openai_max_context: 4096,
            openai_max_tokens: 300,
            show_thoughts: false,
            reasoning_effort: 'auto',
            stream_openai: false,
        });
        await document.defaultView.LeslieReplyStylePreparePrompt([], 4096, () => {}, 'normal');
        const messages = [{ role: 'user', content: 'Synthetic test prompt.' }];
        await sendOpenAIRequest('normal', messages, new AbortController().signal);
        await sendOpenAIRequest('quiet', messages, new AbortController().signal);
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].chat_completion_source).toBe('deepseek');
    expect(requests[0]).not.toHaveProperty('max_tokens');
    expect(requests[1].max_tokens).toBe(300);
});
