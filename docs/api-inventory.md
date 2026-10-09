# DreamLand API inventory (Phase 0 baseline)

Generated from the Express routers actually mounted in `src/server-main.js` and
`src/server-startup.js` at the Phase 0 branch state (commit `5349f101f`, i.e. the
commit preceding the one that adds this file), after removing AIRI and managed
local models. Regenerate this file whenever a mount point changes.

## 1. How to read this file

- **Mount prefix** is the literal path passed to `app.use(...)`.
- **Routes** are the paths declared by that router; the client URL is
  `<mount prefix><route path>`.
- **Login required** means the request must pass `requireLoginMiddleware`
  (cookie session resolution) or the Leslie Bridge bearer token.
- "Login required" is enforced by middleware position, not per route: everything
  registered **after** `app.use(requireLoginMiddleware)` in `src/server-main.js`
  is protected. On a fresh install with no password and no multi-user space the
  default user is unlocked automatically, so these routes answer without a login
  prompt; the middleware still binds every request to a user directory.

## 2. Middleware and authentication order (`src/server-main.js`)

| # | Middleware | Notes |
|---|------------|-------|
| 1 | `helmet` | `contentSecurityPolicy: false` today (tightened in Phase 4) |
| 2 | `compression`, `response-time`, `body-parser` (500 MB) | |
| 3 | `cors` | only when `cors.enabled` |
| 4 | `basicAuth` | only when `listen` + `basicAuthMode` |
| 5 | `getWhitelistMiddleware` | only when `whitelistMode` |
| 6 | `hostWhitelistMiddleware` | always |
| 7 | `accessLoggerMiddleware` | only when `listen` |
| 8 | `cookieSession` | desktop/Web session (cookie-session, in memory) |
| 9 | Leslie Bridge bearer auth | mounted on `/api/leslie/bridge/v1` only |
| 10 | `setUserDataMiddleware` | binds `request.user` |
| 11 | CSRF (`csrf-sync`) | bypassed for authenticated Bridge requests and `/proxy/` |
| 12 | static frontend, `/`, `/login`, `/callback` | |
| 13 | `/api/users` (public router) | account mode, login, recovery |
| 14 | `requireLoginMiddleware` | **auth boundary** for everything below |
| 15 | `/api/ping`, `/proxy/:url(*)`, uploads, `/version` | |
| 16 | `redirectDeprecatedEndpoints`, `setupPrivateEndpoints` | all API routers |

## 3. Public (pre-login) endpoints

| Mount prefix | Routes | Source file |
|---|---|---|
| `/api/users` | `GET /mode`<br>`GET /login-progress`<br>`POST /list`<br>`POST /login`<br>`POST /recover-step1`<br>`POST /recover-step2` | `src/endpoints/users-public.js` |

Also public, registered inline in `src/server-main.js`: `GET /`,
`GET /login`, `GET /callback/:source?`, `GET /csrf-token`, and the static
frontend under `public/`.

## 4. Authenticated endpoints (cookie session)

Client URL = mount prefix + route path. All of these sit behind
`requireLoginMiddleware`.

