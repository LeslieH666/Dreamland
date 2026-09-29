import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { isTrackedProcessRunning, runLocalServiceAction, waitForLeslieBridge } from '../src/electron/local-services.js';

const BRIDGE_TOKEN = 'a'.repeat(64);

let temporaryRoot;

afterEach(() => {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
});

describe('Leslie desktop local service process tracking', () => {
    test('accepts a live tracked process without terminating it', () => {
        const calls = [];
        const running = isTrackedProcessRunning(4321, (pid, signal) => calls.push([pid, signal]));

        expect(running).toBe(true);
        expect(calls).toEqual([[4321, 0]]);
    });

    test('treats missing or invalid process ids as stopped', () => {
        const missing = Object.assign(new Error('missing'), { code: 'ESRCH' });
        expect(isTrackedProcessRunning(4321, () => { throw missing; })).toBe(false);
        expect(isTrackedProcessRunning('not-a-pid', () => {})).toBe(false);
    });

    test('treats access-denied process probes as running', () => {
        const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
        expect(isTrackedProcessRunning(4321, () => { throw denied; })).toBe(true);
    });

    test('checks the loopback Bridge with the process token before AIRI starts', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok', protocol: { version: '1' } }),
        }));
        const healthUrl = await waitForLeslieBridge({
            environment: {
                LESLIE_BRIDGE_TOKEN: BRIDGE_TOKEN,
                LESLIE_BRIDGE_BASE_URL: 'http://127.0.0.1:8127/api/leslie/bridge/v1/',
            },
            fetchImpl,
            attempts: 1,
        });

        expect(healthUrl.toString()).toBe('http://127.0.0.1:8127/api/leslie/bridge/v1/health');
        expect(fetchImpl).toHaveBeenCalledWith(healthUrl, expect.objectContaining({
            headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
        }));
    });

    test('starts AIRI only after Electron verifies the Bridge', async () => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-airi-service-'));
        const scriptsRoot = path.join(temporaryRoot, 'packaging', 'windows-local');
        fs.mkdirSync(scriptsRoot, { recursive: true });
        fs.writeFileSync(path.join(scriptsRoot, 'Leslie-AIRI-Launcher.ps1'), 'synthetic');
        const waitForBridge = jest.fn(async () => undefined);
        const spawned = [];
        const spawnProcess = (_command, args) => {
            spawned.push(args);
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            queueMicrotask(() => child.emit('exit', 0));
            return child;
        };

        await expect(runLocalServiceAction(temporaryRoot, 'airi', 'start', { spawnProcess, waitForBridge }))
            .resolves.toMatchObject({ ok: true });

        expect(waitForBridge).toHaveBeenCalledTimes(1);
        expect(spawned[0]).toEqual(expect.arrayContaining(['-Mode', 'Airi', '-BridgeReady']));
    });

    test('does not launch AIRI when Bridge authentication is rejected', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: false,
            status: 401,
            json: async () => ({ error: { code: 'BRIDGE_UNAUTHORIZED' } }),
        }));
        await expect(waitForLeslieBridge({
            environment: {
                LESLIE_BRIDGE_TOKEN: BRIDGE_TOKEN,
                LESLIE_BRIDGE_BASE_URL: 'http://127.0.0.1:8127/api/leslie/bridge/v1/',
            },
            fetchImpl,
            attempts: 1,
        })).rejects.toThrow('HTTP 401 (BRIDGE_UNAUTHORIZED)');
    });
});
