# Roadmap

## Workshop appearance choices and scoped revisions (2026-10-04)

- Appearance fields offer compact, optional presets for measurements, build, posture, hair, eyes, clothing and distinctive features. Choices remain editable as text; alternatives in a group replace each other, with selected choices removable by clicking again.
- Before editor handoff, a local revision panel can change appearance with image prompts or image prompts alone. It previews exact before/after fragments and requires explicit application; withdrawing keeps the draft. Only description fragments and the appearance blueprint can change, while other card fields and opaque extensions are preserved. Image prompts are directly editable without a model call.
- Invalid, overlapping or ambiguous patches, out-of-scope fields and stale proposals are rejected. This is page-only draft state with no persistent schema or chat changes. The patch protocol can support additional explicitly bounded fields later; currently AI revision is restricted to appearance and image prompts.
- Validation: 52 relevant unit checks and a mocked synthetic browser flow cover preset selection, preview/apply/withdraw, independent prompt editing, unchanged other modules and mobile layout. Repository hygiene and source/test lint passed without errors. Actual DeepSeek output quality still needs acceptance with the configured provider.

## Progressive workshop blueprint (2026-10-04)

- Each blueprint category has an explicit confirmation action. Confirmation adds a round check indicator on the right, collapses the current category and opens the next in order; the final confirmation focuses supplemental notes. Empty fields remain delegated to AI and generation does not require every category to be confirmed.
- Manual reopening preserves values; editing invalidates only that category's confirmation. Clearing resets checks and opens the first category. Generation/rehearsal locks category controls. Height/opacity animations handle rapid toggling and cancellation; reduced-motion preferences receive immediate transitions. Confirmation state is page-local with no persistent schema change.
- Validation: 46 related unit checks and the synthetic browser flow passed, covering all seven confirmations in order, local edit invalidation, value preservation, rapid toggles, reset, generation locks and reduced motion. The browser verifies the 260 ms animation and desktop/mobile check indicators. Repository and source/test lint passed without errors; existing unrelated test warnings remain.

## Rehearsal action simplification (2026-10-04)

- Rehearsal exposes one stage-specific primary action and an optional “更多操作” disclosure. The final scene can directly generate a card with human originals; optional analysis and destructive AI rewriting have distinct labels and explanatory titles. Skipping, replacing and returning to the blueprint remain available in the disclosure.
- Functional controls use inclined neutral/blue/yellow game bases; scene switching uses thin borders and no raised shadow. Labels and hit areas stay upright. No schema, saved-card or chat changes.
- Validation: 46 related unit checks and the synthetic browser flow passed. The browser verifies the single visible primary button, explicit retention/discard titles, optional analysis under the disclosure, flat scene switches, inclined functional controls, human-line preservation and desktop/mobile layouts. Repository and source/test lint passed without errors; existing unrelated test warnings remain.

## Workshop draft discard and footer controls (2026-10-04)

- A persistent “放弃并清空” action clears unsaved drafts, rehearsal, avatar selection, blueprint fields and notes, and restores the empty creation flow. Pending generations are invalidated before clearing; stopping generation remains separate and retains inputs. Saved cards, connection selection, random preferences and recent-name history are preserved.
- Footer controls share the game's inclined base: neutral utility/discard controls, blue review and yellow editor handoff. Labels and hit areas remain upright, with wrapping on narrow screens. This workshop exception is recorded in the control-shape specification.
- Validation: 46 related unit checks and the synthetic browser flow passed, including clearing a completed card and inputs, preserving provider selection, cancelling a pending generation without late-result restoration, and desktop/mobile footer layout. Repository and source/test lint passed without errors; existing unrelated test warnings remain.

## Workshop name deduplication (2026-10-04)

- Original characters without an entered name exclude the 30 most recently generated names in the current page session. Local checks detect whitespace and temporary-name suffix variants, with up to two retries for empty or repeated names; persistent duplicates stop before card creation.
- Drafts and reviews must retain the selected name; human renames remain authoritative. Entered names, adaptations and imported cards retain their existing behavior. History is in memory only, clears on refresh, and does not read saved cards or chats or introduce a persistent schema.
- Validation: 9 focused name tests, 37 related unit checks and the synthetic browser flow passed, including a repeated name followed by automatic retry and a new final name. Repository and source/test lint passed without errors. Live DeepSeek rerun was unavailable because the previous local connection settings file was no longer at its original path; no live-model success is claimed.

