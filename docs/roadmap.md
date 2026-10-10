# Roadmap

## Phase 3 dual packaging: platform injection and two build targets (2026-10-09)

- The Electron shell is now explicitly a pure desktop host owning three responsibilities: the system tray, automatic startup of the bundled backend and window, and sealed exit. The only IPC left is the moments status/tick channel that drives the tray label; the companion frontend and in-app model controls were removed in Phase 0.
- Added `src/platform/` as the single place that inspects the process platform. It injects two interfaces — data root (a mounted server volume versus an install-relative desktop directory) and secret storage (Windows DPAPI versus AES-256-GCM under `DREAMLAND_SECRET_ENCRYPTION_KEY`, with both formats readable during a migration). Business code asks for a capability instead of branching: `src/util.js`, `src/server-main.js` and `src/endpoints/secrets.js` no longer contain platform checks.
- `src/secret-protection.js` became format-aware, so an existing DPAPI secrets file can be read after a deployment switches to encryption-at-rest, and a tampered AES file fails to open instead of returning wrong plaintext.
- Added the two packaging targets with shared-input verification: `npm run build:server` (backend plus the single `public/` UI into a container image, with the build context proven free of the desktop host, mobile clients, packaging and tests) and `npm run build:desktop` (the same backend and UI plus the Electron host). `npm run verify:targets` runs both checks without Docker or Windows.
- Desktop dependency setup is reproducible now: `src/electron/package.json` allows the Electron postinstall, which npm 12 otherwise blocks, resolving the Phase 1 deferral.
- Verified on this host: the server image equivalent boots and both targets serve the same `public/` tree; the Electron host starts the bundled server and completed a full chat with streamed SSE against a mock model.

## Phase 2 public API v1, token auth and the adapter layer (2026-10-09)

- Added `/api/v1` (`src/api-v1/`) as the versioned public surface for the web client and the React Native app: `/health`, `/capabilities`, accounts (`/auth/register`, `/auth/token`, `/auth/pkce`, `/auth/refresh`, `/auth/logout`, `/auth/me`), characters, chats (including SSE generation), groups, World Info, voices, speech, memory, moments, identity, workshop and key-id-only secrets. The contract lives in `docs/contracts/api-v1.openapi.yaml` and now records the two additions and every operation the server cannot serve yet.
- Authentication is dual-track: `/api/v1` uses short-lived HS256 access tokens plus rotating opaque refresh tokens (only their SHA-256 hash is stored) and optional RFC 7636 PKCE; the desktop web UI keeps its cookie session. The v1 router is mounted before the cookie-session and CSRF middleware, so neither track can affect the other.
- Added per-client and per-account rate limiting with `RateLimiter-*` and `Retry-After` headers over the existing `rate-limiter-flexible` dependency.
- The adapter layer (`src/api-v1/adapters/express.js`) reuses the existing routers by invoking them with a mock request/response. This keeps chat-core files untouched while avoiding duplicated business logic; the domain modules call exported stores (`LeslieMemoryStore`, `LeslieMomentsStore`, `LeslieIdentityStore`) and handlers (`SecretManager`, the Volcengine voice handlers) directly.
- Opaque ids hide internal file names; every id is resolved inside the authenticated account's own directories, so a forged id cannot cross accounts.
- Operations whose logic only exists in the browser answer `501` with a stable code instead of being re-implemented server-side: character avatar write, World Info entry writes, moment publishing, workshop generation, and swipe regeneration. Chat generation runs in gateway mode because prompt assembly is still browser-only.
- Refresh tokens live in memory for the test phase (single instance), so a server restart signs clients out; Redis remains deferred with the rest of Phase 6.

## Phase 1 server deployment: runtime modes, environment config, HTTPS (2026-10-09)

