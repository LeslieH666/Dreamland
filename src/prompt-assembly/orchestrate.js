/**
 * Chat-completion assembly orchestration (Phase 2.5.2 step 7).
 *
 * prepareOpenAIMessages moves here as prepareOpenAIMessagesCore. The ChatCompletion
 * class is constructed through env rather than imported, so a server caller can hand
 * in its own implementation.
 *
 * Two implicit browser dependencies had to be named: toastr (a page global that was
 * never imported) arrives as env.notify with .error/.warning, and the module-level
 * openai_messages_count becomes env.setOpenaiMessagesCount.
 *
 * The interceptor hook is optional and the browser passes nothing: see the comment in
 * the body for why running it here would double-execute interceptors.
 */

import { InvalidCharacterNameError, TokenBudgetExceededError } from './chat-completion.js';
import { populateChatCompletionCore, preparePromptsForChatCompletionCore } from './populate.js';

export async function prepareOpenAIMessagesCore({
    name2,
    charDescription,
    charPersonality,
    scenario,
    worldInfoBefore,
    worldInfoAfter,
    bias,
    type,
    quietPrompt,
    quietImage,
    extensionPrompts,
    cyclePrompt,
    systemPromptOverride,
    jailbreakPromptOverride,
    messages,
    messageExamples,
}, dryRun, env) {
    // Optional interceptor stage. The browser deliberately passes nothing here:
    // runGenerationInterceptors already ran upstream in script.js, so wiring it again
    // would execute every interceptor twice on the chat-completion path — and the
    // synthetic fixtures would not catch it. The server wires only its memory and
    // reply-style interceptors; reality and filter are not ported.
    await env.runInterceptors?.({ type, dryRun });

    // Without a character selected, there is no way to accurately calculate tokens
    if (!env.getPromptManager().activeCharacter && dryRun) return [null, false];

    const chatCompletion = new env.ChatCompletion();
    if (env.getPowerUser().console_log_prompts) chatCompletion.enableLogging();

    const userSettings = env.getPromptManager().serviceSettings;
    const reasoningBudget = env.getGenerationTokenBudget({
        chatCompletionSource: userSettings.chat_completion_source,
        showThoughts: userSettings.show_thoughts,
        reasoningEffort: userSettings.reasoning_effort,
        contextTokens: userSettings.openai_max_context,
        outputTokens: userSettings.openai_max_tokens,
        type,
    });
    chatCompletion.setTokenBudget(reasoningBudget.contextTokens, reasoningBudget.outputTokens);

    try {
        // Merge markers and ordered user prompts with system prompts
        const prompts = await preparePromptsForChatCompletionCore({
            scenario,
            charPersonality,
            name2,
            worldInfoBefore,
            worldInfoAfter,
            charDescription,
            quietPrompt,
            bias,
            extensionPrompts,
            systemPromptOverride,
            jailbreakPromptOverride,
            type,
        }, env);

        // Fill the chat completion with as much context as the budget allows
        await populateChatCompletionCore(prompts, chatCompletion, { bias, quietPrompt, quietImage, type, cyclePrompt, messages, messageExamples }, env);
    } catch (error) {
        if (error instanceof TokenBudgetExceededError) {
            env.notify.error(env.t`Mandatory prompts exceed the context size.`);
            chatCompletion.log('Mandatory prompts exceed the context size.');
            env.getPromptManager().error = env.t`Not enough free tokens for mandatory prompts. Raise your token limit or disable custom prompts.`;
        } else if (error instanceof InvalidCharacterNameError) {
            env.notify.warning(env.t`An error occurred while counting tokens: Invalid character name`);
            chatCompletion.log('Invalid character name');
            env.getPromptManager().error = env.t`The name of at least one character contained whitespaces or special characters. Please check your user and character name.`;
        } else {
            env.notify.error(env.t`An unknown error occurred while counting tokens. Further information may be available in console.`);
            chatCompletion.log('----- Unexpected error while preparing prompts -----');
            chatCompletion.log(error);
            chatCompletion.log(error.stack);
            chatCompletion.log('----------------------------------------------------');
        }
    } finally {
        // Pass chat completion to prompt manager for inspection
        env.getPromptManager().setChatCompletion(chatCompletion);

        if (env.getOaiSettings().squash_system_messages && dryRun == false) {
            await chatCompletion.squashSystemMessages();
        }

        // All information is up-to-date, render.
        if (false === dryRun) env.getPromptManager().render(false);
    }

    const chat = chatCompletion.getChat();

    const eventData = { chat, dryRun };
    await env.emit(env.eventTypes.CHAT_COMPLETION_PROMPT_READY, eventData);

    env.setOpenaiMessagesCount(chat.filter(x => !x?.tool_calls && ['user', 'assistant', 'tool'].includes(x?.role)).length || 0);

    return [chat, env.getPromptManager().tokenHandler.counts];
}
