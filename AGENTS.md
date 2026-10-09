# Repository instructions

Before changing code, read `README.md`, `docs/project-overview.md`, and `docs/roadmap.md`. Local maintainers may also have ignored planning notes under `notes/private/`; use them when present, but never commit their contents.

## Compatibility

- Preserve SillyTavern chat behavior, events, character-card compatibility, JSONL chats, group chats, World Info, swipes, and model adapters.
- Prefer Leslie modules and extension points over invasive changes to the upstream chat core.
- Memory, identity, moments, and voice features must fail open so ordinary chat remains usable.
- Any persistent schema change needs migration, validation, and rollback coverage.

## User data

- Treat `data/`, `Config/`, `Runtime/`, `Cache/`, `Run/`, logs, backups, and `notes/private/` as local-only state.
- DreamLand does not host or manage local models. Users run their own KoboldCpp / llama.cpp / OpenAI-compatible endpoint and DreamLand only connects to it. Do not reintroduce an in-repo model catalog or process launcher.
- Never commit character cards, chats, credentials, cookies, memories, user settings, generated audio, or real-person fixtures.
- Do not print secret values or private chat content in logs, tests, documentation, or review output.
- Use synthetic fixtures for automated tests.

## Verification

- Run the narrowest relevant tests while developing.
- Before handing off a repository-level change, run `npm run check:repo`, `npm run lint`, and the relevant unit tests.
- Desktop and packaging changes should also verify the resolved data root and configured listener. Portable builds must remain localhost-only; any local LAN listener must retain an explicit IP allowlist and a trusted-network firewall boundary.

## Git and documentation

- Keep commits focused and use clear conventional-style messages when practical.
- Update `docs/roadmap.md` or `CHANGELOG.md` when a change materially affects project status or release behavior.
- Use the project-owned `origin` as the only remote. Do not add or push to SillyTavern or AIRI upstream remotes.
