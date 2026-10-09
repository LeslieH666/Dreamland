/**
 * Adapters that let `/api/v1` reuse existing DreamLand logic unchanged.
 *
 * Almost every legacy endpoint defines its logic *inline* inside a
 * `router.get(...)`/`router.post(...)` callback, so the only way to reuse that
 * logic without copying it — and without editing the chat-core files, which are
 * under a compatibility freeze — is to invoke the existing handler with a
 * request/response pair this module controls.
 *
 * `invokeExpressHandler` therefore runs a real Express handler against a light
 * mock and returns a captured result. The handler keeps its own validation,
 * storage access and error messages; the v1 route only reshapes the result into
 * the public contract.
 */

/**
 * @typedef {object} CapturedResponse
 * @property {number} status HTTP status that was set.
 * @property {Record<string, string>} headers Response headers.
 * @property {unknown} body Parsed JSON body, string or Buffer.
 * @property {string | Buffer | null} raw Unparsed body.
 * @property {boolean} sent Whether the handler ended the response.
 */

/**
 * Build a minimal Express-compatible response whose output can be inspected.
 *
 * `onSettled` is invoked the first time the response is actually finished, so
 * an async Express handler (whose promise the router discards) can still drive
 * the adapter's promise.
 * @param {{onSettled?: () => void}} [options] Settle hook.
 * @returns {{response: object, captured: CapturedResponse}} Mock response and its capture.
 */
export function createMockResponse({ onSettled } = {}) {
    /** @type {CapturedResponse} */
    const captured = { status: 200, headers: {}, body: null, raw: null, sent: false };
    const listeners = new Map();
    const settle = () => { onSettled?.(); };

    const response = {
        statusCode: 200,
        headersSent: false,
        locals: {},
        status(code) {
            captured.status = Number(code) || 200;
            response.statusCode = captured.status;
            return response;
        },
        set(nameOrObject, value) {
            if (typeof nameOrObject === 'object' && nameOrObject !== null) {
                for (const [key, item] of Object.entries(nameOrObject)) {
                    captured.headers[String(key).toLowerCase()] = String(item);
                }
            } else {
                captured.headers[String(nameOrObject).toLowerCase()] = String(value);
            }
            return response;
        },
        header(name, value) {
            return response.set(name, value);
        },
        type(value) {
            return response.set('Content-Type', String(value));
        },
        json(payload) {
            captured.body = payload;
            captured.raw = JSON.stringify(payload);
            captured.sent = true;
            response.headersSent = true;
            if (!captured.headers['content-type']) {
                captured.headers['content-type'] = 'application/json; charset=utf-8';
            }
            settle();
            return response;
        },
        send(payload) {
            if (payload === undefined || payload === null) {
                captured.body = null;
                captured.raw = null;
            } else if (Buffer.isBuffer(payload)) {
                captured.body = payload;
                captured.raw = payload;
            } else if (typeof payload === 'object') {
                captured.body = payload;
                captured.raw = JSON.stringify(payload);
            } else {
                const text = String(payload);
                captured.body = text;
                captured.raw = text;
                try {
                    captured.body = JSON.parse(text);
                } catch {
                    // Keep the raw string when it is not JSON.
                }
            }
            captured.sent = true;
            response.headersSent = true;
            settle();
            return response;
        },
        sendStatus(code) {
            response.status(code);
            captured.body = String(code);
            captured.raw = String(code);
            captured.sent = true;
            response.headersSent = true;
            settle();
            return response;
        },
        end(payload) {
            if (payload !== undefined) {
                response.send(payload);
            }
            captured.sent = true;
            response.headersSent = true;
            settle();
            return response;
        },
        write(chunk) {
            const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
            captured.raw = `${typeof captured.raw === 'string' ? captured.raw : ''}${text}`;
            captured.body = captured.raw;
            response.headersSent = true;
            return true;
        },
        flushHeaders() {
            response.headersSent = true;
        },
        redirect() {
            captured.sent = true;
            settle();
            return response;
        },
        on(event, listener) {
            listeners.set(event, listener);
            return response;
        },
        once(event, listener) {
            listeners.set(event, listener);
            return response;
        },
        removeListener(event) {
            listeners.delete(event);
            return response;
        },
        emit(event, ...args) {
            listeners.get(event)?.(...args);
            return true;
        },
        setHeader(name, value) {
            return response.set(name, value);
        },
        getHeader(name) {
            return captured.headers[String(name).toLowerCase()];
        },
    };

    return { response, captured };
}

