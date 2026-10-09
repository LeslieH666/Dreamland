#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible mock provider for the prompt-assembly fixtures.
 *
 * It exists so the browser's own status check reports the chat-completion
 * provider as reachable (otherwise `Generate` returns early at the connection
 * gate and nothing is assembled). The harness captures the *request*, so the
 * response body only has to be well-formed.
 */

import http from 'node:http';

const PORT = Number(process.env.LESLIE_FIXTURE_PROVIDER_PORT || 9099);
const REPLY = '合成夹具回复。';

/**
 * Read a JSON request body.
 * @param {import('node:http').IncomingMessage} request Request.
 * @returns {Promise<object>} Parsed body.
 */
function readJson(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch (error) {
                reject(error);
            }
        });
        request.on('error', reject);
    });
}

/**
 * Start the mock provider.
 * @param {number} [port] Port.
 * @returns {Promise<import('node:http').Server>} Listening server.
 */
export function startMockProvider(port = PORT) {
    const server = http.createServer(async (request, response) => {
        const url = request.url ?? '';
        if (url.endsWith('/models')) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] }));
            return;
        }
        if (url.includes('/chat/completions')) {
            let body = {};
            try {
                body = await readJson(request);
            } catch {
                body = {};
            }
            const chunk = {
                id: 'chatcmpl-fixture',
                object: 'chat.completion.chunk',
                created: 1767225600,
                model: body.model ?? 'fixture-model',
                choices: [{ index: 0, delta: { role: 'assistant', content: REPLY }, finish_reason: null }],
            };
            if (body.stream) {
                response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
                response.write(`data: ${JSON.stringify(chunk)}\n\n`);
                response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                response.write('data: [DONE]\n\n');
                response.end();
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                id: 'chatcmpl-fixture',
                object: 'chat.completion',
                created: 1767225600,
                model: body.model ?? 'fixture-model',
                choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
            return;
        }
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'not found' } }));
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await startMockProvider();
    console.log(`mock provider listening on http://127.0.0.1:${PORT}`);
}
