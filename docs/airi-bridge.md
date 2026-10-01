# AIRI companion bridge

## Product boundary

AIRI is the visible body and interaction surface for the character selected in DreamLand.

DreamLand owns:

- the active character card;
- Persona, World Info, extension prompts, and Leslie memory;
- the active chat and its saved history;
- model provider settings and secrets;
- the final generated reply;
- the Volcengine voice assigned to the active character.

AIRI owns:

- the 3D, Live2D, or other display model;
- text and microphone input;
- reply display, audio playback, and lip sync;
- desktop-window interaction.

AIRI does not build a second character prompt and does not select a second model or voice.

## Turn flow

1. The visible DreamLand page reports its current character, chat, Persona name, and voice binding through a narrow Electron IPC channel.
2. AIRI sends microphone audio to `POST /companion/audio/transcriptions` when voice input is active.
3. DreamLand uses its configured local speech-recognition model and returns text to AIRI.
4. AIRI sends only the newest user message to `POST /chat/completions`.
5. The DreamLand page calls its normal `sendMessageAsUser` and `Generate('normal')` flow.
6. The normal DreamLand pipeline applies the character card, World Info, memory, model settings, extensions, and chat persistence.
7. Generated text streams back to AIRI.
8. AIRI requests speech from `POST /companion/audio/speech`. The server ignores AIRI voice choices and uses the voice assigned to the current DreamLand character.

Changing the selected character or chat in DreamLand changes the AIRI binding automatically.

## Security boundary

- The bridge is disabled unless `LESLIE_BRIDGE_TOKEN` contains 32 to 512 UTF-8 bytes.
- The DreamLand launcher creates a new random token for each desktop session; AIRI inherits it only when started from that desktop window's settings.
- The token stays in process environments. It is not stored in settings, user data, logs, renderer storage, or source control.
- AIRI renderer requests pass through its Electron main process. The renderer never receives the token.
- The DreamLand browser host uses Electron IPC and accepts commands only from the visible DreamLand window.
- AIRI connects only to a loopback bridge URL.
- Ordinary DreamLand routes keep their existing CSRF and access controls.

## Companion endpoints

All paths are below `/api/leslie/bridge/v1` and require bearer authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Protocol health check |
| `GET` | `/capabilities` | Machine-readable feature contract |
| `GET` | `/companion/state` | Current DreamLand page, character, chat, and voice status |
| `POST` | `/chat/completions` | Authoritative DreamLand turn with SSE output |
| `POST` | `/companion/audio/transcriptions` | Local WAV transcription with the DreamLand speech-recognition model |
| `POST` | `/companion/audio/speech` | MP3 speech using the bound character voice |

Older model-gateway and generic speech routes remain internal compatibility endpoints. The dedicated AIRI frontend does not use or display them.

The machine-readable contract is in [`contracts/leslie-bridge-v1.openapi.yaml`](contracts/leslie-bridge-v1.openapi.yaml).

## Current limits

- The bridge follows one visible DreamLand page and one active character at a time.
- AIRI text input creates a normal new DreamLand turn. AIRI does not yet expose DreamLand swipe, edit, branch, or regenerate controls.
- The display model remains an AIRI choice. Automatic per-character display-model mapping can be added later.
- Multi-user account selection is not part of Bridge v1.
- Local transcription needs no API key. The first request can take longer while DreamLand downloads its configured model.
- Local transcription uses the CPU when no compatible accelerator is available.
