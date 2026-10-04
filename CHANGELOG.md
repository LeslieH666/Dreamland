# Changelog

All notable LeslieTavern-specific changes are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project does not yet promise semantic-versioning compatibility.

## [Unreleased]

### Added

- Shared glass appearance sliders in Settings: transparency (0–100%) and Gaussian backdrop blur (0–48 px), with scrollable live previews and reset. Login cards and functional page headers share both values; chat headers keep the theme pink tint while other headers use the neutral surface. Real page content scrolls beneath the header and supplies its changing backdrop; functional headers no longer expose a static page wallpaper. Settings persist in the existing validated account preference map with login appearance hints and previous-record rollback; older records use defaults without migration.

- Added a default-off experimental group-chat smart-speaker mode for existing permanent members. It combines explicit mentions, bounded character-card relevance, turn balance, recent-speaker penalties, existing talkativeness, and configurable reply caps while preserving forced replies, Swipe, native generation, and a fail-open natural-order fallback.
- Added manually created current-chat temporary group roles backed only by versioned JSONL metadata. Active roles join normal prompt and speaker selection through hidden runtime adapters; dormant and archived roles retain Swipe, branch, and shared-memory attribution while remaining absent from the character library and permanent group data.
- Added default-off model-assisted temporary-role review. One isolated bounded structured call can propose an editable new-role draft, an optionally immediate confirmed reply, and evidence-based retirement candidates, while schema validation, cooldowns, current-chat identity checks, and explicit confirmation prevent direct model creation or archival.
- A plot compass for solo story chats that generates three memory-aware, multi-stage arcs with an explicit in-world horizon, lasting impact, and optional 12–80-turn estimate. Accepted v1 plans migrate in place; desktop keeps a compact header pin while mobile uses a separate dock and bottom sheet. The chat-header appearance toggle has been removed, with appearance controls remaining in the sidebar and settings.
- An opt-in experimental interaction-relationship layer for solo character chats. A/B/C memories now support auditable six-dimension attitude impacts from 0–100, C-class recency decay, automatic A-class approval, deterministic score rebuilding, prompt-time attitude guidance, and API-assisted conversion of older memory summaries without changing character cards or chat JSONL.
- Password-selected Leslie user spaces with a blurred login screen, settings-based account creation and switching, encrypted account and legacy-backup migration, a retained encrypted rollback snapshot, and graceful sealing on logout and desktop exit.
- User-space password forms now fit narrow settings panels, and account activation, creation, and password changes accept any nonempty password length.

