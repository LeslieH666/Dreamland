import { ApiClient } from './client';

/** Voice (TTS) endpoint of the versioned API. */
export class VoiceApi {
    constructor(private readonly client: ApiClient) {}

    /**
     * Synthesize speech for the given text. Returns an audio blob URL (or an audio URI)
     * the host can hand to its audio player.
     */
    async synthesize(text: string): Promise<{ uri: string; mimeType: string }> {
        // The voice route returns binary audio. The client fetches it authenticated and
        // exposes it as a local object URL so the UI stays decoupled from the transport.
        const blob = await this.client.requestBlob('/api/v1/voice/synthesize', {
            method: 'POST',
            body: JSON.stringify({ text }),
        });
        const url = URL.createObjectURL(blob);
        return { uri: url, mimeType: blob.type || 'audio/mpeg' };
    }
}