## Human-authored workshop voice rehearsal (2026-10-04)

- Writing workflow v1.5.0 adds optional three-scene rehearsal after the brief/knowledge stages. The model plays the blueprint's player; users write two character responses per scene. Followups depend on the actual response, without character reference answers. Automatic and random generation remain available.
- Scene navigation, rewriting, skipping, replacement and pause preserve the current in-memory workflow; changing the first reply resets dependent second turns. Model analysis requires quoted character evidence and traceable locked facts. Users resolve flagged conflicts; the model cannot silently rewrite human lines or locked settings.
- Draft and review requests use human originals plus supplemental examples; deterministic merging keeps originals first through repeated AI review. Editing final examples manually releases old rehearsal protection. No chat, memory, account-storage or persistent schema changes; refresh discards unsaved rehearsal.
- Validation: 42 focused unit checks and the synthetic browser flow passed, covering context-dependent second turns, invalidation after rewriting the first turn, pause/navigation, traceable conflict display, verbatim originals through draft/review, manual release of protection, and desktop/mobile layout. Repository/source/test lint passed without errors (existing unrelated test warnings remain). The browser used an isolated synthetic data root on localhost and mocked model calls; real voice-quality comparison still requires human-written examples and independent evaluation.

## Character workshop spoken dialogue (2026-10-04)

- Writing rules v1.4.0 separate workshop guidance from compact positive runtime contracts; short replies usually use 1–3 spoken sentences with optional brief actions. Detailed replies and higher action ratios retain user-selected controls. The brief defines a concrete voice, with 6–8 examples and at least two continuous two-round exchanges; original unedited workshop cards now enforce that structure while imported and manual cards retain compatibility.
- Dialogue controls offer restrained, expressive and theatrical intensity, with expressive as the unspecified generation default. Character identity, cultural register and relationship pace remain authoritative; imported cards retain their existing voice and valid examples unless changed explicitly.
- Writing and review share spoken-language guidance. Review preserves character-specific flaws, sharpness and emotional intensity instead of smoothing every response into polite explanatory prose.
- Local checks validate roles and nonempty turns per example, accept length-aware output contracts and report repeated longer replies without lowering the score. CCV3 macros, preview/manual saving, model adapters and persistent schemas are unchanged.
- Verification uses synthetic fixtures for legacy/imported cards, user controls, multi-round examples and compatibility. A controlled live DeepSeek Flash pilot generated 12 synthetic cards and 72 replies: v1.3.0 did not meet colloquial-style acceptance. The author's anonymous assessment preferred the baseline in 23/30 probe pairs (20/25 after excluding a baseline card with missing required fields). Emotional continuity improved, but prose length and persona drift need another revision; only 3/6 revised cards met the requested example structure. The harness recorded blueprint fidelity separately rather than enforcing the full UI review gate, so this is not end-to-end acceptance. Independent human review, the complete UI pipeline and local-model acceptance remain pending; reality-line personality extraction is outside this change.
- A fresh v1.4.0 vs v1.2.0 controlled repeat generated 12 synthetic cards and 96 replies, including two additional probe inputs. Author-rated fixed probes preferred v1.4.0 in 22/30 pairs; all six new cards met example structure without JSON repairs. Additional inputs tied 6:6; impatient-role grounding and fixed-opening task repetition remain problems. The baseline's rating also varied substantially across rounds. Strict acceptance remains unmet on persona fidelity; these small subjective samples are not independent human or full UI acceptance.

## Header decoration rollback (2026-10-04)

- Restored the subtle gradient/pattern and original title insets across feature headers, including Settings. Removed the Settings-specific triangle experiment and shared-header strip experiment; aligned heights, flat settings controls and functional changes remain.
- The supplied title sprite remains archived as unused artwork. Original design documents remain unchanged.

## Function title artwork refinement (2026-10-04)

- Applied the user-selected original Common_Top_Menu_Bg artwork to feature headers, replacing faint button-pattern decoration. Reserved a modest left inset (52 px desktop / 20 px mobile) while retaining aligned 60 px headers and upright text.
- Artwork provenance and portable-pack validation include the new original sprite; existing settings surfaces and original design documents remain unchanged.

