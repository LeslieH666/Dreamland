/* global localStorage, window */
import { expect, test } from '@playwright/test';

test.use({
    channel: 'msedge',
    viewport: { width: 1180, height: 820 },
});

test('interactive guidance remains optional and collapses for a free-form draft', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('leslie-story-choice-mode'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    const onboarding = page.locator('.popup').filter({ hasText: 'Welcome to SillyTavern!' });
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (await onboarding.isVisible()) {
        await onboarding.locator('.popup-input').fill('Synthetic User');
        await onboarding.locator('.popup-button-ok').click();
    }
    await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));

    const panel = page.locator('#leslie-story-choices');
    await expect(page.locator('.leslie-conversation-item').first()).toBeVisible();
    await page.locator('.leslie-conversation-item').first().click();
    await expect(panel).toBeVisible();
    await expect(page.locator('#leslie-chat-actions > .leslie-theme-toggle')).toHaveCount(0);
    const plotCompassButton = panel.locator('[data-story-action="plot-compass"]');
    await expect(plotCompassButton).toBeVisible();
    await plotCompassButton.click();
    const plotCompass = page.locator('#leslie-plot-compass-dialog');
    await expect(plotCompass).toBeVisible();
    await expect(plotCompass).toContainText('下一章主线往哪里走？');
    await expect(plotCompass).toContainText('请先连接聊天模型');
    await plotCompass.locator('[data-plot-action="close"]').click();
    await expect(plotCompass).toBeHidden();
    await expect(panel.locator('[data-story-mode="free"]')).toHaveClass(/is-active/);
    await expect(panel.locator('.leslie-story-choice-body')).toBeHidden();

    const textarea = page.locator('#send_textarea');
    await textarea.fill('这是一条不会被剧情选项覆盖的合成草稿。');
    await panel.locator('[data-story-mode="guided"]').click();
    await expect(panel.locator('[data-story-mode="guided"]')).toHaveClass(/is-active/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('leslie-story-choice-mode'))).toBe('guided');
    await expect(panel.locator('[data-story-user-name]')).toHaveText('Synthetic User');
    await expect(panel.locator('.leslie-story-choice-perspective')).toContainText('接下来');

    await textarea.focus();
    await expect(panel).toHaveClass(/is-collapsed/);
    await expect(panel.locator('[data-story-action="expand"]')).toBeVisible();
    await expect(textarea).toHaveValue('这是一条不会被剧情选项覆盖的合成草稿。');

    await panel.locator('[data-story-mode="free"]').click();
    await expect(panel.locator('[data-story-mode="free"]')).toHaveClass(/is-active/);
    await expect(panel.locator('.leslie-story-choice-body')).toBeHidden();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('leslie-story-choice-mode'))).toBe('free');
    await textarea.fill('');
});

test.describe('mobile plot pin', () => {
    test.use({
        viewport: { width: 390, height: 844 },
    });

    test('uses a non-overlapping dock and opens the plan in a bottom sheet', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#preloader')).toBeHidden();
        const onboarding = page.locator('.popup').filter({ hasText: 'Welcome to SillyTavern!' });
        // eslint-disable-next-line playwright/no-conditional-in-test
        if (await onboarding.isVisible()) {
            await onboarding.locator('.popup-input').fill('Synthetic Mobile User');
            await onboarding.locator('.popup-button-ok').click();
        }
        await page.locator('.popup[open]').evaluateAll((popups) => popups.forEach((popup) => popup.close()));
        await expect(page.locator('.leslie-conversation-item').first()).toBeVisible();
        await page.locator('.leslie-conversation-item').first().click();
        await expect(page.locator('#leslie-chat-header')).toBeVisible();

        await page.evaluate(async () => {
            const app = await import('/script.js');
            app.updateChatMetadata({
                leslie_plot_compass: {
                    schemaVersion: 2,
                    activePlan: {
                        id: 'plot-mobile-synthetic',
                        title: '跨越寒季的共同远征',
                        kind: 'continuation',
                        hook: '当前线索将两人带向一段无法当天往返的远征。',
                        goal: '在数月旅程中找到失落据点，并决定归来后共同生活的方向。',
                        whyNow: '已有线索与关系承诺已经足以让长途行动自然开始。',
                        timeHorizon: '故事内跨越三个月，并经历启程、远征与归来三个阶段。',
                        impact: '双方的信任、居所和对外身份都会因最终选择而长期改变。',
                        beats: ['为远征作出承诺', '在途中形成新的合作方式', '代价升级并迫使双方选择', '归来后建立新的生活常态'],
                        firstMove: '我摊开地图，问她愿不愿意和我一起走完这段路。',
                        duration: { minTurns: 24, maxTurns: 48 },
                        acceptedAtMessageId: 0,
                        acceptedAtSwipeId: 0,
                        status: 'active',
                    },
                    history: [],
                },
            });
            window.dispatchEvent(new CustomEvent('leslie-plot-compass-changed'));
        });

        const pin = page.locator('#leslie-chat-header + #leslie-plot-pin');
        await expect(pin).toBeVisible();
        await expect(pin).toContainText('跨越寒季的共同远征');
        await expect(page.locator('#leslie-chat-actions > .leslie-theme-toggle')).toHaveCount(0);
        const headerBox = await page.locator('#leslie-chat-header').boundingBox();
        const pinBox = await pin.boundingBox();
        expect(pinBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);

        await pin.locator('[data-plot-pin-action="toggle"]').click();
        const sheet = page.locator('#leslie-plot-pin-dialog');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('故事内跨越三个月');
        await expect(sheet).toContainText('居所和对外身份');
        const sheetBox = await sheet.boundingBox();
        expect(sheetBox.y + sheetBox.height).toBeGreaterThanOrEqual(843);
        await sheet.locator('[data-plot-pin-action="close"]').click();
        await expect(sheet).toBeHidden();
    });
});
