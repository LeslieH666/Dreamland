import { expect, test } from '@playwright/test';

test.use({ channel: 'msedge' });

async function preparePage(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#preloader')).toBeHidden();
    await page.locator('.popup[open]').evaluateAll(popups => popups.forEach(popup => popup.close()));
    await expect(page.locator('#leslie-conversation-list .leslie-conversation-item').first()).toBeVisible();
}

async function findCharacterWithTransientChatPointer(page) {
    return page.evaluate(async () => {
        const { characters, getRequestHeaders } = await import('/script.js');
        const { normalizeCharacterChatName, selectLatestCharacterChat } = await import('/scripts/leslie-chat-selection.js');

        for (let id = 0; id < characters.length; id++) {
            const character = characters[id];
            if (!character?.avatar) {
                continue;
            }

            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ avatar_url: character.avatar }),
            });
            if (!response.ok) {
                continue;
            }

            const history = await response.json();
            const selected = selectLatestCharacterChat(history);
            if (!selected) {
                continue;
            }

            const fileNames = history.map(chat => normalizeCharacterChatName(chat.file_name)).filter(Boolean).sort();
            const currentChat = normalizeCharacterChatName(character.chat);
            if (!fileNames.includes(currentChat)) {
                return {
                    id,
                    expectedFileName: selected.fileName,
                    fileNames,
                };
            }
        }

        return null;
    });
}

async function readCharacterChatFileNames(page, characterId) {
    return page.evaluate(async (id) => {
        const { characters, getRequestHeaders } = await import('/script.js');
        const { normalizeCharacterChatName } = await import('/scripts/leslie-chat-selection.js');
        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: characters[id].avatar }),
        });
        const history = await response.json();
        return history.map(chat => normalizeCharacterChatName(chat.file_name)).filter(Boolean).sort();
    }, characterId);
}

test('contact click restores the latest real chat without creating a new file', async ({ page }) => {
    // Synthetic history exercises restoration without relying on private user chats.
    await page.route('**/api/characters/chats', route => route.fulfill({ json: [
        { file_name: 'synthetic-older.jsonl', last_mes: '2026-09-30T10:00:00.000Z', chat_items: 3 },
        { file_name: 'synthetic-latest.jsonl', last_mes: '2026-10-01T10:00:00.000Z', chat_items: 3 },
    ] }));
    await page.route('**/api/chats/get', route => route.fulfill({ json: [
        { user_name: 'Synthetic User', character_name: 'Synthetic Guide', chat_metadata: {} },
        { name: 'Synthetic User', is_user: true, mes: 'A synthetic history entry.', send_date: '2026-10-01T09:59:00.000Z' },
        { name: 'Synthetic Guide', is_user: false, mes: 'The latest synthetic reply.', send_date: '2026-10-01T10:00:00.000Z' },
    ] }));
    await page.route('**/api/chats/save', route => route.fulfill({ json: { result: 'ok' } }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await preparePage(page);

    const candidate = await findCharacterWithTransientChatPointer(page);
    expect(candidate, 'Expected a character with the synthetic history and a transient current-chat pointer.').not.toBeNull();

    const conversation = page.locator(`.leslie-conversation-item[data-entity-type="character"][data-entity-id="${candidate.id}"]`);
    const chatRequest = page.waitForRequest(request => request.url().endsWith('/api/chats/get') && request.method() === 'POST');
    await conversation.click();

    const request = await chatRequest;
    expect(request.postDataJSON().file_name).toBe(candidate.expectedFileName);
    await expect(conversation).toHaveAttribute('aria-selected', 'true');

    const fileNamesAfterClick = await readCharacterChatFileNames(page, candidate.id);
    expect(fileNamesAfterClick).toEqual(candidate.fileNames);
});
