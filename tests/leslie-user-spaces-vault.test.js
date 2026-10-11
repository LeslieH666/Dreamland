/* eslint-disable playwright/no-conditional-in-test, playwright/no-standalone-expect */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, jest, test } from '@jest/globals';

import { getUnlockedUserSpace, hasUserVault, purgeUserVault, rewrapUserSpace, sealActiveUserSpace, sealUserSpace, unlockUserSpace } from '../src/leslie-user-spaces/vault.js';

test('keeps the complete vault when late writes recreate fragments and preserves interrupted complete spaces', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-fragments-'));
    const userRoot = path.join(root, 'alice');
    try {
        fs.mkdirSync(userRoot);
        fs.writeFileSync(path.join(userRoot, 'settings.json'), '{"synthetic":true}');
        fs.writeFileSync(path.join(userRoot, 'preferences.txt'), 'synthetic saved preference');
        await sealUserSpace(root, 'alice', 'synthetic-password');
        fs.mkdirSync(path.join(userRoot, 'leslie', 'moments'), { recursive: true });
        fs.writeFileSync(path.join(userRoot, 'settings.json'), '{"synthetic":"late partial settings"}');
        fs.writeFileSync(path.join(userRoot, 'leslie', 'moments', 'queue.json'), '{"synthetic":"late"}');
        await unlockUserSpace(root, 'alice', 'synthetic-password');
        expect(fs.readFileSync(path.join(userRoot, 'preferences.txt'), 'utf8')).toBe('synthetic saved preference');
        expect(fs.readdirSync(path.join(root, '_leslie-vaults')).filter(name => name.startsWith('alice.fragment-'))).toHaveLength(1);
        expect(fs.existsSync(path.join(userRoot, 'leslie', 'moments', 'queue.json'))).toBe(false);
        await sealActiveUserSpace(root);
        // Legacy v1 working folders have no marker; settings identifies a complete space.
        const vaultFile = path.join(root, '_leslie-vaults', 'alice', 'vault.json');
        const header = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
        delete header.workingMarkerVersion;
        fs.writeFileSync(vaultFile, JSON.stringify(header));
        fs.mkdirSync(userRoot);
        fs.writeFileSync(path.join(userRoot, 'settings.json'), '{"synthetic":"edited after crash"}');
        fs.writeFileSync(path.join(userRoot, 'preferences.txt'), 'synthetic latest preference');
        await unlockUserSpace(root, 'alice', 'synthetic-password');
        expect(fs.readFileSync(path.join(userRoot, 'preferences.txt'), 'utf8')).toBe('synthetic latest preference');
        await sealActiveUserSpace(root);
        await purgeUserVault(root, 'alice');
        expect(fs.readdirSync(path.join(root, '_leslie-vaults'))).toHaveLength(0);
    } finally { await sealActiveUserSpace(root); fs.rmSync(root, { recursive: true, force: true }); }
}, 20000);

