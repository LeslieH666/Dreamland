import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { patchPreferences, readPreferences, readLoginAppearance, saveLoginAppearance } from '../src/leslie-user-spaces/preferences.js';
import { loginAppearance, validPreference } from '../public/scripts/leslie-preferences-core.js';
import { sealUserSpace, unlockUserSpace, sealActiveUserSpace } from '../src/leslie-user-spaces/vault.js';
import { router } from '../src/leslie-user-spaces/preferences-router.js';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamland-preferences-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('keeps each account and demo preference separate, merges changes and retains a rollback record', () => {
    const alice = path.join(root, 'alice');
    const bob = path.join(root, 'bob');
    const demo = path.join(root, '_demo', 'alice');
    patchPreferences(alice, { 'dreamland.appearance.style': 'blue', 'leslie.theme.preference': 'dark' });
    patchPreferences(bob, { 'dreamland.appearance.style': 'paper' });
    patchPreferences(demo, { 'dreamland.appearance.style': 'moon' });
    patchPreferences(alice, { language: 'zh-cn', 'leslie.theme.preference': null });
    expect(readPreferences(alice).values).toEqual({ 'dreamland.appearance.style': 'blue', language: 'zh-cn' });
    expect(readPreferences(bob).values['dreamland.appearance.style']).toBe('blue');
    expect(readPreferences(demo).values['dreamland.appearance.style']).toBe('blue');
    const file = path.join(alice, 'leslie', 'browser-preferences.json');
    expect(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')).values['leslie.theme.preference']).toBe('dark');
    fs.copyFileSync(`${file}.previous`, file);
    expect(readPreferences(alice).values['leslie.theme.preference']).toBe('dark');
});

test('rejects secrets, drafts and invalid values, and exposes only appearance before login', () => {
    expect(validPreference('api_key', 'synthetic-secret')).toBe(false);
    expect(validPreference('leslie.theme.preference', 'invalid')).toBe(false);
    expect(validPreference('leslie.privacy-mode.v1', '{"enabled":true,"blocks":{"messages":true}}')).toBe(true);
    expect(validPreference('leslie.privacy-mode.v1', '{"enabled":true,"blocks":42}')).toBe(false);
    expect(() => patchPreferences(root, { chatDraft: 'synthetic draft' })).toThrow();
    const values = { 'dreamland.appearance.style': 'blue', 'leslie.theme.preference': 'dark', language: 'zh-cn', api_key: 'synthetic-secret' };
    saveLoginAppearance(root, 'alice', values);
    expect(readLoginAppearance(root)).toEqual(loginAppearance(values));
    expect(readLoginAppearance(root, 'alice')).toEqual({ 'dreamland.appearance.style': 'blue', 'leslie.theme.preference': 'dark' });
    expect(readLoginAppearance(root, 'bob')).toEqual({});
    expect(fs.readFileSync(path.join(root, '_leslie-login-appearance.json'), 'utf8')).not.toContain('synthetic-secret');
});

test('preserves unsupported records instead of overwriting them with defaults', () => {
    const file = path.join(root, 'leslie', 'browser-preferences.json');
    fs.mkdirSync(path.dirname(file));
    const original = '{"schemaVersion":99,"values":{"language":"zh-cn"}}';
    fs.writeFileSync(file, original);
    expect(() => patchPreferences(root, { language: 'en' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    fs.writeFileSync(file, '{"schemaVersion":1,"values":"invalid"}');
    expect(() => readPreferences(root)).toThrow();
});

test('rejects delayed preference writes after a space change without modifying either space', () => {
    const alice = path.join(root, 'alice');
    const bob = path.join(root, 'bob');
    patchPreferences(alice, { 'dreamland.appearance.style': 'blue' });
    patchPreferences(bob, { 'dreamland.appearance.style': 'paper' });
    const save = router.stack.find(layer => layer.route?.methods.post).route.stack[0].handle;
    const response = { code: 200, status(code) { this.code = code; return this; }, json() {} };
    save({ user: { profile: { handle: 'bob' }, storageHandle: 'bob', directories: { root: bob } }, body: { owner: 'alice', changes: { 'dreamland.appearance.style': 'blue' } } }, response);
    expect(response.code).toBe(409);
    expect(readPreferences(alice).values['dreamland.appearance.style']).toBe('blue');
    expect(readPreferences(bob).values['dreamland.appearance.style']).toBe('blue');
});

test('restores saved preferences from an existing-format encrypted vault', async () => {
    const userRoot = path.join(root, 'alice');
    patchPreferences(userRoot, { 'dreamland.appearance.style': 'blue', 'leslie-local-model-loading-enabled': 'false' });
    await sealUserSpace(root, 'alice', 'synthetic-password');
    expect(fs.existsSync(userRoot)).toBe(false);
    try {
        await unlockUserSpace(root, 'alice', 'synthetic-password');
        expect(readPreferences(userRoot).values['dreamland.appearance.style']).toBe('blue');
        expect(readPreferences(userRoot).values['leslie-local-model-loading-enabled']).toBe('false');
    } finally { await sealActiveUserSpace(root); }
});

test('migrates v1 layouts once, preserves color/settings and retains the exact rollback record', () => {
    const file = path.join(root, 'leslie', 'browser-preferences.json');
    fs.mkdirSync(path.dirname(file));
    const original = JSON.stringify({ schemaVersion: 1, values: {
        'dreamland.appearance.style': 'paper', 'leslie.design.language': 'classic',
        'dreamland.appearance.decoration': 'full', 'leslie.color.palette': 'clay',
        'leslie.theme.preference': 'dark', language: 'zh-cn',
    } });
    fs.writeFileSync(file, original);
    const migrated = readPreferences(root).values;
    expect(migrated).toEqual({ 'dreamland.appearance.style': 'blue', 'leslie.design.language': 'dreamland',
        'dreamland.appearance.decoration': 'subtle', 'leslie.color.palette': 'clay', 'leslie.theme.preference': 'dark', language: 'zh-cn' });
    expect(fs.readFileSync(`${file}.before-momotalk`, 'utf8')).toBe(original);
    patchPreferences(root, { 'leslie.color.palette': 'rose' });
    readPreferences(root);
    expect(fs.readFileSync(`${file}.before-momotalk`, 'utf8')).toBe(original);
    fs.copyFileSync(`${file}.before-momotalk`, file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).values['dreamland.appearance.style']).toBe('paper');
    expect(readPreferences(root).values['leslie.color.palette']).toBe('clay');
});