- Added the `DREAMLAND_MODE=server|desktop` runtime switch (`src/runtime-mode.js`, resolved in `src/command-line.js`, default `server`). Server mode never opens a browser, never starts Electron or a tray, and no longer seals the encrypted user space on exit, so a container keeps its mounted data root across restarts. The Electron host marks itself as `desktop` and refuses to start with `DREAMLAND_MODE=server`.
- Added `src/config-env.js` for 12-factor configuration: `DREAMLAND_*` variables now take priority over the legacy `SILLYTAVERN_*` variables and over `config.yaml` for the data root, port, listener, whitelist, CORS, TLS, basic auth, the cookie secret and the request proxy. Startup prints the active overrides with credentials redacted, and warns when a publicly reachable server still keeps credentials in `config.yaml`.
- Upstream API keys can be supplied by `DREAMLAND_SECRET_<KEY>` or by a mounted secret document (`DREAMLAND_SECRETS_FILE`, default `/run/secrets/dreamland-secrets.json`). Externally supplied keys become the active entry, are returned only masked, and never need to be written into the repository config.
- The container image now runs as the unprivileged `node` user with `tini`, and `deploy/` adds a Caddy TLS reverse proxy plus a compose stack where only Caddy publishes ports and API keys arrive as a mounted secret.
- Documented the environment variables in the README and made the Playwright browser channel overridable (`LESLIE_E2E_CHANNEL`), because every e2e spec previously hardcoded the Microsoft Edge channel and could not run on machines without Edge.

## Phase 0 removal of the AIRI companion and managed local models (2026-10-09)

- Removed the integrated `airi/` desktop companion frontend, the `src/leslie-local-model/` router, the `models/` GGUF catalog, Electron-managed AIRI and local-model service control, and the public local-model settings UI. DreamLand no longer ships, launches, scans, starts, or stops an AIRI or model process.
- Kept `src/leslie-bridge/` (minus companion-only routes) as the seed for the future versioned `/api/v1`: `/health`, `/capabilities`, `/model/chat/completions`, `/voices`, `/models`, and `/audio/speech` behind a process-scoped bearer token, disabled by default.
- Kept the SillyTavern chat engine, cloud model adapters, the Leslie identity, memory, moments, voice, workshop, and story modules, and manual connections to an already-running self-hosted or remote KoboldCpp / OpenAI-compatible endpoint. Model weights and inference runtimes stay outside this repository.
- Removed the AIRI documentation (`docs/airi-bridge.md`, `docs/airi-launcher.md`, `docs/airi-live2d-hiyori-analysis.md`) and its links from the READMEs, the documentation index, the project overview, and the packaging guide.

## Mobile chat fixes (2026-10-04)

- Keep the send button visible at a 44 px touch target on narrow mobile chat layouts while preserving the temporary hidden state used during slash-command execution.
- Route the model status/configuration card directly to Settings → Model connection.
- Show a clear, non-sensitive error when model discovery fails or returns an empty list instead of silently returning the connect button to its idle state.
- The connected and standalone APKs share these frontend fixes; the standalone server asset stamp advances to beta7.
- Bound model discovery requests to 20 seconds and report failed or empty model lists in the settings UI without exposing provider response bodies or secrets. Android WebView inspection confirmed the saved-key flow reaches the local model-discovery endpoint, which timed out while Node.js fetched the provider list; an unauthenticated WebView probe reached the same provider host. Android Node now prefers IPv4 results for outbound lookups, and diagnostic responses include only a safe failure category, upstream HTTP status, exception type and allowlisted system error code.

## Android standalone runtime beta (2026-10-04)

