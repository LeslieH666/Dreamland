#!/usr/bin/env node
/*
 * Server-side replay oracle for Phase 2.5.3.
 *
 * The browser baseline under baseline/*.json records the exact POST body the page
 * sent to the generate endpoint, messages included. This script builds the *same*
 * synthetic data root the browser run used, calls assembleAuthoritativeTurn against
 * it, and diffs the assembled messages against that recorded body.
 *
 * It is a development oracle, not a gate: it is deliberately not wired into any
 * `npm run` script, because until the §5 registry rebuild lands every case fails by
 * design. Run it after each increment to watch the first divergence move later.
 *
 *   node tests/fixtures/prompt-assembly/replay-server.mjs            # report only
 *   node tests/fixtures/prompt-assembly/replay-server.mjs --strict   # exit 1 on any divergence
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASES, PROFILES } from './corpus.mjs';
import { seedPromptAssemblyFixtures } from './seed.mjs';
import { seedFixtureMemory } from './memory-seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const BASELINE_DIR = path.join(HERE, 'baseline');
const STRICT = process.argv.includes('--strict');

/**
 * Locate the first index at which two message arrays differ.
 * @param {object[]} left Assembled messages.
 * @param {object[]} right Baseline messages.
 * @returns {{index: number, kind: string} | null} Divergence, or null when equal.
 */
function firstDivergence(left, right) {
    const max = Math.max(left.length, right.length);
    for (let index = 0; index < max; index += 1) {
        if (index >= left.length) return { index, kind: 'assembled has fewer messages' };
        if (index >= right.length) return { index, kind: 'assembled has more messages' };
        const a = JSON.stringify(left[index]);
        const b = JSON.stringify(right[index]);
        if (a !== b) return { index, kind: 'message differs' };
    }
    return null;
}

/**
 * Render a short preview of one message for the report.
 * @param {object} message Message.
 * @returns {string} Preview.
 */
function preview(message) {
    if (message === undefined) return '(absent)';
    const text = JSON.stringify(message);
    return text.length > 130 ? `${text.slice(0, 130)}…` : text;
}

async function main() {
    const roots = [];

    // Modules that touch the config loader must be imported after setConfigFilePath().
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-replay-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    const util = await import(`${REPO_ROOT}/src/util.js`);
    util.setConfigFilePath(configPath);
    roots.push(configRoot);

    const { encodeCompositeId } = await import(`${REPO_ROOT}/src/api-v1/ids.js`);
    const { assembleAuthoritativeTurn } = await import(`${REPO_ROOT}/src/prompt-assembly/authoritative-turn.js`);
    const { parse: parseCard } = await import(`${REPO_ROOT}/src/character-card-parser.js`);
    const { getChatData } = await import(`${REPO_ROOT}/src/endpoints/chats.js`);

    const results = [];

    for (const [profileName, profile] of Object.entries(PROFILES)) {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dl-replay-${profileName}-`));
        roots.push(dataRoot);
        const seeded = seedPromptAssemblyFixtures(dataRoot, {
            personaPosition: profile.personaPosition,
            seedMemory: seedFixtureMemory,
        });

        const directories = {
            root: seeded.userRoot,
            characters: path.join(seeded.userRoot, 'characters'),
            chats: path.join(seeded.userRoot, 'chats'),
            groupChats: path.join(seeded.userRoot, 'group chats'),
            worlds: path.join(seeded.userRoot, 'worlds'),
        };

        for (const testCase of CASES.filter(entry => entry.profile === profileName)) {
            const baselinePath = path.join(BASELINE_DIR, `${testCase.id}.json`);
            const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
            const expected = baseline.request?.messages ?? [];

            const chatId = testCase.group
                ? encodeCompositeId('chat', ['group', testCase.group.chat_id])
                : encodeCompositeId('chat', ['solo', path.basename(testCase.character, '.png'), testCase.chat]);

            let assembled = null;
            let failure = null;
            try {
                assembled = await assembleAuthoritativeTurn({
                    user: { directories, storageHandle: path.basename(seeded.userRoot), profile: { name: 'fixture' } },
                    chatId,
                    type: testCase.type,
                    noteText: undefined,
                    deps: {
                        fs,
                        readCard: async cardPath => await parseCard(cardPath, 'png'),
                        getChatData,
                    },
                });
            } catch (error) {
                failure = error;
            }

            if (failure) {
                results.push({ id: testCase.id, status: 'not-implemented', detail: `${failure.status ?? ''} ${failure.code ?? ''}`.trim() });
                continue;
            }

            const diff = firstDivergence(assembled.messages ?? [], expected);
            if (!diff) {
                results.push({ id: testCase.id, status: 'byte-identical', detail: `${expected.length} messages` });
                continue;
            }
            results.push({
                id: testCase.id,
                status: 'diverges',
                detail: `first divergence at message ${diff.index} (${diff.kind}); expected ${expected.length}, got ${(assembled.messages ?? []).length}`,
                expected: preview(expected[diff.index]),
                actual: preview((assembled.messages ?? [])[diff.index]),
            });
        }
    }

    for (const tempRoot of roots) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    const width = Math.max(...results.map(entry => entry.id.length));
    console.log('\nServer replay vs browser baseline\n');
    for (const entry of results) {
        console.log(`  ${entry.id.padEnd(width)}  ${entry.status.padEnd(15)}  ${entry.detail}`);
        if (entry.expected !== undefined) {
            console.log(`  ${' '.repeat(width)}    expected: ${entry.expected}`);
            console.log(`  ${' '.repeat(width)}    actual:   ${entry.actual}`);
        }
    }

    const identical = results.filter(entry => entry.status === 'byte-identical').length;
    const pending = results.filter(entry => entry.status === 'not-implemented').length;
    console.log(`\n  ${identical}/${results.length} byte-identical, ${pending} not implemented, ${results.length - identical - pending} diverging\n`);

    if (STRICT && identical !== results.length) {
        process.exitCode = 1;
    }
}

await main();
