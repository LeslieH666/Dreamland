import { randomUUID } from 'node:crypto';

import { LeslieBridgeRequestError } from './errors.js';

const DEFAULT_HOST_TTL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 10_000;
const TERMINAL_EVENT_TYPES = new Set(['complete', 'error', 'canceled']);

/**
 * Owns the process-local command channel between AIRI and one DreamLand page.
 * The page supplies the active character snapshot and executes each turn through
 * the normal browser generation pipeline.
 */
class CompanionSession {
    #commands = [];
    #createId;
    #host = null;
    #hostTtlMs;
    #now;
    #pollWaiter = null;
    #turns = new Map();

    /**
     * @param {{createId: () => string, hostTtlMs: number, now: () => number}} options Session dependencies.
     */
    constructor(options) {
        this.#createId = options.createId;
        this.#hostTtlMs = options.hostTtlMs;
        this.#now = options.now;
    }

    /**
     * Store the latest browser-owned character and voice snapshot.
     * @param {string} hostId Browser page instance ID.
     * @param {Record<string, unknown>} snapshot Current Leslie state.
     * @returns {void}
     */
    updateHost(hostId, snapshot) {
        const cleanHostId = String(hostId ?? '').trim();
        if (!cleanHostId) {
            throw new LeslieBridgeRequestError('HOST_ID_REQUIRED', 'The Leslie companion host ID is required.');
        }

        const userSpaceId = String(snapshot?.userSpaceId ?? '').trim();
        if (this.#host && (this.#host.id !== cleanHostId
            || (this.#host.userSpaceId && userSpaceId && this.#host.userSpaceId !== userSpaceId))) {
            this.#replaceHost();
        }

        this.#host = {
            id: cleanHostId,
            lastSeen: this.#now(),
            snapshot,
            userSpaceId,
        };
    }

    /**
     * Get the latest state. A snapshot becomes offline after the host time limit.
     * @returns {Record<string, unknown>} Companion state.
     */
    getState() {
        if (!this.#isHostConnected()) {
            return {
                connected: false,
                binding: null,
                characters: [],
                generating: false,
                voice: { available: false },
            };
        }

        const snapshot = { ...this.#host.snapshot };
        delete snapshot.userSpaceId;
        return {
            connected: true,
            ...snapshot,
        };
    }

    /**
     * Queue one user message for the active Leslie page.
     * @param {string} input User message.
     * @returns {{id: string, binding: Record<string, unknown>, subscribe: (listener: (event: Record<string, unknown>) => void) => () => void, cancel: () => void}} Turn handle.
     */
    createTurn(input) {
        if (!this.#isHostConnected()) {
            throw new LeslieBridgeRequestError(
                'COMPANION_HOST_OFFLINE',
                'Open DreamLand and select a character before you use AIRI.',
                503,
            );
        }

        const binding = this.#host.snapshot?.binding;
        if (!binding?.characterId) {
            throw new LeslieBridgeRequestError(
                'CHARACTER_NOT_SELECTED',
                'Select a character in DreamLand before you use AIRI.',
                409,
            );
        }

        if (this.#host.snapshot?.generating || this.#turns.size > 0) {
            throw new LeslieBridgeRequestError(
                'COMPANION_BUSY',
                'Wait for the current DreamLand reply to finish.',
                409,
            );
        }

        const text = String(input ?? '').trim();
        if (!text) {
            throw new LeslieBridgeRequestError('INPUT_REQUIRED', 'The user message must contain text.');
        }

        const id = this.#createId();
        const turn = {
            hostId: this.#host.id,
            listeners: new Set(),
        };
        this.#turns.set(id, turn);
        this.#queueCommand({
            id,
            type: 'turn',
            input: text,
            binding,
            userSpaceId: this.#host.userSpaceId,
        });

        return {
            id,
            binding,
            subscribe: (listener) => {
                turn.listeners.add(listener);
                return () => turn.listeners.delete(listener);
            },
            cancel: () => this.#cancelTurn(id),
        };
    }

    /**
     * Update the host snapshot and wait for its next command.
     * @param {{hostId: string, snapshot: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number}} options Poll options.
     * @returns {Promise<Record<string, unknown> | null>} Next command or null after the time limit.
     */
    pollHost({ hostId, snapshot, signal, timeoutMs = DEFAULT_POLL_TIMEOUT_MS }) {
        this.updateHost(hostId, snapshot);
        const command = this.#takeCommand(hostId);
        if (command) {
            return Promise.resolve(command);
        }

        if (this.#pollWaiter) {
            this.#pollWaiter.finish(null);
        }

        return new Promise((resolve) => {
            let timer;
            const finish = (value) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (this.#pollWaiter?.finish === finish) {
                    this.#pollWaiter = null;
                }
                resolve(value);
            };
            const abort = () => finish(null);
            timer = setTimeout(() => finish(null), Math.max(1, Number(timeoutMs) || DEFAULT_POLL_TIMEOUT_MS));
            signal?.addEventListener('abort', abort, { once: true });
            this.#pollWaiter = { finish, hostId };
        });
    }

    /**
     * Publish progress from the Leslie page to the matching AIRI request.
     * @param {{hostId: string, requestId: string, event: Record<string, unknown>}} message Host event.
     * @returns {boolean} True when the event matched an active turn.
     */
    publishHostEvent({ hostId, requestId, event }) {
        const turn = this.#turns.get(requestId);
        if (!turn || turn.hostId !== hostId) {
            return false;
        }

        for (const listener of turn.listeners) {
            listener(event);
        }

        if (TERMINAL_EVENT_TYPES.has(event?.type)) {
            this.#turns.delete(requestId);
        }
        return true;
    }

    #cancelTurn(requestId) {
        const turn = this.#turns.get(requestId);
        if (!turn) {
            return;
        }
        this.#queueCommand({ id: requestId, type: 'cancel' });
    }

    #isHostConnected() {
        return Boolean(this.#host && this.#now() - this.#host.lastSeen <= this.#hostTtlMs);
    }

    #queueCommand(command) {
        if (this.#pollWaiter && this.#pollWaiter.hostId === this.#host?.id) {
            this.#pollWaiter.finish(command);
            return;
        }
        this.#commands.push({ command, hostId: this.#host?.id });
    }

    #takeCommand(hostId) {
        const index = this.#commands.findIndex(item => item.hostId === hostId);
        if (index < 0) {
            return null;
        }
        return this.#commands.splice(index, 1)[0].command;
    }

    #replaceHost() {
        this.#pollWaiter?.finish(null);
        this.#commands = [];
        for (const [requestId, turn] of this.#turns) {
            const event = {
                type: 'error',
                code: 'COMPANION_HOST_REPLACED',
                message: 'The DreamLand page reloaded during the AIRI request.',
            };
            for (const listener of turn.listeners) {
                listener(event);
            }
            this.#turns.delete(requestId);
        }
    }
}

/**
 * Create one process-local Leslie companion session.
 * @param {{createId?: () => string, hostTtlMs?: number, now?: () => number}} [options] Session options.
 * @returns {CompanionSession} Companion session.
 */
export function createCompanionSession(options = {}) {
    return new CompanionSession({
        createId: options.createId ?? randomUUID,
        hostTtlMs: options.hostTtlMs ?? DEFAULT_HOST_TTL_MS,
        now: options.now ?? Date.now,
    });
}

export const companionSession = createCompanionSession();