- Added an arm64 standalone APK that packages the DreamLand server with a hash-verified Node.js 24 Android pre-release runtime. The server listens only on `127.0.0.1:18790`; chat/config data use separate app-private directories and survive app updates. The existing connected-client APK remains a separate build flavor.
- AIRI, desktop local-model management and local transformer inference are disabled in Android builds. The app does not bundle the computer's `data/`, `Config/`, runtime state or credentials. Beta data remains on the device and is removed by Android when app data is cleared or the app is uninstalled.
- Validation: connected and standalone debug APKs build; standalone lint and v2 signature verification pass. A real Android 16 arm64 phone exposed a startup crash in the shared Material address field (wrong `LayoutParams` subtype); fixed in both flavors. Standalone mode uses only its fixed loopback origin and fails to a local retry screen rather than the PC connection form. Launch labels and adaptive launcher art use distinct flavors and the existing blue wave/light DreamLand mark; the native title bar hides when the WebView is ready. The standalone staging script now includes its untracked mobile capability module, which was missing from the APK and prevented settings initialization; the Settings page now opens on-device. Both APKs install and launch, and the standalone server returns HTTP 200 through an ADB-forwarded loopback port. Connected-to-PC chat flow, on-device chat/persistence acceptance and desktop-data migration remain unverified. Beta uses a third-party Node mobile pre-release and debug signing.

## Android connected client prototype (2026-10-04)

- Added a native Android phone/tablet shell with a Material-based server connection screen, remembered address, system-bar/keyboard handling, predictive-back support, file selection and responsive WebView display of the existing DreamLand client.
- Added a reusable `mobile/shared/` module for server-address validation and mobile capability policy. The first connected APK keeps chat and character data on the computer. Android client mode hides AIRI and local-model settings and forces the shared local-model gate off; the WebView blocks requests to other private-network origins.
- Added debug APK build instructions. The first APK targets Android 8 (API 26) and compiles against API 36. A user-owned release signing key, device acceptance, server TLS and an eventual standalone on-device runtime remain later work.
- Validation: Android shared address tests, Android lint, APK assembly and v2 APK signature verification passed. On-device launch of both flavors is verified after the shared startup crash fix; connecting to a real desktop server still needs interaction acceptance.

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
- One `DreamLand` desktop launcher; model connections stay user-configured through the existing cloud, KoboldCpp, and OpenAI-compatible adapters.
- Optional interactive-guidance input mode with three AI-generated replies anchored to the current user Persona, automatic collapse for free-form typing, and the existing model, character-card, World Info, Persona, memory, and chat pipeline as its source of truth.
- A story-line plot compass for solo chats, with three structured multi-stage arcs that state their in-world horizon and lasting impact, optional 12–80-turn estimates, versioned chat-metadata persistence with v1 migration, a compact desktop header pin, a non-overlapping mobile dock and bottom sheet, and active-plan guidance for existing reply choices without automatic character steering.
- Character workshop provider switch between the existing chat API and a manually connected self-hosted OpenAI-compatible endpoint, with structured-output budgeting and preview-only drafts.
- Per-memory model selection for automatic memory extraction and growth synthesis, including the existing chat API, the DeepSeek OpenAI Chat Completions API, local OpenAI-compatible runtimes, and independent OpenAI-compatible endpoints.
- Model connection checks retain the selected provider and visible endpoint across settings refreshes, recover the button after failures, and keep autosave/backup maintenance from taking down the service.
- Online API keys persist per account and provider across connection switches. The Leslie settings page saves pending keys before switching, shows saved-key state without revealing values, and Windows migrates the local secret file to current-user DPAPI protection.
- Bundled Peach roleplay output now stops at its known bracketed state/scene continuation pattern before contaminated text can be saved into chat history.
- One-click standard Character Card V2/V3 JSON import in the manual character editor, with an optional avatar upload synchronized to the native create form before saving.
- A default-off group-chat orchestrator with deterministic mention/relevance/turn-balance scoring, bounded reply batches, an automatic-reply ceiling, server-validated namespaced settings, and native natural-order fallback. Current-chat temporary roles use JSONL-only versioned metadata, manual creation, hidden in-memory card adapters, active/dormant/archived lifecycle states, branch pruning, Swipe continuity, and shared-memory speaker attribution without entering the character library. A third-stage isolated structured review can propose one editable role draft, an optionally immediate confirmed reply, or confirmed retirement choices on demand, with optional cooldown-based suggestions disabled by default and no direct model writes. See [group-chat-orchestrator.md](group-chat-orchestrator.md).