## Aligned headers, random cards and feed-first Moments (2026-10-04)

- Fixed desktop page headers to the same 60 px frame as the sidebar; restored the original MomoTalk wordmark's 4:1 display ratio without scaling the whole UI.
- Added the supplied CardShop / MinigameOption assets and a workshop random entry with account-scoped, validated preferences and a previous-value backup. Reuses the three-stage writing/review pipeline, preserves the ordinary form, and requires preview plus manual saving.
- Moments opens directly on its feed; model, enthusiasm and permission controls moved into a settings panel. Publishing expands on demand and keeps the draft when collapsed or navigating away.
- Updated the current UI specification; the original design documents and reverted flat settings surfaces remain unchanged. Generation verification uses synthetic model responses; live model content quality remains for user acceptance.
- Validation: repository hygiene and source lint passed; random-preference, existing workshop and artwork unit checks passed. A synthetic browser scenario checks desktop header alignment, the three-stage mocked generation, preserved drafts and 320/390 px layouts; all 72 runtime image hashes verified.

## Colored navigation and compact spacing (2026-10-03)

- The accepted home icon is upright; navigation now reads Home, Chat, Moments, Workshop, Settings. The four specified original colored sprites retain their aspect ratios and colors. About moves into Settings with a return action.
- Home renders the existing greeting/activity template in its own page, preserving the active chat DOM and draft. Chat resumes the current session or opens the newest native recent chat after login, including group chats.
- Desktop headers shrink to 60 px, contacts to 68 px and navigation to 68 px; mobile navigation is 64 px plus the safe area. Artwork/text are never stretched, and mobile chat tools retain their existing touch layout. Flat settings surfaces and original design documents remain preserved.
- The text-only UI specification is updated to v0.2. Runtime artwork provenance distinguishes four original game sprites from the generated home icon.
- Validation: repository hygiene and source lint passed; 19 relevant unit checks, five browser scenarios and all 70 runtime image hashes passed. Synthetic desktop/light/dark/320–390 px checks cover navigation, recent-session loading, live draft/chat preservation, background cleanup and the original editor save flow. Live desktop acceptance remains with the user.

## Current UI specification draft (2026-10-03)

- The [v0.1 UI specification](ui-design-spec.md) documents the current MomoTalk structure, semantic colors, component shapes, flat settings rollback, mobile layout and development acceptance checklist. Existing behavior is distinguished from proposed constraints; original design documents are preserved.
- The draft is text-only at the user's request. The project overview links future UI work to this reference; no runtime interface or user-data behavior changes are introduced.

## Settings menu tiles fully reverted (2026-10-03)

- Settings categories, quick controls, feature rows and section cards return to their original flat styling before the game-menu reference was introduced. Both the first-pass white rims/raised edges and the subsequent darker-material pilot are removed; secondary settings actions regain their preceding neutral game base.
- The original downloaded title ornament remains applied; home rounding, circular chat tools and other existing changes remain intact. Original design documents are preserved.
- Validation: repository hygiene, lint, eight relevant unit tests and four browser scenarios passed. Light/dark/mobile previews confirmed flat category and section surfaces without the added white rims or raised edges; 29 other changed files and CSS outside the settings block were verified unchanged.

## MomoTalk control shapes and menu tiles (2026-10-03)

- Home activity entries share a rounded frame; conversation entries have consistent rounded selection/hover backgrounds and inset spacing.
- Everyday chat-header tools use circular, upright targets. Confirmation, submission and primary configuration actions retain the inclined game base; cancellation and secondary utilities use upright neutral tiles.
- Settings categories, quick controls and feature entries use pale menu tiles with a bright rim and a shallow bottom shadow in both display modes. Native fields, switches and mobile line labels retain their usable shapes.
- The original design/appearance documents are preserved. See [the supplementary shape rules](ui-control-shapes.md); no user-data schema or chat behavior changes are involved.
- Validation: repository and source lint passed, as did 15 relevant unit checks and seven desktop/mobile browser scenarios. Synthetic previews verify both display modes, activity frames, menu tiles, distinct confirmation/cancellation shapes and mobile settings; test lint has no errors.

## MomoTalk chat tools, background visibility and desktop width (2026-10-03)

