/* eslint-disable playwright/no-conditional-in-test, playwright/no-standalone-expect */
/* global globalThis */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import storage from 'node-persist';
import { expect, jest, test } from '@jest/globals';

import { hasUserVault } from '../src/leslie-user-spaces/vault.js';
import { setConfigFilePath } from '../src/util.js';

function responseStub() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
    };
}

test('local activation migrates a synthetic default account and invalidates its session', async () => {
    const quietInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'leslie-space-route-'));
    const root = path.join(workspace, 'data');
    const previousRoot = globalThis.DATA_ROOT;
    try {
        fs.mkdirSync(root);
        globalThis.DATA_ROOT = root;
        setConfigFilePath(fileURLToPath(new URL('../default/config.yaml', import.meta.url)));
        const { router } = await import('../src/leslie-user-spaces/router.js');
        const { areLeslieUserSpacesEnabled, ensureUserDirectoriesExist, getAccountVersion, getUserAvatar, getUserDirectories, initUserStorage, requireLoginMiddleware, setUserDataMiddleware, toAvatarKey, toKey } = await import('../src/users.js');
        await initUserStorage(root);
        const user = await storage.getItem(toKey('default-user'));
        const createHash = crypto.createHash;
        const unsupportedShake = jest.spyOn(crypto, 'createHash').mockImplementation((algorithm, options) => {
            if (algorithm === 'shake256') throw new Error('Digest method not supported');
            return createHash(algorithm, options);
        });
        try {
            expect(getAccountVersion(user)).toMatch(/^[a-f0-9]{16}$/);
        } finally {
            unsupportedShake.mockRestore();
        }
        const directories = getUserDirectories(user.handle);
        ensureUserDirectoriesExist(directories);
        fs.writeFileSync(path.join(directories.chats, 'synthetic.jsonl'), 'synthetic chat');
        await storage.setItem(toAvatarKey(user.handle), 'data:image/png;base64,c3ludGhldGlj');
        const session = { handle: user.handle, version: 'old', csrfToken: 'synthetic' };
        const request = { socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
            user: { profile: user, demoMode: false }, session, body: { password: 'a' } };
        const response = responseStub();
        const handler = router.stack.find(layer => layer.route?.path === '/activate').route.stack[0].handle;
        const remoteResponse = responseStub();
        await handler({ ...request, socket: { remoteAddress: '192.0.2.10', localAddress: '127.0.0.1' } }, remoteResponse);
        expect(remoteResponse.statusCode).toBe(403);
        expect(fs.existsSync(directories.root)).toBe(true);
        const emptyActivation = responseStub();
        await handler({ ...request, body: { password: '' } }, emptyActivation);
        expect(emptyActivation.statusCode).toBe(400);
        fs.mkdirSync(path.join(root, 'old-user'));
        const orphanResponse = responseStub();
        await handler(request, orphanResponse);
        expect(orphanResponse.statusCode).toBe(409);
        expect(hasUserVault(root, user.handle)).toBe(false);
        fs.rmdirSync(path.join(root, 'old-user'));
        await handler(request, response);
        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({ enabled: true });
        expect(areLeslieUserSpacesEnabled()).toBe(true);
        expect(session.handle).toBeNull();
        expect(fs.existsSync(directories.root)).toBe(false);
        expect(hasUserVault(root, user.handle)).toBe(true);
        expect(await storage.getItem(toAvatarKey(user.handle))).toBeUndefined();
        const { router: publicRouter } = await import('../src/endpoints/users-public.js');
        const login = publicRouter.stack.find(layer => layer.route?.path === '/login').route.stack[0].handle;
        const loginSession = {};
        const loginResponse = responseStub();
        await login({ body: { handle: user.handle, password: 'a' },
            session: loginSession, socket: { remoteAddress: '127.0.0.1' }, headers: {} }, loginResponse);
        expect(loginResponse.statusCode).toBe(200);
        expect(loginSession.handle).toBe(user.handle);
        expect(await getUserAvatar(user.handle)).toBe('data:image/png;base64,c3ludGhldGlj');
        const list = publicRouter.stack.find(layer => layer.route?.path === '/list').route.stack[0].handle;
        const listResponse = responseStub();
        await list({}, listResponse);
        expect(listResponse.body[0].avatar).not.toBe('data:image/png;base64,c3ludGhldGlj');
        expect(listResponse.body[0].avatar).toBe('/img/dreamland/icon-192.png');
        expect(fs.existsSync(fileURLToPath(new URL('../public' + listResponse.body[0].avatar, import.meta.url)))).toBe(true);
        expect(fs.readFileSync(path.join(directories.chats, 'synthetic.jsonl'), 'utf8')).toBe('synthetic chat');
        const { router: privateRouter } = await import('../src/endpoints/users-private.js');
        const logout = privateRouter.stack.find(layer => layer.route?.path === '/logout').route.stack[0].handle;

        const { router: adminRouter } = await import('../src/endpoints/users-admin.js');
        const create = adminRouter.stack.find(layer => layer.route?.path === '/create').route.stack.at(-1).handle;
        const emptyCreate = responseStub();
        await create({ body: { handle: 'empty', name: 'Empty', password: '' } }, emptyCreate);
        expect(emptyCreate.statusCode).toBe(400);
        const invalidHandle = responseStub();
        await create({ body: { handle: 'x'.repeat(65), name: 'Invalid', password: 'b' } }, invalidHandle);
        expect(invalidHandle.statusCode).toBe(400);
        const createResponse = responseStub();
        await create({ body: { handle: 'guest', name: 'Synthetic guest', password: 'b' } }, createResponse);
        expect(createResponse.statusCode).toBe(200);
        expect(createResponse.body.handle).toBe('guest');
        expect(hasUserVault(root, 'guest')).toBe(true);
        expect(fs.existsSync(getUserDirectories('guest').root)).toBe(false);

        const guestSession = {};
        const guestLoginResponse = responseStub();
        await login({ body: { handle: 'guest', password: 'b' },
            session: guestSession, socket: { remoteAddress: '127.0.0.1' }, headers: {} }, guestLoginResponse);
        expect(guestLoginResponse.statusCode).toBe(200);
        expect(guestSession.handle).toBe('guest');
        expect(fs.existsSync(directories.root)).toBe(false);
        const bridgeRequest = { session: {}, leslieBridge: { authenticated: true } };
        const bridgeNext = jest.fn();
        await setUserDataMiddleware(bridgeRequest, responseStub(), bridgeNext);
        expect(bridgeNext).toHaveBeenCalledTimes(1);
        expect(bridgeRequest.user).toMatchObject({
            profile: { handle: 'guest' },
            storageHandle: 'guest',
            demoMode: false,
        });
        const bridgeLoginNext = jest.fn();
        requireLoginMiddleware({ leslieBridge: { authenticated: true } }, responseStub(), bridgeLoginNext);
        expect(bridgeLoginNext).toHaveBeenCalledTimes(1);
        const unauthenticatedResponse = responseStub();
        requireLoginMiddleware({}, unauthenticatedResponse, jest.fn());
        expect(unauthenticatedResponse.statusCode).toBe(403);
        const next = jest.fn();
        await setUserDataMiddleware({ session: loginSession }, responseStub(), next);
        expect(loginSession.handle).toBeNull();
        expect(next).toHaveBeenCalledTimes(1);
        await logout({ session: guestSession }, responseStub());
        expect(fs.existsSync(getUserDirectories('guest').root)).toBe(false);

        const returnSession = {};
        const returnResponse = responseStub();
        await login({ body: { handle: user.handle, password: 'a' },
            session: returnSession, socket: { remoteAddress: '127.0.0.1' }, headers: {} }, returnResponse);
        expect(returnResponse.statusCode).toBe(200);
        expect(fs.readFileSync(path.join(directories.chats, 'synthetic.jsonl'), 'utf8')).toBe('synthetic chat');
        const changePassword = privateRouter.stack.find(layer => layer.route?.path === '/change-password').route.stack[0].handle;
        const emptyChange = responseStub();
        await changePassword({ body: { handle: user.handle, oldPassword: 'a', newPassword: '' },
            user: { profile: await storage.getItem(toKey(user.handle)) }, session: returnSession }, emptyChange);
        expect(emptyChange.statusCode).toBe(400);
        const changeResponse = responseStub();
        await changePassword({ body: { handle: user.handle, oldPassword: 'a', newPassword: 'c' },
            user: { profile: await storage.getItem(toKey(user.handle)) }, session: returnSession }, changeResponse);
        expect(changeResponse.statusCode).toBe(204);
        const logoutResponse = responseStub();
        await logout({ session: returnSession }, logoutResponse);
        expect(logoutResponse.statusCode).toBe(204);
        const oldResponse = responseStub();
        await login({ body: { handle: user.handle, password: 'a' },
            session: {}, socket: { remoteAddress: '127.0.0.1' }, headers: {} }, oldResponse);
        expect(oldResponse.statusCode).toBe(403);
        const updatedSession = {};
        const updatedResponse = responseStub();
        await login({ body: { handle: user.handle, password: 'c' },
            session: updatedSession, socket: { remoteAddress: '127.0.0.1' }, headers: {} }, updatedResponse);
        expect(updatedResponse.statusCode).toBe(200);
        await logout({ session: updatedSession }, responseStub());
    } finally {
        quietInfo.mockRestore();
        if (globalThis.DATA_ROOT === root) globalThis.DATA_ROOT = previousRoot;
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}, 60_000);
