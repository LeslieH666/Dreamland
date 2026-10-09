# Project overview

## Purpose

DreamLand explores a desktop-first character-chat experience while retaining SillyTavern's established chat engine and data compatibility. New behavior is implemented around the existing core wherever possible so users can continue using character cards and conversations without a forced migration.

## Architecture

```text
Electron shell
├─ System tray and background activity clock
└─ SillyTavern server
   ├─ Existing chat, character, group, World Info, model, and JSONL flows
   ├─ Leslie identity service
   ├─ Leslie memory service
   ├─ Leslie moments service
   └─ Character voice proxy

Browser UI
├─ Existing SillyTavern interface and event system
├─ Leslie desktop chat and settings layers, including story/reality line switching
├─ Memory and moments extensions, including bounded cross-line recall, a desktop two-pane timeline, threaded replies, per-character publishing policy, isolated social memory, and a model-backed activity worker
└─ Character workshop and voice settings

Optional API boundary
└─ Leslie Bridge v1
   ├─ Process-scoped bearer authentication
   ├─ Capability discovery (/health, /capabilities)
   ├─ Configured model listing (/models)
   ├─ Authoritative DreamLand turn streaming (/model/chat/completions)
   └─ Bound-character Volcengine speech (/voices, /audio/speech)

Local Windows workflow
├─ One DreamLand launcher
├─ Process-scoped Bridge token
└─ Internal build, diagnostics, logs, and safe tracked-process shutdown scripts

Android connected client
├─ Native phone/tablet shell with a remembered DreamLand server address
├─ Responsive existing DreamLand web interface inside Android WebView
├─ Shared platform-neutral address and capability rules under `mobile/shared/`
└─ Chat and character data stay on the computer; the WebView only permits the configured DreamLand origin among private-network origins

Android standalone beta
├─ In-process Node.js 24 Android runtime and existing DreamLand server
├─ App-private server/data/config/cache roots; listener restricted to loopback
├─ Reuses the connected Android shell and shared capability policy
└─ Android arm64 beta; on-device acceptance still pending

Integrated source workspace
├─ One root Git repository and owned origin remote
├─ LeslieTavern npm package boundary
└─ src/leslie-bridge/ as the seed for the versioned public API
```

## Compatibility boundaries

- Existing SillyTavern chat events and storage formats remain authoritative.
- Story and reality conversations remain ordinary, separate JSONL chats. Reality generation uses only a de-fictionalized core-personality profile, real time, reality history, and bounded memory; it does not receive the card's fixed greeting, scenario, example dialogue, creator prompts, World Info, or story history. A character may receive at most two confirmed memories from the opposite line, labelled as echoes rather than current facts.
- Leslie modules should be optional and fail open.
- Character cards, JSONL chats, group chats, World Info, swipes, and model adapters must remain usable.
- User data is local state and is not part of the source repository.
- Direct LAN web access may be enabled explicitly with an allowlist that follows the private subnet used for each connection and a trusted-network firewall boundary. Same-subnet devices do not need per-IP entries, while public and unrelated routed networks remain blocked. Device discovery, data synchronization, cloud synchronization, and automatic memory writes still require separate security and approval designs before implementation.
- The Leslie Bridge v1 API is disabled by default, uses a process-scoped bearer token, and exposes only `/health`, `/capabilities`, `/model/chat/completions`, `/voices`, `/models`, and `/audio/speech`.
- The first Android APK is a LAN client, not an on-device server. Chat and character data remain on the computer, and the client neither manages nor hosts models. Its native WebView only permits the configured DreamLand origin among private-network origins.
- The standalone Android APK embeds a Node.js mobile runtime and the existing server inside the Android app process. It stores data in the app-private sandbox and binds only to loopback. The runtime is a third-party Node 24 mobile pre-release; on-device startup and desktop-data migration need acceptance before this can be treated as a supported release. The embedded server connects only to the model endpoints the user configures and does not host or manage a local runtime.
- Model connections are user-configured: DreamLand talks to cloud APIs or to an already-running self-hosted or remote KoboldCpp / OpenAI-compatible endpoint. It does not download, scan, start, stop, or expose model processes, and the authenticated HTTP API does not accept arbitrary paths, URLs, or commands.
- DreamLand remains authoritative for prompt assembly, generation, persistence, character selection, and voice selection. Leslie Bridge v1 stays disabled by default behind a process-scoped bearer token and is the seed for a future versioned `/api/v1`.

## Current maturity

For UI work, read the [current UI design specification draft](ui-design-spec.md) alongside the implementation. It records the current MomoTalk layout, component semantics and the explicit rollback of raised settings menu tiles. The original design and appearance documents remain preserved as historical references; new visual changes require reconciliation with the user's latest accepted direction.

The repository contains a runnable prototype with significant local verification. It is suitable for continued development and test distribution, but it is not yet a signed installer or a stable public release.

See [roadmap.md](roadmap.md) for planned work and [data-and-packaging.md](data-and-packaging.md) for repository boundaries.
