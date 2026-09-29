import { RELATIONSHIP_DIMENSIONS, normalizeRelationshipImpact } from './schema.js';

export const RELATIONSHIP_CALCULATOR_VERSION = 1;

export const RELATIONSHIP_LABELS = Object.freeze({
    affection: '好感度',
    trust: '信任度',
    intimacy: '亲密度',
    rapport: '默契度',
    security: '安全感',
    bond: '羁绊度',
});

const LEVEL_BUDGETS = Object.freeze({ A: 12, B: 5, C: 1.5 });
const OVERALL_WEIGHTS = Object.freeze({
    affection: 0.25,
    trust: 0.2,
    intimacy: 0.15,
    rapport: 0.15,
    security: 0.15,
    bond: 0.1,
});

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function roundScore(value) {
    return Math.round(clamp(value, 0, 100) * 10) / 10;
}

function getLastSourceMessageId(event) {
    const ids = (event.source ?? []).map(item => Number(item?.messageId)).filter(Number.isFinite);
    return ids.length ? Math.max(...ids) : 0;
}

function getReinforcementFactor(event) {
    return 1 + Math.min(0.3, Math.log2(Math.max(1, Number(event.reinforcement ?? 1))) * 0.1);
}

function getEventBudget(event) {
    const base = LEVEL_BUDGETS[event.level] ?? 0;
    const importance = clamp(Number(event.importance ?? 0), 0, 100);
    const confidence = clamp(Number(event.confidence ?? 0), 0, 1);
    return base * (0.6 + (0.4 * importance / 100)) * confidence * getReinforcementFactor(event);
}

function splitEventBudget(event) {
    const impact = normalizeRelationshipImpact(event.relationshipImpact);
    if (!impact || impact.revoked) {
        return null;
    }
    const denominator = RELATIONSHIP_DIMENSIONS.reduce((sum, dimension) => sum + Math.abs(impact.changes[dimension]), 0);
    if (!denominator) {
        return { impact, changes: Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, 0])) };
    }
    const budget = getEventBudget(event);
    return {
        impact,
        changes: Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [
            dimension,
            budget * impact.changes[dimension] / denominator,
        ])),
    };
}

function positiveGrowthMultiplier(current) {
    if (current >= 90) {
        return 0.2;
    }
    if (current >= 80) {
        return 0.4;
    }
    if (current >= 60) {
        return 0.65;
    }
    return 1;
}

function getStage(overall, scores) {
    let key = 'unestablished';
    let label = '尚未建立';
    if (overall >= 85) {
        key = 'stable';
        label = '稳固';
    } else if (overall >= 70) {
        key = 'deep';
        label = '深厚';
    } else if (overall >= 50) {
        key = 'close';
        label = '亲近';
    } else if (overall >= 30) {
        key = 'familiar';
        label = '熟悉';
    } else if (overall >= 10) {
        key = 'new';
        label = '初识';
    }

    if (key === 'stable' && (scores.trust < 70 || scores.security < 70 || scores.bond < 70)) {
        return getStage(84.9, scores);
    }
    if (key === 'deep' && (scores.trust < 50 || scores.security < 50 || scores.bond < 40)) {
        return getStage(69.9, scores);
    }
    if (key === 'close' && (scores.trust < 30 || scores.security < 30)) {
        return getStage(49.9, scores);
    }
    return { key, label };
}

function isLongTermEvent(event) {
    return ['A', 'B'].includes(event.level)
        && ['active', 'archived'].includes(event.status)
        && (event.level !== 'A' || event.approved === true);
}

function isRecentEvent(event) {
    return event.level === 'C' && event.status === 'active';
}

export function calculateRelationship(events, state, { currentMessageId = 0 } = {}) {
    const sortedEvents = [...(Array.isArray(events) ? events : [])]
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.id).localeCompare(String(right.id)));
    const longTerm = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, 0]));
    const recent = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, 0]));
    const changes = [];
    let convertedEventCount = 0;

    for (const event of sortedEvents) {
        const allocation = splitEventBudget(event);
        if (!allocation) {
            continue;
        }
        convertedEventCount++;
        if (!isLongTermEvent(event) && !isRecentEvent(event)) {
            continue;
        }

        const applied = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, 0]));
        if (isLongTermEvent(event)) {
            for (const dimension of RELATIONSHIP_DIMENSIONS) {
                const raw = allocation.changes[dimension];
                const delta = raw > 0 ? raw * positiveGrowthMultiplier(longTerm[dimension]) : raw;
                longTerm[dimension] = clamp(longTerm[dimension] + delta, 0, 100);
                applied[dimension] = delta;
            }
        } else {
            const age = Math.max(0, Number(currentMessageId || 0) - getLastSourceMessageId(event));
            const decayTurns = Math.max(1, Number(state?.settings?.cDecayTurns ?? 8));
            const decay = Math.exp(-age / decayTurns);
            for (const dimension of RELATIONSHIP_DIMENSIONS) {
                const delta = allocation.changes[dimension] * decay;
                recent[dimension] += delta;
                applied[dimension] = delta;
            }
        }
        changes.push({
            eventId: event.id,
            level: event.level,
            summary: event.summary,
            reason: allocation.impact.reason,
            createdAt: event.createdAt,
            changes: Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, Math.round(applied[dimension] * 100) / 100])),
        });
    }

    for (const dimension of RELATIONSHIP_DIMENSIONS) {
        recent[dimension] = clamp(recent[dimension], -10, 10);
    }
    const scores = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [
        dimension,
        roundScore(longTerm[dimension] + recent[dimension]),
    ]));
    const overall = roundScore(RELATIONSHIP_DIMENSIONS.reduce((sum, dimension) => sum + (scores[dimension] * OVERALL_WEIGHTS[dimension]), 0));

    return {
        enabled: state?.relationship?.enabled === true,
        experimental: true,
        calculatorVersion: RELATIONSHIP_CALCULATOR_VERSION,
        dimensions: scores,
        longTerm: Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, roundScore(longTerm[dimension])])),
        recent: Object.fromEntries(RELATIONSHIP_DIMENSIONS.map(dimension => [dimension, Math.round(recent[dimension] * 10) / 10])),
        overall,
        stage: getStage(overall, scores),
        convertedEventCount,
        totalEventCount: sortedEvents.length,
        changes: changes.reverse().slice(0, 30),
    };
}
