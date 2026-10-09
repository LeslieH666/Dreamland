import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { partitionContext, readDockerIgnorePatterns } = await import('../scripts/lib/dockerignore.mjs');
const { verifySharedPublicTree, readJson } = await import('../scripts/lib/build-verify.mjs');

/**
 * Evaluate a path against the repository `.dockerignore`.
 * @param {string[]} files Context-relative paths.
 * @returns {{kept: string[], excluded: string[]}} Partition.
 */
function partition(files) {
    return partitionContext(files, readDockerIgnorePatterns(path.join(root, '.dockerignore')));
}

describe('build targets share one web UI', () => {
    test('the repository has exactly one public/ tree', () => {
        const result = verifySharedPublicTree(root);
        expect(result.trees).toEqual(['public']);
        expect(result.missing).toEqual([]);
        expect(result.ok).toBe(true);
    });

    test('both package scripts exist and point at the shared tree', () => {
        const scripts = readJson(path.join(root, 'package.json')).scripts;
        expect(scripts['build:server']).toContain('scripts/build-server.mjs');
        expect(scripts['build:desktop']).toContain('scripts/build-desktop.mjs');

        for (const file of ['scripts/build-server.mjs', 'scripts/build-desktop.mjs']) {
            const contents = fs.readFileSync(path.join(root, file), 'utf8');
            expect(contents).toContain('public/');
        }
    });

    test('the desktop packager copies the repository public/ tree, not a copy of it', () => {
        const packager = fs.readFileSync(path.join(root, 'packaging', 'windows-portable', 'build-portable.ps1'), 'utf8');
        expect(packager).toContain('Join-Path $ProjectRoot \'public');
        expect(packager).toMatch(/Invoke-RobocopyChecked/u);
    });

    test('the server image keeps the shared public/ UI', () => {
        const { kept } = partition(['public/index.html', 'public/script.js', 'public/scripts/leslie-bootstrap.js']);
        expect(kept).toEqual(expect.arrayContaining([
            'public/index.html',
            'public/script.js',
            'public/scripts/leslie-bootstrap.js',
        ]));
    });
});

describe('server build context is cropped', () => {
    test('the desktop host, mobile clients, packaging and tests never enter the image', () => {
        const forbidden = [
            'src/electron/index.js',
            'src/electron/preload.cjs',
            'src/electron/sealed-exit.js',
            'mobile/android/app/src/main/AndroidManifest.xml',
            'mobile/README.md',
            'packaging/windows-portable/build-portable.ps1',
            'packaging/windows-local/Start-LeslieTavern.ps1',
            'tests/leslie-api-v1.test.js',
        ];
        const { kept, excluded } = partition(forbidden);
        expect(kept).toEqual([]);
        expect(excluded).toHaveLength(forbidden.length);
    });

    test('the server core and its container assets are kept', () => {
        const required = [
            'server.js',
            'src/server-main.js',
            'src/server-startup.js',
            'src/api-v1/router.js',
            'src/platform/index.js',
            'docker/docker-entrypoint.sh',
            'docker/build-lib.js',
        ];
        const { kept } = partition(required);
        expect(kept).toEqual(required);
    });

    test('the root package has no Electron dependency', () => {
        const packageJson = readJson(path.join(root, 'package.json'));
        const all = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
        expect(all.filter(name => name === 'electron' || name.startsWith('electron-'))).toEqual([]);
    });

    test('the desktop host keeps Electron in its own package boundary', () => {
        const electronPackage = readJson(path.join(root, 'src', 'electron', 'package.json'));
        expect(electronPackage.dependencies.electron).toBeTruthy();
    });
});

describe('build target verification scripts', () => {
    for (const target of ['build-server', 'build-desktop']) {
        test(`npm run build:${target.replace('build-', '')} -- --check passes`, () => {
            const result = spawnSync(process.execPath, [path.join(root, 'scripts', `${target}.mjs`), '--check'], {
                cwd: root,
                encoding: 'utf8',
            });
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('verification passed');
            expect(result.stdout).not.toContain('[FAIL]');
        });
    }
});
