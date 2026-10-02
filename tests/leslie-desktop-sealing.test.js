import { beforeEach, expect, jest, test } from '@jest/globals';
import { createSealedExitHandler } from '../src/electron/sealed-exit.js';

let handlers;
let app;
let flush;
let seal;
let failed;

beforeEach(() => {
    handlers = new Map();
    app = { quit: jest.fn() };
    flush = jest.fn().mockResolvedValue();
    seal = jest.fn().mockResolvedValue();
    failed = jest.fn();
    handlers.set('before-quit', createSealedExitHandler(async () => { await flush(); await seal(); }, () => app.quit(), error => failed(error)));
});

test('waits for stats and encryption before quitting, coalescing repeated exit requests', async () => {
    let finishFlush;
    let finishSeal;
    let startedFlush;
    let startedSeal;
    const flushing = new Promise(resolve => { startedFlush = resolve; });
    const sealing = new Promise(resolve => { startedSeal = resolve; });
    flush.mockImplementation(() => { startedFlush(); return new Promise(resolve => { finishFlush = resolve; }); });
    seal.mockImplementation(() => { startedSeal(); return new Promise(resolve => { finishSeal = resolve; }); });
    const event = { preventDefault: jest.fn() };
    handlers.get('before-quit')(event);
    handlers.get('before-quit')(event);
    await flushing;
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(seal).not.toHaveBeenCalled();
    finishFlush();
    await sealing;
    expect(app.quit).not.toHaveBeenCalled();
    const quit = new Promise(resolve => app.quit.mockImplementation(resolve));
    finishSeal();
    await quit;
    expect(seal).toHaveBeenCalledTimes(1);
    const finalExit = { preventDefault: jest.fn() };
    handlers.get('before-quit')(finalExit);
    expect(finalExit.preventDefault).not.toHaveBeenCalled();
});

test('keeps the desktop alive after encryption fails and allows a later exit retry', async () => {
    seal.mockRejectedValueOnce(new Error('synthetic disk failure'));
    const failure = new Promise(resolve => failed.mockImplementation(resolve));
    handlers.get('before-quit')({ preventDefault: jest.fn() });
    await failure;
    expect(app.quit).not.toHaveBeenCalled();
    const quit = new Promise(resolve => app.quit.mockImplementation(resolve));
    handlers.get('before-quit')({ preventDefault: jest.fn() });
    await quit;
    expect(seal).toHaveBeenCalledTimes(2);
});
