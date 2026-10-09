import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

// src/ reaches the config loader through src/users.js, so the config path must
// be set before any of it is imported. Everything is therefore loaded in
// beforeAll after setConfigFilePath().
let DATA_ROOT_KIND;
let SECRET_ENCRYPTION_KEY_ENV;
let configurePlatform;
let createAesProtector;
let getPlatform;
let parseSecretDocument;
let protectorFormat;
let resetPlatform;
let resolveDataRoot;
let resolveSecretStorage;
let serializeSecretDocument;
let AES_SECRETS_FORMAT;
let PROTECTED_SECRETS_FORMAT;
let setRuntimeMode;
let RUNTIME_MODE_DESKTOP;
let RUNTIME_MODE_SERVER;

let configRoot;
let tempRoots = [];

beforeAll(async () => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-platform-config-'));
    const configPath = path.join(configRoot, 'config.yaml');
    fs.writeFileSync(configPath, 'allowKeysExposure: false\n');
    const util = await import('../src/util.js');
    util.setConfigFilePath(configPath);

    ({ DATA_ROOT_KIND, resolveDataRoot } = await import('../src/platform/data-root.js'));
    ({
        SECRET_ENCRYPTION_KEY_ENV,
        createAesProtector,
        resolveSecretStorage,
    } = await import('../src/platform/secret-store.js'));
    ({ configurePlatform, getPlatform, resetPlatform } = await import('../src/platform/index.js'));
    ({
        AES_SECRETS_FORMAT,
        PROTECTED_SECRETS_FORMAT,
        parseSecretDocument,
        protectorFormat,
        serializeSecretDocument,
    } = await import('../src/secret-protection.js'));
    ({ RUNTIME_MODE_DESKTOP, RUNTIME_MODE_SERVER, setRuntimeMode } = await import('../src/runtime-mode.js'));
});

afterAll(() => {
    if (configRoot && fs.existsSync(configRoot) && path.dirname(configRoot) === os.tmpdir()) {
        fs.rmSync(configRoot, { recursive: true, force: true });
    }
});

beforeEach(() => {
    delete process.env[SECRET_ENCRYPTION_KEY_ENV];
    delete process.env.DREAMLAND_DATA_ROOT;
    resetPlatform();
});

afterEach(() => {
    for (const dir of tempRoots) {
        if (dir && fs.existsSync(dir) && path.dirname(dir) === os.tmpdir()) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    tempRoots = [];
    setRuntimeMode(RUNTIME_MODE_SERVER);
    resetPlatform();
});

describe('data root platform interface', () => {
    test('server mode resolves an absolute mounted volume and reports its source', () => {
        const descriptor = resolveDataRoot({ mode: RUNTIME_MODE_SERVER, configuredRoot: '/srv/dreamland/data', configuredByEnv: true });
        expect(descriptor.kind).toBe(DATA_ROOT_KIND.SERVER_VOLUME);
        expect(descriptor.root).toBe('/srv/dreamland/data');
        expect(descriptor.source).toBe('env');
        expect(descriptor.describe()).toContain('server volume');
    });

    test('server mode warns about a relative path instead of guessing silently', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const descriptor = resolveDataRoot({ mode: RUNTIME_MODE_SERVER, configuredRoot: './data', configuredByEnv: false, cwd: '/srv/app' });
            expect(descriptor.root).toBe('/srv/app/data');
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('relative'));
        } finally {
            warn.mockRestore();
        }
    });

    test('desktop mode keeps an install-relative directory', () => {
        const descriptor = resolveDataRoot({ mode: RUNTIME_MODE_DESKTOP, configuredRoot: './data', configuredByEnv: false, cwd: '/opt/dreamland' });
        expect(descriptor.kind).toBe(DATA_ROOT_KIND.DESKTOP_DIRECTORY);
        expect(descriptor.root).toBe('/opt/dreamland/data');
        expect(descriptor.source).toBe('default');
    });

    test('ensure() creates the directory and reports writability', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-dataroot-'));
        tempRoots.push(root);
        const target = path.join(root, 'nested', 'data');
        const descriptor = resolveDataRoot({ mode: RUNTIME_MODE_SERVER, configuredRoot: target, configuredByEnv: true });
        expect(descriptor.ensure()).toBe(true);
        expect(fs.existsSync(target)).toBe(true);
        expect(descriptor.describe()).toContain('writable: true');
    });
});