- Header tool icons now contrast with their neutral game button bases in both display modes. Font Awesome aliases retain their icon font.
- Backgrounds move from the bottom navigation into Settings > Appearance. This entry opens the existing full-area controls without a drawer overlay. A toolbar exposes display mode, return to settings and chat preview; picking an image (including the current image) enables display when it was off.
- Translucent chat/composer canvases reveal native global and chat-specific backgrounds. Native fitting options remain usable, background settings retain their existing persistence format, and mobile thumbnails leave enough space for selection beside the context menu.
- Desktop messages and composer share a 1280 px reading area, with longer bubbles up to 1160 px. Mobile sizing, drafts, world-line selection and ordinary chat remain intact.
- Validation: 23 desktop/mobile browser scenarios and 15 relevant unit checks passed against an isolated synthetic data root on localhost. Final focused checks also cover fitting controls, same-image selection, background navigation and the mobile back icon. Repository hygiene and source/test lint passed without errors; existing test lint warnings remain. A live Electron acceptance and portable rebuild remain release checks.

## Classic BA button geometry and rounded typography (2026-10-02)

- MomoTalk retains its pink header and one default rose selection accent. Confirmation/continue controls use classic yellow; creation/generation/publishing controls use blue; secondary and icon tools use neutral game bases. Complete nine-slice visual bases incline while text, icons and hit targets stay upright. Missing artwork preserves usable fallbacks.
- The real game wordmark, continuous contact rows, round avatars, segmented filters/world-line tabs, compact bubbles, cut-corner portrait frames, notebook details, subtle triangular headers and yellow title rules follow the supplied game references. Feature pages retain full-area navigation.
- The runtime allowlist contains 64 verified images, including an independently pinned Texture2D wordmark bundle and declared blue/yellow/dark button adaptations. Restoration supports the source CDN and checked local UI-library bundles.
- A local OFL Resource Han Rounded CN subset supplies the UI/login rounded font with immediate system fallback. Source/license/checksums and a reproducible builder ship with the font. Blueaka is not bundled because its redistribution license remains unverified.
- Validation: 15 relevant unit checks, 19 desktop/mobile browser scenarios, live font loading and blocked-font navigation passed. Game bases and upright labels were visually reviewed in light/dark UI; repository/source lint and all 64 artwork hashes passed. Verification uses an isolated synthetic data root and localhost listener; a full portable rebuild and live Electron acceptance remain release checks.

## Consistent rose buttons and game UI controls (2026-10-02)

- MomoTalk keeps the default rose accent; other palette selectors and quick-menu choices are removed. Valid legacy palettes migrate to rose with an exact, one-time `.before-rose` backup, without changing the v1 preference schema or the saved display/background settings.
- Continue, quick actions, settings, workshop, Moments, memory and confirmation buttons share the same border/corners and contrast-controlled adaptations of the game's red texture. Blue/yellow button and header accents no longer mix with the rose theme.
- Six navigation icons use original game glyph contours at one size and inherit neutral/selected colors. Search, new-chat, import and liked-post controls also use small game sprites; missing images retain the original fallback behavior.
- Twenty additional original/declared-adaptation images are now in the runtime allowlist (57 files total). Offline restoration, all 57 HTTP hashes, inherited Windows ACLs and portable allowlist copying passed. The complete future-development library remains a separate 901 MiB asset Release.
- Validation: 19 relevant unit checks and six browser scenarios passed, including legacy preference migration/rollback, two-account/demo/login display settings, artwork failures/recovery and desktop/mobile layouts. Light/dark button previews were visually reviewed; repository and source/test lint have no errors. A full portable rebuild and live Electron acceptance remain release checks.

## Interface asset library and login avatar fallback (2026-10-02)

- Archived 420 verified interface/dependency bundles from pinned Global Android 1.93.454564, excluding 1,333 game-content bundle families. Exported 7,212 PNG entries and 21 NGUI atlases with crop/border metadata; 14 empty dynamic font atlases are recorded separately and preserved in the source bundles.
- Source URLs, original MD5/size, SHA-256, exclusions and image lookup metadata are retained. The 901 MiB archive is distributed through this repository's asset Release; its local project directory is excluded from ordinary Git and portable builds. Runtime continues using the small bundled artwork allowlist.
- Encrypted-space account selection now uses the shipped public DreamLand icon instead of a missing legacy default image. Personal account avatars remain inside the decrypted account boundary.
- Validation: all 420 original hashes and all indexed PNG hashes passed; export has no errors. Repository/source/test lint have no errors and 669 unit checks across 55 suites passed. Archive paths and CRCs are verified before publication.

