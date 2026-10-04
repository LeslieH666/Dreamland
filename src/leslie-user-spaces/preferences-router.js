import express from 'express';
import { readPreferences, patchPreferences, saveLoginAppearance } from './preferences.js';

export const router = express.Router();
router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
router.get('/', (request, response) => {
    try {
        return response.json({ ...readPreferences(request.user.directories.root), owner: request.user.storageHandle ?? request.user.profile.handle });
    } catch { return response.status(500).json({ error: 'Could not restore preferences.' }); }
});
router.post('/', (request, response) => {
    const owner = request.user.storageHandle ?? request.user.profile.handle;
    if (request.body?.owner !== owner) return response.status(409).json({ error: 'The user space changed.' });
    try {
        const values = patchPreferences(request.user.directories.root, request.body.changes);
        if (!request.user.demoMode) saveLoginAppearance(globalThis.DATA_ROOT, request.user.profile.handle, values);
        return response.json({ saved: true });
    } catch (error) {
        return response.status(error instanceof TypeError ? 400 : 500).json({ error: 'Could not save preferences.' });
    }
});
