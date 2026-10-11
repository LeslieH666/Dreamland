import fs from 'node:fs';
import vm from 'node:vm';
import { expect, test } from '@jest/globals';

test('system templates start together and retain the same message contents', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/system-messages.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function initSystemMessages()');
    const body = source.slice(start, source.indexOf('\nexport ', start + 1)).replace('export async', 'async');
    const pending = [];
    const messages = {};
    const task = vm.runInNewContext(`${body}; initSystemMessages()`, {
        lodash: { merge: Object.assign }, structuredClone, systemUserName: 'synthetic', system_avatar: 'synthetic',
        displayVersion: 'synthetic', system_messages: messages, SAFETY_CHAT: [], getMessageTimeStamp: () => 0,
        t: strings => strings.join(''),
        renderTemplateAsync: id => new Promise(resolve => pending.push({ id, resolve })),
    });
    expect(pending.map(item => item.id)).toEqual(['help', 'hotkeys', 'formatting', 'welcome', 'welcomePrompt', 'assistantNote']);
    pending.forEach(item => item.resolve(`synthetic-${item.id}`));
    await task;
    expect(messages.help.mes).toBe('synthetic-help');
    expect(messages.welcome_prompt.mes).toBe('synthetic-welcomePrompt');
});

test('shell cache reuses fresh assets, refreshes navigation and excludes API data', async () => {
    const handlers = {};
    const cached = { headers: new Headers({ date: new Date().toUTCString() }) };
    let networkRequests = 0;
    const sandbox = {
        self: { location: { origin: 'https://synthetic.invalid' }, addEventListener: (name, handler) => { handlers[name] = handler; } },
        URL, Date, Response,
        caches: { open: async () => ({ match: async () => cached, put: async () => {} }) },
        fetch: async () => { networkRequests++; return new Response('synthetic'); },
    };
    vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox);
    const run = async (pathname, mode = 'cors') => {
        let response;
        handlers.fetch({ request: { method: 'GET', url: `https://synthetic.invalid${pathname}`, mode },
            respondWith: value => { response = value; }, waitUntil: () => {} });
        return response ? await response : undefined;
    };
    expect(await run('/script.js')).toBe(cached);
    expect(networkRequests).toBe(0);
    expect((await run('/app', 'navigate')).ok).toBe(true);
    expect(networkRequests).toBe(1);
    expect(await run('/api/settings/get')).toBeUndefined();
    expect(networkRequests).toBe(1);
});
