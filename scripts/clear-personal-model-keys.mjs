#!/usr/bin/env node
/**
 * Clear per-account model API keys and endpoint configuration (server-managed gateway T4).
 *
 * The model gateway owns provider keys and endpoints now, so every account's private
 * oai_settings model block and its per-account secrets file are stale. This script walks
 * all accounts and removes them, leaving chats/characters/settings intact.
 *
 *   node scripts/clear-personal-model-keys.mjs                # dry-run: list only
 *   node scripts/clear-personal-model-keys.mjs --execute      # apply the deletions
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(SERVER_DIRECTORY);

const { resolveDataRoot } = await import('../src/platform/data-root.js');
const dataRoot = resolveDataRoot({
    mode: 'server',
    configuredRoot: process.env.DREAMLAND_DATA_ROOT,
    configuredByEnv: Boolean(process.env.DREAMLAND_DATA_ROOT),
}).root;
globalThis.DATA_ROOT = dataRoot;
globalThis.COMMAND_LINE_ARGS = { listen: false, basicAuthMode: false, mode: 'server' };

const util = await import('../src/util.js');
util.setConfigFilePath(path.join(SERVER_DIRECTORY, 'config.yaml'));

const { getAllUserHandles, getUserDirectories, toKey, initUserStorage } = await import('../src/users.js');
const { SecretManager, SECRET_KEYS } = await import('../src/endpoints/secrets.js');
const storage = (await import('node-persist')).default;

await initUserStorage(dataRoot);

/** Model-related oai_settings fields that belong to the server gateway now. */
const MODEL_FIELD_PATTERN = /(^|_)(model|source|url|proxy|secret|key|endpoint|header)(_|$)/i;
const EXPLICIT_MODEL_FIELDS = new Set([
    'chat_completion_source',
    'custom_url',
    'reverse_proxy',
    'proxy_password',
    'secret_id',
    'custom_include_headers',
    'custom_prompt_post_processing',
    'custom_exclude_body',
    'custom_include_body',
]);

function isModelField(key) {
    return EXPLICIT_MODEL_FIELDS.has(key) || MODEL_FIELD_PATTERN.test(key);
}

const execute = process.argv.includes('--execute');
const handles = await getAllUserHandles();
const report = [];
let removedFields = 0;
let removedSecrets = 0;

for (const handle of handles.sort()) {
    const directories = getUserDirectories(handle);
    const settingsPath = path.join(directories.root, 'settings.json');
    const entry = { handle, settings: [], secrets: [] };

    let settings = null;
    try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch { /* no settings */ }

    if (settings?.oai_settings && typeof settings.oai_settings === 'object') {
        for (const key of Object.keys(settings.oai_settings)) {
            if (isModelField(key)) {
                entry.settings.push({ key, value: settings.oai_settings[key] });
                if (execute) {
                    delete settings.oai_settings[key];
                }
            }
        }
        if (execute) {
            fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 4)}\n`, 'utf8');
        }
    }

    const manager = new SecretManager(directories);
    try {
        const all = manager.getAllSecrets();
        for (const [key, values] of Object.entries(all)) {
            if (key === SECRET_KEYS._MIGRATED) continue;
            if (Array.isArray(values) && values.length > 0) {
                entry.secrets.push({ key, count: values.length });
                if (execute) {
                    manager.deleteSecret(key, null);
                }
            }
        }
    } catch { /* no per-account secrets */ }

    removedFields += entry.settings.length;
    removedSecrets += entry.secrets.length;
    if (entry.settings.length || entry.secrets.length) {
        report.push(entry);
    }
}

console.log(`\n${execute ? 'CLEARED' : 'DRY-RUN'} — accounts scanned: ${handles.length}`);
console.log(`  model fields to remove: ${removedFields}`);
console.log(`  secret slots to remove: ${removedSecrets}\n`);

for (const entry of report) {
    console.log(`${entry.handle}:`);
    for (const item of entry.settings) {
        console.log(`  settings.oai_settings.${item.key} = ${JSON.stringify(item.value)}`);
    }
    for (const item of entry.secrets) {
        console.log(`  secrets.${item.key} (${item.count} entries)`);
    }
}
console.log();

if (!execute) {
    console.log('Run with --execute to apply the deletions shown above.');
}

process.exit(0);
