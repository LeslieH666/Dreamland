/**
 * Text-to-speech playback helper.
 *
 * The audio library is isolated behind this one function so the rest of the UI never
 * touches expo-av directly; swapping in a different native audio backend only changes
 * this file. Playback failures degrade to a no-op (voice is optional).
 */

import { Audio } from 'expo-av';

let currentSound: Audio.Sound | null = null;

/**
 * Synthesize and play `text` through the voice API.
 * @param synthesize Function that returns an audio URI.
 * @param text Text to speak.
 */
export async function speak(synthesize: (text: string) => Promise<{ uri: string }>, text: string): Promise<void> {
    try {
        const { uri } = await synthesize(text);
        await currentSound?.unloadAsync();
        const { sound } = await Audio.Sound.createAsync({ uri });
        currentSound = sound;
        await sound.playAsync();
    } catch {
        // Voice is optional: never let a TTS failure break the chat.
    }
}

/** Release the current audio resource (called on unmount). */
export async function stopSpeaking(): Promise<void> {
    try {
        await currentSound?.unloadAsync();
    } catch { /* already released */ }
    currentSound = null;
}
