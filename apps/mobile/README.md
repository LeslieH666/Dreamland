# DreamLand Mobile (React Native / Expo)

First release of the DreamLand mobile client. It is a thin client over the versioned
`/api/v1` contract (the server's authoritative turn), so prompt assembly, memory and
World Info stay server-side — this app never re-implements them.

## Layout

```
src/api/           Typed API client + domain types (UI-agnostic, reusable)
src/store/         Session store (token pair + client wiring)
src/features/      UI modules, one directory per concern:
  auth/            login + registration
  characters/      character list
  chat/            chat with SSE streaming + typewriter
  voice/           TTS playback
  feed/            read-only memory + moments
  settings/        server origin + account
  home/            post-login shell / tab navigation
```

The `src/api/` layer has no React/React Native imports; it runs on `fetch` +
`ReadableStream` + `TextDecoder`, so it is reusable by a future native shell or by
scripts, and it is the layer unit-tested on its own.

## Setup

```bash
cd apps/mobile
npm install          # or pnpm install
npx expo install expo-av   # pins the audio library to the installed Expo SDK
npm run ios          # iOS simulator
npm run android      # Android emulator (requires the Android SDK)
npm run typecheck    # tsc --noEmit
```

The server origin defaults to `http://127.0.0.1:18790` (see `App.tsx`). Point it at a
reachable DreamLand server. The app authenticates with `POST /api/v1/auth/token` and
attaches `Authorization: Bearer` to every request.

## First-release scope

- Login / register → character list → chat (SSE streaming, typewriter) → TTS playback.
- Memory and moments are read-only feeds.
- Swipe/regenerate/impersonate/quiet are exposed on the typed client but the UI ships
  only `normal` turns in the first release.

## Verification status

- TypeScript typecheck and the API-client unit tests are the CI gates (run `npm run
  typecheck` and the `src/api` tests).
- iOS/Android simulator smoke (login → character → message → streamed reply → TTS) must
  be run on a machine with Xcode / the Android SDK; see the parent roadmap for status.
