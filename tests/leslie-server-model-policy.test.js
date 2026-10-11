/* global globalThis */
/* eslint-disable playwright/no-standalone-expect -- Jest policy regression suite. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { setRuntimeMode } from '../src/runtime-mode.js';

let root;
let gateway;
beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-catalog-policy-'));
    fs.writeFileSync(path.join(root, 'config.yaml'), 'allowKeysExposure: false\n');
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(path.join(root, 'config.yaml'));
    globalThis.DATA_ROOT = root;
    gateway = await import('../src/model-gateway/store.js');
});
afterAll(() => {
    delete globalThis.DATA_ROOT;
    delete globalThis.DREAMLAND_MODE;
    fs.rmSync(root, { recursive: true, force: true });
});
test('an empty server catalog blocks personal API fallback; desktop keeps compatibility', () => {
    gateway.writeModelGateway(gateway.createDefaultGateway());
    setRuntimeMode('server');
    expect(() => gateway.resolveWebModelConfig()).toThrow('管理员尚未配置可用模型');
    setRuntimeMode('desktop');
    expect(gateway.resolveWebModelConfig()).toBeNull();
});
test('disabled providers are excluded and the default uses a usable model', () => {
    gateway.writeModelGateway({ schemaVersion: 1, providers: [
        { id: 'disabled', enabled: false }, { id: 'available', source: 'custom', endpoint: 'http://127.0.0.1:12345/v1' },
    ], models: [
        { id: 'hidden', provider: 'disabled' }, { id: 'selected', provider: 'available', apiModel: 'fixture-model' },
    ] });
    setRuntimeMode('server');
    expect(gateway.listAvailableModels().map(model => model.id)).toEqual(['selected']);
    expect(gateway.resolveWebModelConfig().model).toBe('fixture-model');
    expect(() => gateway.resolveWebModelConfig('hidden')).toThrow('disabled');
    expect(() => gateway.resolveWebModelConfig('not-in-catalog')).toThrow('not in');
});