| Mount prefix | Routes | Source file |
|---|---|---|
| `/` | (no direct `router.*` routes; see source) | `src/users.js` |
| `/api/leslie/demo-mode` | `GET /status`<br>`POST /switch` | `src/leslie-demo-mode/router.js` |
| `/api/leslie/user-spaces` | `POST /status`<br>`POST /activate` | `src/leslie-user-spaces/router.js` |
| `/api/leslie/preferences` | `GET /`<br>`POST /` | `src/leslie-user-spaces/preferences-router.js` |
| `/api/users` | `POST /logout`<br>`GET /me`<br>`POST /change-avatar`<br>`POST /change-password`<br>`POST /backup`<br>`POST /reset-settings`<br>`POST /change-name`<br>`POST /reset-step1`<br>`POST /reset-step2` | `src/endpoints/users-private.js` |
| `/api/users` | `POST /get`<br>`POST /disable`<br>`POST /enable`<br>`POST /promote`<br>`POST /demote`<br>`POST /create`<br>`POST /delete`<br>`POST /slugify` | `src/endpoints/users-admin.js` |
| `/api/moving-ui` | `POST /save` | `src/endpoints/moving-ui.js` |
| `/api/images` | `POST /upload`<br>`POST /list/:folder?`<br>`POST /folders`<br>`POST /delete` | `src/endpoints/images.js` |
| `/api/quick-replies` | `POST /save`<br>`POST /delete` | `src/endpoints/quick-replies.js` |
| `/api/avatars` | `POST /get`<br>`POST /delete`<br>`POST /upload` | `src/endpoints/avatars.js` |
| `/api/themes` | `POST /save`<br>`POST /delete` | `src/endpoints/themes.js` |
| `/api/openai` | `POST /caption-image`<br>`POST /generate-voice`<br>`POST /electronhub/generate-voice`<br>`POST /electronhub/models`<br>`POST /chutes/generate-voice`<br>`POST /chutes/models/embedding`<br>`POST /nanogpt/models/embedding`<br>`POST /siliconflow/models/embedding`<br>`POST /workers-ai/models/embedding`<br>`POST /generate-image`<br>`POST /generate-video`<br>`POST /transcribe-audio`<br>`POST /groq/transcribe-audio`<br>`POST /mistral/transcribe-audio`<br>`POST /zai/transcribe-audio`<br>`POST /chutes/transcribe-audio` | `src/endpoints/openai.js` |
| `/api/google` | `POST /caption-image`<br>`POST /list-voices`<br>`POST /generate-voice`<br>`POST /list-native-voices`<br>`POST /generate-native-tts`<br>`POST /generate-image`<br>`POST /generate-video` | `src/endpoints/google.js` |
| `/api/anthropic` | `POST /caption-image` | `src/endpoints/anthropic.js` |
| `/api/tokenizers` | `POST /llama/encode`<br>`POST /nerdstash/encode`<br>`POST /nerdstash_v2/encode`<br>`POST /mistral/encode`<br>`POST /yi/encode`<br>`POST /gemma/encode`<br>`POST /jamba/encode`<br>`POST /gpt2/encode`<br>`POST /claude/encode`<br>`POST /llama3/encode`<br>`POST /qwen2/encode`<br>`POST /command-r/encode`<br>`POST /command-a/encode`<br>`POST /nemo/encode`<br>`POST /deepseek/encode`<br>`POST /llama/decode`<br>`POST /nerdstash/decode`<br>`POST /nerdstash_v2/decode`<br>`POST /mistral/decode`<br>`POST /yi/decode`<br>`POST /gemma/decode`<br>`POST /jamba/decode`<br>`POST /gpt2/decode`<br>`POST /claude/decode`<br>`POST /llama3/decode`<br>`POST /qwen2/decode`<br>`POST /command-r/decode`<br>`POST /command-a/decode`<br>`POST /nemo/decode`<br>`POST /deepseek/decode`<br>`POST /openai/encode`<br>`POST /openai/decode`<br>`POST /openai/count`<br>`POST /remote/kobold/count`<br>`POST /remote/textgenerationwebui/encode` | `src/endpoints/tokenizers.js` |
| `/api/presets` | `POST /save`<br>`POST /delete`<br>`POST /restore` | `src/endpoints/presets.js` |
| `/api/secrets` | `POST /write`<br>`POST /read`<br>`POST /view`<br>`POST /find`<br>`POST /delete`<br>`POST /rotate`<br>`POST /rename`<br>`POST /settings` | `src/endpoints/secrets.js` |
| `/thumbnail` | (no direct `router.*` routes; see source) | `src/endpoints/thumbnails.js` |
| `/api/novelai` | `POST /status`<br>`POST /generate`<br>`POST /generate-image`<br>`POST /generate-voice` | `src/endpoints/novelai.js` |
| `/api/extensions` | `POST /install`<br>`POST /update`<br>`POST /branches`<br>`POST /switch`<br>`POST /move`<br>`POST /version`<br>`POST /delete`<br>`GET /discover` | `src/endpoints/extensions.js` |
| `/api/assets` | `POST /get`<br>`POST /download`<br>`POST /delete`<br>`POST /character` | `src/endpoints/assets.js` |
| `/api/files` | `POST /sanitize-filename`<br>`POST /upload`<br>`POST /delete`<br>`POST /verify` | `src/endpoints/files.js` |
| `/api/characters` | `POST /create`<br>`POST /rename`<br>`POST /edit`<br>`POST /edit-avatar`<br>`POST /edit-attribute`<br>`POST /merge-attributes`<br>`POST /delete`<br>`POST /all`<br>`POST /get`<br>`POST /chats`<br>`POST /import`<br>`POST /duplicate`<br>`POST /export`<br>`POST /export-bundle` | `src/endpoints/characters.js` |
| `/api/chats` | `POST /save`<br>`POST /get`<br>`POST /rename`<br>`POST /delete`<br>`POST /export`<br>`POST /group/import`<br>`POST /import`<br>`POST /group/get`<br>`POST /group/info`<br>`POST /group/delete`<br>`POST /group/save`<br>`POST /search`<br>`POST /recent` | `src/endpoints/chats.js` |
| `/api/leslie/identity` | `GET /`<br>`POST /story-scope`<br>`POST /entities/resolve` | `src/leslie-identity/router.js` |
| `/api/leslie/memory` | `POST /ensure`<br>`GET /catalog`<br>`POST /:memoryId/events/invalidate`<br>`POST /:memoryId/events`<br>`PATCH /:memoryId/events/:eventId`<br>`PUT /:memoryId/state`<br>`POST /:memoryId/state/restore`<br>`POST /:memoryId/core-snapshot`<br>`POST /:memoryId/branch`<br>`POST /:memoryId/context`<br>`POST /:memoryId/cross-line-context`<br>`POST /:memoryId/relationship`<br>`POST /:memoryId/identity`<br>`GET /:memoryId` | `src/leslie-memory/router.js` |
| `/api/leslie/moments` | `GET /settings`<br>`GET /models`<br>`PUT /model-selection`<br>`POST /generate`<br>`PUT /settings`<br>`GET /`<br>`POST /`<br>`PATCH /:postId`<br>`POST /:postId/${route}`<br>`PUT /:postId/likes`<br>`POST /:postId/comments`<br>`GET /activity/status`<br>`POST /activity/pause`<br>`POST /activity/heartbeat`<br>`POST /activity/reconcile`<br>`POST /activity/jobs/claim`<br>`POST /activity/jobs/:jobId/complete`<br>`POST /activity/jobs/:jobId/publish`<br>`POST /memory/context`<br>`POST /activity/jobs/:jobId/fail` | `src/leslie-moments/router.js` |
| `/api/groups` | `POST /all`<br>`POST /create`<br>`POST /edit`<br>`POST /delete` | `src/endpoints/groups.js` |
| `/api/worldinfo` | `POST /list`<br>`POST /get`<br>`POST /delete`<br>`POST /import`<br>`POST /edit` | `src/endpoints/worldinfo.js` |
| `/api/stats` | `POST /get`<br>`POST /recreate`<br>`POST /update` | `src/endpoints/stats.js` |
| `/api/backgrounds` | `POST /all`<br>`POST /folders`<br>`POST /delete`<br>`POST /rename`<br>`POST /upload` | `src/endpoints/backgrounds.js` |
| `/api/sprites` | `GET /get`<br>`POST /delete`<br>`POST /upload-zip`<br>`POST /upload` | `src/endpoints/sprites.js` |
| `/api/content` | `POST /importURL`<br>`POST /importUUID` | `src/endpoints/content-manager.js` |
| `/api/settings` | `POST /save`<br>`POST /get`<br>`POST /get-snapshots`<br>`POST /load-snapshot`<br>`POST /make-snapshot`<br>`POST /restore-snapshot` | `src/endpoints/settings.js` |
| `/api/sd` | `POST /ping`<br>`POST /upscalers`<br>`POST /vaes`<br>`POST /samplers`<br>`POST /schedulers`<br>`POST /models`<br>`POST /get-model`<br>`POST /set-model`<br>`POST /generate`<br>`POST /sd-next/upscalers` | `src/endpoints/stable-diffusion.js` |
| `/api/horde` | `POST /text-workers`<br>`POST /text-models`<br>`POST /status`<br>`POST /cancel-task`<br>`POST /task-status`<br>`POST /generate-text`<br>`POST /sd-samplers`<br>`POST /sd-models`<br>`POST /caption-image`<br>`POST /user-info`<br>`POST /generate-image` | `src/endpoints/horde.js` |
| `/api/vector` | `POST /query`<br>`POST /query-multi`<br>`POST /insert`<br>`POST /list`<br>`POST /delete`<br>`POST /purge-all`<br>`POST /purge` | `src/endpoints/vectors.js` |
| `/api/translate` | `POST /libre`<br>`POST /google`<br>`POST /yandex`<br>`POST /lingva`<br>`POST /deepl`<br>`POST /onering`<br>`POST /deeplx`<br>`POST /bing` | `src/endpoints/translate.js` |
| `/api/extra/classify` | `POST /labels`<br>`POST /` | `src/endpoints/classify.js` |
| `/api/extra/caption` | `POST /` | `src/endpoints/caption.js` |
| `/api/search` | `POST /serpapi`<br>`POST /transcript`<br>`POST /searxng`<br>`POST /tavily`<br>`POST /koboldcpp`<br>`POST /serper`<br>`POST /zai`<br>`POST /visit` | `src/endpoints/search.js` |
| `/api/backends/text-completions` | `POST /status`<br>`POST /props`<br>`POST /generate` | `src/endpoints/backends/text-completions.js` |
| `/api/openrouter` | `POST /models/providers`<br>`POST /models/multimodal`<br>`POST /models/embedding`<br>`POST /models/image`<br>`POST /credits`<br>`POST /image/generate` | `src/endpoints/openrouter.js` |
| `/api/nanogpt` | `POST /credits`<br>`POST /models/providers` | `src/endpoints/nanogpt.js` |
| `/api/backends/kobold` | `POST /generate`<br>`POST /status`<br>`POST /transcribe-audio`<br>`POST /embed` | `src/endpoints/backends/kobold.js` |
| `/api/backends/chat-completions` | `POST /status`<br>`POST /bias`<br>`POST /generate`<br>`POST /process` | `src/endpoints/backends/chat-completions.js` |
| `/api/speech` | `POST /recognize`<br>`POST /synthesize` | `src/endpoints/speech.js` |
| `/api/azure` | `POST /list`<br>`POST /generate` | `src/endpoints/azure.js` |
| `/api/volcengine` | `GET /voices`<br>`POST /generate-voice` | `src/endpoints/volcengine.js` |
| `/api/minimax` | `POST /generate-voice` | `src/endpoints/minimax.js` |
| `/api/data-maid` | `POST /report`<br>`POST /finalize`<br>`GET /view`<br>`POST /delete` | `src/endpoints/data-maid.js` |
| `/api/backups` | `POST /chat/get`<br>`POST /chat/delete`<br>`POST /chat/download` | `src/endpoints/backups.js` |
| `/api/image-metadata` | `POST /folders/get`<br>`POST /folders/create`<br>`POST /folders/set-thumbnails`<br>`POST /folders/update`<br>`POST /folders/delete`<br>`POST /folders/assign`<br>`POST /folders/unassign`<br>`POST /`<br>`POST /all`<br>`POST /cleanup` | `src/endpoints/image-metadata.js` |

