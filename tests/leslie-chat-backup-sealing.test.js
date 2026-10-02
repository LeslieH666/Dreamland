/* eslint-disable playwright/no-standalone-expect */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, jest, test } from '@jest/globals';
import { setConfigFilePath } from '../src/util.js';
import { getLeslieDemoStorageHandle } from '../src/leslie-demo-mode.js';
import { sealActiveUserSpace, sealUserSpace, unlockUserSpace } from '../src/leslie-user-spaces/vault.js';

test('sealing flushes the latest ordinary and demo chat backups without later recreating closed directories', async () => {
    setConfigFilePath(fileURLToPath(new URL('../default/config.yaml', import.meta.url)));
    const { trySaveChat } = await import('../src/endpoints/chats.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-backup-sealing-'));
    const main = path.join(root, 'synthetic-backup-user');
    const demo = path.join(root, '_demo', 'synthetic-backup-user');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
        for (const [directory, handle] of [[main, 'synthetic-backup-user'], [demo, getLeslieDemoStorageHandle('synthetic-backup-user')]]) {
            const backups = path.join(directory, 'backups');
            fs.mkdirSync(backups, { recursive: true });
            const chat = path.join(directory, 'chats', 'synthetic.jsonl');
            await trySaveChat([{ mes: 'synthetic first revision' }], chat, true, handle, 'synthetic', backups);
            await trySaveChat([{ mes: 'synthetic latest revision' }], chat, true, handle, 'synthetic', backups);
        }
        await sealUserSpace(root, 'synthetic-backup-user', 'synthetic-password');
        jest.advanceTimersByTime(30000);
        expect(fs.existsSync(main)).toBe(false);
        expect(fs.existsSync(demo)).toBe(false);
        await unlockUserSpace(root, 'synthetic-backup-user', 'synthetic-password');
        for (const directory of [main, demo]) {
            const backups = path.join(directory, 'backups');
            const revisions = fs.readdirSync(backups).map(name => fs.readFileSync(path.join(backups, name), 'utf8'));
            expect(revisions).toContain('{"mes":"synthetic latest revision"}');
        }
    } finally {
        jest.useRealTimers();
        await sealActiveUserSpace(root);
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 20000);
