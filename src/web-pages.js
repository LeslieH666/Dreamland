/**
 * Mount public web pages without changing the account/API authentication boundary.
 * The server app shell is public because a browser navigation cannot attach the
 * bearer token stored in localStorage. Its data requests remain authenticated.
 * @param {import('express').Express} app Express application.
 * @param {object} options Page dependencies.
 * @param {string} options.publicRoot Public asset directory.
 * @param {() => string} options.getMode Runtime mode reader.
 * @param {(req: import('express').Request) => boolean} options.shouldRedirectToLogin Desktop account check.
 * @param {import('express').RequestHandler} options.cacheMiddleware Shell cache middleware.
 * @returns {void}
 */
export function mountWebPages(app, { publicRoot, getMode, shouldRedirectToLogin, cacheMiddleware }) {
    const serveApp = (request, response) => {
        if (getMode() !== 'server' && shouldRedirectToLogin(request)) {
            const query = request.originalUrl.split('?')[1];
            return response.redirect(query ? `/login?${query}` : '/login');
        }
        return response.sendFile('index.html', { root: publicRoot });
    };

    app.get('/', cacheMiddleware, (request, response) => {
        if (getMode() === 'server') {
            return response.sendFile('introduction.html', { root: publicRoot });
        }
        return serveApp(request, response);
    });
    app.get('/app', cacheMiddleware, serveApp);
}
