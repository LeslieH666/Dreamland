/**
 * Unified server-sent-event streaming for the public API.
 *
 * Every v1 stream uses the same OpenAI-compatible chunk shape that the Leslie
 * Bridge already established, so one client decoder covers both:
 *
 *   data: {"id":"...","object":"chat.completion.chunk","created":0,
 *          "model":"...","choices":[{"index":0,"delta":{"content":"Hi"},
 *          "finish_reason":null}]}
 *   data: [DONE]
 *
 * `X-Accel-Buffering: no` is part of the contract: reverse proxies (and the
 * deploy/ Caddyfile) must not buffer the stream.
 */

/**
 * Open an SSE response with the fixed v1 headers.
 * @param {import('express').Response} response Express response.
 * @returns {void}
 */
export function openSseStream(response) {
    response.status(200);
    response.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    response.flushHeaders?.();
}

/**
 * Create a writer that emits normalized v1 chunks.
 * @param {import('express').Response} response Express response.
 * @param {{id: string, model: string, created?: number}} options Chunk metadata.
 * @returns {{chunk: (delta: string, finishReason?: string | null) => void, done: () => void, fail: (code: string, message: string) => void, closed: () => boolean}} Writer.
 */
export function createSseWriter(response, { id, model, created = 0 }) {
    let isClosed = false;

    const write = (payload) => {
        if (isClosed) {
            return;
        }
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    return {
        chunk(delta, finishReason = null) {
            write({
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                    index: 0,
                    delta: delta ? { content: delta } : {},
                    finish_reason: finishReason,
                }],
            });
        },
        done() {
            if (isClosed) {
                return;
            }
            isClosed = true;
            response.end('data: [DONE]\n\n');
        },
        fail(code, message) {
            if (isClosed) {
                return;
            }
            isClosed = true;
            // Errors travel inside the stream once the status line is sent.
            response.end(`data: ${JSON.stringify({ error: { code, message, type: 'server_error' } })}\n\n`);
        },
        closed() {
            return isClosed;
        },
    };
}

/**
 * Emit a full answer as a single chunk and close the stream. Used by endpoints
 * whose upstream is not streaming.
 * @param {import('express').Response} response Express response.
 * @param {{id: string, model: string, text: string}} options Payload.
 * @returns {void}
 */
export function sendSingleChunkStream(response, { id, model, text }) {
    openSseStream(response);
    const writer = createSseWriter(response, { id, model });
    writer.chunk(text);
    writer.chunk('', 'stop');
    writer.done();
}

/**
 * True when the client asked for an event stream.
 * @param {import('express').Request} request Express request.
 * @param {unknown} requested Explicit `stream` flag from the body.
 * @returns {boolean} Whether to stream.
 */
export function wantsStream(request, requested) {
    if (typeof requested === 'boolean') {
        return requested;
    }
    return String(request.get('accept') ?? '').includes('text/event-stream');
}
