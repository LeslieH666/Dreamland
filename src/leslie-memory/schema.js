import { randomUUID } from 'node:crypto';

export const MEMORY_SCHEMA_VERSION = 5;
export const MEMORY_LEVELS = Object.freeze(['A', 'B', 'C']);
export const MEMORY_STATUSES = Object.freeze(['active', 'pending', 'archived', 'invalid', 'superseded']);
export const MEMORY_MODEL_PROVIDERS = Object.freeze(['chat', 'local', 'deepseek', 'openai-compatible']);
export const RELATIONSHIP_DIMENSIONS = Object.freeze(['affection', 'trust', 'intimacy', 'rapport', 'security', 'bond']);

const MAX_SUMMARY_LENGTH = 2000;
const MAX_LABEL_LENGTH = 120;

function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function cleanString(value, maximumLength = MAX_SUMMARY_LENGTH) {
    return String(value ?? '').trim().slice(0, maximumLength);
}

function cleanStringArray(value, maximumItems = 24, maximumLength = MAX_LABEL_LENGTH) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value
        .map(item => cleanString(item, maximumLength))
        .filter(Boolean))]
        .slice(0, maximumItems);
}

function cleanSource(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => ({
            messageId: Number.isInteger(Number(item?.messageId)) ? Math.max(0, Number(item.messageId)) : null,
            swipeId: Number.isInteger(Number(item?.swipeId)) ? Math.max(0, Number(item.swipeId)) : null,
            hash: cleanString(item?.hash, 128),
        }))
        .filter(item => item.messageId !== null)
        .slice(0, 32);
}

function cleanCandidateChange(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const candidate = {
        area: cleanString(value.area, MAX_LABEL_LENGTH),
        current: cleanString(value.current),
        proposed: cleanString(value.proposed),
        reason: cleanString(value.reason),
    };

    return Object.values(candidate).some(Boolean) ? candidate : null;
}

export function normalizeRelationshipImpact(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const sourceChanges = value.changes && typeof value.changes === 'object' && !Array.isArray(value.changes)
        ? value.changes
        : {};
    const changes = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [
        dimension,
        Math.round(clampNumber(sourceChanges[dimension], -3, 3, 0)),
    ]));
    return {
        version: 1,
        changes,
        reason: cleanString(value.reason, 1000),
        targets: cleanStringArray(value.targets, 24, 500),
        source: ['ai-extraction', 'api-conversion', 'manual'].includes(value.source) ? value.source : 'ai-extraction',
        analyzedAt: cleanString(value.analyzedAt, 64) || new Date().toISOString(),
        revoked: value.revoked === true,
    };
}

export function isMemoryId(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function assertMemoryId(value) {
    if (!isMemoryId(value)) {
        throw new TypeError('Invalid Leslie memory id.');
    }
    return value;
}

export function normalizeIdentityBinding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const requiredIds = ['storyScopeId', 'personaId', 'counterpartId'];
    for (const field of requiredIds) {
        if (!isMemoryId(value[field])) {
            throw new TypeError(`Invalid Leslie identity binding field: ${field}.`);
        }
    }
    const counterpartType = ['character', 'group'].includes(value.counterpartType) ? value.counterpartType : null;
    if (!counterpartType) {
        throw new TypeError('Invalid Leslie identity binding counterpart type.');
    }
    return {
        domain: 'story',
        worldLine: value.worldLine === 'reality' ? 'reality' : 'story',
        storyScopeId: value.storyScopeId,
        personaId: value.personaId,
        personaSourceKey: cleanString(value.personaSourceKey, 500),
        personaName: cleanString(value.personaName, 300),
        counterpartId: value.counterpartId,
        counterpartType,
        counterpartSourceKey: cleanString(value.counterpartSourceKey, 500),
        counterpartName: cleanString(value.counterpartName, 300),
        confirmed: value.confirmed === true,
        boundAt: cleanString(value.boundAt, 64) || new Date().toISOString(),
    };
}

export function normalizeCoreSnapshot(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        name: cleanString(source.name, 300),
        avatar: cleanString(source.avatar, 500),
        description: cleanString(source.description, 20_000),
        personality: cleanString(source.personality, 20_000),
        scenario: cleanString(source.scenario, 20_000),
        mesExample: cleanString(source.mesExample ?? source.mes_example, 40_000),
        characterNote: cleanString(source.characterNote ?? source.character_note, 10_000),
    };
}

