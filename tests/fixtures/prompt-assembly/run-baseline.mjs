#!/usr/bin/env node
/* global window, document, localStorage */
/**
 * Record (or re-verify) the browser's prompt-assembly output for the synthetic
 * corpus — the Phase 2.5.4 baseline that Phase 2.5.2 must not change.
 *
 * For every case the harness drives the real browser through the real UI code
 * path (`selectCharacterById` / `Generate`) with the model endpoint stubbed, and
 * captures the request body the browser posts to
 * `/api/backends/chat-completions/generate`. That body's `messages` array is the
 * browser's authoritative assembly output.
 *
 * Usage:
 *   node tests/fixtures/prompt-assembly/run-baseline.mjs --record
 *   node tests/fixtures/prompt-assembly/run-baseline.mjs --compare
 *
 * `--compare` exits non-zero and prints the first differing case on any drift.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CASES, PROFILES } from './corpus.mjs';
import { seedPromptAssemblyFixtures } from './seed.mjs';
import { seedFixtureMemory } from './memory-seed.mjs';
import { startMockProvider } from './mock-provider.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASELINE_DIR = path.join(ROOT, 'tests', 'fixtures', 'prompt-assembly', 'baseline');
const PORT = Number(process.env.LESLIE_FIXTURE_PORT || 8300);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const mode = process.argv.includes('--compare') ? 'compare' : 'record';

/**
 * Wait until a URL answers.
 * @param {string} url URL to poll.
 * @param {number} timeoutMs Timeout.
 * @returns {Promise<void>} Resolves when reachable.
 */