test('a new file arriving during encryption aborts sealing without deleting working data', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-race-'));
    const userRoot = path.join(root, 'alice');
    fs.mkdirSync(userRoot);
    fs.writeFileSync(path.join(userRoot, 'source.txt'), 'synthetic source');
    const read = fs.promises.readFile;
    const injected = jest.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
        const result = await read(...args);
        if (String(args[0]).endsWith('source.txt')) fs.writeFileSync(path.join(userRoot, 'late.txt'), 'synthetic late write');
        return result;
    });
    try {
        await expect(sealUserSpace(root, 'alice', 'synthetic-password')).rejects.toThrow('changed while');
        expect(fs.readFileSync(path.join(userRoot, 'late.txt'), 'utf8')).toBe('synthetic late write');
        expect(hasUserVault(root, 'alice')).toBe(false);
    } finally { injected.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('decrypts many files without blocking the event loop and serializes failed and successful unlocks', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-responsive-'));
    const userRoot = path.join(root, 'alice');
    const progress = [];
    let decrypting = false;
    let ticks = 0;
    let timer;
    try {
        fs.mkdirSync(userRoot);
        const data = Buffer.alloc(256 * 1024, 97);
        for (let i = 0; i < 32; i++) fs.writeFileSync(path.join(userRoot, `synthetic-${i}.bin`), data);
        await sealUserSpace(root, 'alice', 'synthetic-password');
        timer = setInterval(() => { if (decrypting) ticks++; }, 1);
        const invalid = unlockUserSpace(root, 'alice', 'wrong-password');
        const valid = unlockUserSpace(root, 'alice', 'synthetic-password', state => {
            decrypting = state.phase === 'decrypt';
            progress.push(state);
        });
        await expect(invalid).rejects.toThrow();
        await valid;
        expect(ticks).toBeGreaterThan(0);
        expect(progress.filter(state => state.phase === 'decrypt').at(-1)).toMatchObject({ completed: 32, total: 32 });
        expect(getUnlockedUserSpace()).toBe('alice');
        expect(fs.readFileSync(path.join(userRoot, 'synthetic-31.bin'))).toEqual(data);
        expect(JSON.parse(fs.readFileSync(path.join(root, '_leslie-vaults', 'alice', 'vault.json'), 'utf8')).version).toBe(1);
    } finally {
        clearInterval(timer);
        await sealActiveUserSpace(root);
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 20000);

test('synthetic user and demo data are encrypted, restored, and rewrapped', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-test-'));
    const root = path.join(workspace, 'data');
    const password = 'first-secret-password';
    const newPassword = 'second-secret-password';
    try {
        fs.mkdirSync(root);
        fs.mkdirSync(path.join(root, 'default-user', 'chats'), { recursive: true });
        fs.mkdirSync(path.join(root, 'default-user_demo', 'characters'), { recursive: true });
        fs.mkdirSync(path.join(root, '_demo', 'default-user'), { recursive: true });
        fs.mkdirSync(path.join(workspace, 'backups'));
        fs.writeFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'synthetic secret chat');
        fs.writeFileSync(path.join(root, 'default-user_demo', 'characters', 'test.json'), '{"name":"synthetic"}');
        fs.writeFileSync(path.join(root, '_demo', 'default-user', 'old.jsonl'), 'synthetic legacy demo');
        fs.writeFileSync(path.join(workspace, 'backups', '!README.md'), 'public instructions');
        fs.writeFileSync(path.join(workspace, 'backups', 'old-backup.zip'), 'synthetic archive');

        const sealed = await sealUserSpace(root, 'default-user', password);
        expect(sealed.files).toBe(4);
        expect(sealed.backup).toBe(true);
        expect(hasUserVault(root, 'default-user')).toBe(true);
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);
        expect(fs.existsSync(path.join(root, 'default-user_demo'))).toBe(false);
        expect(fs.existsSync(path.join(root, '_demo', 'default-user'))).toBe(false);
        expect(fs.existsSync(path.join(workspace, 'backups', 'old-backup.zip'))).toBe(false);
        expect(fs.existsSync(path.join(workspace, 'backups', '!README.md'))).toBe(true);
        expect(fs.existsSync(path.join(root, '_leslie-vaults', 'default-user.initial', 'vault.json'))).toBe(true);
        const vault = path.join(root, '_leslie-vaults', 'default-user');
        expect(fs.readFileSync(path.join(vault, 'vault.json'), 'utf8')).not.toContain('private-chat.jsonl');
        expect(fs.readdirSync(path.join(vault, 'files')).some(name => name.includes('chat'))).toBe(false);
        await expect(unlockUserSpace(root, 'default-user', 'incorrect-password')).rejects.toThrow();
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);

        await unlockUserSpace(root, 'default-user', password);
        expect(getUnlockedUserSpace()).toBe('default-user');
        expect(fs.readFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'utf8')).toBe('synthetic secret chat');
        expect(fs.readFileSync(path.join(root, 'default-user_demo', 'characters', 'test.json'), 'utf8')).toBe('{"name":"synthetic"}');
        expect(fs.readFileSync(path.join(root, '_demo', 'default-user', 'old.jsonl'), 'utf8')).toBe('synthetic legacy demo');
        expect(fs.readFileSync(path.join(workspace, 'backups', 'old-backup.zip'), 'utf8')).toBe('synthetic archive');
        await rewrapUserSpace(root, 'default-user', password, newPassword);
        await sealActiveUserSpace(root);
        expect(getUnlockedUserSpace()).toBeNull();
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);
        expect(fs.existsSync(path.join(workspace, 'backups', 'old-backup.zip'))).toBe(false);
        await expect(unlockUserSpace(root, 'default-user', password)).rejects.toThrow();
        await unlockUserSpace(root, 'default-user', newPassword);
        expect(fs.readFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'utf8')).toBe('synthetic secret chat');
        await sealActiveUserSpace(root);
        // The initial snapshot remains a usable encrypted rollback point.
        fs.renameSync(vault, path.join(root, '_leslie-vaults', 'default-user.newer'));
        fs.cpSync(path.join(root, '_leslie-vaults', 'default-user.initial'), vault, { recursive: true });
        await unlockUserSpace(root, 'default-user', password);
        expect(fs.readFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'utf8')).toBe('synthetic secret chat');
        await sealActiveUserSpace(root);
    } finally {
        if (getUnlockedUserSpace()) await sealActiveUserSpace(root);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('a symlink in the user data aborts migration without removing plaintext', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-link-test-'));
    try {
        fs.mkdirSync(path.join(root, 'default-user'));
        fs.writeFileSync(path.join(root, 'outside.txt'), 'synthetic');
        try {
            fs.symlinkSync(path.join(root, 'outside.txt'), path.join(root, 'default-user', 'linked.txt'));
        } catch (error) {
            if (error.code === 'EPERM') return; // Windows without Developer Mode cannot create symlinks.
            throw error;
        }
        await expect(sealUserSpace(root, 'default-user', 'first-secret-password')).rejects.toThrow();
        expect(fs.existsSync(path.join(root, 'default-user', 'linked.txt'))).toBe(true);
        expect(hasUserVault(root, 'default-user')).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('tampered ciphertext does not open a user directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-tamper-test-'));
    try {
        fs.mkdirSync(path.join(root, 'default-user'));
        fs.writeFileSync(path.join(root, 'default-user', 'synthetic.txt'), 'synthetic data');
        await sealUserSpace(root, 'default-user', 'first-secret-password');
        const headerFile = path.join(root, '_leslie-vaults', 'default-user', 'vault.json');
        const original = fs.readFileSync(headerFile, 'utf8');
        fs.writeFileSync(headerFile, JSON.stringify({ ...JSON.parse(original), workingMarkerVersion: 99 }));
        await expect(unlockUserSpace(root, 'default-user', 'first-secret-password')).rejects.toThrow('Unsupported working-space marker');
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);
        fs.writeFileSync(headerFile, original);
        const file = path.join(root, '_leslie-vaults', 'default-user', 'files',
            fs.readdirSync(path.join(root, '_leslie-vaults', 'default-user', 'files'))[0]);
        fs.writeFileSync(file, 'tampered data');
        await expect(unlockUserSpace(root, 'default-user', 'first-secret-password')).rejects.toThrow();
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