## Bundled artwork and readable light navigation (2026-10-02)

- All 37 verified game images and their checksum ledger now live in the project-owned `public/img/blue-archive/bundled/` directory. Runtime and portable preparation use this directory; no separate local pack install is needed.
- The previous extraction preserved private temporary-directory ACLs on Windows, preventing the ordinary desktop process from reading the images. Bundled copies inherit the public directory's permissions; the restoration script now creates replacement files there as well.
- Chat and Moments navigation only use a colored icon tile once their game sprite is ready. Missing-image fallback icons retain a transparent background and readable inherited color in light and dark mode.
- Validation: all 37 same-origin artwork URLs returned images with matching SHA-256 checksums, and all 38 bundled files (images plus ledger) inherit the public directory ACL. The host image reader can open the copied icons. Ten artwork/packaging unit checks and five desktop/mobile artwork/recovery browser scenarios passed; repository and source/test lint have no errors. Portable allowlist copying and both restoration/build script syntax checks passed.

## Unified MomoTalk UI and resilient local artwork (2026-10-02)

- MomoTalk / BA is the only layout. Alternate layout selectors, stylesheets and motion modules were removed; extension/native-control foundations now serve the same page system.
- Appearance exposes independent colors, system/light/dark mode, home scenery, chat backgrounds, language and accessibility/performance controls. Login uses the same palette. Legacy per-space layout values migrate with an exact, one-time rollback backup; the v1 storage format is unchanged.
- Artwork loads with four concurrent requests, immediate partial success, bounded retries and fresh retry URLs. Failed requests can recover from settings, network reconnection or return to the foreground. Status distinguishes missing installation records from resource read failures.
- Local portable builds validate and copy the 37-image allowlist, excluding previews and user state; missing/corrupt source artwork fails before output cleanup. Runtime/data-root/listener boundaries remain unchanged.
- Space sealing now flushes and retires trailing ordinary/demo chat backup timers before encryption, preventing closed demo directories from being recreated during a later login.
- Validation: repository and source/test lint passed (no errors), 667 unit checks across 54 suites passed, and 22 browser scenarios passed across artwork recovery, single-layout desktop/mobile navigation and isolated two-account/demo preferences. The 37-image source/copy validation and portable data-root/listener configuration checks passed; a full portable rebuild and live Electron acceptance remain release checks.

## Demo content, account preferences and responsive space login (2026-10-02)

- Isolated demo spaces now seed three fictional characters, six native story/reality JSONL chats (96 messages), 12 Moments posts with comments/likes, and six memory profiles with A/B/C events, growth and calculated relationship dimensions. Seeding is idempotent and preserves edited demo content.
- Browser presentation and interaction preferences now persist per account and demo namespace in a validated v1 sidecar. Existing default-account preferences migrate on first load; native SillyTavern settings retain their existing save path. Logout and space changes flush pending saves. The previous preference record is retained for rollback.
- Login uses the last saved appearance and each selected account's theme. Only allowlisted appearance values are available before decryption; account preferences remain inside the encrypted space.
- Password derivation and file encryption/decryption are asynchronous, with four concurrent file jobs and streaming for large files. Login displays phase and file progress while the server stays responsive. The encrypted vault format remains v1.
- Sealing waits for outstanding account requests, thumbnail work and deferred chat backups; authentication is checked again after asynchronous account lookup. Complete working folders can recover after interruption. Late fragments are preserved in separate encrypted snapshots instead of replacing the complete vault; directory/file changes abort sealing before working data is removed.
- Desktop exit waits for sealing and permits retry after a disk failure. Portable data-root and localhost listener boundaries are unchanged.
- Validation: 657 unit checks across 52 suites passed, along with repository/source/test lint, the synthetic two-account/demo browser flow (including mobile login), and portable configuration boundary checks. Verification uses only isolated synthetic data; a full portable rebuild and live Electron acceptance remain release checks.

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
