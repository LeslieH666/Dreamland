import express from 'express';
import ipaddr from 'ipaddr.js';

import { isDirectPrivateNetworkRequest } from '../network-access.js';
import { serverDirectory } from '../server-directory.js';
import { detectLeslieLocalModel, probeLeslieLocalRuntime } from '../../public/scripts/leslie-local-model-core.js';

const desktopLocalServices = process.env.DREAMLAND_ANDROID === '1'
    ? null
    : await import('../electron/local-services.js');
const getLocalServiceStatus = desktopLocalServices?.getLocalServiceStatus ?? (() => ({
    localModels: { models: [] },
    services: { localModel: { state: 'stopped', configured: false, runtimeInstalled: false, modelId: null } },
}));
const startManagedLocalModel = desktopLocalServices?.startManagedLocalModel
    ?? (async () => { throw new Error('Local model management is disabled on Android.'); });

/** Allow process control only from loopback or the directly connected private subnet. */
export function isLocalModelControlClient(remoteAddress, localAddress, interfaces) {
    try {
        const remote = ipaddr.process(String(remoteAddress || '').replace(/%[^%]+$/, ''));
        const local = ipaddr.process(String(localAddress || '').replace(/%[^%]+$/, ''));
        if (remote.range() === 'loopback' && local.range() === 'loopback') {
            return true;
        }
    } catch {
        return false;
    }
    return isDirectPrivateNetworkRequest(remoteAddress, localAddress, interfaces);
}

/**
 * A narrow remote control surface for a phone on the same LAN.
 * It exposes no file path, PID, arbitrary URL, stop action, or AIRI control.
 */
export function createLocalModelRouter({
    root = serverDirectory,
    platform = process.platform,
    getStatus = getLocalServiceStatus,
    startModel = startManagedLocalModel,
    detectModel = detectLeslieLocalModel,
    probeRuntime = probeLeslieLocalRuntime,
    isAllowedClient = isLocalModelControlClient,
} = {}) {
    const router = express.Router();
    let startTask = null;
    let startingModelId = '';

    const readStatus = () => {
        const status = getStatus(root, { busyServices: new Set(startTask ? ['localModel'] : []) });
        const model = status.services.localModel;
        return {
            available: platform === 'win32',
            remoteManaged: true,
            localModels: { directory: 'models/', models: status.localModels.models },
            services: {
                localModel: {
                    state: model.state,
                    configured: model.configured,
                    runtimeInstalled: model.runtimeInstalled,
                    modelId: model.modelId,
                },
            },
        };
    };

    router.use((request, response, next) => {
        response.set('Cache-Control', 'no-store');
        if (!request.user?.profile?.handle
            || !isAllowedClient(request.socket?.remoteAddress, request.socket?.localAddress)) {
            return response.sendStatus(403);
        }
        return next();
    });

    router.post('/status', (_request, response) => {
        try {
            return response.json(readStatus());
        } catch {
            return response.status(500).json({ error: 'Could not inspect local models.' });
        }
    });

    // Both probes use catalog-fixed loopback ports on the computer, never a
    // caller-supplied URL or the phone's own 127.0.0.1.
    router.post('/detect', async (_request, response) => {
        try {
            return response.json({ detected: await detectModel() });
        } catch {
            return response.status(500).json({ error: 'Could not detect a local model.' });
        }
    });

    router.post('/probe', async (_request, response) => {
        try {
            return response.json({ probe: await probeRuntime('koboldcpp', { timeoutMs: 1500 }) });
        } catch {
            return response.status(500).json({ error: 'Could not probe the local model.' });
        }
    });

    router.post('/start', async (request, response) => {
        try {
            const status = readStatus();
            if (!status.available || !status.services.localModel.runtimeInstalled) {
                return response.status(503).json({ error: 'Managed KoboldCpp is unavailable on this computer.' });
            }
            const modelId = request.body?.modelId;
            if (typeof modelId !== 'string' || !status.localModels.models.some(model => model.id === modelId)) {
                return response.status(400).json({ error: 'Select a model from the project catalog.' });
            }
            if (startTask && startingModelId !== modelId) {
                return response.status(409).json({ error: 'Another local model is starting.' });
            }
            if (!startTask) {
                startingModelId = modelId;
                startTask = Promise.resolve().then(() => startModel(root, modelId)).finally(() => {
                    startTask = null;
                    startingModelId = '';
                });
            }
            await startTask;
            return response.json({ status: readStatus() });
        } catch (error) {
            console.error('[Leslie local model] Managed model startup failed:', error);
            return response.status(500).json({ error: 'Could not start the selected model. Check the KoboldCpp logs on the computer.' });
        }
    });

    return router;
}

export const router = createLocalModelRouter();
