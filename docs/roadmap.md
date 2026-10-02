# Roadmap

## MomoTalk and local Blue Archive artwork (2026-10-02)

- Blue now uses MomoTalk as the main conversation interface, replacing the earlier geometric approximation.
- A pinned Global Android 1.93.454564 pack supplies 27 original atlas sprites and 3 original backgrounds; 7 color adaptations are explicitly recorded. Dark mode uses warm charcoal and dusty rose, with tinted original bubbles and button textures.
- BA footer navigation opens full content pages for moments, workshop, backgrounds, settings and about. Desktop retains contacts; mobile uses the area above the footer. Chat, form drafts and original character saving remain intact, with browser back navigation and legacy-theme restoration.
- Redundant BA header controls are hidden. Appearance and privacy live in settings, and manual/JSON character creation lives in the workshop. The shared mobile header exposes both world lines and line-specific creation; switching and creation are mutually guarded. Keyboard and safe-area layout are handled without a persistent-data migration.
- Original NGUI crop and border metadata, URLs and checksums are recorded in [the asset ledger](../public/img/blue-archive/ASSETS.md). A validated importer can restore the separate local pack.
- Game images and screenshots remain ignored and excluded from portable packages. Missing artwork falls back without preventing chat; appearance still uses the existing `blue` preference and requires no user-data migration.
- Repository and lint checks, 640 unit tests, 22 appearance browser checks and 2 shared navigation checks passed. Local screenshots are in `Cache/MomoTalk-QA/preview.html`; the tracked preview remains the earlier four-theme baseline. Full portable rebuild and live desktop/phone acceptance remain release checks.

## Workspace cleanup (2026-10-02)

- Windows startup uses one DreamLand entry in each source or portable workspace.
- Old brand launchers, duplicate batch launchers, upstream update scripts, and unused Colab/Replit setup files are removed.
- AIRI blog translations share identical media files. Documentation links point to the retained copies.
- The repository check rejects unexpected Windows entry scripts.
- User data, local runtimes, and the retained historical source snapshot remain local.

## DreamLand appearance refresh (2026-10-01)

- Public branding now uses DreamLand. Internal module names, Bridge v1 and user-data paths stay stable.
- Clear, Moon, Paper and Blue styles support light/dark mode, responsive navigation and shared tool surfaces.
- Cupertino and Classic remain available. Existing explicit preferences are preserved; new users start with Clear.
- Original product art and icons are included. The initial Blue Archive-inspired geometric theme was replaced by the local artwork implementation described above.
- Appearance preferences are browser-only. No chat, character, memory or identity schema migration is required.
- See [appearance and branding](dreamland-appearance.md) for switching, background import and rollback.
- [Actual screenshot preview](dreamland-preview.html) is available. Repository/lint checks, 636 unit tests and 24 browser checks passed; complete portable rebuild and live desktop/audio acceptance remain release checks.

## Available in the current prototype

