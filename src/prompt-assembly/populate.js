/**
 * Chat-completion prompt population (Phase 2.5.2 step 6b).
 *
 * populationInjectionPrompts, populateChatHistory, populateDialogueExamples,
 * populateChatCompletion and preparePromptsForChatCompletion move here, together with
 * the three helpers and the enums they need. Each function takes the browser
 * environment as its last argument, so openai.js keeps its call sites behind thin
 * wrappers.
 *
 * Prompt assembly is now free of the page's ambient state: settings, the prompt
 * manager, the tool registry, provider capability probes and the mutable bindings
 * (power_user, selected_group) all arrive through env, while the pieces that are
 * already shared are imported directly — Message/MessageCollection from
 * chat-completion.js, the macro engine from macros.js and the extension-prompt core
 * from extension-prompts.js.
 *
 * name2 needs no injection: its only occurrence in this cluster is the parameter of
 * preparePromptsForChatCompletion, so the module-level binding was never read here.
 */

import { Message, MessageCollection } from './chat-completion.js';
import { ExtensionPromptRole as extension_prompt_roles, ExtensionPromptType as extension_prompt_types } from './enums.js';


export const character_names_behavior = {
    NONE: -1,
    DEFAULT: 0,
    COMPLETION: 1,
    CONTENT: 2,
};


export async function populationInjectionPromptsCore(prompts, messages, env) {
    // Phase 2.5.2 step 6b: work on a copy so the caller's array is never mutated.
    messages = [...messages];
    let totalInsertedMessages = 0;

    const roleTypes = {
        'system': extension_prompt_roles.SYSTEM,
        'user': extension_prompt_roles.USER,
        'assistant': extension_prompt_roles.ASSISTANT,
    };

    const maxDepth = env.getExtensionPromptMaxDepth();
    for (let i = 0; i <= maxDepth; i++) {
        // Get prompts for current depth
        const depthPrompts = prompts.filter(prompt => prompt.injection_depth === i && prompt.content);

        const roleMessages = [];
        const separator = '\n';
        const wrap = false;

        // Group prompts by priority
        const extensionPromptsOrder = '100';
        const orderGroups = {
            [extensionPromptsOrder]: [],
        };
        for (const prompt of depthPrompts) {
            const order = prompt.injection_order ?? 100;
            if (!orderGroups[order]) {
                orderGroups[order] = [];
            }
            orderGroups[order].push(prompt);
        }

        // Process each order group in order (b - a = low to high ; a - b = high to low)
        const orders = Object.keys(orderGroups).sort((a, b) => +b - +a);
        for (const order of orders) {
            const orderPrompts = orderGroups[order];

            // Order of priority for roles (most important go lower)
            const roles = ['system', 'user', 'assistant'];
            for (const role of roles) {
                const rolePrompts = orderPrompts
                    .filter(prompt => prompt.role === role)
                    .map(x => x.content)
                    .join(separator);

                // Get extension prompt
                const extensionPrompt = order === extensionPromptsOrder
                    ? await env.getExtensionPrompt(extension_prompt_types.IN_CHAT, i, separator, roleTypes[role], wrap)
                    : '';
                const jointPrompt = [rolePrompts, extensionPrompt].filter(x => x).map(x => x.trim()).join(separator);

                if (jointPrompt && jointPrompt.length) {
                    roleMessages.push({ 'role': role, 'content': jointPrompt, injected: true });
                }
            }
        }

        if (roleMessages.length) {
            const injectIdx = i + totalInsertedMessages;
            messages.splice(injectIdx, 0, ...roleMessages);
            totalInsertedMessages += roleMessages.length;
        }
    }

    messages = messages.reverse();
    return messages;
}