## P2.5 里程碑报告：服务端权威轮次（2026-10-10）

**结论：P2.5 未收口。** 服务端 `/generate` 权威轮次已能逐字复现浏览器组装，oracle 从
`0/9` 前进到 **`6/9 byte-identical`**（solo-normal / solo-continue / solo-quiet /
solo-persona-depth / solo-author-note / group-normal），首分歧从 message 10 后移到
`swipe` / `regenerate` / `impersonate` 三个类型的 memory 子块；剩余 3 例各有具体证据，见下。
按令状 §6「2.5.4 = 9/9 逐字一致是硬关口」，本阶段**不标记完成**，也未进入 Phase 4/5 的
收口结论。

### 已达成的门禁（全部断言退出码与计数）

| 门禁 | 结果 |
| --- | --- |
| `npm run lint`（root） | exit 0 |
| `npm run lint --prefix tests` | exit 0（0 errors，155 warnings 为既有存量） |
| `npm run test:unit` | **80 suites / 944 tests passed**，无 failed |
| `npm run check:repo` | exit 0（1474 tracked files） |
| 红线 3 文件（`src/endpoints/chats.js`、`src/endpoints/characters.js`、`src/prompt-converters.js`） | 累计 diff 空 |
| `test:prompt-baseline`（浏览器 9 例） | **9/9 byte-identical**（改用本机 Chrome，见下节） |

### 浏览器基准门禁：已可运行，9/9 逐字一致

本会话找到了缺失的浏览器门禁的替代路径：机器上装有 Google Chrome，Playwright 可用
`channel: 'chrome'` 直接驱动它，无需下载 Chromium。`run-baseline.mjs` 新增
`LESLIE_BASELINE_BROWSER_CHANNEL` 环境变量（未设置时行为不变）。

**同时修掉 harness 自身一个会让该门禁说谎的缺陷**：原实现在 `page.evaluate` 里覆盖
`window.fetch`，与页面模块初始化存在竞态；实测它被绕过，录到的其实是**未被 stub 的
真实响应**，于是浏览器只"组装"出 10 条系统消息。改为用 `page.route` 在网络层拦截并
记录请求体后：

```
identical solo-normal (24)      identical solo-continue (25)
identical solo-swipe (19)       identical solo-regenerate (23)
identical solo-impersonate (24) identical solo-quiet (21)
identical group-normal (20)     identical solo-persona-depth (23)
identical solo-author-note (24)
All 9 case(s) are byte-identical to the baseline.
```

并额外验证：用修好的 harness `--record` 重录 9 例，与仓库中已提交基线
`diff -rq` **完全一致**。结论：**浏览器侧 9/9 门禁成立，抬升未回归，已提交基线可信**。

### oracle 现状

`node tests/fixtures/prompt-assembly/replay-server.mjs`

| 用例 | 状态 |
| --- | --- |
| solo-normal / solo-continue / solo-quiet / solo-persona-depth / solo-author-note | **byte-identical**（24 / 25 / 21 / 23 / 24 messages） |
| group-normal | **byte-identical**（20 messages） |
| solo-swipe | 首分歧 message 2；expected 19，got 20（缺关系投影块） |
| solo-regenerate | 首分歧 message 17；expected 23，got 24（记忆块位置） |
| solo-impersonate | 首分歧 message 2；expected 24，got 24（缺关系投影块） |

### 本阶段修复的根因（每条都先插桩取证、跑完即还原）

1. **示例对话未做宏替换**：`setOpenAIMessageExamples` 收到的是含 `{{user}}:` / `{{char}}:`
   的原文，说话人前缀匹配不到，示例块全部为空。页面先走 `baseChatReplace`（替换名字、
   不替换角色卡宏），原始数组只留给 story string。
