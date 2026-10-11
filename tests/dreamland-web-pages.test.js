import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { mountWebPages } from '../src/web-pages.js';

/** @returns {object} Isolated routing harness with no user data or real listener. */
function harness(mode, needsLogin = true) {
    const routes = new Map();
    const response = {
        sendFile: (file, options) => ({ file, options }),
        redirect: url => ({ redirect: url }),
    };
    mountWebPages({ get: (route, ...handlers) => routes.set(route, handlers.at(-1)) }, {
        publicRoot: path.resolve('/tmp/dreamland-public'),
        getMode: () => mode,
        shouldRedirectToLogin: () => needsLogin,
        cacheMiddleware: (_req, _res, next) => next(),
    });
    return (route, query = '') => routes.get(route)({ originalUrl: `${route}${query}` }, response);
}

describe('DreamLand public introduction and app entry', () => {
    test('server root always shows the introduction, including signed-in visitors', () => {
        for (const needsLogin of [true, false]) {
            expect(harness('server', needsLogin)('/').file).toBe('introduction.html');
        }
    });

    test('server app navigation serves the shell so localStorage bearer auth can bootstrap', () => {
        expect(harness('server')('/app').file).toBe('index.html');
    });

    test('desktop root and app keep the existing account gate and query parameters', () => {
        const request = harness('desktop');
        expect(request('/', '?noauto=1')).toEqual({ redirect: '/login?noauto=1' });
        expect(request('/app')).toEqual({ redirect: '/login' });
    });

    test('desktop signed-in root continues to serve the application', () => {
        expect(harness('desktop', false)('/').file).toBe('index.html');
    });
});