- Same-subnet mobile model selection and quick setup can now request managed KoboldCpp startup on the LeslieTavern computer, wait for readiness, and configure the existing chat API without first starting the model on desktop. The fixed HTTP actions require the normal login and CSRF checks and accept only cataloged GGUF models.
- Four Leslie color palettes (Jade, Iris, Clay, and Slate), each with coordinated light and dark surfaces, accessible chat-bubble contrast, a shared appearance-menu picker, and a settings-page selector saved in the current browser.
- A dedicated new-chat action for the current character and world line, including multiple reality chats with generated instant-message openings and a line-labelled history picker with confirmed chat deletion.
- An online-only Moments model picker sourced from configured DeepSeek, OpenAI, OpenRouter, Claude, or Google AI Studio connections, using the account's saved model and credentials without duplicate API fields.
- A unified chat header with the former composer chat tools grouped under its menu; the unused original-layout toggle and duplicate old chat controls are removed from the visible interface.
- Purposeful Cupertino motion for direct control feedback, menus, chat changes, newly inserted messages, mobile navigation, and large overlays, with a system Reduce Motion path that removes spatial transforms.
- A Cupertino design language for the conversation list, chat header, message bubbles, and composer, plus a persistent in-app switch back to the previous classic presentation.
- A presentation-only design-language preference with unit coverage and a documented pre-refactor Git recovery point.
- A session-scoped demo mode that switches each account to an isolated `_demo` storage namespace without copying normal chats, characters, memories, or credentials.
- Persistent Leslie Moments background activity with genuine per-character read receipts, selective AI likes and comments, bounded retry/rate controls, and sidecar storage that leaves the original timeline intact.
- A persisted three-level Leslie Moments enthusiasm slider that adjusts public-interaction probability, participating character count, and initial response delay while retaining the hourly model-call limit.
- Threaded Leslie Moments replies that let Personas and AI characters continue conversations across repeated background selections, plus a clickable liker list with character identity and timestamps.
- Explicit per-character AI publishing permissions for both recently used and library-only characters, with text-only character-authored Moments, frequency controls, optional read-only chat-memory access, and delete-only user moderation.
- Per-character Moments comment/reply permissions beside the existing publishing controls, with likes remaining available even when a role is muted from conversations.
- Persona-authored Moments likes and unlikes for AI character posts, with the heart action separated from the clickable liker-count control.
- Persona-authored Moments replies now stay bound to the Persona that published the post, including a backed-up, idempotent repair for older cross-Persona comment authors.
- An isolated per-character Moments memory store with Persona/story-scope boundaries, cross-post retrieval, source invalidation, current-chat memory-topic import, and a disabled-by-default future prompt-injection adapter.
- An independent Moments content-role picker for story ownership and approved-memory topic import, separate from the audience visibility picker.
- A LeslieTavern system tray with background Moments status, pause/resume controls, window restoration, and an explicit application exit action.
- Semantic Leslie reply modes that inject a fail-open presentation instruction before foreground character replies without modifying character cards, memories, sampling temperature, or stored chats.
- Electron desktop workflow and Windows portable-package tooling.
- Leslie memory, identity isolation, moments, character workshop, and voice modules.
- Repository privacy guard, public documentation, community templates, and read-only CI.
- Disabled-by-default Leslie Bridge v1 foundation for AIRI, including bearer authentication, capability discovery, an OpenAPI draft, and OpenAI-compatible Volcengine speech synthesis.
- AIRI chat model gateway with streaming, cancellation, active LeslieTavern model discovery, and stored provider credentials.
- Authoritative AIRI companion turns that follow the active LeslieTavern character and use its normal card, World Info, Persona, memory, chat persistence, model, and Volcengine voice.
- Automatic AIRI voice input through LeslieTavern's local speech-recognition model, with no additional API key.
- Windows desktop launch orchestration with automatic Bridge token generation, AIRI discovery, diagnostics, rebuild, logs, and tracked shutdown.
- Leslie chat-menu exports for a CCV3 PNG character card, the current SillyTavern JSONL chat, or a ZIP containing the shareable card and all of that character's JSONL chats.
- Optional interactive-guidance chat mode that uses the active model, character context, World Info, Persona, and Leslie memory to offer three live replies explicitly authored by the current user Persona while preserving free-form input and ordinary JSONL messages.
- One-click local Peach 2.0 GGUF setup in Leslie's model-connection settings, with KoboldCpp and llama.cpp endpoints plus 8GB-friendly RP defaults.
- Character workshop generation can now switch between the existing DeepSeek/current chat API and the local Peach 2.0 KoboldCpp API; local runs stay as an in-memory preview until the user explicitly applies them.
- Role memory automation can now use a separate DeepSeek API connection with the same OpenAI Chat Completions request format as the chat API.
- Added an in-memory DeepSeek safety-test workbench that reuses the active character card prompt, runs authorized line-by-line checks, and exports results without writing to normal chats.
- Added separate story and reality chat lines for solo characters. Reality chats use the device clock and elapsed offline interval, while confirmed memories can cross through the same character only as a two-item, tightly budgeted echo from the opposite line.
- Reworked reality-line generation around a one-time de-fictionalized personality profile. New reality chats now receive model-generated openings, all foreground replies bypass story-only card fields and World Info, and a strict plain-message validator retries decorated role-play output before anything is stored.
- Added a desktop-first two-pane Moments layout with role and world-line navigation, plus a compact single-column mobile fallback.
- Added Electron settings controls for starting and stopping AIRI and the tracked Peach local-model process.

### Changed

