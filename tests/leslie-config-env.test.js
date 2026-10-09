import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';

import {
    CONFIG_ENV_KEYS,
    DEFAULT_SECRETS_FILE,
    DREAMLAND_ENV_PREFIX,
    SECRETS_FILE_ENV,
    configKeyToEnvKey,
    findDreamlandEnvOverride,
    hasExternalSecretSource,
    listConfigEnvOverrides,
    listEnvSecretKeys,
    readEnvSecret,
    readMountedSecrets,
    secretKeyToEnvKey,
} from '../src/config-env.js';

describe('DreamLand config environment mapping', () => {
    test('derives DREAMLAND_ variables from config keys', () => {
        expect(configKeyToEnvKey('cors.origin')).toBe('DREAMLAND_CORS_ORIGIN');
        expect(configKeyToEnvKey('dataRoot')).toBe('DREAMLAND_DATAROOT');
        expect(DREAMLAND_ENV_PREFIX).toBe('DREAMLAND_');
        expect(CONFIG_ENV_KEYS['port']).toBe('DREAMLAND_PORT');
    });

    test('prefers the documented variable name over the derived one', () => {
        expect(findDreamlandEnvOverride('dataRoot', { DREAMLAND_DATA_ROOT: '/srv/dreamland-data' }))
            .toEqual({ envKey: 'DREAMLAND_DATA_ROOT', raw: '/srv/dreamland-data' });
        expect(findDreamlandEnvOverride('listen', { DREAMLAND_LISTEN: 'true' }))
            .toEqual({ envKey: 'DREAMLAND_LISTEN', raw: 'true' });
    });

    test('ignores unrelated variables and reports no override', () => {
        expect(findDreamlandEnvOverride('port', {})).toBeNull();
        expect(findDreamlandEnvOverride('port', { SILLYTAVERN_PORT: '8124' })).toBeNull();
        expect(findDreamlandEnvOverride('port', { DREAMLAND_SOMETHING_ELSE: 'x' })).toBeNull();
    });

    test('redacts credential-bearing overrides in the report', () => {
        const entries = listConfigEnvOverrides({
            DREAMLAND_PORT: '8123',
            DREAMLAND_CORS_ORIGIN: 'https://app.example.com',
            DREAMLAND_BASIC_AUTH_PASSWORD: 'super-secret',
        });
        const byKey = Object.fromEntries(entries.map(entry => [entry.key, entry]));
        expect(byKey['port'].value).toBe('8123');
        expect(byKey['cors.origin'].value).toBe('https://app.example.com');
        expect(byKey['basicAuthUser.password'].value).toBe('[redacted]');
        expect(byKey['basicAuthUser.password'].secret).toBe(true);
        expect(JSON.stringify(entries)).not.toContain('super-secret');
    });
});