export function createInitialGrowth() {
    return {
        summary: '',
        relationship: '',
        traits: [],
        beliefs: [],
        goals: [],
        emotionalBaseline: '',
        unresolvedThreads: [],
        boundaries: [],
        evidenceEventIds: [],
    };
}

export function normalizeGrowth(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        summary: cleanString(source.summary, 4000),
        relationship: cleanString(source.relationship, 3000),
        traits: cleanStringArray(source.traits, 40, 500),
        beliefs: cleanStringArray(source.beliefs, 40, 500),
        goals: cleanStringArray(source.goals, 40, 500),
        emotionalBaseline: cleanString(source.emotionalBaseline, 2000),
        unresolvedThreads: cleanStringArray(source.unresolvedThreads, 40, 500),
        boundaries: cleanStringArray(source.boundaries, 40, 500),
        evidenceEventIds: cleanStringArray(source.evidenceEventIds, 200, 64),
    };
}

export function createInitialMemoryModelSettings() {
    return {
        provider: 'chat',
        endpoint: '',
        model: '',
        apiKey: '',
        temperature: 0.2,
        responseTokens: 1400,
    };
}

export function normalizeMemoryModelSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const defaults = createInitialMemoryModelSettings();
    return {
        provider: MEMORY_MODEL_PROVIDERS.includes(source.provider) ? source.provider : defaults.provider,
        endpoint: cleanString(source.endpoint, 1000),
        model: cleanString(source.model, 500),
        apiKey: cleanString(source.apiKey, 1000),
        temperature: clampNumber(source.temperature, 0, 1, defaults.temperature),
        responseTokens: Math.round(clampNumber(source.responseTokens, 256, 4096, defaults.responseTokens)),
    };
}

export function createInitialState() {
    const now = new Date().toISOString();
    return {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        revision: 0,
        enabled: false,
        growth: createInitialGrowth(),
        analysis: {
            autoExtract: false,
            interval: 4,
            lastAnalyzedMessageId: -1,
            lastRunAt: null,
            lastError: null,
        },
        settings: {
            memoryBudgetTokens: 1200,
            contextShare: 0.12,
            maxMemories: 8,
            crossLineMemoryEnabled: true,
            crossLineMaxMemories: 2,
            bDecayTurns: 40,
            cDecayTurns: 8,
            memoryModel: createInitialMemoryModelSettings(),
        },
        relationship: {
            enabled: false,
            experimental: true,
            calculatorVersion: 1,
            conversion: {
                status: 'not-started',
                convertedAt: null,
                convertedEventCount: 0,
                lastError: null,
            },
        },
        createdAt: now,
        updatedAt: now,
    };
}

export function normalizeMemoryState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const initial = createInitialState();
    const settings = source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)
        ? source.settings
        : {};
    const analysis = source.analysis && typeof source.analysis === 'object' && !Array.isArray(source.analysis)
        ? source.analysis
        : {};
    const relationship = source.relationship && typeof source.relationship === 'object' && !Array.isArray(source.relationship)
        ? source.relationship
        : {};
    const conversion = relationship.conversion && typeof relationship.conversion === 'object' && !Array.isArray(relationship.conversion)
        ? relationship.conversion
        : {};
    const now = new Date().toISOString();
    return {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        revision: Math.round(clampNumber(source.revision, 0, Number.MAX_SAFE_INTEGER, initial.revision)),
        enabled: source.enabled === true,
        growth: normalizeGrowth(source.growth),
        analysis: {
            autoExtract: analysis.autoExtract === true,
            interval: Math.round(clampNumber(analysis.interval, 1, 100, initial.analysis.interval)),
            lastAnalyzedMessageId: Math.round(clampNumber(analysis.lastAnalyzedMessageId, -1, Number.MAX_SAFE_INTEGER, initial.analysis.lastAnalyzedMessageId)),
            lastRunAt: analysis.lastRunAt ? cleanString(analysis.lastRunAt, 64) : null,
            lastError: analysis.lastError ? cleanString(analysis.lastError, 2000) : null,
        },
        settings: {
            memoryBudgetTokens: Math.round(clampNumber(settings.memoryBudgetTokens, 128, 8000, initial.settings.memoryBudgetTokens)),
            contextShare: clampNumber(settings.contextShare, 0.02, 0.3, initial.settings.contextShare),
            maxMemories: Math.round(clampNumber(settings.maxMemories, 1, 30, initial.settings.maxMemories)),
            crossLineMemoryEnabled: settings.crossLineMemoryEnabled !== false,
            crossLineMaxMemories: Math.round(clampNumber(settings.crossLineMaxMemories, 1, 3, initial.settings.crossLineMaxMemories)),
            bDecayTurns: Math.round(clampNumber(settings.bDecayTurns, 4, 500, initial.settings.bDecayTurns)),
            cDecayTurns: Math.round(clampNumber(settings.cDecayTurns, 1, 100, initial.settings.cDecayTurns)),
            memoryModel: normalizeMemoryModelSettings(settings.memoryModel),
        },
        relationship: {
            enabled: relationship.enabled === true,
            experimental: true,
            calculatorVersion: 1,
            conversion: {
                status: ['not-started', 'running', 'completed', 'error'].includes(conversion.status) ? conversion.status : 'not-started',
                convertedAt: conversion.convertedAt ? cleanString(conversion.convertedAt, 64) : null,
                convertedEventCount: Math.round(clampNumber(conversion.convertedEventCount, 0, 100_000, 0)),
                lastError: conversion.lastError ? cleanString(conversion.lastError, 2000) : null,
            },
        },
        createdAt: cleanString(source.createdAt, 64) || now,
        updatedAt: cleanString(source.updatedAt, 64) || now,
    };
}