- Removed old brand launchers and unused upstream deployment files. Windows startup now uses only the DreamLand launcher in each workspace.
- Removed duplicate AIRI blog media and updated translations to use the retained files.
- Encrypted user-space entry now restores small files with fewer disk operations. Login and switch controls show progress during vault work; encrypted rollback snapshots and full verification before resealing remain in place.
- Refined Moments with Cupertino grouped controls, matched like/comment counters, correctly bounded liker avatars, adapted reply/thread UI, selected-first choice lists, complete bound and legacy memory-source discovery, A–B–C or newest-first memory-topic sorting, fixed-layer dialogs that do not shift the desktop timeline, independently editable story visibility, and one read count per character on each post revision.
- Moments timeline, activity, and queue stores now migrate legacy data through preserved pre-migration copies. Legacy unread posts are scheduled for genuine background reads, while posts with existing reads or comments retain their activity and gain reply support without being replayed.
- Every authenticated local user has the same reversible delete/restore permission for Persona-authored and AI-authored Moments; only the originating Persona may edit a user post, and AI text cannot be edited.
- Closing the Electron window now hides LeslieTavern to the system tray so approved Moments activity can continue until the user explicitly exits the process.
- Isolated background generations can opt out of current-chat prompt hooks and can be cancelled independently when a foreground reply starts.
- Upgraded the AI character workshop with an optional structured blueprint, AI completion for blank fields, a directly editable post-generation card, and a local avatar picker that hands images to the existing character editor without an extra AI pass.
- Replaced the fixed 180/360/500/1500-token reply-style presets with qualitative balanced, novel, dialogue, concise, and no-injection modes. Verified DeepSeek foreground requests now let the provider choose the output allowance while prompt assembly keeps a separate safety reservation; quiet jobs and other providers retain explicit compatibility limits.
- Stopped issuing hidden automatic continuation requests when a provider-controlled DeepSeek reply reaches its service-side output boundary; the UI now leaves continuation to the user.
- 收紧本地 Peach 角色扮演默认采样与回复约束，减少机械反问，并关闭非推理模型的 reasoning 传递。
- Consolidated development and portable workspaces into one Git repository.
- Made allowlisted LAN access follow the directly connected private subnet so changing Wi-Fi no longer requires per-device IP entries.
- Made the Windows launcher prefer resolvable hostname URLs and record both stable and numeric LAN addresses for recovery after DHCP address changes.
- Integrated the complete AIRI source tree under `airi/`, removed its nested Git metadata, and made the LeslieTavern repository the single versioning and push boundary.
- Separated source-controlled files from local data, runtimes, caches, logs, and backups.
- Made the local Windows launcher verify the listener resolved from its actual configuration and report available LAN URLs when allowlisted LAN access is explicitly enabled.
- Simplified the dedicated AIRI frontend to auto-configure Leslie chat and speech, skip onboarding, hide provider and profile choices, and show only connection and display-model settings.
- Made the desktop AIRI launch workflow rebuild AIRI automatically when its source is newer than the existing desktop build.
- Made the desktop AIRI launch workflow build AIRI workspace dependencies before the desktop app, preventing missing package exports after branch switches or clean checkouts.
- Removed cross-window `DataCloneError` failures from automatic Leslie provider setup.
- Made character-avatar replacement preserve the existing character card and refresh character state, thumbnails, chat images, and editor previews without stale browser caches.
- Made AIRI Live2D startup fail open when local IndexedDB hydration stalls, restored the bundled Hiyori model when the companion selection is empty, kept the companion renderer active in the background, and stopped opening DevTools during ordinary local launches.
- Kept bundled Live2D loading independent of OPFS and moved custom-model cache persistence behind the visible model pipeline so a stalled browser storage backend cannot lock the stage and shortcut controls on “Loading”.
- Removed the unused eager DuckDB/WASM bootstrap from the character stage; the placeholder initialization consumed hundreds of megabytes and could monopolize the renderer before the Live2D frame became interactive.
- Made the Windows launcher accept only a complete, successfully stamped AIRI build so a failed partial rebuild cannot mix new main-process code with a stale renderer.
- Consolidated the root Windows launch surface into `启动 DreamLand.cmd`; AIRI and local-model lifecycle controls now live in DreamLand settings.
- Reality-line entry now reopens the latest matching JSONL and upgrades older metadata in place instead of creating a successor chat. Each deliberate entry produces one non-duplicated proactive greeting before the conversation continues, and reality memory snapshots no longer retain scenario, example-dialogue, or creator-note fields.

### Fixed

- Reality-line background openings and replies are now bound to the originating character, JSONL file, integrity ID, and session. Switching chats cancels and settles pending reality work before the transition, preventing a completed reality request from appending to or reclassifying a story chat.
- Moments background interactions now use DeepSeek's beta chat endpoint with thinking explicitly disabled, preventing successful reasoning-only responses from being misreported as empty API output.
- AIRI startup from Leslie settings now verifies the authenticated loopback Bridge before launching, remains available while an encrypted space is locked, and binds live character state to the active user space without moving AIRI display-model files into per-user storage.
- Encrypted user-space login now falls back to a widely supported session digest when Electron omits SHAKE-256, and login failures display a readable server error.
- Deleting the open history chat now clears its messages and sidebar preview immediately before loading the next chat.
- Desktop chat shows one privacy shortcut in the conversation sidebar; mobile retains a shortcut on each of its separate pages.
- Mobile local API quick setup now detects supported models through the LeslieTavern host instead of probing the phone's loopback address.

### Security

- Portable builds default to localhost-only networking and empty user data.
- Local LAN web access retains an explicit IP allowlist and is intended to be paired with a trusted-interface and subnet-scoped firewall rule.
- Private user artifacts and local planning notes are excluded from Git and distribution builds.
- Only successfully bearer-authenticated Leslie Bridge requests bypass CSRF protection; all other routes retain the existing login and CSRF boundary.
- Leslie Bridge model-gateway logs omit AIRI message and provider-response bodies.
- Local speech-recognition logs omit transcribed user text.