- SillyTavern-compatible chat and character workflows.
- Electron desktop entry point and a listener-aware local launcher; the current workspace can explicitly enable same-subnet LAN web access without per-device whitelist entries.
- Modern desktop chat layout and settings adaptations.
- A runtime-selectable Cupertino design language for the conversation list, chat chrome, message bubbles, and composer, with purposeful reduced-motion-aware transitions and a persisted classic-theme fallback that leaves the original DOM and chat behavior intact.
- Four browser-persisted Leslie color palettes with matched light and dark variants, selectable from the appearance menu or settings page without changing SillyTavern theme data.
- A one-click demo mode in Leslie settings that switches the current browser session to an isolated per-account storage namespace for synthetic feature showcases and screenshots, without copying regular chats, character cards, memories, or API secrets.
- Optional password-selected user spaces with separate encrypted account directories, a blurred login picker, local first-run migration with an encrypted initial backup, and sealing on logout or normal desktop exit.
- A visual privacy mode aligned to the original desktop UI regions, with independent blur masks for the conversation list, chat header, messages, composer, and connection status plus persistent quick toggles. It changes only local presentation and does not encrypt stored chat data.
- A Leslie companion home for the no-chat state, with continue-chat, manually pinned or activity-ranked characters, content-free Moments updates, first-run guidance, and model/setup shortcuts while the classic SillyTavern welcome screen remains available with the classic layout.
- Semantic reply modes that guide balanced, novel, dialogue-driven, or concise presentation through prompt injection instead of fixed per-style token caps; DeepSeek foreground replies can use provider-controlled output length.
- First versions of Leslie memory and Persona/storyline identity isolation.
- A default-off experimental interaction-relationship layer for solo chats, with shared 0–100 bars for affection, trust, intimacy, rapport, security, and bond; automatically approved A-class impacts, decaying C-class recent influence, deterministic rollback-aware calculation, API conversion of legacy memory summaries, and a separate attitude prompt that leaves remembered facts and the protected character core unchanged.
- Separate story and reality chat lines backed by ordinary SillyTavern JSONL chats. Reality chats use a one-time core-personality extraction instead of the full character card, reopen the latest matching JSONL instead of creating a replacement, generate one non-fixed greeting on each entry through the active API, enforce plain instant-message output, follow device time and elapsed offline time, and keep same-character cross-line recall capped at two memory resonances rather than current-world facts. Older reality metadata is upgraded in place without discarding chat history.
- The chat header now creates another chat in the selected line without deleting the current one; single-character history labels story and reality chats, offers confirmed deletion, and reality creation can reuse a matching core-personality profile.
- Moments AI activity selects from the account's configured online connections and follows their saved model choice; missing online configuration waits without local fallback.
- Moments publishing and timeline storage, plus model-backed per-post/per-character unique read receipts, persisted low/medium/high enthusiasm controls, and selective likes/comments that continue while the Electron app is hidden in the system tray.
- Threaded Moments replies with repeated AI participation, publishing-Persona ownership for every user reply, Persona likes/unlikes separated from the clickable liker list, per-character comment/reply permission that leaves AI likes unrestricted, reversible delete/restore permission shared by local users, and lossless migration of legacy timelines and activity sidecars.
- Text-only character-authored Moments with explicit per-character enablement and frequency controls for both recently chatted and library-only characters.
- Parallel per-character Moments memory with Persona/story isolation, cross-post retrieval, a content-role picker independent from audience visibility, complete discovery of confirmed and legacy memory sources, read-only access to that role's approved chat memory, A–B–C/newest-first user-selected memory-topic import, and a future chat prompt adapter that remains disabled.
- A Cupertino-aligned Moments pass covering a desktop two-pane role/timeline layout, grouped content-role and audience controls, 44px primary targets, adapted reply/thread controls and secondary dialogs, selected-first role lists, reduced-motion handling, and a mobile single-column fallback.
- Volcengine character voice settings and playback integration.
- Character workshop prototype.
- Character-card and chat-record export from the Leslie chat menu, including a combined ZIP that preserves CCV3 PNG and SillyTavern JSONL files.
- Windows portable-package builder with empty distributable user data.
- Disabled-by-default Leslie Bridge v1 foundation with bearer authentication, capability discovery, and an OpenAI-compatible Volcengine speech route.
- Authoritative AIRI companion turns through the active DreamLand character, chat, prompt pipeline, memory, and model.
- Automatic AIRI binding to the visible DreamLand character and its Volcengine voice.
- Dedicated AIRI mode with automatic provider selection, no onboarding window, and a reduced settings surface.
- One `DreamLand` desktop launcher, with AIRI and tracked local-model stop controls in Electron settings. Same-subnet mobile clients can select a cataloged GGUF model and request managed KoboldCpp startup through authenticated, CSRF-protected HTTP endpoints.
- Optional interactive-guidance input mode with three AI-generated replies anchored to the current user Persona, automatic collapse for free-form typing, and the existing model, character-card, World Info, Persona, memory, and chat pipeline as its source of truth.
- A story-line plot compass for solo chats, with three structured multi-stage arcs that state their in-world horizon and lasting impact, optional 12–80-turn estimates, versioned chat-metadata persistence with v1 migration, a compact desktop header pin, a non-overlapping mobile dock and bottom sheet, and active-plan guidance for existing reply choices without automatic character steering.
- One-click local Qwen3.5 9B RP and Peach 2.0 9B RP GGUF detection and API configuration through the existing KoboldCpp or llama.cpp adapters, plus desktop settings start/stop controls; model weights remain outside Git.
- A shared `models/` catalog for single-file GGUF weights in desktop and same-subnet mobile settings. Users select a discovered model and connect through managed KoboldCpp without editing a port; manual local-provider controls are folded into advanced settings.
- Character workshop provider switch between the existing chat API and local Qwen3.5 generation, with structured-output budgeting and preview-only drafts.
- Per-memory model selection for automatic memory extraction and growth synthesis, including the existing chat API, the DeepSeek OpenAI Chat Completions API, local OpenAI-compatible runtimes, and independent OpenAI-compatible endpoints.
- Project-wide local-model loading gate shared by chat, character workshop, and memory-model adapters; disabling it leaves local model files intact while preventing local calls.
- Model connection checks retain the selected provider and visible endpoint across settings refreshes, recover the button after failures, and keep autosave/backup maintenance from taking down the service.
- Online API keys persist per account and provider across connection switches. The Leslie settings page saves pending keys before switching, shows saved-key state without revealing values, and Windows migrates the local secret file to current-user DPAPI protection.
- Bundled Peach roleplay output now stops at its known bracketed state/scene continuation pattern before contaminated text can be saved into chat history.
- One-click standard Character Card V2/V3 JSON import in the manual character editor, with an optional avatar upload synchronized to the native create form before saving.
- A default-off group-chat orchestrator with deterministic mention/relevance/turn-balance scoring, bounded reply batches, an automatic-reply ceiling, server-validated namespaced settings, and native natural-order fallback. Current-chat temporary roles use JSONL-only versioned metadata, manual creation, hidden in-memory card adapters, active/dormant/archived lifecycle states, branch pruning, Swipe continuity, and shared-memory speaker attribution without entering the character library. A third-stage isolated structured review can propose one editable role draft, an optionally immediate confirmed reply, or confirmed retirement choices on demand, with optional cooldown-based suggestions disabled by default and no direct model writes. See [group-chat-orchestrator.md](group-chat-orchestrator.md).

## Stabilization priorities

1. Expand regression coverage for ordinary chat with every Leslie module disabled.
2. Add long-response cancellation and swipe coverage for automatic voice playback.
3. Split the largest frontend modules into smaller maintainable units.
4. Add schema migration and recovery fixtures for identity, memory, and moments stores.
5. Add AIRI controls for DreamLand retry, regenerate, swipe, edit, and branch operations.
6. Add an optional per-character AIRI display-model mapping without mixing it into DreamLand character data.
7. Extend reality-line switching to group chats after group identity, membership, and cross-line privacy rules are specified and tested.

## Later work

- Optional injection of selected Moments memory into ordinary character chat after prompt-budget, privacy, and regression review.
- A project/workspace layer for multiple stories or role-play contexts.
- Secure LAN device discovery and synchronization with authentication and a documented threat model.
- Signed installer, update strategy, version migration, and release automation.

## Not promised yet

There is no stable release schedule, public synchronization service, compatibility guarantee for unreleased schemas, or automatic publishing pipeline.