describe('DreamLand external secret sources', () => {
    test('reads a per-key secret from the environment', () => {
        expect(secretKeyToEnvKey('api_key_openai')).toBe('DREAMLAND_SECRET_API_KEY_OPENAI');
        expect(readEnvSecret('api_key_openai', { environment: { DREAMLAND_SECRET_API_KEY_OPENAI: 'sk-live' } }))
            .toEqual({ value: 'sk-live', source: 'env', envKey: 'DREAMLAND_SECRET_API_KEY_OPENAI' });
    });

    test('falls back to the mounted secret document and reports its keys', () => {
        const environment = { DREAMLAND_SECRET_CLAUDE: 'sk-claude' };
        const mounted = { path: '/run/secrets/dreamland-secrets.json', secrets: { api_key_openai: 'sk-mounted' } };
        expect(readEnvSecret('api_key_openai', { environment, mounted }))
            .toEqual({ value: 'sk-mounted', source: 'mounted-file' });
        expect(readEnvSecret('claude', { environment, mounted }))
            .toEqual({ value: 'sk-claude', source: 'env', envKey: 'DREAMLAND_SECRET_CLAUDE' });
        expect(readEnvSecret('volcengine', { environment, mounted })).toBeNull();

        const keys = listEnvSecretKeys({ environment, mounted, knownKeys: ['api_key_openai', 'claude', 'volcengine'] });
        expect([...keys.keys()].sort()).toEqual(['api_key_openai', 'claude']);
    });

    test('accepts both the string and the labelled object form in a mounted document', () => {
        const mounted = { path: '/tmp/secrets.json', secrets: { labelled: { value: 'sk-labelled', label: 'Ops' } } };
        expect(readEnvSecret('labelled', { environment: {}, mounted }))
            .toEqual({ value: 'sk-labelled', source: 'mounted-file' });
    });

    test('reads and validates a mounted secret file, and survives a broken one', () => {
        const file = '/run/secrets/dreamland-secrets.json';
        const io = { exists: target => target === file, readFile: () => '{"api_key_openai":"sk-file"}' };
        const parsed = readMountedSecrets({ [SECRETS_FILE_ENV]: file }, io);
        expect(parsed).toEqual({ path: file, secrets: { api_key_openai: 'sk-file' } });

        const broken = readMountedSecrets({ [SECRETS_FILE_ENV]: file }, { exists: () => true, readFile: () => 'not json' });
        expect(broken).toBeNull();

        expect(DEFAULT_SECRETS_FILE).toBe('/run/secrets/dreamland-secrets.json');
        expect(readMountedSecrets({}, { exists: () => false })).toBeNull();
    });

    test('detects whether any external secret source is configured', () => {
        expect(hasExternalSecretSource({})).toBe(false);
        expect(hasExternalSecretSource({ DREAMLAND_SECRET_API_KEY_OPENAI: 'sk' })).toBe(true);
        expect(hasExternalSecretSource({ [SECRETS_FILE_ENV]: '/run/secrets/x.json' })).toBe(true);
    });
});

describe('SecretManager external overlay', () => {
    let testRoot;
    let directories;
    let configRoot;
    let SecretManager;
    let EXTERNAL_SECRET_ID;
    let SECRET_KEYS;

    beforeAll(async () => {
        configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-config-env-'));
        const configPath = path.join(configRoot, 'config.yaml');
        fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
        const { setConfigFilePath } = await import('../src/util.js');
        setConfigFilePath(configPath);
        ({ SecretManager, EXTERNAL_SECRET_ID, SECRET_KEYS } = await import('../src/endpoints/secrets.js'));
    });

    beforeEach(() => {
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-secret-env-'));
        directories = { root: testRoot };
        delete process.env.DREAMLAND_SECRET_API_KEY_OPENAI;
        delete process.env[SECRETS_FILE_ENV];
    });

    afterEach(() => {
        delete process.env.DREAMLAND_SECRET_API_KEY_OPENAI;
        delete process.env[SECRETS_FILE_ENV];
        if (testRoot && path.dirname(testRoot) === os.tmpdir()) {
            fs.rmSync(testRoot, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        if (configRoot && path.dirname(configRoot) === os.tmpdir()) {
            fs.rmSync(configRoot, { recursive: true, force: true });
        }
    });

    test('an environment secret wins over a stored one and is reported as active and masked', () => {
        const manager = new SecretManager(directories);
        manager.writeSecret(SECRET_KEYS.OPENAI, 'sk-stored-value', 'Stored');

        expect(manager.readSecret(SECRET_KEYS.OPENAI)).toBe('sk-stored-value');

        process.env.DREAMLAND_SECRET_API_KEY_OPENAI = 'sk-from-environment';
        const envManager = new SecretManager(directories);
        expect(envManager.readSecret(SECRET_KEYS.OPENAI)).toBe('sk-from-environment');

        const state = envManager.getSecretState()[SECRET_KEYS.OPENAI];
        expect(state[0]).toMatchObject({ id: EXTERNAL_SECRET_ID, active: true });
        expect(state[0].value).not.toContain('from-environment');
        expect(state[1].active).toBe(false);
    });

    test('keeps the stored file path when no external source is configured', () => {
        const manager = new SecretManager(directories);
        manager.writeSecret(SECRET_KEYS.OPENAI, 'sk-stored-value', 'Stored');
        expect(manager.readSecret(SECRET_KEYS.OPENAI, undefined)).toBe('sk-stored-value');
        expect(manager.getSecretState()[SECRET_KEYS.OPENAI]).toHaveLength(1);
    });
});
