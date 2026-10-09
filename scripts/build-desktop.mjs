#!/usr/bin/env node
/**
 * `npm run build:desktop` — build target ①+②+④: the backend core, the shared
 * `public/` UI and the Electron desktop host, packaged as a desktop build.
 *
 * The verification half runs everywhere (and is what the regression test uses
 * through `--check`). Producing the actual installer delegates to the existing
 * platform packager in `packaging/`, which is Windows PowerShell today.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJson, reportCheck, verifySharedPublicTree } from './lib/build-verify.mjs';
import { projectRootFrom } from './lib/dockerignore.mjs';

const root = projectRootFrom(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
const portableScript = path.join(root, 'packaging', 'windows-portable', 'build-portable.ps1');

console.log('build:desktop — verifying the desktop target inputs');

const publicTree = verifySharedPublicTree(root);
reportCheck('shares the single public/ UI tree with the server build', {
    ok: publicTree.ok,
    detail: `trees=[${publicTree.trees.join(', ')}]${publicTree.missing.length ? ` missing=[${publicTree.missing.join(', ')}]` : ''}`,
});

const electronPackagePath = path.join(root, 'src', 'electron', 'package.json');
const electronPackage = fs.existsSync(electronPackagePath) ? readJson(electronPackagePath) : null;
reportCheck('desktop host package declares Electron', {
    ok: Boolean(electronPackage?.dependencies?.electron),
    detail: electronPackage ? `electron ${electronPackage.dependencies?.electron}` : 'src/electron/package.json missing',
});

for (const required of ['src/electron/index.js', 'src/electron/preload.cjs', 'src/electron/sealed-exit.js', 'server.js', 'public/index.html']) {
    reportCheck(`desktop target keeps ${required}`, { ok: fs.existsSync(path.join(root, required)) });
}

reportCheck('platform packager present', {
    ok: fs.existsSync(portableScript),
    detail: fs.existsSync(portableScript) ? path.relative(root, portableScript) : 'packaging/windows-portable/build-portable.ps1 missing',
});

if (process.exitCode) {
    console.error('build:desktop — verification failed; refusing to package.');
    process.exit(1);
}

if (checkOnly) {
    console.log('build:desktop — check mode: verification passed, skipping the installer.');
    process.exit(0);
}

if (process.platform !== 'win32') {
    console.error('build:desktop — the installer is produced on Windows by packaging/windows-portable/build-portable.ps1.');
    console.error('  Verification passed on this host, so the tarball can be produced here with:');
    console.error('    npm run build:desktop -- --check   # inputs verified');
    console.error('  and on Windows:');
    console.error('    powershell -ExecutionPolicy Bypass -File packaging/windows-portable/build-portable.ps1');
    process.exit(1);
}

console.log('build:desktop — running the portable packager');
const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', portableScript], {
    stdio: 'inherit',
    cwd: root,
});
process.exit(result.status ?? 1);