2. **组装环境拿到未合并的 `oai_settings`**：`new_chat_prompt` / `new_example_chat_prompt`
   为 undefined，两个标记消息被静默丢弃。
3. **枚举未接线**：`systemMessageTypes` / `characterNamesBehavior` 传空对象，使
   `extra.type` 比较恒真，整段聊天历史被判成 narrator 的 system 消息。现已落入
   `src/prompt-assembly/enums.js`。
4. **扩展提示词注册表缺项**：quiet prompt、角色卡 depth prompt、Persona 描述
   （at-depth 与 A/N 合并）、World Info 的 at-depth/outlet 条目都是页面侧扩展提示词，
   服务端一个都没注册，对应块全部丢失。
5. **continue 轮次没有 `cyclePrompt`**：continue-nudge 对从未进入组装；
   `continue_postfix` 补进 assembly 默认值（按页面的字符串语义）。
6. **World Info 上下文不是完整扩展上下文**：作者注劫持会在 `getContext()` 上写回，
   两字段桩会抛错并丢掉作者注。
7. **memory 子块按类型分别门控**：growth + 记忆列表跳过 quiet；关系投影额外跳过
   swipe 与 impersonate。
8. **群聊完全不可用**：群聊 id 是聊天文件名而非群 id，改为按持久化 `chat_id` 匹配；
   首个未禁用成员成为活动卡；成员卡读入 `characters` 以解析 `{{group}}`；
   `getSelectedGroup()` 接线，使新建群聊标记与 group nudge 不再退化成单人。
9. **`setOpenAIMessages` 两处抬升缺陷**：游标 `j` 从未自增（每个槽位都填 `chat[0]`）；
   倒序填充 `messages[i]` 在前部留下空洞。该模块浏览器也在加载，输出顺序即基准，
   现改为「按聊天顺序收集、倒序交出」，并更新了编码空洞行为的单测。
10. **harness 自身两处缺陷**：replay oracle 从未给 `note` profile 播种作者注元数据、
    也从未传 `quietPrompt`，两例都静默退化成 default profile。

### 剩余 4 例的证据与判断

- **solo-swipe / solo-regenerate / solo-impersonate（同一处未决语义）**：三例都涉及
  memory 子块。为把规则从浏览器直接读出来（而不是靠推断），本会话用真实页面把这三个
  类型的组装体 dump 了一遍：
  - `solo-swipe` 浏览器产出 growth + relationship，
  - `solo-regenerate` 浏览器产出 memory 块在 `first_mes` 之前（第 17 位），
  - `solo-impersonate` 浏览器产出 growth + 记忆列表 + relationship，但**没有** reply-style。

  这三份 dump 与**同一次运行**的浏览器门禁（对已提交基线 9/9 逐字一致）**互相矛盾**：
  `run-baseline.mjs` 在同一环境下驱动同一页面、对每例只抓一个 `/generate` 请求体，却得到
  19/23/24 条并与基线逐字一致；独立 dump 脚本却多出关系投影块。两者唯一的差别是拦截方式
  （`page.route` 对 `page.route`）与请求选取（最后一例对第一例）。换言之，
  **真实浏览器基线（9/9，已复核）与 oracle 的差异点尚不能用「浏览器规则」解释**，
  这一处必须先把两次抓取为何不同查清，再谈裁决——在此之前不对 memory 门控做进一步
  推断式修改（已试过的四种组合：6/6/5/2，都不是全绿）。
- **solo-swipe（基线自相矛盾，按用户裁决如实披露）**：`solo-swipe` 的 memory 块是已提交
  基线内部的矛盾。`git show 58cfc2b32 -- tests/fixtures/prompt-assembly/baseline/solo-swipe.json`
  显示同一次重录**只从 swipe 用例删掉了 `[与当前对话相关的过往记忆]` 块**（20→19
  messages），而同一 commit 里其余基线都保留 memory；当前 `memory-seed.mjs` 对 swipe
  聊天与其他聊天注入完全相同的确定性记忆（`selectContext` 对两者都返回
  `enabled: true, memories: 3`）。按用户裁决：不改基线、不伪造通过，保持代码语义。
