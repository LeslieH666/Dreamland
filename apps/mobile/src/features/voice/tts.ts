/**
 * Text-to-speech playback helper.
 *
 * The audio library is isolated behind this one function so the rest of the UI never
 * touches expo-audio directly; swapping in a different native audio backend only changes
 * this file. Playback failures degrade to a no-op (voice is optional).
 *
 * SDK 57 migration note: expo-av was removed from Expo Go, so playback now uses the
 * imperative `createAudioPlayer` from expo-audio (the successor to expo-av's Audio.Sound).
 */

import { createAudioPlayer } from 'expo-audio';

let currentPlayer: ReturnType<typeof createAudioPlayer> | null = null;

/**
 * Synthesize and play `text` through the voice API.
 * @param synthesize Function that returns an audio URI.
 * @param text Text to speak.
 */
export async function speak(synthesize: (text: string) => Promise<{ uri: string }>, text: string): Promise<void> {
    try {
        const { uri } = await synthesize(text);
        currentPlayer?.remove();
        const player = createAudioPlayer({ uri });
        currentPlayer = player;
        player.play();
    } catch {
        // Voice is optional: never let a TTS failure break the chat.
    }
}

/** Release the current audio resource (called on unmount). */
export async function stopSpeaking(): Promise<void> {
    try {
        currentPlayer?.remove();
    } catch { /* already released */ }
    currentPlayer = null;
}
