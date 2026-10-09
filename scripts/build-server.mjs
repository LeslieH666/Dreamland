#!/usr/bin/env node
/**
 * `npm run build:server` — build target ①+②: the backend core plus the shared
 * `public/` UI, as a Linux container image. No Electron, no mobile clients.
 *
 * The script first proves the build context is correctly cropped, then runs
 * `docker build`. `--check` stops after the verification, which is what the
 * regression test and any CI without a container runtime uses.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { partitionContext, projectRootFrom, readDockerIgnorePatterns } from './lib/dockerignore.mjs';
import { readJson, reportCheck, verifySharedPublicTree } from './lib/build-verify.mjs';

const root = projectRootFrom(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
const imageTag = process.env.DREAMLAND_SERVER_IMAGE || 'dreamland/server:dev';

/** Paths that must never reach the server image. */
const FORBIDDEN_PREFIXES = ['src/electron/', 'mobile/', 'packaging/', 'tests/', 'models/', 'airi/'];
/** Paths the server image needs. */
const REQUIRED_PATHS = ['server.js', 'src/server-main.js', 'src/api-v1/router.js', 'public/index.html', 'public/script.js', 'docker/docker-entrypoint.sh', 'docker/build-lib.js'];

/**
 * Every file that would be sent as the build context.
 * @returns {string[]} Context-relative paths.
 */
function listContextFiles() {
    const files = [];
    const walk = (directory, relative) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(path.join(directory, entry.name), childRelative);
            } else if (entry.isFile()) {
                files.push(childRelative);
            }
        }
    };
    walk(root, '');
    return files;
}

console.log('build:server — verifying the container build context');

const patterns = readDockerIgnorePatterns(path.join(root, '.dockerignore'));
if (patterns.length === 0) {
    console.error('  [FAIL] .dockerignore is missing or empty; the image would contain the whole repository.');
    process.exit(1);
}

const { kept } = partitionContext(listContextFiles(), patterns);

const leaked = kept.filter(file => FORBIDDEN_PREFIXES.some(prefix => file === prefix.replace(/\/$/, '') || file.startsWith(prefix)));
reportCheck('context excludes the desktop host, mobile, packaging and tests', {
    ok: leaked.length === 0,
    detail: leaked.length === 0 ? `(${kept.length} files kept)` : `leaked: ${leaked.slice(0, 5).join(', ')}`,
});

const absent = REQUIRED_PATHS.filter(file => !kept.includes(file));
reportCheck('server context keeps every required file', {
    ok: absent.length === 0,
    detail: absent.length === 0 ? `(${REQUIRED_PATHS.length} checked)` : `missing: ${absent.join(', ')}`,
});

const rootPackage = readJson(path.join(root, 'package.json'));
const electronInRoot = Object.keys({ ...rootPackage.dependencies, ...rootPackage.devDependencies })
    .filter(name => name === 'electron' || name.startsWith('electron-'));
reportCheck('root package has no Electron dependency', {
    ok: electronInRoot.length === 0,
    detail: electronInRoot.length === 0 ? '' : `found: ${electronInRoot.join(', ')}`,
});

const publicTree = verifySharedPublicTree(root);
reportCheck('shared public/ UI tree', {
    ok: publicTree.ok,
    detail: `trees=[${publicTree.trees.join(', ')}]${publicTree.missing.length ? ` missing=[${publicTree.missing.join(', ')}]` : ''}`,
});

const dockerfile = path.join(root, 'Dockerfile');
reportCheck('Dockerfile present', { ok: fs.existsSync(dockerfile), detail: path.relative(root, dockerfile) });

if (process.exitCode) {
    console.error('build:server — verification failed; refusing to build.');
    process.exit(1);
}

if (checkOnly) {
    console.log('build:server — check mode: verification passed, skipping the image build.');
    process.exit(0);
}

const docker = spawnSync('docker', ['--version'], { encoding: 'utf8' });
if (docker.error || docker.status !== 0) {
    console.error('build:server — docker is not available on this host.');
    console.error('  Verification passed, so run the build on a machine with Docker:');
    console.error(`    docker build -f Dockerfile -t ${imageTag} .`);
    process.exit(1);
}

console.log(`build:server — docker build -f Dockerfile -t ${imageTag} .`);
const build = spawnSync('docker', ['build', '-f', 'Dockerfile', '-t', imageTag, '.'], { stdio: 'inherit', cwd: root });
if (build.error) {
    console.error('build:server — docker build could not start:', build.error.message);
    process.exit(1);
}
process.exit(build.status ?? 1);