/**
 * Build an Express-compatible request for a legacy handler.
 * @param {import('express').Request} source Original v1 request (for headers and user).
 * @param {{body?: unknown, query?: unknown, params?: unknown, path?: string, method?: string}} [overrides] Request parts.
 * @returns {object} Mock request.
 */
export function createMockRequest(source, { body, query, params, path, method } = {}) {
    const headers = { ...(source?.headers ?? {}) };
    // A plain object, deliberately NOT inheriting from IncomingMessage: several
    // request properties (path, url, method) are getter-only there, so
    // assigning them on a real request throws.
    const request = {
        method: method ?? source?.method ?? 'GET',
        url: path ?? source?.url ?? '/',
        path: path ?? source?.path ?? '/',
        originalUrl: path ?? source?.originalUrl ?? '/',
        baseUrl: '',
        headers,
        body: body ?? {},
        query: query ?? {},
        params: params ?? {},
        user: source?.user,
        apiAuth: source?.apiAuth,
        session: source?.session,
        socket: source?.socket ?? { remoteAddress: source?.ip ?? '127.0.0.1' },
        ip: source?.ip ?? '127.0.0.1',
        ips: [],
        httpVersion: '1.1',
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        complete: true,
        aborted: false,
        readable: true,
        route: undefined,
        app: undefined,
        res: undefined,
        get(name) {
            return headers[String(name).toLowerCase()];
        },
        header(name) {
            return headers[String(name).toLowerCase()];
        },
        accepts() {
            return true;
        },
        acceptsCharsets() {
            return true;
        },
        acceptsEncodings() {
            return true;
        },
        acceptsLanguages() {
            return true;
        },
        is() {
            return false;
        },
        on() {
            return request;
        },
        once() {
            return request;
        },
        removeListener() {
            return request;
        },
        pipe() {
            return request;
        },
        unpipe() {
            return request;
        },
    };
    return request;
}

/**
 * Run an Express handler or router and capture its response.
 * @param {(req: object, res: object, next: (error?: unknown) => void) => unknown} handler Handler, router or middleware.
 * @param {object} request Mock request.
 * @returns {Promise<CapturedResponse>} Captured response.
 */
export function invokeExpressHandler(handler, request) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) {
                return;
            }
            settled = true;
            fn(value);
        };
        const { response, captured } = createMockResponse({
            onSettled: () => finish(resolve, captured),
        });
        /** @param {unknown} [error] Error passed to next(). */
        const next = (error) => {
            if (error) {
                finish(reject, error);
                return;
            }
            // The handler declined or finished without sending.
            finish(resolve, captured);
        };
        try {
            const result = handler(request, response, next);
            if (result && typeof result.then === 'function') {
                result.then(() => finish(resolve, captured), error => finish(reject, error));
            } else if (captured.sent) {
                finish(resolve, captured);
            }
        } catch (error) {
            finish(reject, error);
        }
    });
}

/**
 * Convenience wrapper: build a mock request from the v1 request and invoke.
 * @param {(req: object, res: object, next: (error?: unknown) => void) => unknown} handler Handler or router.
 * @param {import('express').Request} source Original v1 request.
 * @param {{body?: unknown, query?: unknown, params?: unknown, path?: string, method?: string}} [overrides] Request parts.
 * @returns {Promise<CapturedResponse>} Captured response.
 */
export function invokeWithRequest(handler, source, overrides = {}) {
    return invokeExpressHandler(handler, createMockRequest(source, overrides));
}

/**
 * Read the JSON body of a captured response, or throw when the legacy handler
 * reported a failure. Legacy handlers return either a JSON payload or a plain
 * text error; both are surfaced as an ApiError so /api/v1 keeps one envelope.
 * @param {CapturedResponse} captured Captured response.
 * @param {{allowStatuses?: number[], fallbackMessage?: string}} [options] Options.
 * @returns {any} Parsed body.
 */
export function readJsonOrThrow(captured, { allowStatuses = [200, 201, 204], fallbackMessage = 'The upstream handler failed.' } = {}) {
    if (!allowStatuses.includes(captured.status)) {
        const message = typeof captured.body === 'string' && captured.body.trim()
            ? captured.body.trim().slice(0, 300)
            : fallbackMessage;
        const error = new Error(message);
        Object.assign(error, { status: captured.status, legacyBody: captured.body });
        throw error;
    }
    if (captured.status === 204 || captured.body === null) {
        return null;
    }
    return captured.body;
}