export async function populateChatHistoryCore(messages, prompts, chatCompletion, type = null, cyclePrompt = null, env) {
    if (!prompts.has('chatHistory')) {
        return;
    }

    chatCompletion.add(new MessageCollection('chatHistory'), prompts.index('chatHistory'));

    // Reserve budget for new chat message
    const newChat = env.getSelectedGroup() ? env.getOaiSettings().new_group_chat_prompt : env.getOaiSettings().new_chat_prompt;
    const newChatMessage = await Message.createAsync('system', env.substituteParams(newChat), 'newMainChat');
    chatCompletion.reserveBudget(newChatMessage);

    // Reserve budget for group nudge
    let groupNudgeMessage = null;
    const noGroupNudgeTypes = ['impersonate'];
    if (env.getSelectedGroup() && prompts.has('groupNudge') && !noGroupNudgeTypes.includes(type)) {
        groupNudgeMessage = await Message.fromPromptAsync(prompts.get('groupNudge'));
        chatCompletion.reserveBudget(groupNudgeMessage);
    }

    // Reserve budget for continue nudge
    let continueMessageCollection = null;
    if (type === 'continue' && cyclePrompt && !env.getOaiSettings().continue_prefill) {
        const promptObject = {
            identifier: 'continueNudge',
            role: 'system',
            content: env.substituteParamsExtended(env.getOaiSettings().continue_nudge_prompt, { lastChatMessage: String(cyclePrompt).trim() }),
            system_prompt: true,
        };
        continueMessageCollection = new MessageCollection('continueNudge');
        const continueMessageIndex = messages.findLastIndex(x => !x.injected);
        if (continueMessageIndex >= 0) {
            const continueMessage = messages[continueMessageIndex];
            // Removed through a copy (was an in-place splice of the caller's array).
            messages = [...messages.slice(0, continueMessageIndex), ...messages.slice(continueMessageIndex + 1)];
            const prompt = new env.Prompt(continueMessage);
            const chatMessage = await Message.fromPromptAsync(env.getPromptManager().preparePrompt(prompt));
            continueMessageCollection.add(chatMessage);
        }
        const continueNudgePrompt = new env.Prompt(promptObject);
        const preparedNudgePrompt = env.getPromptManager().preparePrompt(continueNudgePrompt);
        const continueNudgeMessage = await Message.fromPromptAsync(preparedNudgePrompt);
        continueMessageCollection.add(continueNudgeMessage);
        chatCompletion.reserveBudget(continueMessageCollection);
    }

    const lastChatPrompt = messages[messages.length - 1];
    const message = await Message.createAsync('user', env.getOaiSettings().send_if_empty, 'emptyUserMessageReplacement');
    if (lastChatPrompt && lastChatPrompt.role === 'assistant' && env.getOaiSettings().send_if_empty && chatCompletion.canAfford(message)) {
        chatCompletion.insert(message, 'chatHistory');
    }

    const imageInlining = env.isImageInliningSupported();
    const videoInlining = env.isVideoInliningSupported();
    const audioInlining = env.isAudioInliningSupported();
    const canUseTools = env.toolManager.isToolCallingSupported();
    const includeSignature = env.isReasoningSignatureSupported();
    const isToolReasoningProvider = env.interleavedReasoningProviders.includes(env.getOaiSettings().chat_completion_source);
    const toolReasoningMode = isToolReasoningProvider
        ? env.getEffectiveToolReasoningMode()
        : env.toolReasoningModes.DISABLED;
    const includeToolReasoning = toolReasoningMode !== env.toolReasoningModes.DISABLED;
    const lastUserIdx = messages.findLastIndex(x => x.role === 'user');

    // Insert chat messages as long as there is budget available
    const chatPool = [...messages].reverse();
    for (let index = 0; index < chatPool.length; index++) {
        const chatPrompt = chatPool[index];

        // We do not want to mutate the prompt
        const prompt = new env.Prompt(chatPrompt);
        prompt.identifier = `chatHistory-${messages.length - index}`;
        const chatMessage = await Message.fromPromptAsync(env.getPromptManager().preparePrompt(prompt));

        if (env.getPromptManager().serviceSettings.names_behavior === character_names_behavior.COMPLETION && prompt.name) {
            const messageName = env.getPromptManager().isValidName(prompt.name) ? prompt.name : env.getPromptManager().sanitizeName(prompt.name);
            await chatMessage.setName(messageName);
        }

        /**
         * Inline a media attachment into the chat message.
         * @param {MediaAttachment} media - The media attachment to inline.
         */
        async function inlineMediaAttachment(media) {
            if (!media || !media.url) {
                return;
            }
            if (!media.type) {
                media.type = env.mediaType.IMAGE;
            }
            if (imageInlining && media.type === env.mediaType.IMAGE) {
                await chatMessage.addImage(media.url);
            }
            if (videoInlining && media.type === env.mediaType.VIDEO) {
                await chatMessage.addVideo(media.url);
            }
            if (audioInlining && media.type === env.mediaType.AUDIO) {
                await chatMessage.addAudio(media.url);
            }
        }

        if (Array.isArray(chatPrompt.media) && chatPrompt.media.length) {
            if (chatPrompt.mediaDisplay === env.mediaDisplay.LIST) {
                for (const media of chatPrompt.media) {
                    await inlineMediaAttachment(media);
                }
            }
            if (chatPrompt.mediaDisplay === env.mediaDisplay.GALLERY) {
                const media = chatPrompt.media[chatPrompt.mediaIndex];
                await inlineMediaAttachment(media);
            }
        }

        if (canUseTools && Array.isArray(chatPrompt.invocations)) {
            const promptIdx = messages.indexOf(chatPrompt);
            const reasoningIsEligible = toolReasoningMode !== env.toolReasoningModes.DISABLED
                && promptIdx > lastUserIdx;
            let previousAssistantReasoning = '';
            if (reasoningIsEligible) {
                if (toolReasoningMode === env.toolReasoningModes.ACTIVE_CHAIN) {
                    // Strict chain mode: skip tool/tool-call messages, then use only the first assistant text boundary.
                    for (let idx = promptIdx - 1; idx > lastUserIdx; idx--) {
                        const candidate = messages[idx];
                        if (candidate?.role === 'tool') {
                            continue;
                        }
                        if (candidate?.role === 'assistant' && Array.isArray(candidate.invocations)) {
                            continue;
                        }
                        const hasAssistantText = candidate?.role === 'assistant'
                            && !Array.isArray(candidate.invocations)
                            && typeof candidate.content === 'string'
                            && candidate.content.trim().length > 0;
                        if (hasAssistantText) {
                            previousAssistantReasoning = String(candidate.reasoning ?? '');
                        }
                        break;
                    }
                } else if (toolReasoningMode === env.toolReasoningModes.SINCE_LAST_USER) {
                    // Broad mode: use the latest assistant text reasoning anywhere since the last user.
                    for (let idx = promptIdx - 1; idx > lastUserIdx; idx--) {
                        const candidate = messages[idx];
                        const hasAssistantText = candidate?.role === 'assistant'
                            && !Array.isArray(candidate.invocations)
                            && typeof candidate.content === 'string'
                            && candidate.content.trim().length > 0;
                        if (!hasAssistantText) {
                            continue;
                        }
                        const candidateReasoning = String(candidate.reasoning ?? '');
                        if (candidateReasoning) {
                            previousAssistantReasoning = candidateReasoning;
                            break;
                        }
                    }
                }
            }
            /** @type {import('./tool-calling.js').ToolInvocation[]} */
            const invocations = chatPrompt.invocations.map(invocation => {
                const clone = structuredClone(invocation);
                if (!reasoningIsEligible) {
                    delete clone.reasoning;
                } else if (previousAssistantReasoning && !clone.reasoning) {
                    // Fall back to adjacent assistant-text reasoning only when the invocation has none of its own.
                    clone.reasoning = previousAssistantReasoning;
                }
                return clone;
            });
            const toolCallMessage = await Message.createAsync(chatMessage.role, undefined, 'toolCall-' + chatMessage.identifier);
            const toolResultMessages = await Promise.all(invocations.slice().reverse().map((invocation) => Message.createAsync('tool', invocation.result || '[No content]', invocation.id)));
            await toolCallMessage.setToolCalls(invocations, includeSignature, includeToolReasoning);
            if (chatCompletion.canAffordAll([toolCallMessage, ...toolResultMessages])) {
                for (const resultMessage of toolResultMessages) {
                    chatCompletion.insertAtStart(resultMessage, 'chatHistory');
                }
                chatCompletion.insertAtStart(toolCallMessage, 'chatHistory');
            } else {
                break;
            }

            continue;
        }

        if (includeSignature && chatPrompt.signature) {
            chatMessage.signature = chatPrompt.signature;
        }

        if (chatCompletion.canAfford(chatMessage)) {
            chatCompletion.insertAtStart(chatMessage, 'chatHistory');
        } else {
            break;
        }
    }

    // Insert and free new chat
    chatCompletion.freeBudget(newChatMessage);
    chatCompletion.insertAtStart(newChatMessage, 'chatHistory');

    // Reserve budget for group nudge
    if (env.getSelectedGroup() && groupNudgeMessage) {
        chatCompletion.freeBudget(groupNudgeMessage);
        chatCompletion.insertAtEnd(groupNudgeMessage, 'chatHistory');
    }

    // Insert and free continue nudge
    if (type === 'continue' && continueMessageCollection) {
        chatCompletion.freeBudget(continueMessageCollection);
        chatCompletion.add(continueMessageCollection, -1);
    }
}