- **solo-impersonate**：消息总数已对齐（24 = 24），仅剩 growth / relationship /
  reply-style 三个相对位置未对齐。基线要求 impersonate 保留关系投影却不出现 growth，
  与「growth 与记忆列表同门控」的实现冲突，需要单独裁决 impersonate 的 memory 子块
  语义。

### 停靠声明

按令状 §7：group-normal / solo-persona-depth 的 depth 注入语义、solo-impersonate 的
memory 子块组合，均属**本文件与附 L/M/N/O/P 未覆盖且有具体证据的新分叉**。Phase 4（Web
PWA）与 Phase 5（RN App）依赖 §3「服务端 `/generate` 权威轮次可用」；在 depth 注入语义
未定论前开工，会把客户端叠在错误的组装语义上，故在此停靠报告，等待裁决后继续。

### 环境说明

- 打包的 Playwright Chromium 缺失且沙箱禁止写 `~/Library/Caches/ms-playwright`
  （`playwright install chromium` 返回 `EPERM`）。改用本机 Google Chrome
  （`LESLIE_BASELINE_BROWSER_CHANNEL=chrome`）后该门禁完全可用，且已用
  `--record` 复核基线未被改动。

## Prompt-assembly lift and authoritative-turn groundwork (2026-10-09)

- Phase 2.5.2 (prompt-assembly lift) is closed. Prompt building now runs through shared
  modules under `src/prompt-assembly/`: World Info state/lore/scan/build plus its
  portability guard, the prompt registry and ordering, the chat-completion message model,
  the populate cluster and the orchestrator. The browser files keep their exports and call
  sites by delegating to those modules, so the public surface is unchanged:
  `world-info.js` keeps all 70 exports, `PromptManager.js` 7, `openai.js` 43.
- The compatibility red line held throughout: `src/endpoints/chats.js`,
  `src/endpoints/characters.js` and `src/prompt-converters.js` were never touched.
- Verification is byte-level. `npm run test:prompt-baseline` replays eight synthetic cases
  (solo normal/continue/swipe/regenerate/impersonate/quiet, group, persona depth) through a
  real browser and compares the POST body to a baseline recorded before the refactor; all
  eight are byte-identical, and stayed so at every step of the lift.
- The eight-case baseline is the only gate that exercises `openai.js` and the browser
  bundle end to end, so it is the lower bound for any assembly change. The harness now also
  reports page errors, console errors and failing request URLs, which is what turned a
  three-attempt blind fix into a one-run fix.
- Full self-check re-run and green: `npm run validate`; the eight-case baseline; an
  all-commit audit showing no commit since the refactor base touched the three red-line
  files or any `data/`-style path; leftover-reference and secret scans; and a live-service
  smoke that boots the real `/api/v1` router on a listener and walks register, log in,
  create character, create chat and stream a generation from a mock provider, asserting
  ordered `chat.completion.chunk` frames, a terminating `[DONE]` and `X-Accel-Buffering: no`.

## Stabilization priorities

1. Expand regression coverage for ordinary chat with every Leslie module disabled.
2. Add long-response cancellation and swipe coverage for automatic voice playback.
3. Split the largest frontend modules into smaller maintainable units.
4. Add schema migration and recovery fixtures for identity, memory, and moments stores.
5. Extend reality-line switching to group chats after group identity, membership, and cross-line privacy rules are specified and tested.

## Later work

- Optional injection of selected Moments memory into ordinary character chat after prompt-budget, privacy, and regression review.
- A project/workspace layer for multiple stories or role-play contexts.
- Secure LAN device discovery and synchronization with authentication and a documented threat model.
- Signed installer, update strategy, version migration, and release automation.

## Not promised yet

There is no stable release schedule, public synchronization service, compatibility guarantee for unreleased schemas, or automatic publishing pipeline.