describe('secret storage platform interface', () => {
    test('a server without an encryption key keeps the file plaintext and marks the environment source', () => {
        const storage = resolveSecretStorage({
            mode: RUNTIME_MODE_SERVER,
            environment: { DREAMLAND_SECRET_API_KEY_OPENAI: 'sk-x' },
            platform: 'linux',
        });
        expect(storage.kind).toBe('plaintext');
        expect(storage.protector).toBeNull();
        expect(storage.externalSecretSourceConfigured).toBe(true);
    });

    test('an encryption key selects AES-256-GCM at rest', () => {
        const storage = resolveSecretStorage({
            mode: RUNTIME_MODE_SERVER,
            environment: { [SECRET_ENCRYPTION_KEY_ENV]: 'a-strong-passphrase' },
            platform: 'linux',
        });
        expect(storage.kind).toBe('aes-gcm');
        expect(storage.format).toBe(AES_SECRETS_FORMAT);
        expect(storage.protector).toBeTruthy();
        expect(storage.description).toContain(SECRET_ENCRYPTION_KEY_ENV);
    });

    test('a Windows desktop prefers DPAPI and can still read an AES document', () => {
        const storage = resolveSecretStorage({ mode: RUNTIME_MODE_DESKTOP, environment: {}, platform: 'win32' });
        expect(storage.kind).toBe('dpapi');
        expect(storage.format).toBe(PROTECTED_SECRETS_FORMAT);

        const withKey = resolveSecretStorage({
            mode: RUNTIME_MODE_DESKTOP,
            environment: { [SECRET_ENCRYPTION_KEY_ENV]: 'passphrase' },
            platform: 'win32',
        });
        expect(withKey.kind).toBe('aes-gcm');
        // Both formats stay readable so a migration does not lock users out.
        expect(withKey.protectors.map(protectorFormat)).toEqual(
            expect.arrayContaining([AES_SECRETS_FORMAT, PROTECTED_SECRETS_FORMAT]),
        );
    });

    test('an AES protector round-trips and refuses tampered data', () => {
        const protector = createAesProtector('round-trip-key');
        expect(protectorFormat(protector)).toBe(AES_SECRETS_FORMAT);
        const plaintext = Buffer.from('{"api_key_openai":"sk-secret"}', 'utf8');
        const sealed = protector.protect(plaintext);
        expect(sealed.equals(plaintext)).toBe(false);
        expect(protector.unprotect(sealed).toString('utf8')).toBe(plaintext.toString('utf8'));

        const tampered = Buffer.from(sealed);
        tampered[tampered.length - 1] ^= 0xff;
        expect(() => protector.unprotect(tampered)).toThrow();
    });

    test('a different passphrase cannot open the document', () => {
        const sealed = createAesProtector('key-one').protect(Buffer.from('{"a":"b"}', 'utf8'));
        expect(() => createAesProtector('key-two').unprotect(sealed)).toThrow();
    });
});

describe('secret document formats', () => {
    test('plaintext documents stay untouched', () => {
        const contents = JSON.stringify({ api_key_openai: [{ id: '1', value: 'sk', active: true }] });
        const parsed = parseSecretDocument(contents, null);
        expect(parsed.protected).toBe(false);
        expect(parsed.secrets.api_key_openai[0].value).toBe('sk');
        expect(serializeSecretDocument(parsed.secrets, null)).toContain('api_key_openai');
    });

    test('an unprotected protector defaults to the DPAPI format tag', () => {
        const legacy = { protect: bytes => bytes, unprotect: bytes => bytes };
        expect(protectorFormat(legacy)).toBe(PROTECTED_SECRETS_FORMAT);
        const contents = serializeSecretDocument({ a: 'b' }, legacy);
        expect(JSON.parse(contents).format).toBe(PROTECTED_SECRETS_FORMAT);
    });

    test('a document is opened by the matching protector only', () => {
        const aes = createAesProtector('format-test-key');
        const contents = serializeSecretDocument({ api_key_openai: 'sk-aes' }, aes);
        expect(parseSecretDocument(contents, [aes]).secrets).toEqual({ api_key_openai: 'sk-aes' });
        expect(() => parseSecretDocument(contents, [])).toThrow(/cannot be opened/i);
        expect(() => parseSecretDocument(contents, null)).toThrow(/cannot be opened/i);
    });
});

describe('platform capabilities replace inline process.platform checks', () => {
    test('only the desktop host may launch a browser', () => {
        setRuntimeMode(RUNTIME_MODE_SERVER);
        resetPlatform();
        expect(getPlatform().environment.supportsBrowserLaunch).toBe(false);
        expect(getPlatform().environment.isDesktop).toBe(false);

        setRuntimeMode(RUNTIME_MODE_DESKTOP);
        resetPlatform();
        expect(getPlatform().environment.supportsBrowserLaunch).toBe(true);
        expect(getPlatform().environment.isDesktop).toBe(true);
    });

    test('terminal titles and desktop icons are resolved by the platform', () => {
        setRuntimeMode(RUNTIME_MODE_SERVER);
        resetPlatform();
        const environment = getPlatform().environment;
        expect(() => environment.applyTerminalTitle('unit-test')).not.toThrow();
        expect(environment.desktopIconAsset('icon')).toMatch(/^icon(-192\.png|\.ico)$/);
        expect(typeof environment.isAndroid).toBe('boolean');
    });

    test('an explicitly configured data root is published on the platform', () => {
        setRuntimeMode(RUNTIME_MODE_SERVER);
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-platform-root-'));
        tempRoots.push(root);
        configurePlatform({ dataRoot: resolveDataRoot({ mode: RUNTIME_MODE_SERVER, configuredRoot: root, configuredByEnv: true }) });
        expect(getPlatform().dataRoot.root).toBe(root);
    });
});

describe('SecretManager uses the platform protector', () => {
    test('a configured encryption key writes an AES document and reads it back', async () => {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-platform-secrets-'));
        tempRoots.push(dataRoot);
        process.env[SECRET_ENCRYPTION_KEY_ENV] = 'manager-passphrase';
        setRuntimeMode(RUNTIME_MODE_SERVER);
        resetPlatform();

        const { SecretManager, SECRET_KEYS } = await import('../src/endpoints/secrets.js');
        const directories = { root: dataRoot };
        const manager = new SecretManager(directories);
        manager.writeSecret(SECRET_KEYS.OPENAI, 'sk-written-through-platform', 'unit');

        const onDisk = fs.readFileSync(path.join(dataRoot, 'secrets.json'), 'utf8');
        expect(JSON.parse(onDisk).format).toBe(AES_SECRETS_FORMAT);
        expect(onDisk).not.toContain('sk-written-through-platform');

        // A fresh manager (same platform storage) can read it back.
        delete process.env[SECRET_ENCRYPTION_KEY_ENV];
        resetPlatform();
        expect(new SecretManager(directories).readSecret(SECRET_KEYS.OPENAI)).toBe('sk-written-through-platform');
    });
});
