import crypto from 'node:crypto';
import { promisify } from 'node:util';

import storage from 'node-persist';
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpAddress, retryAfter } from '../express-common.js';
import { color, Cache, getConfigValue } from '../util.js';
import { KEY_PREFIX, areLeslieUserSpacesEnabled, getUserAvatar, getUserDirectories, migrateSystemPrompts, toKey, getPasswordHash, getPasswordSalt, getAccountVersion, stampLeslieLoginSession } from '../users.js';
import { getUnlockedUserSpace, sealActiveUserSpace, unlockUserSpace } from '../leslie-user-spaces/vault.js';
import { flushUserStats, loadUserStats } from './stats.js';
import { migrateGroupChatsMetadataFormat } from './groups.js';
import { checkForNewContent } from './content-manager.js';
import { migrateFlatSecrets } from './secrets.js';
import { readLoginAppearance, readPreferences, saveLoginAppearance } from '../leslie-user-spaces/preferences.js';

const DISCREET_LOGIN = getConfigValue('enableDiscreetLogin', false, 'boolean');
const PREFER_REAL_IP_HEADER = getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');
const LOGIN_POINTS = getConfigValue('rateLimiting.accountsLoginMaxAttempts', 5, 'number');
const RECOVER_POINTS = getConfigValue('rateLimiting.accountsRecoverMaxAttempts', 5, 'number');
const MFA_CACHE = new Cache(5 * 60 * 1000);
const passwordHash = promisify(crypto.scrypt);
const loginProgress = new Map();
let openingSpace = false;

const generateRecoveryCode = () => Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');

export const router = express.Router();
router.get('/mode', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    return response.json({ encryptedSpaces: areLeslieUserSpacesEnabled(), appearance: readLoginAppearance(globalThis.DATA_ROOT) });
});
router.get('/login-progress', (request, response) => {
    response.set('Cache-Control', 'no-store');
    const progress = loginProgress.get(request.query.operation);
    if (!progress || progress.expires < Date.now()) return response.sendStatus(404);
    return response.json(progress.value);
});
const loginLimiter = new RateLimiterMemory({
    points: LOGIN_POINTS > 0 ? LOGIN_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 60,
});
const recoverLimiter = new RateLimiterMemory({
    points: RECOVER_POINTS > 0 ? RECOVER_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 300,
});

