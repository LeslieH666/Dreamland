/** Full Web model-selection flow using only synthetic users and a local model server. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { seedPromptAssemblyFixtures } from './prompt-assembly/seed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-model-ui-'));
const port = 8315;
const base = `http://127.0.0.1:${port}`;
const requests = [];
const provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
        requests.push({ body: JSON.parse(raw), authorization: req.headers.authorization });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Synthetic server model reply.' }, finish_reason: 'stop' }] }));
    });
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const gateway = { schemaVersion: 1, providers: [{ id: 'fixture', source: 'custom', endpoint: `http://127.0.0.1:${provider.address().port}/v1`, apiKeySecretId: 'api_key_custom' }], models: [
    { id: 'fixture-a', name: '合成模型 A', provider: 'fixture', apiModel: 'fixture-model-a' },
    { id: 'fixture-b', name: '合成模型 B', provider: 'fixture', apiModel: 'fixture-model-b' },
] };
fs.writeFileSync(path.join(data, 'model-gateway.json'), JSON.stringify(gateway));
fs.writeFileSync(path.join(data, 'config.yaml'), 'enableUserAccounts: true\nallowKeysExposure: false\n');
const log = fs.openSync(path.join(data, 'server.log'), 'a');
const child = spawn(process.execPath, ['server.js', '--configPath', path.join(data, 'config.yaml')], {
    cwd: root, env: { ...process.env, DREAMLAND_MODE: 'server', DREAMLAND_DATA_ROOT: data, DREAMLAND_PORT: String(port), DREAMLAND_SECRET_API_KEY_CUSTOM: 'synthetic-key' }, stdio: ['ignore', log, log],
});
let browser;
let page;
const errors = [];
try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
        try { ready = (await fetch(`${base}/version`)).ok; } catch { /* starting */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'server becomes ready');
    const credentials = { handle: 'model-ui-fixture', password: 'synthetic-password' };
    const register = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    assert.equal(register.status, 201);
    seedPromptAssemblyFixtures(data, { handle: credentials.handle });
    const login = await fetch(`${base}/api/v1/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, grant_type: 'password' }) });
    assert.equal(login.status, 200);
    const tokens = await login.json();
    browser = await chromium.launch({ headless: true, channel: process.env.LESLIE_BASELINE_BROWSER_CHANNEL || 'chrome' });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    // Authorize the initial document navigation as well as API fetches in this isolated fixture.
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${tokens.access_token}` });
    await page.addInitScript(tokens => {
        localStorage.setItem('dreamland.accessToken', tokens.access_token);
        localStorage.setItem('dreamland.refreshToken', tokens.refresh_token);
        localStorage.setItem('language', 'zh-cn');
    }, tokens);
    await page.goto(`${base}/app`);
    await page.locator('body > #preloader').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForFunction(() => document.documentElement.dataset.dreamlandMode === 'server' && document.querySelector('#server_model_select')?.options.length === 2);
    assert.equal(await page.locator('[data-leslie-settings-page="spaces"]').count(), 0);
    const registered = await page.evaluate(async () => {
        const response = await fetch('/api/v1/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: `synthetic-startup-${Date.now()}`, password: 'synthetic-registration-password' }),
        });
        const user = await response.json();
        const login = await fetch('/api/v1/auth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'password', handle: user.handle, password: 'synthetic-registration-password' }),
        });
        const tokens = await login.json();
        const settings = await fetch('/api/settings/get', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` }, body: '{}',
        });
        const data = await settings.json();
        return { registerStatus: response.status, loginStatus: login.status, settingsStatus: settings.status, firstRun: JSON.parse(data.settings).firstRun };
    });
    assert.deepEqual(registered, { registerStatus: 201, loginStatus: 200, settingsStatus: 200, firstRun: false });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('leslie:open-model-settings')));
    const select = page.locator('#leslie-server-model-select');
    await select.waitFor({ state: 'visible' });
    assert.equal(await select.locator('option').count(), 2);
    assert.equal(await page.locator('#leslie-settings-detail input[type=password]').count(), 0);
    assert.equal(await page.locator('#leslie-settings-detail [data-leslie-service]').count(), 0);
    await select.selectOption('fixture-b');
    await page.evaluate(async () => { const app = await import('/script.js'); await app.saveSettings(); });
    await page.reload();
    await page.locator('body > #preloader').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#server_model_select')?.value === 'fixture-b');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('leslie:open-model-settings')));
    await page.locator('#leslie-server-model-select').waitFor({ state: 'visible' });
    if (process.env.DREAMLAND_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.DREAMLAND_SMOKE_SCREENSHOT });
    await page.evaluate(async () => {
        const app = await import('/script.js');
        const { oai_settings } = await import('/scripts/openai.js');
        oai_settings.stream_openai = false;
        await app.getCharacters();
        await app.selectCharacterById(0, { switchMenu: true });
        document.querySelector('#send_textarea').value = 'Synthetic model selection smoke.';
        await app.Generate('normal');
    });
    assert.ok(requests.length > 0, 'Web Generate reaches the local administrator-configured provider');
    assert.equal(requests.at(-1).body.model, 'fixture-model-b');
    assert.equal(requests.at(-1).authorization, 'Bearer synthetic-key');
    const before = requests.length;
    fs.writeFileSync(path.join(data, 'model-gateway.json'), JSON.stringify({ schemaVersion: 1, providers: [], models: [] }));
    await page.evaluate(async () => {
        const { refreshServerModels } = await import('/scripts/server-models.js');
        await refreshServerModels({ headers: (await import('/script.js')).getRequestHeaders() });
        document.dispatchEvent(new CustomEvent('leslie:open-model-settings'));
    });
    await page.locator('[data-server-model-status]').filter({ hasText: '管理员尚未配置' }).waitFor();
    assert.equal(await select.isDisabled(), true);
    const blocked = await page.evaluate(async () => {
        const app = await import('/script.js');
        const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: app.getRequestHeaders(), body: JSON.stringify({ chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:9/v1', model: 'personal-model', messages: [{ role: 'user', content: 'synthetic' }] }) });
        return { status: response.status, data: await response.json() };
    });
    assert.ok(blocked.status >= 400);
    assert.match(blocked.data.error.message, /管理员尚未配置/);
    assert.equal(requests.length, before);
    assert.deepEqual(errors, []);
    console.log('PASS: model-only settings, account persistence, actual generation through selected server model, empty-catalog UI and backend rejection.');
} catch (error) {
    console.error('Browser smoke diagnostics:', errors);
    if (page) console.error(await page.evaluate(() => ({ url: location.pathname, mode: document.documentElement.dataset.dreamlandMode, options: document.querySelector('#server_model_select')?.options.length, preloaderPresent: Boolean(document.querySelector('#preloader')) })));
    throw error;
} finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => provider.close(resolve));
    fs.closeSync(log);
    fs.rmSync(data, { recursive: true, force: true });
}