async function waitForServer(url, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // not up yet
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Server did not become ready at ${url}`);
}

/**
 * Start the server against an isolated data root.
 * @param {string} dataRoot Data root.
 * @returns {{child: import('node:child_process').ChildProcess, log: () => string}} Server handle.
 */
function startServer(dataRoot) {
    const logFile = path.join(dataRoot, 'server.log');
    const out = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            DREAMLAND_DATA_ROOT: dataRoot,
            DREAMLAND_PORT: String(PORT),
            DREAMLAND_MODE: 'server',
            // The chat-completion status check refuses to run without a key for
            // the selected source, and Generate then aborts at the connection
            // gate. Supplied through the external secret source so no secret is
            // ever written into the fixture data root.
            DREAMLAND_SECRET_API_KEY_CUSTOM: 'fixture-key',
        },
        stdio: ['ignore', out, out],
    });
    return { child, log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '') };
}

/**
 * Capture one case in the browser.
 * @param {import('playwright').Page} page Page.
 * @param {object} testCase Case definition.
 * @returns {Promise<object>} Captured request body.
 */
async function captureCase(page, testCase) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#preloader').waitFor({ state: 'hidden', timeout: 60_000 });

    const captured = await page.evaluate(async (definition) => {
        const app = await import('/script.js');

        // Stub the model endpoint and record what the browser assembled.
        const records = [];
        window.__assemblyCaptures = records;
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input?.url ?? '';
            if (url.includes('/api/backends/chat-completions/generate')) {
                const body = JSON.parse(init?.body ?? '{}');
                records.push(body);
                return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '合成夹具回复。' } }] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return originalFetch(input, init);
        };

        await app.getCharacters();
        const { getGroups, openGroupById } = await import('/scripts/group-chats.js');
        await getGroups();

        // The connection gate silently aborts Generate when the provider looks
        // unreachable, which would leave us with no request to capture. Bring the
        // session online exactly the way the UI does: click the API connect
        // button (`reconnectOpenAi` -> `getStatusOpen`) and wait for the status.
        for (let attempt = 0; attempt < 12 && app.online_status === 'no_connection'; attempt++) {
            document.querySelector('#api_button_openai')?.click();
            for (let wait = 0; wait < 10 && app.online_status === 'no_connection'; wait++) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        if (app.online_status === 'no_connection') {
            throw new Error('provider status is no_connection; the mock provider must be reachable and a key configured');
        }

        if (definition.group) {
            // `openGroupById` is the selector that actually binds `selected_group`
            // and loads the group chat (openGroupChat assumes it already ran).
            const group = (await import('/scripts/group-chats.js')).groups.find(entry => entry.id === definition.group.id);
            if (group) group.chat_id = definition.chat;
            await openGroupById(definition.group.id);
        } else {
            const index = app.characters.findIndex(entry => entry.avatar === definition.character);
            if (index < 0) throw new Error(`fixture character not found: ${definition.character}`);
            await app.selectCharacterById(index, { switchMenu: true, chatFile: definition.chat });
        }

        await new Promise(resolve => setTimeout(resolve, 300));

        if (definition.type === 'swipe') {
            await app.swipe(null, 'right', { source: 'fixture' });
        } else if (definition.type === 'quiet') {
            await app.Generate('quiet', { quiet_prompt: definition.quietPrompt, automatic_trigger: true }, false);
        } else {
            await app.Generate(definition.type, {}, false);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        return records.length ? records[records.length - 1] : null;
    }, testCase);

    if (!captured) throw new Error(`no chat-completion request captured for case ${testCase.id}`);
    return captured;
}

/**
 * Compare two captured bodies and report the first difference.
 * @param {object} a Baseline body.
 * @param {object} b Current body.
 * @returns {string | null} Difference description, or null when identical.
 */
function firstDifference(a, b) {
    const left = JSON.stringify(a?.messages ?? null);
    const right = JSON.stringify(b?.messages ?? null);
    if (left === right) {
        const leftAll = JSON.stringify({ ...a, messages: undefined });
        const rightAll = JSON.stringify({ ...b, messages: undefined });
        return leftAll === rightAll ? null : `non-message fields differ:\n  baseline: ${leftAll}\n  current:  ${rightAll}`;
    }
    const leftMessages = a?.messages ?? [];
    const rightMessages = b?.messages ?? [];
    if (leftMessages.length !== rightMessages.length) {
        return `message count differs: baseline ${leftMessages.length}, current ${rightMessages.length}`;
    }
    for (let index = 0; index < leftMessages.length; index++) {
        const l = JSON.stringify(leftMessages[index]);
        const r = JSON.stringify(rightMessages[index]);
        if (l !== r) {
            return `message[${index}] differs:\n  baseline: ${l}\n  current:  ${r}`;
        }
    }
    return 'messages differ but no per-message difference was isolated';
}

const dataRoots = [];
/** Errors the page reported, so a failed capture can say why. */
const pageErrors = [];
let server = null;
let browser = null;
let provider = null;
const results = {};
const failures = [];

try {
    provider = await startMockProvider();
    console.log(`[${mode}] mock provider ready on http://127.0.0.1:${process.env.LESLIE_FIXTURE_PROVIDER_PORT || 9099}`);
    const { chromium } = await import('playwright');
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        console.error('Could not launch chromium. Install it with `npx playwright install chromium`,');
        console.error('or point PLAYWRIGHT_BROWSERS_PATH at an existing download. Original error:');
        console.error(`  ${error.message.split('\n')[0]}`);
        throw error;
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // Capture what the page itself reports. Without this a broken bundle only shows
    // up as "the preloader never hid", which says nothing about the actual exception.
    page.on('pageerror', error => {
        pageErrors.push(`[pageerror] ${error?.message ?? error}`);
    });
    page.on('console', message => {
        if (message.type() === 'error') {
            pageErrors.push(`[console] ${message.text()}`);
        }
    });
    // A console message alone says "some resource failed" without naming it, which is
    // not enough to act on. Record the URL and status too.
    page.on('response', response => {
        if (response.status() >= 400) {
            pageErrors.push(`[http ${response.status()}] ${response.url()}`);
        }
    });
    page.on('requestfailed', request => {
        pageErrors.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });

    await page.addInitScript(() => {
        try {
            localStorage.setItem('language', 'zh-cn');
        } catch {
            // ignore
        }
    });

    for (const [profileName, profile] of Object.entries(PROFILES)) {
        const cases = CASES.filter(entry => entry.profile === profileName);
        if (cases.length === 0) continue;

        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-pa-${profileName}-`));
        dataRoots.push(dataRoot);
        seedPromptAssemblyFixtures(dataRoot, { personaPosition: profile.personaPosition, noteText: profile.noteText, seedMemory: seedFixtureMemory });

        server = startServer(dataRoot);
        await waitForServer(`${BASE_URL}/version`);
        console.log(`[${mode}] profile=${profileName} server ready on ${BASE_URL}`);

        for (const testCase of cases) {
            try {
                const body = await captureCase(page, testCase);
                results[testCase.id] = { case: testCase.id, profile: profileName, type: testCase.type, request: body, messageCount: body.messages?.length ?? 0 };
                console.log(`[${mode}] captured ${testCase.id} (${body.messages?.length ?? 0} messages)`);
            } catch (error) {
                failures.push(`${testCase.id}: ${error.message}`);
                console.error(`[${mode}] FAILED ${testCase.id}: ${error.message}`);
            }
        }

        server.child.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (!server.child.killed) server.child.kill('SIGKILL');
        server = null;
    }
} finally {
    if (server?.child) server.child.kill('SIGKILL');
    if (browser) await browser.close();
    if (provider) await new Promise(resolve => provider.close(resolve));
}

if (failures.length) {
    console.error(`\n${failures.length} case(s) could not be captured.`);
    // The reason a capture fails is almost always a page-level exception; print the
    // first one so the failure is diagnosable instead of a bare timeout.
    if (pageErrors.length) {
        console.error(`\nFirst page error (${pageErrors.length} captured):`);
        console.error(`  ${pageErrors[0]}`);
    } else {
        console.error('The page reported no error; the capture timed out for another reason.');
    }
    process.exit(1);
}

if (mode === 'record') {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    for (const [id, snapshot] of Object.entries(results)) {
        fs.writeFileSync(path.join(BASELINE_DIR, `${id}.json`), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    }
    console.log(`\nRecorded ${Object.keys(results).length} baseline snapshot(s) in ${path.relative(ROOT, BASELINE_DIR)}`);
    process.exit(0);
}

let drift = 0;
for (const [id, snapshot] of Object.entries(results)) {
    const file = path.join(BASELINE_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
        console.error(`MISSING baseline for ${id}`);
        drift++;
        continue;
    }
    const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
    const difference = firstDifference(baseline.request, snapshot.request);
    if (difference) {
        console.error(`DRIFT ${id}: ${difference}`);
        drift++;
    } else {
        console.log(`identical ${id} (${snapshot.messageCount} messages)`);
    }
}
const recorded = fs.existsSync(BASELINE_DIR) ? fs.readdirSync(BASELINE_DIR).filter(name => name.endsWith('.json')).length : 0;
if (recorded !== Object.keys(results).length) {
    console.error(`case count changed: baseline has ${recorded}, run captured ${Object.keys(results).length}`);
    drift++;
}

for (const dataRoot of dataRoots) {
    if (dataRoot.startsWith(os.tmpdir()) && path.basename(dataRoot).startsWith('dsh-pa-')) {
        fs.rmSync(dataRoot, { recursive: true, force: true });
    }
}

if (drift) {
    console.error(`\n${drift} case(s) drifted from the baseline.`);
    process.exit(1);
}
console.log(`\nAll ${Object.keys(results).length} case(s) are byte-identical to the baseline.`);
