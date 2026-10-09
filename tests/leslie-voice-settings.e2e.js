import { E2E_BROWSER_CHANNEL } from './fixtures/e2e-browser.js';
import { expect, test } from '@playwright/test';

test.use({
    channel: E2E_BROWSER_CHANNEL,
    viewport: { width: 1280, height: 900 },
});

async function openSettings(page) {
    await page.route('**/api/volcengine/voices', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            voices: [
                { name: '小何（女声）', voice_id: 'zh_female_xiaohe_uranus_bigtts', lang: '中文 / English', model: '2.0', resource_id: 'seed-tts-2.0' },
                { name: 'English Alice', voice_id: 'en_female_alice_bigtts', lang: 'English', model: '1.0', resource_id: 'volc.service_type.10029' },
            ],
        }),
    }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await page.locator('.popup[open]').evaluateAll(popups => popups.forEach(popup => popup.close()));
    await page.locator('.leslie-sidebar-actions [data-action="settings"]').click();
}

test('Volcengine character voice has a safe end-to-end settings entry', async ({ page }) => {
    let previewRequests = 0;
    await page.route('**/api/volcengine/generate-voice', async route => {
        previewRequests += 1;
        await route.fulfill({ status: 500, body: 'A preview should not run during this smoke test.' });
    });

    await openSettings(page);
    const navigation = page.locator('.leslie-settings-navigation');
    const voiceEntry = navigation.locator('[data-leslie-detail="voice"]');
    await expect(voiceEntry).toBeVisible();
    await expect(voiceEntry).toContainText('Character voice');

    await voiceEntry.click();
    await expect(page.locator('.leslie-detail-hero h2')).toHaveText('Volcengine character voice');
    await expect(page.locator('leslie-voice-settings')).toBeVisible();
    await expect(page.locator('[data-voice-enable]')).toBeVisible();
    await expect(page.locator('[data-voice-auto]')).toBeVisible();
    const outsideParentheses = page.getByRole('radio', { name: 'Outside parentheses only' });
    await expect(outsideParentheses).toBeVisible();
    await expect(page.locator('[data-voice-resource]')).toBeVisible();
    await expect(page.locator('[data-voice-language]')).toHaveValue('auto');
    await expect(page.locator('[data-voice-search]')).toBeVisible();
    await expect(page.locator('[data-voice-speed]')).toHaveValue('0');
    await expect(page.locator('[data-voice-character="[Default Voice]"]')).toBeVisible();
    await expect(page.locator('.manage-api-keys[data-key="volcengine_app_id"]')).toBeVisible();
    await expect(page.locator('.manage-api-keys[data-key="volcengine_access_key"]')).toBeVisible();
    await expect(page.locator('.leslie-voice-privacy')).toContainText('not cached to disk');

    // Merely visiting the page must not spend API quota or silently switch the
    // original provider. Activation only happens after the user enables voice.
    expect(previewRequests).toBe(0);

    await outsideParentheses.check();
    await expect(page.locator('#tts_narrate_outside_parentheses')).toBeChecked();
    await expect(page.locator('#tts_narrate_quoted')).not.toBeChecked();
    await expect(page.locator('#tts_narrate_dialogues')).not.toBeChecked();

    await page.locator('[data-voice-enable]').check();
    await expect(page.locator('#tts_provider')).toHaveValue('Volcengine');
    await expect(page.locator('#tts_enabled')).toBeChecked();
    await expect(page.locator('body')).toHaveClass(/tts/);
    await expect(page.locator('#tts_periodic_auto_generation')).not.toBeChecked();
    await expect(page.locator('#tts_narrate_by_paragraphs')).toBeChecked();
    await expect(page.locator('[data-voice-character="[Default Voice]"]')).not.toHaveValue('');
    expect(previewRequests).toBe(0);

    await page.locator('[data-voice-enable]').uncheck();
    await expect(page.locator('#tts_enabled')).not.toBeChecked();
});

test('Volcengine custom voice_type accepts console copy formats and becomes selectable', async ({ page }) => {
    await openSettings(page);
    await page.locator('.leslie-settings-navigation [data-leslie-detail="voice"]').click();

    await page.locator('.leslie-voice-custom-form input[name="voiceId"]').fill('{"voice_type":"S_test_custom_voice"}');
    await page.locator('.leslie-voice-custom-form button[type="submit"]').click();

    await expect(page.locator('[data-voice-character="[Default Voice]"]')).toHaveValue('S_test_custom_voice');
    await expect(page.locator('.leslie-voice-status')).toContainText('S_test_custom_voice');
});

test('Volcengine voice mapping stays usable on a phone-sized settings page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettings(page);
    await page.locator('.leslie-settings-navigation [data-leslie-detail="voice"]').click();

    const overlay = page.locator('#leslie-settings-overlay');
    await expect(overlay).toHaveClass(/leslie-settings-mobile-detail/);
    await expect(page.locator('leslie-voice-settings')).toBeVisible();
    const voiceRow = page.locator('.leslie-voice-map-row').first();
    const preview = page.locator('.leslie-voice-preview').first();
    await expect(voiceRow).toBeVisible();
    await expect.poll(async () => Math.abs((await preview.boundingBox()).width - (await voiceRow.boundingBox()).width)).toBeLessThanOrEqual(1);
});
