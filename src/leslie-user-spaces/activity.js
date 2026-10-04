import path from 'node:path';

const tasks = new Map();
const waiters = new Map();
const flushers = new Set();

/** Register deferred file work that must finish before a space is encrypted. */
export function registerUserSpaceFlusher(flush) {
    flushers.add(flush);
    return () => flushers.delete(flush);
}

export function beginUserSpaceTask(handle) {
    tasks.set(handle, (tasks.get(handle) || 0) + 1);
    let ended = false;
    return () => {
        if (ended) return;
        ended = true;
        const count = tasks.get(handle) - 1;
        if (count) tasks.set(handle, count);
        else {
            tasks.delete(handle);
            for (const resolve of waiters.get(handle) || []) resolve();
        }
    };
}

export function trackUserSpaceRequest(request, response) {
    if (!response.once || /^\/api\/users\/(?:login|logout|create|delete|change-password)$/.test(request.path)
        || request.path === '/api/leslie/user-spaces/activate') return;
    const release = beginUserSpaceTask(request.user.profile.handle);
    response.once('finish', release);
    response.once('close', release);
}

export async function runUserSpaceTask(root, action) {
    const release = beginUserSpaceTask(path.basename(path.resolve(root)));
    try { return await action(); } finally { release(); }
}

export async function waitForUserSpaceTasks(handle) {
    if (tasks.has(handle)) await waitForRequests(handle);
    for (const flush of flushers) await flush(handle);
}

async function waitForRequests(handle) {
    const listeners = waiters.get(handle) || new Set();
    waiters.set(handle, listeners);
    let done;
    let timer;
    try {
        await new Promise((resolve, reject) => {
            done = resolve;
            listeners.add(done);
            timer = setTimeout(() => reject(new Error('User-space operations are still finishing. Please retry.')), 30000);
        });
    } finally {
        clearTimeout(timer);
        listeners.delete(done);
        if (!listeners.size) waiters.delete(handle);
    }
}
