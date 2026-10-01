import {
    Generate,
    chat,
    characters,
    eventSource,
    event_types,
    getCurrentChatId,
    isGenerating,
    name1,
    sendMessageAsUser,
    stopGeneration,
    this_chid,
} from '../script.js';
import { getLeslieCompanionVoiceSettings } from './leslie-voice-settings.js';
import { extension_settings } from './extensions.js';
import { getCurrentUserHandle } from './user.js';

const host = window.leslieCompanionHost;
let activeRequestId = '';
let activeTurnPromise = null;
let pollStarted = false;

function getSnapshot() {
    const character = this_chid !== undefined ? characters[this_chid] : null;
    return {
        userSpaceId: getCurrentUserHandle(),
        binding: character ? {
            characterId: String(this_chid),
            characterName: String(character.name || ''),
            chatId: String(getCurrentChatId() || ''),
            personaName: String(name1 || ''),
        } : null,
        characters: characters.map((item, id) => ({
            id: String(id),
            name: String(item?.name || ''),
            avatar: String(item?.avatar || ''),
        })).filter(item => item.name),
        generating: isGenerating(),
        voice: getLeslieCompanionVoiceSettings(character?.name || ''),
    };
}

async function publish(requestId, event) {
    const accepted = await host.publish(requestId, event);
    if (!accepted) {
        throw new Error('The companion request is no longer active.');
    }
}

async function runTurn(command) {
    const bindingMatches = getCurrentUserHandle() === String(command.userSpaceId ?? '')
        && String(this_chid ?? '') === String(command.binding?.characterId ?? '')
        && String(getCurrentChatId() ?? '') === String(command.binding?.chatId ?? '');
    if (!bindingMatches) {
        await publish(command.id, {
            type: 'error',
            code: 'CHARACTER_BINDING_CHANGED',
            message: 'The active DreamLand character changed before the turn started.',
        });
        return;
    }
    if (isGenerating()) {
        await publish(command.id, {
            type: 'error',
            code: 'LESLIE_GENERATION_BUSY',
            message: 'Wait for the current DreamLand reply to finish.',
        });
        return;
    }

    activeRequestId = command.id;
    let latestText = '';
    let publishedText = '';
    let timer;
    let publishChain = Promise.resolve();

    const flush = () => {
        clearTimeout(timer);
        timer = undefined;
        if (!latestText || latestText === publishedText) {
            return publishChain;
        }
        publishedText = latestText;
        publishChain = publishChain.then(() => publish(command.id, { type: 'delta', text: publishedText }));
        return publishChain;
    };
    const onStream = (text) => {
        latestText = String(text ?? '');
        if (!timer) {
            timer = setTimeout(() => void flush(), 40);
        }
    };
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStream);
    const ttsSettings = extension_settings.tts;
    const hadAutoGeneration = Object.hasOwn(ttsSettings ?? {}, 'auto_generation');
    const previousAutoGeneration = ttsSettings?.auto_generation;
    if (ttsSettings) {
        ttsSettings.auto_generation = false;
    }

    try {
        await sendMessageAsUser(command.input, '');
        const result = await Generate('normal');
        latestText = String(result ?? chat.at(-1)?.mes ?? latestText);
        await flush();
        await publishChain;
        await publish(command.id, { type: 'complete', text: latestText });
    } catch (error) {
        await publish(command.id, {
            type: 'error',
            code: 'LESLIE_GENERATION_FAILED',
            message: error?.message || 'DreamLand failed to generate the reply.',
        }).catch(() => {});
    } finally {
        clearTimeout(timer);
        if (ttsSettings && hadAutoGeneration) {
            ttsSettings.auto_generation = previousAutoGeneration;
        } else if (ttsSettings) {
            delete ttsSettings.auto_generation;
        }
        eventSource.removeListener(event_types.STREAM_TOKEN_RECEIVED, onStream);
        activeRequestId = '';
    }
}

async function runCommand(command) {
    if (command?.type === 'cancel' && activeRequestId === command.id) {
        stopGeneration();
        await publish(command.id, { type: 'canceled', message: 'The AIRI request was canceled.' }).catch(() => {});
        return;
    }
    if (command?.type === 'turn') {
        await runTurn(command);
    }
}

async function poll() {
    if (!host) {
        return;
    }
    for (;;) {
        try {
            const command = await host.poll(getSnapshot());
            if (command) {
                if (command.type === 'turn') {
                    if (!activeTurnPromise) {
                        activeTurnPromise = runCommand(command)
                            .catch(error => console.warn('Leslie companion turn failed.', error))
                            .finally(() => {
                                activeTurnPromise = null;
                            });
                    }
                } else {
                    await runCommand(command);
                }
            }
        } catch (error) {
            console.warn('Leslie companion host poll failed.', error);
            await new Promise(resolve => setTimeout(resolve, 1_000));
        }
    }
}

function startPoll() {
    if (!host || pollStarted) {
        return;
    }
    pollStarted = true;
    void poll();
}

eventSource.on(event_types.APP_READY, startPoll);
startPoll();
