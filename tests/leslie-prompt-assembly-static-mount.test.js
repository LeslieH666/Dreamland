import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { PROMPT_ASSEMBLY_MOUNT, mountPromptAssembly } from '../src/prompt-assembly/mount-static.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let baseUrl;

beforeAll(async () => {
    const app = express();
    mountPromptAssembly(app, serverDirectory);
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    if (server) {
        await new Promise(resolve => server.close(resolve));
    }
});

describe('prompt-assembly static mount', () => {
    test('serves the shared modules the browser imports', async () => {
        for (const file of ['extension-prompts.js', 'macros.js', 'enums.js', 'token-counting.js']) {
            const response = await fetch(`${baseUrl}${PROMPT_ASSEMBLY_MOUNT}/${file}`);
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('javascript');
            const body = await response.text();
            expect(body.length).toBeGreaterThan(0);
        }
    });

    test('the module the browser loads first is the one it expects', async () => {
        const response = await fetch(`${baseUrl}${PROMPT_ASSEMBLY_MOUNT}/extension-prompts.js`);
        const body = await response.text();
        expect(body).toContain('export async function getExtensionPrompt');
    });

    test('does not index the directory and does not fall through', async () => {
        expect((await fetch(`${baseUrl}${PROMPT_ASSEMBLY_MOUNT}/`)).status).toBe(404);
        expect((await fetch(`${baseUrl}${PROMPT_ASSEMBLY_MOUNT}/missing.js`)).status).toBe(404);
    });

    test('does not serve anything outside src/prompt-assembly', async () => {
        for (const attempt of [
            `${PROMPT_ASSEMBLY_MOUNT}/../server-main.js`,
            `${PROMPT_ASSEMBLY_MOUNT}/%2e%2e/server-main.js`,
            `${PROMPT_ASSEMBLY_MOUNT}/..%2f..%2fpackage.json`,
            `${PROMPT_ASSEMBLY_MOUNT}/../endpoints/secrets.js`,
        ]) {
            const response = await fetch(`${baseUrl}${attempt}`);
            expect(response.status).not.toBe(200);
        }
    });
});
