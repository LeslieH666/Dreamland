import { describe, expect, test } from '@jest/globals';

import {
    CHAT_COMPLETION_DEFAULT_PROMPTS,
    PROMPT_MANAGER_DEFAULT_ORDER,
    checkForMissingPrompts,
    getPromptCollection,
    getPromptOrderForCharacter,
    isPromptDisabledForActiveCharacter,
    sanitizeServiceSettings,
    shouldTrigger,
} from '../src/prompt-assembly/registry.js';

/**
 * Build an environment that mirrors the PromptManager surface the shared
 * functions use, wiring the cross-calls back to the shared implementations.
 * @param {object} [overrides] Overrides.
 * @returns {object} Environment.
 */
function registryEnv(overrides = {}) {
    const env = {
        serviceSettings: {
            prompts: [],
            prompt_order: [],
        },
        activeCharacter: { id: 100001 },
        configuration: { promptOrder: { strategy: 'global', dummyId: 100001 } },
        log: () => {},
        getUuidv4: (() => {
            let counter = 0;
            return () => `uuid-${++counter}`;
        })(),
        getPromptById(identifier) {
            return env.serviceSettings.prompts.find(prompt => prompt.identifier === identifier);
        },
        getPromptOrderEntry(character, identifier) {
            const entry = getPromptOrderForCharacter(env, character);
            return entry.find(item => item.identifier === identifier);
        },
        addPromptOrderForCharacter(character, order) {
            env.serviceSettings.prompt_order.push({
                character_id: character.id,
                order: structuredClone(order),
            });
        },
        setPrompts(prompts) {
            env.serviceSettings.prompts = structuredClone(prompts);
        },
        preparePrompt: prompt => prompt,
        createPromptCollection() {
            const items = [];
            return {
                items,
                add(prompt) {
                    items.push(prompt);
                },
            };
        },
        ...overrides,
    };
    env.getPromptOrderForCharacter = character => getPromptOrderForCharacter(env, character);
    env.checkForMissingPrompts = prompts => checkForMissingPrompts(env, prompts);
    env.shouldTrigger = (prompt, generationType) => shouldTrigger(prompt, generationType);
    return env;
}

describe('moved default tables', () => {
    test('the default prompt order lists the twelve built-in slots in order', () => {
        expect(PROMPT_MANAGER_DEFAULT_ORDER.map(item => item.identifier)).toEqual([
            'main', 'worldInfoBefore', 'personaDescription', 'charDescription',
            'charPersonality', 'scenario', 'enhanceDefinitions', 'nsfw',
            'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak',
        ]);
        expect(PROMPT_MANAGER_DEFAULT_ORDER.every(item => typeof item.enabled === 'boolean')).toBe(true);
    });

    test('the default prompt set carries the built-in identifiers', () => {
        const identifiers = CHAT_COMPLETION_DEFAULT_PROMPTS.prompts.map(prompt => prompt.identifier);
        expect(identifiers).toContain('main');
        expect(identifiers).toContain('jailbreak');
        expect(CHAT_COMPLETION_DEFAULT_PROMPTS.prompts.length).toBeGreaterThan(8);
    });
});

describe('getPromptOrderForCharacter', () => {
    test('returns the order entry for the character', () => {
        const env = registryEnv();
        env.addPromptOrderForCharacter({ id: 7 }, [{ identifier: 'main', enabled: true }]);
        expect(getPromptOrderForCharacter(env, { id: 7 })).toEqual([{ identifier: 'main', enabled: true }]);
    });

    test('returns an empty array for an unknown character', () => {
        expect(getPromptOrderForCharacter(registryEnv(), { id: 999 })).toEqual([]);
    });
});

