import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import {
    MEMORY_SCHEMA_VERSION,
    assertMemoryId,
    createInitialState,
    isMemoryId,
    mergeState,
    normalizeCoreSnapshot,
    normalizeEvent,
    normalizeIdentityBinding,
    normalizeMemoryState,
} from './schema.js';
import { selectMemoryEvents } from './scoring.js';
import { calculateRelationship } from './relationship.js';

export class LeslieMemoryStoreError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'LeslieMemoryStoreError';
        this.code = code;
    }
}

function cleanIdentity(value, field) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 500) {
        throw new LeslieMemoryStoreError('INVALID_INPUT', `${field} is required and must be shorter than 500 characters.`);
    }
    return text;
}

function hashJson(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalSummary(value) {
    return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function mergeSources(previous, next) {
    const sources = [...(previous ?? []), ...(next ?? [])];
    const unique = new Map(sources.map(source => [`${source.messageId}:${source.swipeId}:${source.hash}`, source]));
    return [...unique.values()].slice(-32);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new LeslieMemoryStoreError('CORRUPT_DATA', `Could not read Leslie memory file: ${path.basename(filePath)}. ${error.message}`);
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileAtomicSync(filePath, `${JSON.stringify(value, null, 4)}\n`, 'utf8');
}

export class LeslieMemoryStore {
    constructor(userRoot) {
        if (!path.isAbsolute(userRoot)) {
            throw new TypeError('Leslie memory storage requires an absolute user data directory.');
        }
        this.userRoot = userRoot;
        this.baseDirectory = path.join(userRoot, 'leslie', 'memory');
        this.archiveDirectory = path.join(userRoot, 'leslie', 'memory-archive');
    }

    getMemoryDirectory(memoryId) {
        assertMemoryId(memoryId);
        return path.join(this.baseDirectory, memoryId);
    }

    getPaths(memoryId) {
        const directory = this.getMemoryDirectory(memoryId);
        return {
            directory,
            manifest: path.join(directory, 'manifest.json'),
            core: path.join(directory, 'core-snapshot.json'),
            events: path.join(directory, 'events.jsonl'),
            state: path.join(directory, 'state.json'),
            history: path.join(directory, 'history'),
        };
    }

    exists(memoryId) {
        return fs.existsSync(this.getPaths(memoryId).manifest);
    }

    createMemory({ chatKey, characterKey, coreSnapshot = {}, parentMemoryId = null, branchPointMessageId = null, identityBinding = null } = {}) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const paths = this.getPaths(id);
        const normalizedCore = normalizeCoreSnapshot(coreSnapshot);
        const manifest = {
            schemaVersion: MEMORY_SCHEMA_VERSION,
            id,
            chatKey: cleanIdentity(chatKey, 'chatKey'),
            characterKey: cleanIdentity(characterKey, 'characterKey'),
            parentMemoryId: parentMemoryId ? assertMemoryId(parentMemoryId) : null,
            branchPointMessageId: Number.isInteger(Number(branchPointMessageId)) ? Math.max(0, Number(branchPointMessageId)) : null,
            identityBinding: normalizeIdentityBinding(identityBinding),
            coreHash: hashJson(normalizedCore),
            createdAt: now,
            updatedAt: now,
        };

        fs.mkdirSync(paths.history, { recursive: true });
        writeJson(paths.manifest, manifest);
        writeJson(paths.core, normalizedCore);
        writeFileAtomicSync(paths.events, '', 'utf8');
        writeJson(paths.state, createInitialState());
        return this.getMemory(id);
    }

    ensureMemory({ memoryId = null, chatKey, characterKey, coreSnapshot = {}, branchPointMessageId = null, isBranch = false, parentChatKey = null, identityBinding = null } = {}) {
        const cleanChatKey = cleanIdentity(chatKey, 'chatKey');
        const cleanCharacterKey = cleanIdentity(characterKey, 'characterKey');
        const normalizedBinding = normalizeIdentityBinding(identityBinding);

        if (!memoryId) {
            return {
                memory: this.createMemory({ chatKey: cleanChatKey, characterKey: cleanCharacterKey, coreSnapshot, identityBinding: normalizedBinding }),
                created: true,
                branched: false,
                coreChanged: false,
                identityStatus: normalizedBinding ? 'matched' : 'unbound',
            };
        }

        assertMemoryId(memoryId);
        if (!this.exists(memoryId)) {
            return {
                memory: this.createMemory({ chatKey: cleanChatKey, characterKey: cleanCharacterKey, coreSnapshot, identityBinding: normalizedBinding }),
                created: true,
                branched: false,
                coreChanged: false,
                identityStatus: normalizedBinding ? 'matched' : 'unbound',
            };
        }

        const existing = this.getMemory(memoryId);
        const existingBinding = existing.manifest.identityBinding ?? null;
        const identityStatus = !existingBinding
            ? 'unbound'
            : normalizedBinding?.storyScopeId === existingBinding.storyScopeId && normalizedBinding?.personaId === existingBinding.personaId
                ? 'matched'
                : 'mismatch';
        if (identityStatus === 'mismatch') {
            const cleanParentChatKey = parentChatKey ? cleanIdentity(parentChatKey, 'parentChatKey') : null;
            const branchesFromExisting = isBranch === true && (!cleanParentChatKey || existing.manifest.chatKey === cleanParentChatKey);
            if (branchesFromExisting) {
                const memory = this.cloneMemory(memoryId, {
                    chatKey: cleanChatKey,
                    characterKey: cleanCharacterKey,
                    branchPointMessageId,
                    identityBinding: normalizedBinding,
                });
                return { memory, created: true, branched: true, coreChanged: false, identityStatus: 'matched' };
            }
            return { memory: existing, created: false, branched: false, coreChanged: false, identityStatus };
        }
        if (existing.manifest.chatKey !== cleanChatKey) {
            const cleanParentChatKey = parentChatKey ? cleanIdentity(parentChatKey, 'parentChatKey') : null;
            const branchesFromExisting = isBranch === true && (!cleanParentChatKey || existing.manifest.chatKey === cleanParentChatKey);
            if (branchesFromExisting) {
                const memory = this.cloneMemory(memoryId, {
                    chatKey: cleanChatKey,
                    characterKey: cleanCharacterKey,
                    branchPointMessageId,
                    identityBinding: normalizedBinding,
                });
                return {
                    memory,
                    created: true,
                    branched: true,
                    coreChanged: false,
                    identityStatus: normalizedBinding ? 'matched' : 'unbound',
                };
            }

            existing.manifest.chatKey = cleanChatKey;
            existing.manifest.characterKey = cleanCharacterKey;
            existing.manifest.updatedAt = new Date().toISOString();
            writeJson(this.getPaths(memoryId).manifest, existing.manifest);
        }

        const coreChanged = hashJson(normalizeCoreSnapshot(coreSnapshot)) !== existing.manifest.coreHash;
        return { memory: existing, created: false, branched: false, coreChanged, identityStatus };
    }

    bindIdentity(memoryId, value, { confirmed = false } = {}) {
        if (confirmed !== true) {
            throw new LeslieMemoryStoreError('CONFIRMATION_REQUIRED', 'Binding a Persona to a Leslie memory requires explicit confirmation.');
        }
        const identityBinding = normalizeIdentityBinding({ ...value, confirmed: true, boundAt: new Date().toISOString() });
        if (!identityBinding) {
            throw new LeslieMemoryStoreError('INVALID_INPUT', 'A complete Leslie identity binding is required.');
        }
        const paths = this.getPaths(memoryId);
        const manifest = readJson(paths.manifest);
        fs.mkdirSync(paths.history, { recursive: true });
        writeJson(path.join(paths.history, `manifest-${Date.now()}.json`), manifest);
        manifest.schemaVersion = MEMORY_SCHEMA_VERSION;
        manifest.identityBinding = identityBinding;
        manifest.updatedAt = new Date().toISOString();
        writeJson(paths.manifest, manifest);
        return manifest;
    }

    assertStoryScope(memoryId, storyScopeId) {
        const manifest = readJson(this.getPaths(memoryId).manifest);
        const binding = manifest.identityBinding;
        if (!binding) {
            return;
        }
        if (!isMemoryId(storyScopeId) || storyScopeId !== binding.storyScopeId) {
            throw new LeslieMemoryStoreError('IDENTITY_MISMATCH', 'This memory belongs to a different Persona or story line.');
        }
    }

    getMemory(memoryId) {
        const paths = this.getPaths(memoryId);
        if (!fs.existsSync(paths.manifest)) {
            throw new LeslieMemoryStoreError('NOT_FOUND', 'Leslie memory was not found.');
        }

        const manifest = readJson(paths.manifest);
        const rawState = readJson(paths.state);
        const state = this.migrateStateIfNeeded(memoryId, manifest, rawState);

        return {
            manifest: state.manifest,
            coreSnapshot: readJson(paths.core),
            state: state.state,
            events: this.readEvents(memoryId),
            history: this.listHistory(memoryId),
        };
    }

    listMemorySources() {
        if (!fs.existsSync(this.baseDirectory)) {
            return [];
        }
        const sources = [];
        for (const entry of fs.readdirSync(this.baseDirectory, { withFileTypes: true })) {
            if (!entry.isDirectory() || !isMemoryId(entry.name)) {
                continue;
            }
            try {
                const paths = this.getPaths(entry.name);
                const manifest = readJson(paths.manifest);
                const coreSnapshot = normalizeCoreSnapshot(readJson(paths.core));
                const identityBinding = manifest.identityBinding
                    ? normalizeIdentityBinding(manifest.identityBinding)
                    : null;
                sources.push({
                    memoryId: entry.name,
                    chatKey: cleanIdentity(manifest.chatKey, 'chatKey'),
                    characterKey: cleanIdentity(manifest.characterKey, 'characterKey'),
                    displayName: coreSnapshot.name,
                    avatar: coreSnapshot.avatar,
                    identityBinding,
                    identityStatus: identityBinding?.confirmed ? 'confirmed' : identityBinding ? 'unconfirmed' : 'unbound',
                    updatedAt: String(manifest.updatedAt ?? '').trim(),
                });
            } catch (error) {
                console.warn(`Skipped an unavailable Leslie memory source (${entry.name}). ${String(error?.message || error).slice(0, 300)}`);
            }
        }
        return sources.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    }

    migrateStateIfNeeded(memoryId, manifest, rawState) {
        const rawVersion = Number(rawState?.schemaVersion ?? 0);
        const manifestVersion = Number(manifest?.schemaVersion ?? 0);
        const normalizedIdentityBinding = manifest?.identityBinding
            ? normalizeIdentityBinding(manifest.identityBinding)
            : null;
        const identityNeedsMigration = Boolean(manifest?.identityBinding
            && !['story', 'reality'].includes(manifest.identityBinding.worldLine));
        const needsMigration = rawVersion < MEMORY_SCHEMA_VERSION
            || manifestVersion < MEMORY_SCHEMA_VERSION
            || !rawState?.settings?.memoryModel
            || !rawState?.relationship
            || identityNeedsMigration;
        if (!needsMigration) {
            return {
                manifest: { ...manifest, identityBinding: normalizedIdentityBinding },
                state: normalizeMemoryState(rawState),
            };
        }

        const paths = this.getPaths(memoryId);
        const migrationVersion = Math.min(rawVersion || 1, manifestVersion || 1);
        const migrationStamp = Date.now();
        fs.mkdirSync(paths.history, { recursive: true });
        writeJson(path.join(paths.history, `state-migration-v${migrationVersion}-${migrationStamp}.json`), rawState);
        writeJson(path.join(paths.history, `manifest-migration-v${migrationVersion}-${migrationStamp}.json`), manifest);

        if (migrationVersion < 5 && fs.existsSync(paths.events)) {
            const previousJournal = fs.readFileSync(paths.events, 'utf8');
            writeFileAtomicSync(path.join(paths.history, `events-migration-v${migrationVersion}-${migrationStamp}.jsonl`), previousJournal, 'utf8');
            const automaticallyApproved = this.readEvents(memoryId)
                .filter(event => event.level === 'A' && (event.status === 'pending' || event.approved !== true))
                .map(event => ({
                    ...event,
                    status: event.status === 'archived' ? 'archived' : 'active',
                    approved: true,
                    autoApprovedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                }));
            if (automaticallyApproved.length) {
                this.appendEventRecords(memoryId, automaticallyApproved);
            }
        }

        const state = normalizeMemoryState(rawState);
        const nextManifest = {
            ...manifest,
            schemaVersion: MEMORY_SCHEMA_VERSION,
            identityBinding: normalizedIdentityBinding,
            updatedAt: new Date().toISOString(),
        };
        writeJson(paths.state, state);
        writeJson(paths.manifest, nextManifest);
        return { manifest: nextManifest, state };
    }

    readEvents(memoryId) {
        const paths = this.getPaths(memoryId);
        if (!fs.existsSync(paths.events)) {
            return [];
        }

        const records = fs.readFileSync(paths.events, 'utf8').split(/\r?\n/).filter(Boolean);
        const events = new Map();
        for (const recordText of records) {
            try {
                const record = JSON.parse(recordText);
                if (record.op === 'upsert' && record.event?.id) {
                    events.set(record.event.id, record.event);
                }
            } catch (error) {
                throw new LeslieMemoryStoreError('CORRUPT_DATA', `Could not read Leslie memory journal. ${error.message}`);
            }
        }
        return [...events.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    }

    appendEventRecords(memoryId, events) {
        const paths = this.getPaths(memoryId);
        const existing = fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8') : '';
        const records = events.map(event => JSON.stringify({ op: 'upsert', at: new Date().toISOString(), event })).join('\n');
        const separator = existing && !existing.endsWith('\n') ? '\n' : '';
        writeFileAtomicSync(paths.events, `${existing}${separator}${records}${records ? '\n' : ''}`, 'utf8');
        this.touchManifest(memoryId);
    }

    upsertEvents(memoryId, values, { sourceType = 'manual' } = {}) {
        if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
            throw new LeslieMemoryStoreError('INVALID_INPUT', 'events must contain between 1 and 100 items.');
        }

        const current = new Map(this.readEvents(memoryId).map(event => [event.id, event]));
        const normalized = values.map(value => {
            let previous = value?.id ? current.get(value.id) : null;
            if (!previous && sourceType === 'ai') {
                const summaryKey = canonicalSummary(value?.summary);
                previous = [...current.values()].find(event =>
                    ['active', 'pending'].includes(event.status)
                    && event.level === String(value?.level ?? '').toUpperCase()
                    && canonicalSummary(event.summary) === summaryKey,
                );
            }
            const nextValue = previous && sourceType === 'ai'
                ? {
                    ...value,
                    id: previous.id,
                    source: mergeSources(previous.source, value?.source),
                    reinforcement: Number(previous.reinforcement ?? 1) + 1,
                }
                : value;
            const event = normalizeEvent(nextValue, { previous, sourceType });
            current.set(event.id, event);
            return event;
        });
        this.appendEventRecords(memoryId, normalized);
        return normalized;
    }

    patchEvent(memoryId, eventId, patch) {
        assertMemoryId(eventId);
        const previous = this.readEvents(memoryId).find(event => event.id === eventId);
        if (!previous) {
            throw new LeslieMemoryStoreError('NOT_FOUND', 'Leslie memory event was not found.');
        }
        const event = normalizeEvent({ ...previous, ...patch, id: eventId }, { previous, sourceType: previous.sourceType });
        this.appendEventRecords(memoryId, [event]);
        return event;
    }

    invalidateByMessageIds(memoryId, messageIds, reason = 'Source message changed.') {
        const ids = new Set((Array.isArray(messageIds) ? messageIds : []).map(Number).filter(Number.isInteger));
        if (!ids.size) {
            return [];
        }
        const affected = this.readEvents(memoryId)
            .filter(event => ['active', 'pending'].includes(event.status))
            .filter(event => (event.source ?? []).some(source => ids.has(Number(source.messageId))))
            .map(event => ({ ...event, status: 'invalid', invalidReason: String(reason).slice(0, 500), updatedAt: new Date().toISOString() }));
        if (affected.length) {
            this.appendEventRecords(memoryId, affected);
        }
        return affected;
    }

    updateState(memoryId, patch) {
        const paths = this.getPaths(memoryId);
        const rawCurrent = readJson(paths.state);
        const current = normalizeMemoryState(rawCurrent);
        fs.mkdirSync(paths.history, { recursive: true });
        writeJson(path.join(paths.history, `state-r${current.revision}-${Date.now()}.json`), current);
        const next = mergeState(rawCurrent, patch);
        writeJson(paths.state, next);
        this.touchManifest(memoryId);
        return next;
    }

    listHistory(memoryId) {
        const paths = this.getPaths(memoryId);
        if (!fs.existsSync(paths.history)) {
            return [];
        }
        return fs.readdirSync(paths.history)
            .filter(file => /^state-r\d+-\d+\.json$/.test(file))
            .map(file => readJson(path.join(paths.history, file)))
            .sort((left, right) => Number(right.revision) - Number(left.revision))
            .map(state => ({ revision: state.revision, updatedAt: state.updatedAt }));
    }

    restoreState(memoryId, revision) {
        const paths = this.getPaths(memoryId);
        const targetRevision = Number(revision);
        const file = fs.readdirSync(paths.history).find(name => name.startsWith(`state-r${targetRevision}-`));
        if (!file) {
            throw new LeslieMemoryStoreError('NOT_FOUND', 'Requested Leslie memory state revision was not found.');
        }
        const restored = readJson(path.join(paths.history, file));
        return this.updateState(memoryId, {
            enabled: restored.enabled,
            growth: restored.growth,
            analysis: restored.analysis,
            settings: restored.settings,
            relationship: restored.relationship,
        });
    }

    updateCoreSnapshot(memoryId, value) {
        const paths = this.getPaths(memoryId);
        const manifest = readJson(paths.manifest);
        const current = readJson(paths.core);
        fs.mkdirSync(paths.history, { recursive: true });
        writeJson(path.join(paths.history, `core-${Date.now()}.json`), current);
        const coreSnapshot = normalizeCoreSnapshot(value);
        writeJson(paths.core, coreSnapshot);
        manifest.coreHash = hashJson(coreSnapshot);
        manifest.updatedAt = new Date().toISOString();
        writeJson(paths.manifest, manifest);
        return { coreSnapshot, coreHash: manifest.coreHash };
    }

    cloneMemory(memoryId, { chatKey, characterKey, branchPointMessageId = null, identityBinding = null } = {}) {
        const source = this.getMemory(memoryId);
        const branchPoint = Number.isInteger(Number(branchPointMessageId)) ? Math.max(0, Number(branchPointMessageId)) : null;
        const created = this.createMemory({
            chatKey,
            characterKey,
            coreSnapshot: source.coreSnapshot,
            parentMemoryId: memoryId,
            branchPointMessageId: branchPoint,
            identityBinding: identityBinding ?? source.manifest.identityBinding,
        });
        const newId = created.manifest.id;
        const retainedEvents = source.events.filter(event => {
            if (branchPoint === null || !event.source?.length) {
                return true;
            }
            return event.source.every(item => Number(item.messageId) <= branchPoint);
        });
        if (retainedEvents.length) {
            this.appendEventRecords(newId, retainedEvents);
        }

        const stateCanBeCopied = branchPoint === null || Number(source.state.analysis?.lastAnalyzedMessageId ?? -1) <= branchPoint;
        const statePatch = stateCanBeCopied
            ? {
                enabled: source.state.enabled,
                growth: source.state.growth,
                analysis: source.state.analysis,
                settings: source.state.settings,
                relationship: source.state.relationship,
            }
            : {
                enabled: source.state.enabled,
                analysis: { ...source.state.analysis, lastAnalyzedMessageId: -1, lastRunAt: null, lastError: null },
                settings: source.state.settings,
                relationship: source.state.relationship,
            };
        this.updateState(newId, statePatch);
        return this.getMemory(newId);
    }

    selectContext(memoryId, { query = '', currentMessageId = 0 } = {}) {
        const memory = this.getMemory(memoryId);
        if (!memory.state.enabled) {
            return { enabled: false, growth: memory.state.growth, memories: [] };
        }
        const selected = selectMemoryEvents(memory.events, {
            query,
            currentMessageId,
            settings: memory.state.settings,
            maximum: memory.state.settings.maxMemories,
        });
        return {
            enabled: true,
            growth: memory.state.growth,
            memories: selected.map(item => ({ ...item.event, score: item.score })),
            settings: memory.state.settings,
        };
    }

    getRelationship(memoryId, { currentMessageId = 0 } = {}) {
        const memory = this.getMemory(memoryId);
        return calculateRelationship(memory.events, memory.state, { currentMessageId });
    }

    selectCrossLineContext(memoryId, { query = '', maximum } = {}) {
        const current = this.getMemory(memoryId);
        const currentBinding = current.manifest.identityBinding;
        const limit = Math.min(3, Math.max(1, Number(maximum ?? current.state.settings.crossLineMaxMemories) || 2));
        if (!current.state.enabled || current.state.settings.crossLineMemoryEnabled === false || !currentBinding?.confirmed) {
            return { enabled: false, memories: [] };
        }

        const currentLine = currentBinding.worldLine === 'reality' ? 'reality' : 'story';
        const candidates = [];
        for (const source of this.listMemorySources()) {
            const binding = source.identityBinding;
            const sourceLine = binding?.worldLine === 'reality' ? 'reality' : 'story';
            if (source.memoryId === memoryId
                || !binding?.confirmed
                || binding.personaId !== currentBinding.personaId
                || binding.counterpartId !== currentBinding.counterpartId
                || sourceLine === currentLine) {
                continue;
            }
            const memory = this.getMemory(source.memoryId);
            if (!memory.state.enabled) {
                continue;
            }
            const selected = selectMemoryEvents(memory.events, {
                query,
                currentMessageId: 0,
                settings: memory.state.settings,
                maximum: limit,
            });
            for (const item of selected) {
                candidates.push({
                    ...item.event,
                    score: item.score,
                    fromWorldLine: sourceLine,
                    sourceMemoryId: source.memoryId,
                });
            }
        }
        candidates.sort((left, right) => Number(right.score) - Number(left.score)
            || String(right.updatedAt).localeCompare(String(left.updatedAt)));
        return {
            enabled: true,
            currentWorldLine: currentLine,
            memories: candidates.slice(0, limit),
        };
    }

    touchManifest(memoryId) {
        const paths = this.getPaths(memoryId);
        const manifest = readJson(paths.manifest);
        manifest.updatedAt = new Date().toISOString();
        writeJson(paths.manifest, manifest);
    }
}
