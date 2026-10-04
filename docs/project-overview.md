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

Optional companion boundary
└─ Leslie Bridge v1
   ├─ Process-scoped bearer authentication
   ├─ Capability discovery
   ├─ OpenAI-compatible Volcengine speech adapter
   ├─ Active DreamLand character and chat binding
   ├─ Authoritative DreamLand turn streaming
   └─ Bound-character Volcengine speech

Local Windows workflow
├─ One DreamLand launcher
├─ Electron controls for AIRI and local-model stop; same-subnet mobile model selection and startup
├─ Ephemeral inherited Bridge token
└─ Internal build, diagnostics, logs, and safe tracked-process shutdown scripts

Integrated source workspace
├─ One root Git repository and owned origin remote
├─ LeslieTavern npm package boundary
├─ airi/ pnpm package boundary
└─ No nested AIRI Git metadata or upstream remote
```

## Compatibility boundaries

- Existing SillyTavern chat events and storage formats remain authoritative.
- Story and reality conversations remain ordinary, separate JSONL chats. Reality generation uses only a de-fictionalized core-personality profile, real time, reality history, and bounded memory; it does not receive the card's fixed greeting, scenario, example dialogue, creator prompts, World Info, or story history. A character may receive at most two confirmed memories from the opposite line, labelled as echoes rather than current facts.
- Leslie modules should be optional and fail open.
- Character cards, JSONL chats, group chats, World Info, swipes, and model adapters must remain usable.
- User data is local state and is not part of the source repository.
- Direct LAN web access may be enabled explicitly with an allowlist that follows the private subnet used for each connection and a trusted-network firewall boundary. Same-subnet devices do not need per-IP entries, while public and unrelated routed networks remain blocked. Device discovery, data synchronization, cloud synchronization, and automatic memory writes still require separate security and approval designs before implementation.
- The AIRI companion bridge is disabled by default and uses a process-scoped bearer token.
- AIRI and local-model stop actions are exposed only through Electron IPC from the main DreamLand window. The authenticated HTTP API permits same-subnet clients to list project GGUF models, start a selected managed KoboldCpp model, and probe fixed host-loopback ports. It does not accept arbitrary paths, URLs, commands, or routed/public clients.
- AIRI sends only the newest user input. DreamLand remains authoritative for prompt assembly, generation, persistence, character selection, and voice selection. The boundary is documented in [airi-bridge.md](airi-bridge.md).

## Current maturity

For UI work, read the [current UI design specification draft](ui-design-spec.md) alongside the implementation. It records the current MomoTalk layout, component semantics and the explicit rollback of raised settings menu tiles. The original design and appearance documents remain preserved as historical references; new visual changes require reconciliation with the user's latest accepted direction.

The repository contains a runnable prototype with significant local verification. It is suitable for continued development and test distribution, but it is not yet a signed installer or a stable public release.

See [roadmap.md](roadmap.md) for planned work and [data-and-packaging.md](data-and-packaging.md) for repository boundaries.