describe('shouldTrigger', () => {
    test('a prompt without triggers always runs', () => {
        expect(shouldTrigger({ identifier: 'main' }, 'normal')).toBe(true);
    });

    test('a prompt with triggers only runs for a matching generation type', () => {
        const prompt = { identifier: 'x', injection_trigger: ['normal'] };
        expect(shouldTrigger(prompt, 'normal')).toBe(true);
        expect(shouldTrigger(prompt, 'continue')).toBe(false);
    });
});

describe('sanitizeServiceSettings', () => {
    test('seeds the default prompts when none are configured', () => {
        const env = registryEnv();
        sanitizeServiceSettings(env);
        expect(env.serviceSettings.prompts.length).toBe(CHAT_COMPLETION_DEFAULT_PROMPTS.prompts.length);
    });

    test('creates the default prompt order for the dummy character when empty', () => {
        const env = registryEnv();
        sanitizeServiceSettings(env);
        const entry = env.serviceSettings.prompt_order.find(item => item.character_id === 100001);
        expect(entry).toBeDefined();
        expect(entry.order.map(item => item.identifier)).toEqual(PROMPT_MANAGER_DEFAULT_ORDER.map(item => item.identifier));
    });

    test('assigns identifiers to prompts that have none', () => {
        const env = registryEnv({ serviceSettings: { prompts: [{ role: 'system', content: 'x' }], prompt_order: [] } });
        sanitizeServiceSettings(env);
        expect(typeof env.serviceSettings.prompts[0].identifier).toBe('string');
        expect(env.serviceSettings.prompts[0].identifier.length).toBeGreaterThan(0);
    });
});

describe('checkForMissingPrompts', () => {
    test('appends the built-in prompts that are missing', () => {
        const env = registryEnv();
        const prompts = [{ identifier: 'main' }];
        checkForMissingPrompts(env, prompts);
        const identifiers = prompts.map(prompt => prompt.identifier);
        expect(identifiers).toContain('jailbreak');
        expect(identifiers.filter(id => id === 'main').length).toBe(1);
    });
});

describe('isPromptDisabledForActiveCharacter', () => {
    test('reflects the character order entry when present', () => {
        const env = registryEnv();
        env.addPromptOrderForCharacter(env.activeCharacter, [{ identifier: 'main', enabled: false }]);
        expect(isPromptDisabledForActiveCharacter(env, 'main')).toBe(true);
    });

    test('treats an unlisted prompt as enabled', () => {
        const env = registryEnv();
        env.addPromptOrderForCharacter(env.activeCharacter, [{ identifier: 'main', enabled: true }]);
        expect(isPromptDisabledForActiveCharacter(env, 'absent')).toBe(false);
    });
});

describe('getPromptCollection', () => {
    test('adds only the enabled and triggered prompts', () => {
        const env = registryEnv();
        env.setPrompts([{ identifier: 'main', content: 'M' }, { identifier: 'nsfw', content: 'N' }]);
        env.addPromptOrderForCharacter(env.activeCharacter, [
            { identifier: 'main', enabled: true },
            { identifier: 'nsfw', enabled: false },
        ]);

        const collection = getPromptCollection(env, 'normal');
        expect(collection.items.map(item => item.identifier)).toEqual(['main']);
    });

    test('substitutes an empty placeholder for a disabled main prompt', () => {
        const env = registryEnv();
        env.setPrompts([{ identifier: 'main', content: 'M' }]);
        env.addPromptOrderForCharacter(env.activeCharacter, [{ identifier: 'main', enabled: false }]);

        const collection = getPromptCollection(env, 'normal');
        expect(collection.items.length).toBe(1);
        expect(collection.items[0].identifier).toBe('main');
        expect(collection.items[0].content).toBe('');
    });

    test('normalises the generation type before triggering', () => {
        const env = registryEnv();
        env.setPrompts([{ identifier: 'main', content: 'M' }]);
        env.addPromptOrderForCharacter(env.activeCharacter, [{ identifier: 'main', enabled: true }]);
        expect(getPromptCollection(env, '  NORMAL  ').items.length).toBe(1);
    });
});