router.post('/list', async (_request, response) => {
    try {
        if (DISCREET_LOGIN) {
            return response.sendStatus(204);
        }

        /** @type {import('../users.js').User[]} */
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

        /** @type {Promise<import('../users.js').UserViewModel>[]} */
        const viewModelPromises = users
            .filter(x => x.enabled)
            .map(user => new Promise(async (resolve) => {
                getUserAvatar(user.handle, true).then(avatar =>
                    resolve({
                        handle: user.handle,
                        name: user.name,
                        created: user.created,
                        avatar: avatar,
                        password: !!user.password,
                        appearance: readLoginAppearance(globalThis.DATA_ROOT, user.handle),
                    }),
                );
            }));

        const viewModels = await Promise.all(viewModelPromises);
        viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(viewModels);
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/login', async (request, response) => {
    let openedSpace = false;
    let transition = false;
    let progressStarted = false;
    const operation = typeof request.body?.operation === 'string' && /^[a-f0-9-]{36}$/i.test(request.body.operation) ? request.body.operation : null;
    const report = value => {
        if (operation && progressStarted) loginProgress.set(operation, { value, expires: Date.now() + 5 * 60_000 });
    };
    try {
        if (!request.body.handle) {
            console.warn('Login failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await loginLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.error('Login failed: User', request.body.handle, 'not found');
            return response.status(403).json({ error: 'Incorrect credentials' });
        }

        if (!user.enabled) {
            console.warn('Login failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        if (areLeslieUserSpacesEnabled() && !user.password) {
            return response.status(403).json({ error: 'This user needs a password before login.' });
        }

        if (user.password && (typeof request.body.password !== 'string' || user.password !== (await passwordHash(request.body.password.normalize(), user.salt, 64)).toString('base64'))) {
            console.warn('Login failed: Incorrect password for', user.handle);
            return response.status(403).json({ error: 'Incorrect credentials' });
        }

        if (!request.session) {
            console.error('Session not available');
            return response.sendStatus(500);
        }

        const sessionVersion = getAccountVersion(user);
        if (areLeslieUserSpacesEnabled()) {
            if (openingSpace) return response.status(409).json({ error: '另一个空间正在打开，请稍后重试。' });
            openingSpace = transition = true;
            progressStarted = true;
            for (const [id, progress] of loginProgress) if (progress.expires < Date.now()) loginProgress.delete(id);
            if (loginProgress.size >= 64) loginProgress.delete(loginProgress.keys().next().value);
            report({ phase: 'sealing', completed: 0, total: 0 });
            await flushUserStats();
            const alreadyOpen = getUnlockedUserSpace() === user.handle;
            await unlockUserSpace(globalThis.DATA_ROOT, user.handle, request.body.password, report);
            openedSpace = !alreadyOpen;
            report({ phase: 'loading', completed: 0, total: 0 });
            const directories = getUserDirectories(user.handle);
            try {
                await migrateSystemPrompts();
                await migrateGroupChatsMetadataFormat([directories]);
                await checkForNewContent([directories]);
                migrateFlatSecrets([directories]);
                await loadUserStats(user.handle);
            } catch (maintenanceError) {
                console.warn('User space opened; optional startup maintenance failed:', maintenanceError);
            }
        }

        await loginLimiter.delete(ip);
        try {
            saveLoginAppearance(globalThis.DATA_ROOT, user.handle, readPreferences(getUserDirectories(user.handle).root).values);
        } catch { /* Optional appearance recovery must not prevent login. */ }
        request.session.handle = user.handle;
        request.session.version = sessionVersion;
        stampLeslieLoginSession(request.session);
        console.info('Login successful:', user.handle, 'from', ip, 'at', new Date().toLocaleString());
        report({ phase: 'ready', completed: 1, total: 1 });
        return response.json({ handle: user.handle });
    } catch (error) {
        report({ phase: 'failed', completed: 0, total: 0 });
        if (error instanceof RateLimiterRes) {
            console.error('Login failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or recover your password.' });
        }

        if (openedSpace) {
            try {
                await flushUserStats();
                await sealActiveUserSpace(globalThis.DATA_ROOT);
            } catch (sealError) {
                console.error('Could not reseal the user space after login failed:', sealError);
            }
        }
        console.error('Login failed:', error);
        return response.status(500).json({ error: 'Could not open the user space. Please check the server log and retry.' });
    } finally {
        if (transition) openingSpace = false;
    }
});

router.post('/recover-step1', async (request, response) => {
    if (areLeslieUserSpacesEnabled()) {
        return response.status(403).json({ error: 'Encrypted spaces require the existing password. Use the encrypted backup to recover data.' });
    }
    try {
        if (!request.body.handle) {
            console.warn('Recover step 1 failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await recoverLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.error('Recover step 1 failed: User', request.body.handle, 'not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.error('Recover step 1 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        const mfaCode = generateRecoveryCode();
        console.log();
        console.log(color.blue(`${user.name}, your password recovery code is: `) + color.magenta(mfaCode));
        console.log();
        MFA_CACHE.set(user.handle, mfaCode);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 1 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 1 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step2', async (request, response) => {
    if (areLeslieUserSpacesEnabled()) {
        return response.status(403).json({ error: 'Encrypted spaces cannot reset a password without the existing password.' });
    }
    try {
        if (!request.body.handle || !request.body.code) {
            console.warn('Recover step 2 failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));
        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        const rateLimit = await recoverLimiter.get(ip);

        if (rateLimit !== null && rateLimit.consumedPoints > recoverLimiter.points) {
            throw rateLimit;
        }

        if (!user) {
            console.error('Recover step 2 failed: User', request.body.handle, 'not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.warn('Recover step 2 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        const mfaCode = MFA_CACHE.get(user.handle);

        if (request.body.code !== mfaCode) {
            await recoverLimiter.consume(ip);
            console.warn('Recover step 2 failed: Incorrect code');
            return response.status(403).json({ error: 'Incorrect code' });
        }

        if (request.body.newPassword) {
            const salt = getPasswordSalt();
            user.password = getPasswordHash(request.body.newPassword, salt);
            user.salt = salt;
            await storage.setItem(toKey(user.handle), user);
        } else {
            user.password = '';
            user.salt = '';
            await storage.setItem(toKey(user.handle), user);
        }

        if (request.session && request.session.handle === user.handle) {
            request.session.version = getAccountVersion(user);
        }

        await recoverLimiter.delete(ip);
        MFA_CACHE.remove(user.handle);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 2 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});