export function mergeState(current, patch) {
    const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const base = normalizeMemoryState(current);
    const currentSource = current && typeof current === 'object' && !Array.isArray(current) ? structuredClone(current) : {};
    const next = {
        ...currentSource,
        ...base,
        growth: { ...(currentSource.growth ?? {}), ...base.growth },
        analysis: { ...(currentSource.analysis ?? {}), ...base.analysis },
        settings: { ...(currentSource.settings ?? {}), ...base.settings },
        relationship: {
            ...(currentSource.relationship ?? {}),
            ...base.relationship,
            conversion: {
                ...(currentSource.relationship?.conversion ?? {}),
                ...base.relationship.conversion,
            },
        },
    };

    if (typeof source.enabled === 'boolean') {
        next.enabled = source.enabled;
    }
    if (source.growth !== undefined) {
        next.growth = normalizeGrowth(source.growth);
    }
    if (source.analysis && typeof source.analysis === 'object' && !Array.isArray(source.analysis)) {
        if (typeof source.analysis.autoExtract === 'boolean') {
            next.analysis.autoExtract = source.analysis.autoExtract;
        }
        if (source.analysis.interval !== undefined) {
            next.analysis.interval = Math.round(clampNumber(source.analysis.interval, 1, 100, next.analysis.interval));
        }
        if (source.analysis.lastAnalyzedMessageId !== undefined) {
            next.analysis.lastAnalyzedMessageId = Math.round(clampNumber(source.analysis.lastAnalyzedMessageId, -1, Number.MAX_SAFE_INTEGER, next.analysis.lastAnalyzedMessageId));
        }
        if (source.analysis.lastRunAt !== undefined) {
            next.analysis.lastRunAt = source.analysis.lastRunAt ? cleanString(source.analysis.lastRunAt, 64) : null;
        }
        if (source.analysis.lastError !== undefined) {
            next.analysis.lastError = source.analysis.lastError ? cleanString(source.analysis.lastError, 2000) : null;
        }
    }
    if (source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)) {
        const settings = source.settings;
        if (settings.memoryBudgetTokens !== undefined) {
            next.settings.memoryBudgetTokens = Math.round(clampNumber(settings.memoryBudgetTokens, 128, 8000, next.settings.memoryBudgetTokens));
        }
        if (settings.contextShare !== undefined) {
            next.settings.contextShare = clampNumber(settings.contextShare, 0.02, 0.3, next.settings.contextShare);
        }
        if (settings.maxMemories !== undefined) {
            next.settings.maxMemories = Math.round(clampNumber(settings.maxMemories, 1, 30, next.settings.maxMemories));
        }
        if (settings.crossLineMemoryEnabled !== undefined) {
            next.settings.crossLineMemoryEnabled = settings.crossLineMemoryEnabled !== false;
        }
        if (settings.crossLineMaxMemories !== undefined) {
            next.settings.crossLineMaxMemories = Math.round(clampNumber(settings.crossLineMaxMemories, 1, 3, next.settings.crossLineMaxMemories));
        }
        if (settings.bDecayTurns !== undefined) {
            next.settings.bDecayTurns = Math.round(clampNumber(settings.bDecayTurns, 4, 500, next.settings.bDecayTurns));
        }
        if (settings.cDecayTurns !== undefined) {
            next.settings.cDecayTurns = Math.round(clampNumber(settings.cDecayTurns, 1, 100, next.settings.cDecayTurns));
        }
        if (settings.memoryModel !== undefined) {
            next.settings.memoryModel = normalizeMemoryModelSettings(settings.memoryModel);
        }
    }
    if (source.relationship && typeof source.relationship === 'object' && !Array.isArray(source.relationship)) {
        if (typeof source.relationship.enabled === 'boolean') {
            next.relationship.enabled = source.relationship.enabled;
        }
        const conversion = source.relationship.conversion;
        if (conversion && typeof conversion === 'object' && !Array.isArray(conversion)) {
            if (['not-started', 'running', 'completed', 'error'].includes(conversion.status)) {
                next.relationship.conversion.status = conversion.status;
            }
            if (conversion.convertedAt !== undefined) {
                next.relationship.conversion.convertedAt = conversion.convertedAt ? cleanString(conversion.convertedAt, 64) : null;
            }
            if (conversion.convertedEventCount !== undefined) {
                next.relationship.conversion.convertedEventCount = Math.round(clampNumber(conversion.convertedEventCount, 0, 100_000, next.relationship.conversion.convertedEventCount));
            }
            if (conversion.lastError !== undefined) {
                next.relationship.conversion.lastError = conversion.lastError ? cleanString(conversion.lastError, 2000) : null;
            }
        }
    }

    next.schemaVersion = MEMORY_SCHEMA_VERSION;
    next.revision = Number(base.revision ?? 0) + 1;
    next.updatedAt = new Date().toISOString();
    return next;
}

