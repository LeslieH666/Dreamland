/* eslint-disable playwright/no-conditional-in-test */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@jest/globals';

import { getUnlockedUserSpace, hasUserVault, rewrapUserSpace, sealActiveUserSpace, sealUserSpace, unlockUserSpace } from '../src/leslie-user-spaces/vault.js';

test('synthetic user and demo data are encrypted, restored, and rewrapped', () => {
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

        const sealed = sealUserSpace(root, 'default-user', password);
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
        expect(() => unlockUserSpace(root, 'default-user', 'incorrect-password')).toThrow();
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);

        unlockUserSpace(root, 'default-user', password);
        expect(getUnlockedUserSpace()).toBe('default-user');
        expect(fs.readFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'utf8')).toBe('synthetic secret chat');
        expect(fs.readFileSync(path.join(root, 'default-user_demo', 'characters', 'test.json'), 'utf8')).toBe('{"name":"synthetic"}');
        expect(fs.readFileSync(path.join(root, '_demo', 'default-user', 'old.jsonl'), 'utf8')).toBe('synthetic legacy demo');
        expect(fs.readFileSync(path.join(workspace, 'backups', 'old-backup.zip'), 'utf8')).toBe('synthetic archive');
        rewrapUserSpace(root, 'default-user', password, newPassword);
        sealActiveUserSpace(root);
        expect(getUnlockedUserSpace()).toBeNull();
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);
        expect(fs.existsSync(path.join(workspace, 'backups', 'old-backup.zip'))).toBe(false);
        expect(() => unlockUserSpace(root, 'default-user', password)).toThrow();
        unlockUserSpace(root, 'default-user', newPassword);
        expect(fs.readFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'utf8')).toBe('synthetic secret chat');
        sealActiveUserSpace(root);
        // The initial snapshot remains a usable encrypted rollback point.
        fs.renameSync(vault, path.join(root, '_leslie-vaults', 'default-user.newer'));
        fs.cpSync(path.join(root, '_leslie-vaults', 'default-user.initial'), vault, { recursive: true });
        unlockUserSpace(root, 'default-user', password);
        expect(fs.readFileSync(path.join(root, 'default-user', 'chats', 'private-chat.jsonl'), 'utf8')).toBe('synthetic secret chat');
        sealActiveUserSpace(root);
    } finally {
        if (getUnlockedUserSpace()) sealActiveUserSpace(root);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('a symlink in the user data aborts migration without removing plaintext', () => {
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
        expect(() => sealUserSpace(root, 'default-user', 'first-secret-password')).toThrow();
        expect(fs.existsSync(path.join(root, 'default-user', 'linked.txt'))).toBe(true);
        expect(hasUserVault(root, 'default-user')).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('tampered ciphertext does not open a user directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-vault-tamper-test-'));
    try {
        fs.mkdirSync(path.join(root, 'default-user'));
        fs.writeFileSync(path.join(root, 'default-user', 'synthetic.txt'), 'synthetic data');
        sealUserSpace(root, 'default-user', 'first-secret-password');
        const file = path.join(root, '_leslie-vaults', 'default-user', 'files',
            fs.readdirSync(path.join(root, '_leslie-vaults', 'default-user', 'files'))[0]);
        fs.writeFileSync(file, 'tampered data');
        expect(() => unlockUserSpace(root, 'default-user', 'first-secret-password')).toThrow();
        expect(fs.existsSync(path.join(root, 'default-user'))).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
