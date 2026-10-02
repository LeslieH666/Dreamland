# DreamLand

DreamLand, formerly LeslieTavern, is a space for character conversations and desktop companionship.

![Original DreamLand product concept art](public/img/dreamland/introduction.png)

DreamLand uses one **MomoTalk / Blue Archive** layout and component system. Colors, display mode and scenery remain independent, persist per user space, and also theme login. Older layouts migrate automatically. Main features occupy full content pages with mobile story/reality controls. All 37 artwork files ship in `public/img/blue-archive/bundled/` without a separate install; portable builds verify and include the complete allowlist. See [appearance behavior](docs/dreamland-appearance.md).

English | [简体中文](README.md)

[![CI](https://github.com/LeslieH666/LeslieTavern/actions/workflows/ci.yml/badge.svg)](https://github.com/LeslieH666/LeslieTavern/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

DreamLand is an experimental desktop-oriented fork of [SillyTavern](https://github.com/SillyTavern/SillyTavern). It preserves the upstream chat and data formats while adding an Electron entry point, a modern chat interface, character memory, identity isolation, a moments prototype, and character voice features.

> The project is a runnable prototype. It is not an official SillyTavern release or a signed production distribution.

## Highlights

- Compatible with SillyTavern character cards, group chats, World Info, swipes, model adapters, and JSONL chats.
- Windows Electron workflow with one `DreamLand` entry point, in-app AIRI/local-model controls, and portable-package tooling.
- A shared `models/` folder for local single-file GGUF weights. The desktop settings list discovered models under the managed KoboldCpp connection method and connect the selected model without requiring a port setting.
- Leslie memory and Persona/storyline isolation with story/reality chat lines that share only bounded memory resonance. Reality chats extract a de-fictionalized core personality, generate dynamic openings through the active API, and persist strictly plain instant messages; Moments provides a desktop-first timeline.
- Volcengine voice configuration, preview, and automatic reply playback.
- Explicit separation between source code, local user data, runtimes, backups, and distributable builds.

## Development setup

Node.js 20 or newer, npm, and Git are required.

```bash
git clone https://github.com/LeslieH666/LeslieTavern.git
cd LeslieTavern
npm ci
npm ci --prefix src/electron
npm run start:electron
```

Run the repository checks with:

```bash
npm ci --prefix tests
npm run check:repo
npm run lint
npm run test:unit
```

## Local models

Place a single-file GGUF in `models/` or one of its subfolders. The Qwen3.5 and Peach 2.0 Q4_K_M weights each live in their own subfolder. In DreamLand, open Settings → Model connection → Local API, select the model shown under KoboldCpp, and click Connect selected model. The desktop app starts or switches the tracked KoboldCpp process and applies the existing chat adapter. Use Stop local model to release resources. Automatic process control is desktop-only; Ollama, llama.cpp, other formats, and manual addresses remain under Advanced connection settings. A discovered GGUF is a load candidate, and the runtime checks architecture and available memory when starting.

## Repository layout

```text
LeslieTavern/
├─ .github/        Issue, pull request, and CI configuration
├─ docs/           Architecture, roadmap, design, and data guidance
├─ packaging/      Local Windows and portable-package scripts
├─ public/         Browser UI and extensions
├─ scripts/        Repository maintenance and migration tools
├─ src/            Server, Electron, and Leslie modules
├─ tests/          Unit and end-to-end tests
└─ data/           Local user data; only a placeholder is tracked
```

## Privacy

Character cards, chats, secrets, memories, voice settings, logs, caches, backups, and local runtimes must not be committed. Run `npm run check:repo` before publishing changes. Never attach private chats, character files, credentials, or unsanitized logs to issues or pull requests.

See [Data and packaging](docs/data-and-packaging.md), [Contributing](CONTRIBUTING.md), and the [Security policy](SECURITY.md).

## Upstream and license

DreamLand is an unofficial derivative of SillyTavern. Copyright remains with the respective authors, and derivative source is distributed under the [GNU AGPL-3.0](LICENSE).
