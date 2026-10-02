import { EventEmitter } from 'node:events';
import { expect, jest, test } from '@jest/globals';
import { beginUserSpaceTask, registerUserSpaceFlusher, runUserSpaceTask, trackUserSpaceRequest, waitForUserSpaceTasks } from '../src/leslie-user-spaces/activity.js';

test('waits for file work and HTTP completion once, without waiting on the sealing request itself', async () => {
    const release = beginUserSpaceTask('synthetic-alice');
    const response = new EventEmitter();
    trackUserSpaceRequest({ path: '/api/chats/save', user: { profile: { handle: 'synthetic-alice' } } }, response);
    trackUserSpaceRequest({ path: '/api/users/logout', user: { profile: { handle: 'synthetic-alice' } } }, new EventEmitter());
    const finished = jest.fn();
    const waiting = waitForUserSpaceTasks('synthetic-alice').then(finished);
    release();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    response.emit('finish');
    response.emit('close');
    await waiting;
    expect(finished).toHaveBeenCalledTimes(1);
    await waitForUserSpaceTasks('synthetic-alice');
});

test('releases thumbnail work even when image processing fails', async () => {
    await expect(runUserSpaceTask('/synthetic-alice', async () => { throw new Error('synthetic image failure'); })).rejects.toThrow();
    await waitForUserSpaceTasks('synthetic-alice');
});

test('flushes deferred work after requests finish, including spaces with no active requests', async () => {
    const flush = jest.fn();
    const unregister = registerUserSpaceFlusher(flush);
    const release = beginUserSpaceTask('synthetic-bob');
    try {
        const waiting = waitForUserSpaceTasks('synthetic-bob');
        expect(flush).not.toHaveBeenCalled();
        release();
        await waiting;
        expect(flush).toHaveBeenCalledWith('synthetic-bob');
        await waitForUserSpaceTasks('synthetic-bob');
        expect(flush).toHaveBeenCalledTimes(2);
    } finally { release(); unregister(); }
});

test('rejects sealing when deferred file work fails', async () => {
    const unregister = registerUserSpaceFlusher(() => { throw new Error('synthetic flush failure'); });
    try {
        await expect(waitForUserSpaceTasks('synthetic-failure')).rejects.toThrow('synthetic flush failure');
    } finally { unregister(); }
});
