import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { generateMomentsOnline, getConfiguredMomentsOnlineModels, MomentsOnlineModelError, validateMomentsGeneration } from '../src/leslie-moments/online-model.js';
import { LeslieMomentsSettingsStore } from '../src/leslie-moments/settings-store.js';

describe('Leslie Moments online model', () => {
    let temporaryRoot;

    afterEach(() => {
        if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
        temporaryRoot = undefined;
    });

    test('migrates v1 settings on the next write and keeps the original for rollback', () => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-moments-model-'));
        const store = new LeslieMomentsSettingsStore(temporaryRoot);
        fs.mkdirSync(store.directory, { recursive: true });
        const original = { schemaVersion: 1, revision: 3, globalAiPostingEnabled: false, characterPolicies: [], createdAt: '2026-01-01T00:00:00.000Z' };
        fs.writeFileSync(store.settingsPath, JSON.stringify(original));

        expect(store.readSettings()).toMatchObject({ schemaVersion: 2, onlineModel: { provider: '', model: '' } });
        const next = store.updateSettings({ onlineModel: { provider: 'deepseek', model: 'example-model' } });
        expect(next).toMatchObject({ schemaVersion: 2, onlineModel: { provider: 'deepseek', model: 'example-model' } });
        const backup = fs.readdirSync(store.historyDirectory).find(name => name.startsWith('settings-r3-'));
        expect(backup).toBeTruthy();
        expect(JSON.parse(fs.readFileSync(path.join(store.historyDirectory, backup), 'utf8'))).toEqual(original);
        fs.copyFileSync(path.join(store.historyDirectory, backup), store.settingsPath);
        expect(store.readSettings().onlineModel).toEqual({ provider: '', model: '' });
    });

    test('rejects unsupported providers and invalid generation input', () => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-moments-model-'));
        const store = new LeslieMomentsSettingsStore(temporaryRoot);
        expect(() => store.updateSettings({ onlineModel: { provider: 'koboldcpp', model: 'local' } })).toThrow(TypeError);
        expect(() => validateMomentsGeneration({ prompt: 'hello', systemPrompt: 'system', responseLength: 2000 })).toThrow(MomentsOnlineModelError);
        expect(fs.existsSync(store.settingsPath)).toBe(false);
    });

    test('calls only the selected fixed HTTPS provider and uses its saved key', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"read"}' } }] }) }));
        const readSecretImpl = jest.fn(() => 'synthetic-key');
        const content = await generateMomentsOnline({
            directories: {},
            onlineModel: { provider: 'deepseek', model: 'example-model' },
            input: { systemPrompt: 'Return JSON', prompt: '{}', responseLength: 300 },
            fetchImpl,
            readSecretImpl,
        });
        expect(content).toBe('{"action":"read"}');
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.deepseek.com/beta/chat/completions');
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
            model: 'example-model',
            thinking: { type: 'disabled' },
        });
        expect(readSecretImpl).toHaveBeenCalledTimes(1);
    });

    test('never falls back when the online key is missing', async () => {
        const fetchImpl = jest.fn();
        await expect(generateMomentsOnline({
            directories: {},
            onlineModel: { provider: 'openai', model: 'example-model' },
            input: { systemPrompt: 'Return JSON', prompt: '{}', responseLength: 300 },
            fetchImpl,
            readSecretImpl: () => '',
        })).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('lists only account-configured online models with readable keys', async () => {
        const settings = { oai_settings: {
            deepseek_model: 'deepseek-chat', openai_model: 'gpt-example', openrouter_model: 'OR_Website',
            claude_model: 'claude-example', google_model: 'gemini-example', koboldcpp_model: 'local-model',
        } };
        const readSecretImpl = jest.fn((_, key) => key === 'api_key_deepseek' || key === 'api_key_claude' ? 'synthetic-key' : '');
        expect(await getConfiguredMomentsOnlineModels({ directories: {}, settings, readSecretImpl })).toEqual([
            { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek' },
            { provider: 'claude', model: 'claude-example', label: 'Claude' },
        ]);
        settings.oai_settings.deepseek_model = 'deepseek-reconfigured';
        expect((await getConfiguredMomentsOnlineModels({ directories: {}, settings, readSecretImpl }))[0].model).toBe('deepseek-reconfigured');
    });

    test('reads the existing account model settings without a Moments model field', async () => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-moments-model-'));
        fs.writeFileSync(path.join(temporaryRoot, 'settings.json'), JSON.stringify({ oai_settings: { openai_model: 'gpt-example' } }));
        const models = await getConfiguredMomentsOnlineModels({
            directories: { root: temporaryRoot },
            readSecretImpl: (_, key) => key === 'api_key_openai' ? 'synthetic-key' : '',
        });
        expect(models).toEqual([{ provider: 'openai', model: 'gpt-example', label: 'OpenAI' }]);
    });

    test('uses the configured Claude and Google online API formats', async () => {
        const input = { systemPrompt: 'Return JSON', prompt: '{}', responseLength: 300 };
        const readSecretImpl = () => 'synthetic-key';
        const claudeFetch = jest.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"action":"read"}' }] }) }));
        expect(await generateMomentsOnline({ directories: {}, onlineModel: { provider: 'claude', model: 'claude-example' }, input, fetchImpl: claudeFetch, readSecretImpl })).toBe('{"action":"read"}');
        expect(claudeFetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
        expect(claudeFetch.mock.calls[0][1].headers['anthropic-version']).toBe('2023-06-01');
        const googleFetch = jest.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"action":"read"}' }] } }] }) }));
        expect(await generateMomentsOnline({ directories: {}, onlineModel: { provider: 'makersuite', model: 'gemini-example' }, input, fetchImpl: googleFetch, readSecretImpl })).toBe('{"action":"read"}');
        expect(googleFetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-example:generateContent');
        expect(googleFetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('synthetic-key');
    });
});
