import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import ipaddr from 'ipaddr.js';
import storage from 'node-persist';

import { DEFAULT_USER } from '../constants.js';
import { hasUserVault, sealUserSpace } from './vault.js';
import { flushUserStats } from '../endpoints/stats.js';
import {
    activateLeslieUserSpaces,
    areLeslieUserSpacesEnabled,
    areUserAccountsEnabled,
    getPasswordHash,
    getPasswordSalt,
    getUserDirectories,
    toAvatarKey,
    toKey,
} from '../users.js';

function isLoopbackSocket(request) {
    try {
        return ipaddr.process(request.socket.remoteAddress).range() === 'loopback'
            && ipaddr.process(request.socket.localAddress).range() === 'loopback';
    } catch {
        return false;
    }
}

export const router = express.Router();

router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
});

router.post('/status', async (request, response) => {
    try {
        const current = request.user.profile;
        const records = current.admin ? await storage.values(item => item.key.startsWith('user:')) : [current];
        const users = records.filter(user => user.enabled).map(user => ({
            handle: user.handle,
            name: user.name,
            admin: Boolean(user.admin),
            password: Boolean(user.password),
        }));
        return response.json({
            enabled: areLeslieUserSpacesEnabled(),
            accountsEnabled: areUserAccountsEnabled(),
            current: current.handle,
            admin: Boolean(current.admin),
            localSetup: isLoopbackSocket(request),
            users,
        });
    } catch {
        return response.status(500).json({ error: 'Could not read user spaces.' });
    }
});

router.post('/activate', async (request, response) => {
    if (areLeslieUserSpacesEnabled()) {
        return response.status(409).json({ error: 'User spaces are already enabled.' });
    }
    if (!isLoopbackSocket(request) || request.user.profile.handle !== DEFAULT_USER.handle
        || !request.user.profile.admin || request.user.demoMode || !request.session) {
        return response.sendStatus(403);
    }
    try {
        const password = request.body?.password;
        if (typeof password !== 'string' || !password) {
            return response.status(400).json({ error: 'A password is required.' });
        }
        const users = await storage.values(item => item.key.startsWith('user:'));
        const primary = users.find(user => user.handle === DEFAULT_USER.handle);
        if (!primary?.enabled || !primary.admin || users.some(user => user.handle !== primary.handle)) {
            return response.status(409).json({ error: 'Purge existing secondary accounts before activating encrypted spaces.' });
        }
        const unassignedRoots = fs.readdirSync(globalThis.DATA_ROOT, { withFileTypes: true })
            .some(item => item.isDirectory() && !item.name.startsWith('_')
                && item.name !== primary.handle && item.name !== `${primary.handle}_demo`);
        const legacyDemoRoot = path.join(globalThis.DATA_ROOT, '_demo');
        const unassignedLegacyDemos = fs.existsSync(legacyDemoRoot)
            && fs.readdirSync(legacyDemoRoot, { withFileTypes: true })
                .some(item => item.isDirectory() && item.name !== primary.handle);
        const orphanAvatarKeys = await storage.keys(item => item.key.startsWith('avatar:')
            && item.key !== toAvatarKey(primary.handle));
        if (unassignedRoots || unassignedLegacyDemos || orphanAvatarKeys.length) {
            return response.status(409).json({ error: 'Unassigned user data remains. Purge old accounts and their data before activation.' });
        }
        if (primary.password) {
            if (primary.password !== getPasswordHash(password, primary.salt)) {
                return response.status(403).json({ error: 'Incorrect current password.' });
            }
        }
        const oldPassword = primary.password;
        const oldSalt = primary.salt;
        const avatarKey = toAvatarKey(primary.handle);
        const legacyAvatar = await storage.getItem(avatarKey);
        if (legacyAvatar) fs.writeFileSync(path.join(getUserDirectories(primary.handle).root, '.leslie-profile-avatar'), legacyAvatar);
        await flushUserStats();
        try {
            if (!oldPassword) {
                primary.salt = getPasswordSalt();
                primary.password = getPasswordHash(password, primary.salt);
                await storage.setItem(toKey(primary.handle), primary);
            }
            if (legacyAvatar) await storage.removeItem(avatarKey);
            await activateLeslieUserSpaces();
            sealUserSpace(globalThis.DATA_ROOT, primary.handle, password);
        } catch (error) {
            if (!areLeslieUserSpacesEnabled()) {
                if (legacyAvatar) await storage.setItem(avatarKey, legacyAvatar);
                if (!oldPassword) {
                    primary.password = oldPassword;
                    primary.salt = oldSalt;
                    await storage.setItem(toKey(primary.handle), primary);
                }
            }
            throw error;
        }
        request.session.handle = null;
        request.session.version = null;
        request.session.leslieServerSession = null;
        request.session.csrfToken = null;
        return response.json({ enabled: true });
    } catch (error) {
        console.error('User space activation failed:', error);
        return response.status(500).json({ error: areLeslieUserSpacesEnabled()
            ? 'Account login is active, but sealing was interrupted. Sign in with the new password to finish recovery.'
            : hasUserVault(globalThis.DATA_ROOT, DEFAULT_USER.handle)
                ? 'Encryption failed; check the encrypted backup and account directory before retrying.'
                : 'Could not activate user spaces.' });
    }
});