export function normalizeEvent(value, { previous = null, sourceType = 'manual' } = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const now = new Date().toISOString();
    const level = MEMORY_LEVELS.includes(String(source.level).toUpperCase()) ? String(source.level).toUpperCase() : (previous?.level ?? 'C');
    const requestedStatus = MEMORY_STATUSES.includes(source.status) ? source.status : null;
    const defaultStatus = 'active';
    const status = requestedStatus ?? previous?.status ?? defaultStatus;

    const event = {
        id: isMemoryId(source.id) ? source.id : (previous?.id ?? randomUUID()),
        summary: cleanString(source.summary ?? previous?.summary),
        level,
        importance: Math.round(clampNumber(source.importance, 0, 100, previous?.importance ?? ({ A: 90, B: 60, C: 30 }[level]))),
        confidence: clampNumber(source.confidence, 0, 1, previous?.confidence ?? (sourceType === 'manual' ? 1 : 0.7)),
        participants: cleanStringArray(source.participants ?? previous?.participants),
        tags: cleanStringArray(source.tags ?? previous?.tags),
        source: cleanSource(source.source ?? previous?.source),
        sourceType: ['manual', 'ai', 'import'].includes(source.sourceType) ? source.sourceType : (previous?.sourceType ?? sourceType),
        status,
        approved: typeof source.approved === 'boolean' ? source.approved : (previous?.approved ?? (status === 'active' && level === 'A')),
        autoApprovedAt: cleanString(source.autoApprovedAt ?? previous?.autoApprovedAt, 64) || null,
        pinned: typeof source.pinned === 'boolean' ? source.pinned : (previous?.pinned ?? false),
        reinforcement: Math.round(clampNumber(source.reinforcement, 1, 1000, previous?.reinforcement ?? 1)),
        candidateChange: cleanCandidateChange(source.candidateChange ?? previous?.candidateChange),
        relationshipImpact: source.relationshipImpact === null
            ? null
            : normalizeRelationshipImpact(source.relationshipImpact ?? previous?.relationshipImpact),
        supersedes: cleanStringArray(source.supersedes ?? previous?.supersedes, 50, 64),
        createdAt: previous?.createdAt ?? (cleanString(source.createdAt, 64) || now),
        updatedAt: now,
    };

    if (!event.summary) {
        throw new TypeError('A Leslie memory event requires a summary.');
    }
    if (event.level === 'A' && sourceType === 'ai' && source.approved === undefined) {
        event.approved = true;
        event.status = 'active';
        event.autoApprovedAt = event.autoApprovedAt || now;
    } else if (event.level === 'A' && !event.approved && event.status === 'active') {
        event.status = 'pending';
    }
    if (event.level !== 'A') {
        event.approved = true;
    }
    return event;
}