export async function populateDialogueExamplesCore(prompts, chatCompletion, messageExamples, env) {
    if (!prompts.has('dialogueExamples')) {
        return;
    }

    chatCompletion.add(new MessageCollection('dialogueExamples'), prompts.index('dialogueExamples'));
    if (Array.isArray(messageExamples) && messageExamples.length) {
        const newExampleChat = await Message.createAsync('system', env.substituteParams(env.getOaiSettings().new_example_chat_prompt), 'newChat');
        for (const dialogue of [...messageExamples]) {
            const dialogueIndex = messageExamples.indexOf(dialogue);
            const chatMessages = [];

            for (let promptIndex = 0; promptIndex < dialogue.length; promptIndex++) {
                const prompt = dialogue[promptIndex];
                const role = 'system';
                const content = prompt.content || '';
                const identifier = `dialogueExamples ${dialogueIndex}-${promptIndex}`;

                const chatMessage = await Message.createAsync(role, content, identifier);
                await chatMessage.setName(prompt.name);
                chatMessages.push(chatMessage);
            }

            if (!chatCompletion.canAffordAll([newExampleChat, ...chatMessages])) {
                break;
            }

            chatCompletion.insert(newExampleChat, 'dialogueExamples');
            for (const chatMessage of chatMessages) {
                chatCompletion.insert(chatMessage, 'dialogueExamples');
            }
        }
    }
}

