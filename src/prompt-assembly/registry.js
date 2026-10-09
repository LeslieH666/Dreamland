/**
 * Prompt registry and ordering (Phase 2.5.2 step 5).
 *
 * Moved verbatim from public/scripts/PromptManager.js: the two default tables and
 * the six methods that select, order and repair the prompt collection. They are
 * now free functions over an explicit `env`.
 *
 * `env` is the PromptManager instance itself: the moved code only ever touched
 * this.serviceSettings, this.activeCharacter, this.configuration and a handful of
 * sibling methods, so passing the instance preserves behaviour exactly with just a
 * this. -> env. rewrite, and the browser keeps its 14 internal call sites and the
 * openai.js callers untouched behind thin delegating methods.
 *
 * The one structural dependency is PromptCollection, a browser class. It is
 * injected as `env.createPromptCollection()` so this module never imports back
 * into public/ (which would be circular).
 */

export const CHAT_COMPLETION_DEFAULT_PROMPTS = {
    'prompts': [
        {
            'name': 'Main Prompt',
            'system_prompt': true,
            'role': 'system',
            'content': 'Write {{char}}\'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.',
            'identifier': 'main',
        },
        {
            'name': 'Auxiliary Prompt',
            'system_prompt': true,
            'role': 'system',
            'content': '',
            'identifier': 'nsfw',
        },
        {
            'identifier': 'dialogueExamples',
            'name': 'Chat Examples',
            'system_prompt': true,
            'marker': true,
        },
        {
            'name': 'Post-History Instructions',
            'system_prompt': true,
            'role': 'system',
            'content': '',
            'identifier': 'jailbreak',
        },
        {
            'identifier': 'chatHistory',
            'name': 'Chat History',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'worldInfoAfter',
            'name': 'World Info (after)',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'worldInfoBefore',
            'name': 'World Info (before)',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'enhanceDefinitions',
            'role': 'system',
            'name': 'Enhance Definitions',
            'content': 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.',
            'system_prompt': true,
            'marker': false,
        },
        {
            'identifier': 'charDescription',
            'name': 'Char Description',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'charPersonality',
            'name': 'Char Personality',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'scenario',
            'name': 'Scenario',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'personaDescription',
            'name': 'Persona Description',
            'system_prompt': true,
            'marker': true,
        },
    ],
};

export const PROMPT_MANAGER_DEFAULT_ORDER = [
    {
        'identifier': 'main',
        'enabled': true,
    },
    {
        'identifier': 'worldInfoBefore',
        'enabled': true,
    },
    {
        'identifier': 'personaDescription',
        'enabled': true,
    },
    {
        'identifier': 'charDescription',
        'enabled': true,
    },
    {
        'identifier': 'charPersonality',
        'enabled': true,
    },
    {
        'identifier': 'scenario',
        'enabled': true,
    },
    {
        'identifier': 'enhanceDefinitions',
        'enabled': false,
    },
    {
        'identifier': 'nsfw',
        'enabled': true,
    },
    {
        'identifier': 'worldInfoAfter',
        'enabled': true,
    },
    {
        'identifier': 'dialogueExamples',
        'enabled': true,
    },
    {
        'identifier': 'chatHistory',
        'enabled': true,
    },
    {
        'identifier': 'jailbreak',
        'enabled': true,
    },
];

export function isPromptDisabledForActiveCharacter(env, identifier) {
    const promptOrderEntry = env.getPromptOrderEntry(env.activeCharacter, identifier);
    if (promptOrderEntry) return !promptOrderEntry.enabled;
    return false;
}

export function sanitizeServiceSettings(env) {
    env.serviceSettings.prompts = env.serviceSettings.prompts ?? [];
    env.serviceSettings.prompt_order = env.serviceSettings.prompt_order ?? [];

    if ('global' === env.configuration.promptOrder.strategy) {
        const dummyCharacter = { id: env.configuration.promptOrder.dummyId };
        const promptOrder = env.getPromptOrderForCharacter(dummyCharacter);

        if (0 === promptOrder.length) env.addPromptOrderForCharacter(dummyCharacter, PROMPT_MANAGER_DEFAULT_ORDER);
    }

    // Check whether the referenced prompts are present.
    env.serviceSettings.prompts.length === 0
        ? env.setPrompts(CHAT_COMPLETION_DEFAULT_PROMPTS.prompts)
        : env.checkForMissingPrompts(env.serviceSettings.prompts);

    // Add identifiers if there are none assigned to a prompt
    env.serviceSettings.prompts.forEach(prompt => prompt && (prompt.identifier = prompt.identifier ?? env.getUuidv4()));

    if (env.activeCharacter) {
        const promptReferences = env.getPromptOrderForCharacter(env.activeCharacter);
        for (let i = promptReferences.length - 1; i >= 0; i--) {
            const reference = promptReferences[i];
            if (reference && -1 === env.serviceSettings.prompts.findIndex(prompt => prompt.identifier === reference.identifier)) {
                promptReferences.splice(i, 1);
                env.log('Removed unused reference: ' + reference.identifier);
            }
        }
    }
}

export function checkForMissingPrompts(env, prompts) {
    const defaultPromptIdentifiers = CHAT_COMPLETION_DEFAULT_PROMPTS.prompts.reduce((list, prompt) => { list.push(prompt.identifier); return list; }, []);

    const missingIdentifiers = defaultPromptIdentifiers.filter(identifier =>
        !prompts.some(prompt => prompt.identifier === identifier),
    );

    missingIdentifiers.forEach(identifier => {
        const defaultPrompt = CHAT_COMPLETION_DEFAULT_PROMPTS.prompts.find(prompt => prompt?.identifier === identifier);
        if (defaultPrompt) {
            prompts.push(defaultPrompt);
            env.log(`Missing system prompt: ${defaultPrompt.identifier}. Added default.`);
        }
    });
}

export function getPromptOrderForCharacter(env, character) {
    return !character ? [] : (env.serviceSettings.prompt_order.find(list => String(list.character_id) === String(character.id))?.order ?? []);
}

export function getPromptCollection(env, generationType) {
    generationType = String(generationType || 'normal').toLowerCase().trim();
    const promptCollection = env.createPromptCollection();
    const promptOrder = env.getPromptOrderForCharacter(env.activeCharacter);

    promptOrder.forEach(entry => {
        const prompt = env.getPromptById(entry.identifier);
        const allowedTrigger = entry.enabled && env.shouldTrigger(prompt, generationType);

        if (!prompt) {
            return;
        }

        if (allowedTrigger) {
            promptCollection.add(env.preparePrompt(prompt));
        } else if (entry.identifier === 'main') {
            // Some extensions require main prompt to be present for relative inserts.
            // So we make a GMO-free vegan replacement.
            const replacementPrompt = structuredClone(prompt);
            replacementPrompt.content = '';
            promptCollection.add(env.preparePrompt(replacementPrompt));
        }
    });

    return promptCollection;
}

export function shouldTrigger(prompt, generationType) {
    if (!Array.isArray(prompt?.injection_trigger)) return true;
    if (!prompt.injection_trigger.length) return true;
    return prompt.injection_trigger.includes(generationType);
}
