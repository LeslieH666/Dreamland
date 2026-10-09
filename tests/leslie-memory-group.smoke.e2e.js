import { E2E_BROWSER_CHANNEL } from './fixtures/e2e-browser.js';
import { expect, test } from '@playwright/test';

test.use({
    channel: E2E_BROWSER_CHANNEL,
    viewport: { width: 1280, height: 900 },
});

test('Leslie group-memory helpers load in the real app without touching saved data', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await expect(page.locator('#leslie-memory-launcher')).toBeVisible();

    const result = await page.evaluate(async () => {
        const helpers = await import('/scripts/extensions/leslie-memory/chat-context.js');
        const context = {
            groupId: 'smoke-group',
            chatId: 'smoke-chat',
            chatMetadata: {},
            characterId: 1,
            name1: '测试用户',
            name2: '角色乙',
            characters: [
                { name: '角色甲', avatar: 'a.png', description: '甲的设定', personality: '安静' },
                { name: '角色乙', avatar: 'b.png', description: '乙的设定', personality: '活泼' },
            ],
            groups: [{ id: 'smoke-group', name: '测试群聊', members: ['a.png', 'b.png'], disabled_members: [] }],
            chat: [
                { is_user: false, is_system: false, name: '角色甲', original_avatar: 'a.png', mes: '第一句话' },
                { is_user: false, is_system: false, name: '角色乙', original_avatar: 'b.png', mes: '第二句话' },
            ],
        };
        const identity = helpers.getMemoryChatIdentity(context);
        const transcript = helpers.buildMemoryTranscript(
            context.chat.map((message, index) => ({ message, index })),
            context,
            identity,
        );
        const core = helpers.buildMemoryCoreSnapshot(identity, () => ({}));
        return {
            isGroup: identity.isGroup,
            chatKey: identity.chatKey,
            speakers: transcript.map(item => item.speaker),
            coreName: core.name,
            corePersonality: core.personality,
        };
    });

    expect(result).toEqual({
        isGroup: true,
        chatKey: 'group:smoke-group::smoke-chat',
        speakers: ['角色甲', '角色乙'],
        coreName: '测试群聊',
        corePersonality: '[角色甲]\n安静\n\n[角色乙]\n活泼',
    });
    expect(consoleErrors).toEqual([]);

    const routeProbe = await page.evaluate(async () => {
        const { getContext } = await import('/scripts/st-context.js');
        const context = getContext();
        const response = await fetch('/api/leslie/memory/ensure', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ isGroup: true }),
        });
        return { status: response.status, body: await response.json() };
    });
    expect(routeProbe.status).toBe(400);
    expect(routeProbe.body.error).toBe('INVALID_INPUT');
    expect(routeProbe.body.error).not.toBe('GROUP_UNSUPPORTED');
    expect(consoleErrors.filter(message => !message.includes('status of 400'))).toEqual([]);
});