export async function populateChatCompletionCore(prompts, chatCompletion, { bias, quietPrompt, quietImage, type, cyclePrompt, messages, messageExamples }, env) {
    // Helper function for preparing a prompt, that already exists within the prompt collection, for completion
    const addToChatCompletion = async (source, target = null) => {
        // We need the prompts array to determine a position for the source.
        if (false === prompts.has(source)) return;

        if (env.getPromptManager().isPromptDisabledForActiveCharacter(source) && source !== 'main') {
            env.getPromptManager().log(`Skipping prompt ${source} because it is disabled`);
            return;
        }

        const prompt = prompts.get(source);

        if (prompt.injection_position === env.injectionPosition.ABSOLUTE) {
            env.getPromptManager().log(`Skipping prompt ${source} because it is an absolute prompt`);
            return;
        }

        const index = target ? prompts.index(target) : prompts.index(source);
        const collection = new MessageCollection(source);
        const message = await Message.fromPromptAsync(prompt);
        collection.add(message);
        chatCompletion.add(collection, index);
    };

    chatCompletion.reserveBudget(3); // every reply is primed with <|start|>assistant<|message|>
    // Character and world information
    await addToChatCompletion('worldInfoBefore');
    await addToChatCompletion('main');
    await addToChatCompletion('worldInfoAfter');
    await addToChatCompletion('charDescription');
    await addToChatCompletion('charPersonality');
    await addToChatCompletion('scenario');
    await addToChatCompletion('personaDescription');

    // Collection of control prompts that will always be positioned last
    chatCompletion.setOverriddenPrompts(prompts.overriddenPrompts);
    const controlPrompts = new MessageCollection('controlPrompts');

    const impersonateMessage = await Message.fromPromptAsync(prompts.get('impersonate')) ?? null;
    if (type === 'impersonate') controlPrompts.add(impersonateMessage);

    // Add quiet prompt to control prompts
    // This should always be last, even in control prompts. Add all further control prompts BEFORE this prompt
    const quietPromptMessage = await Message.fromPromptAsync(prompts.get('quietPrompt')) ?? null;
    if (quietPromptMessage && quietPromptMessage.content) {
        if (env.isImageInliningSupported() && quietImage) {
            await quietPromptMessage.addImage(quietImage);
        }

        controlPrompts.add(quietPromptMessage);
    }

    chatCompletion.reserveBudget(controlPrompts);

    // Add ordered system and user prompts
    const systemPrompts = ['nsfw', 'jailbreak'];
    const userRelativePrompts = prompts.collection
        .filter((prompt) => false === prompt.system_prompt && prompt.injection_position !== env.injectionPosition.ABSOLUTE)
        .reduce((acc, prompt) => {
            acc.push(prompt.identifier);
            return acc;
        }, []);
    const absolutePrompts = prompts.collection
        .filter((prompt) => prompt.injection_position === env.injectionPosition.ABSOLUTE)
        .reduce((acc, prompt) => {
            acc.push(prompt);
            return acc;
        }, []);

    for (const identifier of [...systemPrompts, ...userRelativePrompts]) {
        await addToChatCompletion(identifier);
    }

    // Add enhance definition instruction
    if (prompts.has('enhanceDefinitions')) await addToChatCompletion('enhanceDefinitions');

    // Bias
    if (bias && bias.trim().length) await addToChatCompletion('bias');

    const injectToMain = async (/** @type {Prompt} */ prompt, /** @type {string|number} */ position) => {
        if (chatCompletion.has('main')) {
            const message = await Message.fromPromptAsync(prompt);
            chatCompletion.insert(message, 'main', position);
        } else {
            // Convert the relative prompt to an injection and place it relative to main prompt
            // Keeping prompts in the same order bucket will squash them together during in-chat injection
            const indexOfMain = absolutePrompts.findIndex(p => p.identifier === 'main');
            if (indexOfMain >= 0) {
                const main = absolutePrompts[indexOfMain];
                const promptCopy = new env.Prompt(prompt);
                promptCopy.role = main.role;
                promptCopy.injection_position = main.injection_position;
                promptCopy.injection_depth = main.injection_depth;
                promptCopy.injection_order = main.injection_order;
                const newIndex = position === 'end' ? indexOfMain + 1 : indexOfMain;
                absolutePrompts.splice(newIndex, 0, promptCopy);
            }
        }
    };

    const knownPrompts = [
        'summary',
        'authorsNote',
        'vectorsMemory',
        'vectorsDataBank',
        'smartContext',
    ];

    // Known relative extension prompts
    for (const key of knownPrompts) {
        if (prompts.has(key)) {
            const prompt = prompts.get(key);
            if (prompt.position) {
                await injectToMain(prompt, prompt.position);
            }
        }
    }

    // Other relative extension prompts
    for (const prompt of prompts.collection.filter(p => p.extension && p.position)) {
        await injectToMain(prompt, prompt.position);
    }

    // Pre-allocation of tokens for tool data
    if (env.toolManager.canPerformToolCalls(type)) {
        const toolData = {};
        await env.toolManager.registerFunctionToolsOpenAI(toolData);
        const toolMessage = [{ role: 'user', content: JSON.stringify(toolData) }];
        const toolTokens = await env.tokenHandler.countAsync(toolMessage);
        chatCompletion.reserveBudget(toolTokens);
    }

    // Displace the message to be continued from its original position before performing in-chat injections
    // In case if it is an assistant message, we want to prepend the users assistant prefill on the message
    if (type === 'continue' && env.getOaiSettings().continue_prefill && messages.length) {
        const chatMessage = messages[0];
        // Shifted through a copy (was an in-place shift of the caller's array).
        messages = messages.slice(1);
        const isAssistantRole = chatMessage.role === 'assistant';
        const supportsAssistantPrefill = env.getOaiSettings().chat_completion_source === env.chatCompletionSources.CLAUDE;
        const namesInCompletion = env.getOaiSettings().names_behavior === character_names_behavior.COMPLETION;
        const assistantPrefill = isAssistantRole && supportsAssistantPrefill ? env.substituteParams(env.getOaiSettings().assistant_prefill) : '';
        const messageContent = [assistantPrefill, chatMessage.content].filter(x => x).join('\n\n');
        const continueMessage = await Message.createAsync(chatMessage.role, messageContent, 'continuePrefill');
        chatMessage.name && namesInCompletion && await continueMessage.setName(env.getPromptManager().sanitizeName(chatMessage.name));
        controlPrompts.add(continueMessage);
        chatCompletion.reserveBudget(continueMessage);
    }

    // Add in-chat injections
    messages = await populationInjectionPromptsCore(absolutePrompts, messages, env);

    // Decide whether dialogue examples should always be added
    if (env.getPowerUser().pin_examples) {
        await populateDialogueExamplesCore(prompts, chatCompletion, messageExamples, env);
        await populateChatHistoryCore(messages, prompts, chatCompletion, type, cyclePrompt, env);
    } else {
        await populateChatHistoryCore(messages, prompts, chatCompletion, type, cyclePrompt, env);
        await populateDialogueExamplesCore(prompts, chatCompletion, messageExamples, env);
    }

    chatCompletion.freeBudget(controlPrompts);
    if (controlPrompts.collection.length) chatCompletion.add(controlPrompts);
}

