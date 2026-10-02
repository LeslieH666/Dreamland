import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { SETTINGS_FILE } from '../constants.js';
import { checkForNewContent, CONTENT_TYPES } from '../endpoints/content-manager.js';
import {
    LESLIE_DEMO_SESSION_KEY,
    getLeslieDemoStorageHandle,
} from '../leslie-demo-mode.js';
import { ensureUserDirectoriesExist, getUserDirectories } from '../users.js';
import { seedDemoContent } from './seed.js';

export const router = express.Router();

router.get('/status', (request, response) => {
    response.set('Cache-Control', 'no-store');
    return response.json({ enabled: request.user?.demoMode === true });
});

router.post('/switch', async (request, response) => {
    try {
        response.set('Cache-Control', 'no-store');
        if (!request.session || !request.user?.profile?.handle) {
            return response.sendStatus(403);
        }

        if (typeof request.body?.enabled !== 'boolean') {
            return response.status(400).json({ error: 'The enabled field must be a boolean.' });
        }

        const enabled = request.body.enabled;
        if (enabled) {
            const storageHandle = getLeslieDemoStorageHandle(request.user.profile.handle);
            const directories = getUserDirectories(storageHandle);
            ensureUserDirectoriesExist(directories);
            await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);

            const settingsPath = path.join(directories.root, SETTINGS_FILE);
            if (!fs.existsSync(settingsPath)) {
                throw new Error('Demo storage initialization did not produce a settings file.');
            }

            seedDemoContent(directories, request.user.profile.handle);

            request.session[LESLIE_DEMO_SESSION_KEY] = true;
        } else {
            delete request.session[LESLIE_DEMO_SESSION_KEY];
        }

        return response.json({ enabled });
    } catch (error) {
        console.error('[Leslie Demo Mode] Could not switch storage spaces:', error);
        return response.status(500).json({ error: 'Could not switch demo mode.' });
    }
});
