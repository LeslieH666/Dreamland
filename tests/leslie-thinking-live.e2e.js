/* global document, HTMLInputElement */
/* eslint-disable playwright/no-conditional-in-test, playwright/no-skipped-test */
import { E2E_BROWSER_CHANNEL } from './fixtures/e2e-browser.js';
import { expect, test } from '@playwright/test';

test.use({
    channel: E2E_BROWSER_CHANNEL,
    viewport: { width: 1280, height: 900 },
});

test.skip(process.env.LESLIE_LIVE_API !== '1', 'Set LESLIE_LIVE_API=1 to run the paid DeepSeek acceptance check.');

test('DeepSeek quiet checks stay bounded while reply styles remain semantic', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const generatedRequests = [];
    page.on('request', (request) => {
        if (!request.url().endsWith('/api/backends/chat-completions/generate')) {
            return;
        }
        const body = request.postDataJSON();
        generatedRequests.push({
            chatCompletionSource: body.chat_completion_source,
            includeReasoning: body.include_reasoning,
            maxTokens: body.max_tokens,
            model: body.model,
            reasoningEffort: body.reasoning_effort ?? 'provider-default',
            stream: body.stream,
        });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));

    const snapshot = await page.evaluate(async () => {
        const { extension_settings } = await import('/scripts/extensions.js');
        return {
            maxTokens: document.getElementById('openai_max_tokens')?.value,
            temperature: document.getElementById('temp_openai')?.value,
            showThoughts: document.getElementById('openai_show_thoughts')?.checked,
            replyStyle: extension_settings.leslieReplyStyle?.style,
        };
    });
    const results = [];

    try {
        await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
        const settingsNavigation = page.locator('.leslie-settings-navigation');
        await settingsNavigation.locator('[data-leslie-detail="model"]').click();
        if (!await page.locator('#leslie-model-thinking-mode').count()) {
            await page.locator('[data-leslie-api-kind="online"]').click();
            await page.locator('[data-leslie-service="deepseek"]').click();
        }
        await expect(page.locator('#leslie-model-thinking-mode')).toBeVisible();
        if (!await page.locator('#leslie-model-thinking-mode').isChecked()) {
            await page.locator('#leslie-model-thinking-mode').check();
        }
        await expect(page.locator('#openai_show_thoughts')).toBeChecked();

        await settingsNavigation.locator('[data-leslie-detail="reply"]').click();
        const styles = [
            ['concise', '请用两到三句简体中文回应，保持角色口吻并以完整句子结尾。'],
            ['dialogue', '请用简体中文写一段以对话推进的回应，保持角色口吻并以完整句子结尾。'],
            ['balanced', '请用简体中文写一段叙述与对话均衡的回应，保持角色口吻并以完整句子结尾。'],
            ['novel', '请用简体中文写一段较丰富的场景回应，保持角色口吻并以完整句子结尾。'],
        ];

        for (const [style, instruction] of styles) {
            await page.locator(`[data-leslie-reply-style="${style}"]`).click();
            await expect(page.locator('#openai_max_tokens')).toHaveValue(String(snapshot.maxTokens));
            await expect(page.locator('#temp_openai')).toHaveValue(String(snapshot.temperature));
            const requestIndex = generatedRequests.length;
            const result = await page.evaluate(async ({ style, instruction }) => {
                const script = await import('/script.js');
                const reasoningModule = await import('/scripts/reasoning.js');
                const character = script.characters[script.this_chid] ?? script.characters[0] ?? {};
                const characterName = String(character.name || '测试角色');
                const description = String(character.description || '').slice(0, 2400);
                const personality = String(character.personality || '').slice(0, 1200);
                const scenario = String(character.scenario || '').slice(0, 1200);
                const data = await script.generateRawData({
                    api: 'openai',
                    prompt: [
                        {
                            role: 'system',
                            content: `你正在进行角色扮演。你是${characterName}。\n角色资料：${description}\n性格：${personality}\n场景：${scenario}\n只输出角色正文，不要解释内部分析过程，并确保文字编码正常。`,
                        },
                        {
                            role: 'user',
                            content: `你发现桌上的信件与刚才听见的话互相矛盾，需要先判断该相信谁。${instruction}`,
                        },
                    ],
                });
                const content = script.extractMessageFromData(data, 'openai');
                const reasoning = reasoningModule.extractReasoningFromData(data, { mainApi: 'openai', ignoreShowThoughts: true });
                const formattedContent = script.messageFormatting(content, characterName, false, false, 0);
                const formattedReasoning = script.messageFormatting(reasoning, characterName, false, false, 0, {}, true);
                const render = (html) => {
                    const element = document.createElement('div');
                    element.innerHTML = html;
                    return element.textContent || '';
                };
                const renderedContent = render(formattedContent);
                const renderedReasoning = render(formattedReasoning);
                const abnormalPattern = /\uFFFD|锟斤拷|鈥|Ã|â€|<\/?think\b/i;
                const controlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
                const abnormalLocations = [
                    ['content', content],
                    ['reasoning', reasoning],
                    ['renderedContent', renderedContent],
                    ['renderedReasoning', renderedReasoning],
                ].filter(([, value]) => abnormalPattern.test(value)).map(([location]) => location);

                return {
                    style,
                    finishReason: data?.choices?.[0]?.finish_reason ?? null,
                    contentLength: content.length,
                    reasoningLength: reasoning.length,
                    renderedContentLength: renderedContent.length,
                    renderedReasoningLength: renderedReasoning.length,
                    reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
                    outputTokens: data?.usage?.completion_tokens ?? null,
                    abnormalLocations,
                    hasAbnormalText: abnormalLocations.length > 0,
                    hasControlCharacters: controlPattern.test(content) || controlPattern.test(reasoning),
                    hasVisibleThinkElement: /<\/?think\b/i.test(formattedContent),
                };
            }, { style, instruction });

            expect(generatedRequests).toHaveLength(requestIndex + 1);
            const request = generatedRequests[requestIndex];
            results.push({ ...request, ...result });
            await testInfo.attach(`deepseek-thinking-${style}.json`, {
                body: JSON.stringify({ ...request, ...result }, null, 2),
                contentType: 'application/json',
            });
            expect(request.chatCompletionSource).toBe('deepseek');
            expect(request.includeReasoning).toBe(true);
            expect(request.maxTokens).toBeGreaterThanOrEqual(32_768);
            expect(request.model).toMatch(/^deepseek-v4-/);
            expect(request.stream).toBe(false);
            expect(result.finishReason).toBe('stop');
            expect(result.contentLength).toBeGreaterThan(10);
            expect(result.reasoningLength).toBeGreaterThan(0);
            expect(result.renderedContentLength).toBeGreaterThan(10);
            expect(result.renderedReasoningLength).toBeGreaterThan(0);
            expect(result.hasAbnormalText).toBe(false);
            expect(result.hasControlCharacters).toBe(false);
            expect(result.hasVisibleThinkElement).toBe(false);
        }
    } finally {
        await page.evaluate(async (saved) => {
            const restoreInput = (id, value, property = 'value') => {
                const element = document.getElementById(id);
                if (!(element instanceof HTMLInputElement) || value === undefined) {
                    return;
                }
                element[property] = value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
            };
            restoreInput('openai_max_tokens', saved.maxTokens);
            restoreInput('temp_openai', saved.temperature);
            restoreInput('openai_show_thoughts', Boolean(saved.showThoughts), 'checked');
            const { extension_settings } = await import('/scripts/extensions.js');
            const { saveSettingsDebounced } = await import('/script.js');
            if (extension_settings.leslieReplyStyle && saved.replyStyle) {
                extension_settings.leslieReplyStyle.style = saved.replyStyle;
                saveSettingsDebounced();
            }
        }, snapshot);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    }

    await testInfo.attach('deepseek-thinking-acceptance.json', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
    });
});