### Per-user static file mounts (`src/users.js`, mounted at `/`)

| Prefix | Source file |
|---|---|
| `/backgrounds/*` | `src/users.js` |
| `/characters/*` | `src/users.js` |
| `/User%20Avatars/*` | `src/users.js` |
| `/assets/*` | `src/users.js` |
| `/user/images/*` | `src/users.js` |
| `/user/files/*` | `src/users.js` |
| `/scripts/extensions/third-party/*` | `src/users.js` |

## 5. Leslie Bridge v1 (`/api/leslie/bridge/v1`, bearer token)

Process-scoped `LESLIE_BRIDGE_TOKEN`; the request is authenticated **before**
`setUserDataMiddleware`, so Bridge clients never use the cookie session. This is
the seed for the future `/api/v1`.

| Method | Path | Source file |
|---|---|---|
| `GET` | `/health` | `src/leslie-bridge/router.js` |
| `GET` | `/capabilities` | `src/leslie-bridge/router.js` |
| `GET` | `/models` | `src/leslie-bridge/router.js` |
| `GET` | `/voices` | `src/leslie-bridge/router.js` |
| `GET` | `/model/chat/models` | `src/leslie-bridge/router.js` |
| `POST` | `/model/chat/completions` | `src/leslie-bridge/router.js` |
| `POST` | `/audio/speech` | `src/leslie-bridge/router.js` |

Contract: [contracts/leslie-bridge-v1.openapi.yaml](contracts/leslie-bridge-v1.openapi.yaml).

## 6. Removed in Phase 0

| Removed | Was | Replaced by |
|---|---|---|
| `/api/leslie/local-model/*` | managed GGUF/KoboldCpp start, stop, scan, detect, probe | SillyTavern's own connection settings; users run their own endpoint |
| `/api/leslie/bridge/v1/companion/state` | AIRI companion page/character/voice binding | — |
| `/api/leslie/bridge/v1/companion/audio/speech` | AIRI speech bound to the active character | `POST /audio/speech` |
| `/api/leslie/bridge/v1/companion/audio/transcriptions` | local speech recognition for AIRI | — |
| `/api/leslie/bridge/v1/chat/completions` | companion turn streaming through the visible DreamLand page | `POST /model/chat/completions` |

## 7. Not covered here

- Plugin routes: registered dynamically by `src/plugin-loader.js` from
  `plugins/` — see that loader for the active plugin list.
- Deprecated aliases: see `redirectDeprecatedEndpoints()` in
  `src/server-startup.js`; they 308-redirect to the table above.
