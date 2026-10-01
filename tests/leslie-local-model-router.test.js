import { expect, jest, test } from '@jest/globals';

/* global globalThis */

import { createLocalModelRouter, isLocalModelControlClient, router } from '../src/leslie-local-model/router.js';

function mockResponse() {
    const response = {
        code: 200,
        set: jest.fn(),
        json: jest.fn(value => value),
        sendStatus: jest.fn(code => { response.code = code; return response; }),
        status: jest.fn(code => { response.code = code; return response; }),
    };
    return response;
}

test('model control accepts loopback and rejects public socket addresses', () => {
    expect(isLocalModelControlClient('127.0.0.1', '127.0.0.1')).toBe(true);
    expect(isLocalModelControlClient('::1', '::1')).toBe(true);
    const interfaces = { wifi: [{ address: '192.168.31.4', cidr: '192.168.31.4/24', internal: false }] };
    expect(isLocalModelControlClient('192.168.31.20', '192.168.31.4', interfaces)).toBe(true);
    expect(isLocalModelControlClient('192.168.32.20', '192.168.31.4', interfaces)).toBe(false);
    expect(isLocalModelControlClient('8.8.8.8', '192.168.1.2')).toBe(false);

    const guard = router.stack.find(layer => !layer.route)?.handle;
    const next = jest.fn();
    const denied = mockResponse();
    guard({ socket: { remoteAddress: '8.8.8.8', localAddress: '192.168.1.2' }, user: { profile: { handle: 'default-user' } } }, denied, next);
    expect(denied.code).toBe(403);
    expect(next).not.toHaveBeenCalled();
});

test('mobile detection probes only the host catalog loopback ports', async () => {
    const handler = router.stack.find(layer => layer.route?.path === '/detect')?.route.stack[0].handle;
    expect(handler).toBeDefined();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
        ok: url === 'http://127.0.0.1:5001/v1/models',
        json: async () => ({ data: [{ id: 'Qwen3.5-text-9B-NSFW-RP-RolePlay.Q4_K_M.gguf' }] }),
    }));
    const response = mockResponse();
    try {
        await handler({ body: { endpoint: 'http://example.invalid/' } }, response);
        expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
            'http://127.0.0.1:5001/v1/models',
            'http://127.0.0.1:8080/v1/models',
        ]);
        expect(response.json).toHaveBeenCalledWith({
            detected: expect.objectContaining({ runtime: 'koboldcpp', endpoint: 'http://127.0.0.1:5001' }),
        });
    } finally {
        fetchSpy.mockRestore();
    }
});

test('remote startup accepts only a catalog model and serializes requests', async () => {
    const getStatus = () => ({
        localModels: { models: [{ id: 'synthetic.gguf', name: 'synthetic', sizeBytes: 24 }, { id: 'other.gguf', name: 'other', sizeBytes: 24 }] },
        services: { localModel: { state: 'stopped', configured: true, runtimeInstalled: true, modelId: null } },
    });
    let finishStart;
    const startModel = jest.fn(() => new Promise(resolve => { finishStart = resolve; }));
    const localRouter = createLocalModelRouter({ root: 'synthetic-root', platform: 'win32', getStatus, startModel });
    const handler = localRouter.stack.find(layer => layer.route?.path === '/start')?.route.stack[0].handle;

    const invalid = mockResponse();
    await handler({ body: { modelId: '../outside.gguf' } }, invalid);
    expect(invalid.code).toBe(400);
    expect(startModel).not.toHaveBeenCalled();

    const first = mockResponse();
    const starting = handler({ body: { modelId: 'synthetic.gguf' } }, first);
    await Promise.resolve();
    const conflicting = mockResponse();
    await handler({ body: { modelId: 'other.gguf' } }, conflicting);
    expect(conflicting.code).toBe(409);
    expect(startModel).toHaveBeenCalledTimes(1);
    expect(startModel).toHaveBeenCalledWith('synthetic-root', 'synthetic.gguf');
    finishStart();
    await starting;
    expect(first.json).toHaveBeenCalledWith({ status: expect.objectContaining({ remoteManaged: true }) });
});