export async function preparePromptsForChatCompletionCore({ scenario, charPersonality, name2, worldInfoBefore, worldInfoAfter, charDescription, quietPrompt, bias, extensionPrompts, systemPromptOverride, jailbreakPromptOverride, type }, env) {
    const scenarioText = scenario && env.getOaiSettings().scenario_format ? env.substituteParams(env.getOaiSettings().scenario_format) : (scenario || '');
    const charPersonalityText = charPersonality && env.getOaiSettings().personality_format ? env.substituteParams(env.getOaiSettings().personality_format) : (charPersonality || '');
    const groupNudge = env.substituteParams(env.getOaiSettings().group_nudge_prompt);
    const impersonationPrompt = env.getOaiSettings().impersonation_prompt ? env.substituteParams(env.getOaiSettings().impersonation_prompt) : '';

    // Create entries for system prompts
    const systemPrompts = [
        // Ordered prompts for which a marker should exist
        { role: 'system', content: env.formatWorldInfo(worldInfoBefore), identifier: 'worldInfoBefore' },
        { role: 'system', content: env.formatWorldInfo(worldInfoAfter), identifier: 'worldInfoAfter' },
        { role: 'system', content: charDescription, identifier: 'charDescription' },
        { role: 'system', content: charPersonalityText, identifier: 'charPersonality' },
        { role: 'system', content: scenarioText, identifier: 'scenario' },
        // Unordered prompts without marker
        { role: 'system', content: impersonationPrompt, identifier: 'impersonate' },
        { role: 'system', content: quietPrompt, identifier: 'quietPrompt' },
        { role: 'system', content: groupNudge, identifier: 'groupNudge' },
        { role: 'assistant', content: bias, identifier: 'bias' },
    ];

    // Tavern Extras - Summary
    const summary = extensionPrompts['1_memory'];
    if (summary && summary.value) systemPrompts.push({
        role: env.getPromptRole(summary.role),
        content: summary.value,
        identifier: 'summary',
        position: env.getPromptPosition(summary.position),
    });

    // Authors Note
    const authorsNote = extensionPrompts['2_floating_prompt'];
    if (authorsNote && authorsNote.value) systemPrompts.push({
        role: env.getPromptRole(authorsNote.role),
        content: authorsNote.value,
        identifier: 'authorsNote',
        position: env.getPromptPosition(authorsNote.position),
    });

    // Vectors Memory
    const vectorsMemory = extensionPrompts['3_vectors'];
    if (vectorsMemory && vectorsMemory.value) systemPrompts.push({
        role: 'system',
        content: vectorsMemory.value,
        identifier: 'vectorsMemory',
        position: env.getPromptPosition(vectorsMemory.position),
    });

    const vectorsDataBank = extensionPrompts['4_vectors_data_bank'];
    if (vectorsDataBank && vectorsDataBank.value) systemPrompts.push({
        role: env.getPromptRole(vectorsDataBank.role),
        content: vectorsDataBank.value,
        identifier: 'vectorsDataBank',
        position: env.getPromptPosition(vectorsDataBank.position),
    });

    // Smart Context (ChromaDB)
    const smartContext = extensionPrompts.chromadb;
    if (smartContext && smartContext.value) systemPrompts.push({
        role: 'system',
        content: smartContext.value,
        identifier: 'smartContext',
        position: env.getPromptPosition(smartContext.position),
    });

    // Persona Description
    if (env.getPowerUser().persona_description && env.getPowerUser().persona_description_position === env.personaDescriptionPositions.IN_PROMPT) {
        systemPrompts.push({ role: 'system', content: env.getPowerUser().persona_description, identifier: 'personaDescription' });
    }

    const knownExtensionPrompts = [
        '1_memory',
        '2_floating_prompt',
        '3_vectors',
        '4_vectors_data_bank',
        'chromadb',
        'PERSONA_DESCRIPTION',
        'QUIET_PROMPT',
        'DEPTH_PROMPT',
    ];

    // Anything that is not a known extension prompt
    for (const key in extensionPrompts) {
        if (Object.hasOwn(extensionPrompts, key)) {
            const prompt = extensionPrompts[key];
            if (knownExtensionPrompts.includes(key)) continue;
            if (!extensionPrompts[key].value) continue;
            if (![extension_prompt_types.BEFORE_PROMPT, extension_prompt_types.IN_PROMPT].includes(prompt.position)) continue;

            const hasFilter = typeof prompt.filter === 'function';
            if (hasFilter && !await prompt.filter()) continue;

            systemPrompts.push({
                identifier: key.replace(/\W/g, '_'),
                position: env.getPromptPosition(prompt.position),
                role: env.getPromptRole(prompt.role),
                content: prompt.value,
                extension: true,
            });
        }
    }

    // This is the prompt order defined by the user
    const prompts = env.getPromptManager().getPromptCollection(type);

    // Merge system prompts with prompt manager prompts
    systemPrompts.forEach(prompt => {
        const collectionPrompt = prompts.get(prompt.identifier);

        // Apply system prompt role/depth overrides if they set in the prompt manager
        if (collectionPrompt) {
            // In-Chat / Relative
            prompt.injection_position = collectionPrompt.injection_position ?? prompt.injection_position;
            // Depth for In-Chat
            prompt.injection_depth = collectionPrompt.injection_depth ?? prompt.injection_depth;
            // Priority for In-Chat
            prompt.injection_order = collectionPrompt.injection_order ?? prompt.injection_order;
            // Role (system, user, assistant)
            prompt.role = collectionPrompt.role ?? prompt.role;
        }

        const newPrompt = env.getPromptManager().preparePrompt(prompt);
        const markerIndex = prompts.index(prompt.identifier);

        if (-1 !== markerIndex) prompts.collection[markerIndex] = newPrompt;
        else prompts.add(newPrompt);
    });

    // Apply character-specific main prompt
    const systemPrompt = prompts.get('main') ?? null;
    const isSystemPromptDisabled = env.getPromptManager().isPromptDisabledForActiveCharacter('main');
    if (systemPromptOverride && systemPrompt && systemPrompt.forbid_overrides !== true && !isSystemPromptDisabled) {
        const mainOriginalContent = systemPrompt.content;
        systemPrompt.content = systemPromptOverride;
        const mainReplacement = env.getPromptManager().preparePrompt(systemPrompt, mainOriginalContent);
        prompts.override(mainReplacement, prompts.index('main'));
    }

    // Apply character-specific jailbreak
    const jailbreakPrompt = prompts.get('jailbreak') ?? null;
    const isJailbreakPromptDisabled = env.getPromptManager().isPromptDisabledForActiveCharacter('jailbreak');
    if (jailbreakPromptOverride && jailbreakPrompt && jailbreakPrompt.forbid_overrides !== true && !isJailbreakPromptDisabled) {
        const jbOriginalContent = jailbreakPrompt.content;
        jailbreakPrompt.content = jailbreakPromptOverride;
        const jbReplacement = env.getPromptManager().preparePrompt(jailbreakPrompt, jbOriginalContent);
        prompts.override(jbReplacement, prompts.index('jailbreak'));
    }

    return prompts;
}
