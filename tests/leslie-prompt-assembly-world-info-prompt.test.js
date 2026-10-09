import { describe, expect, test } from '@jest/globals';

import { buildWorldInfoPrompt } from '../src/prompt-assembly/world-info-prompt.js';
import { WorldInfoBuffer, WorldInfoTimedEffects } from '../src/prompt-assembly/world-info-state.js';

/** Position values mirrored from the shared enums. */
const POSITION = { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 };

/**
 * Build an entry for the activated map.
 * @param {object} overrides Entry fields.
 * @returns {object} Entry.
 */
function entry(overrides) {
    return { uid: 0, content: 'content', order: 1, position: POSITION.before, ...overrides };
}

/**
 * Build the environment the build phase needs.
 * @param {object} [overrides] Overrides.
 * @returns {object} Environment.
 */
function buildEnv(overrides = {}) {
    const chatMetadata = {};
    return {
        sortFn: (left, right) => right.order - left.order,
        // Identity regex: the browser passes getRegexedString; this test only needs
        // content passthrough to check the position switch.
        getRegexedString: content => content,
        regexPlacement: { worldInfo: 5 },
        getChatMetadata: () => chatMetadata,
        getExtensionSettings: () => ({ note: { allowWIScan: false } }),
        getShouldWIAddPrompt: () => false,
        noteModuleName: '2_floating_prompt',
        metadataKeys: { position: 'note_position', depth: 'note_depth', role: 'note_role' },
        extensionPromptRoles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
        getContext: () => ({ extensionPrompts: { '2_floating_prompt': { value: 'AN' } }, setExtensionPrompt: () => {} }),
        ...overrides,
    };
}

/**
 * Build a scan result around activated entries.
 * @param {object[]} entries Activated entries.
 * @param {object} [env] Environment (for the buffer/timed fakes).
 * @returns {object} Scan-shaped object.
 */
function scan(entries, env = buildEnv()) {
    const activated = new Map(entries.map((item, index) => [`w.${index}`, item]));
    return {
        allActivatedEntries: activated,
        buffer: { resetExternalEffects: () => {} },
        timedEffects: { setTimedEffects: () => {}, cleanUp: () => {} },
        allActivatedText: '',
        sortedEntries: entries,
        budget: 100,
        token_budget_overflowed: false,
        availableRecursionDelayLevels: [],
        currentRecursionDelayLevel: 0,
        scanState: 0,
        __env: env,
    };
}

describe('buildWorldInfoPrompt position switch', () => {
    test('splits before/after entries into their own strings', () => {
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'BEFORE', position: POSITION.before }),
            entry({ uid: 2, content: 'AFTER', position: POSITION.after }),
        ]), false, buildEnv());

        expect(result.worldInfoBefore).toBe('BEFORE');
        expect(result.worldInfoAfter).toBe('AFTER');
    });

    test('sorts by the injected sorter', () => {
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'low', order: 1, position: POSITION.before }),
            entry({ uid: 2, content: 'high', order: 9, position: POSITION.before }),
        ]), false, buildEnv());

        // Entries are sorted descending then unshifted, so the lowest order ends
        // up first in the joined string.
        expect(result.worldInfoBefore).toBe('low\nhigh');
    });

    test('routes example-position entries into EMEntries with the anchor position', () => {
        const top = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'EMTOP', position: POSITION.EMTop }),
        ]), false, buildEnv());
        expect(top.EMEntries).toEqual([{ position: 0, content: 'EMTOP' }]);

        const bottom = buildWorldInfoPrompt(scan([
            entry({ uid: 2, content: 'EMBOTTOM', position: POSITION.EMBottom }),
        ]), false, buildEnv());
        expect(bottom.EMEntries).toEqual([{ position: 1, content: 'EMBOTTOM' }]);
    });

    test('routes author-note positions into ANBefore/ANAfter', () => {
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'TOP', position: POSITION.ANTop }),
            entry({ uid: 2, content: 'BOTTOM', position: POSITION.ANBottom }),
        ]), false, buildEnv());

        expect(result.ANBeforeEntries).toEqual(['TOP']);
        expect(result.ANAfterEntries).toEqual(['BOTTOM']);
    });

    test('routes depth entries into WIDepthEntries with depth and role', () => {
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'DEEP', position: POSITION.atDepth, depth: 3, role: 0 }),
        ]), false, buildEnv());

        expect(result.WIDepthEntries.length).toBe(1);
        expect(result.WIDepthEntries[0].depth).toBe(3);
        expect(result.WIDepthEntries[0].entries).toEqual(['DEEP']);
    });

    test('routes outlet entries by outlet name', () => {
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'OUT', position: POSITION.outlet, outletName: 'myOutlet' }),
        ]), false, buildEnv());

        expect(result.outletEntries).toEqual({ myOutlet: ['OUT'] });
    });

    test('drops entries whose content is empty after the regex step', () => {
        const env = buildEnv({ getRegexedString: () => '' });
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'gone', position: POSITION.before }),
        ]), false, env);

        expect(result.worldInfoBefore).toBe('');
        expect(result.EMEntries).toEqual([]);
    });

    test('exposes the activated entries as a Set for downstream consumers', () => {
        const result = buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'x', position: POSITION.before }),
        ]), false, buildEnv());

        expect(result.allActivatedEntries).toBeInstanceOf(Set);
        expect(result.allActivatedEntries.size).toBe(1);
    });

    test('reroutes author-note entries through the injected setter when enabled', () => {
        const calls = [];
        const env = buildEnv({
            getShouldWIAddPrompt: () => true,
            getContext: () => ({
                extensionPrompts: { '2_floating_prompt': { value: 'ORIGINAL' } },
                setExtensionPrompt: (...args) => calls.push(args),
            }),
        });

        buildWorldInfoPrompt(scan([
            entry({ uid: 1, content: 'TOP', position: POSITION.ANTop }),
        ]), false, env);

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('2_floating_prompt');
        expect(calls[0][1]).toContain('TOP');
        expect(calls[0][1]).toContain('ORIGINAL');
    });
});

describe('buildWorldInfoPrompt side effects', () => {
    test('persists timed effects and cleans up on the real classes', () => {
        const chatMetadata = {};
        const env = buildEnv({ getChatMetadata: () => chatMetadata });
        const buffer = new WorldInfoBuffer([], { trigger: 'normal' }, {
            settings: { worldInfoDepth: 2, worldInfoCaseSensitive: false, worldInfoMatchWholeWords: false },
            escapeRegex: value => String(value),
        });
        const timedEffects = new WorldInfoTimedEffects([], [], false, { getChatMetadata: () => chatMetadata });

        const result = buildWorldInfoPrompt({
            allActivatedEntries: new Map([['w.0', entry({ uid: 1 })] ]),
            buffer,
            timedEffects,
            allActivatedText: '',
            sortedEntries: [],
            budget: 1,
            token_budget_overflowed: false,
            availableRecursionDelayLevels: [],
            currentRecursionDelayLevel: 0,
            scanState: 0,
        }, false, env);

        expect(result.worldInfoBefore).toBe('content');
        expect(chatMetadata.timedWorldInfo).toBeDefined();
    });
});
