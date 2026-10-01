# Data and packaging

## Source-controlled files

The Git repository contains application source, tests, documentation, packaging scripts, and a placeholder at `data/.gitkeep`.

The following are always local and ignored:

- `data/`: characters, chats, groups, settings, secrets, memories, and user assets;
- `Runtime/` and `Config/`: bundled Electron runtime and local safe configuration;
- `Cache/`, `Run/`, and `logs/`: generated process state;
- `backups/`: local recovery archives, except its README;
- `notes/private/`: machine-specific planning and migration notes;
- `dist/`: generated portable packages.

## Encrypted user spaces

The optional Leslie user-space mode is activated by the default administrator on the local computer. Activation requires a nonempty password of any length, verifies the encrypted copy, then removes the working user directory. A short password is easier to guess and weakens protection of the encrypted vault. The current and legacy demo directories and the project-root `backups/` contents (apart from the tracked `!README.md`) join the default user's vault. The initial encrypted vault is retained as `<handle>.initial` under `data/_leslie-vaults/`; later seals retain `<handle>.previous`. New accounts receive their own vaults. Existing secondary accounts and orphaned data must be purged before activation because their passwords are unavailable for migration.

The AES-256-GCM data key is wrapped with a password-derived scrypt key. Encrypted manifests hide chat and character filenames. Only the selected account's files are opened while that account is active; logout, account switching, normal Node shutdown, Electron tray Exit, and the Windows stop shortcut seal them again. The browser clears origin local/session storage when leaving or entering an encrypted account so drafts from one account cannot appear in another. The stop shortcut asks Electron to exit and never force-kills a process that has not completed sealing. Password changes require the current password, including for administrators; recovery-code password reset is disabled for encrypted spaces because it cannot recover the data key.

The vault protects account content and the migrated legacy backup directory from browsing while sealed. Account names, password hashes, global configuration, caches, process logs, and external copies outside this workspace are outside the vault. Forced termination, power loss, or a writer still active during shutdown can leave a plaintext working directory; the next password login attempts to re-encrypt it while keeping the prior snapshot. Do not treat this as full-disk encryption or as protection against an administrator reading the running process. Keep the initial backup and password together for rollback, and use encrypted storage for copies outside the project.

## Local Windows workflow

The root `启动 DreamLand.cmd` entry calls scripts under `packaging/windows-local/`. Paths are resolved relative to the repository, so the project can be moved without editing the scripts. Electron controls under “Settings → Model connection → Local services” manage tracked AIRI and project KoboldCpp processes. Authenticated same-subnet mobile clients may list cataloged GGUF models and start one managed KoboldCpp process through a fixed HTTP action; only Electron can stop services. An untracked process occupying port 5001 is never replaced. The launcher verifies the actual data root and the listener resolved from `Config/config.yaml` before reporting success. When LAN web access is enabled, `whitelistDirectPrivateNetworks` permits only clients that share the private subnet of the local address they connected to, so Wi-Fi changes do not require per-device entries and unrelated routed subnets are not implicitly trusted. The launcher reports resolvable hostname URLs before numeric addresses and writes them to `Run/LeslieTavern-lan-addresses.txt`, so DHCP address changes do not require a saved client URL to change when local DNS is available. Keep the Windows firewall restricted to a trusted local-subnet boundary; portable builds remain localhost-only.

The desktop local-service control runs the integrated `airi/` source tree from the same Git worktree. AIRI keeps its pnpm package boundary, while the root repository owns versioning and remotes for both applications. The launcher stores only ignored logs and process state. Bridge bearer tokens remain process-local and are never written to disk.

## Portable build

Build into a new or recognized package directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\packaging\windows-portable\build-portable.ps1 `
  -OutputPath .\dist\LeslieTavern
```

Use `-CleanExisting` only for an existing output containing the package marker created by the builder. The output includes source, production dependencies, Electron, safe configuration, helper scripts, a checksum manifest, and an empty `UserData/` directory.

## Before publishing

1. Run `npm run check:repo`.
2. Confirm `git status` contains no local data or secret files.
3. Build the portable package from a clean commit.
4. Confirm its manifest reports zero working-tree changes.
5. Scan the package for private filenames and content before sharing it.
