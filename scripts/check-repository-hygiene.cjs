#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');

function trackedFiles() {
    const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    return output.split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/'));
}

const allowedPrivatePlaceholders = new Set([
    'backups/!README.md',
    'data/.gitkeep',
]);

function isAiriSource(file) {
    return file.startsWith('airi/');
}

const forbiddenPath = /(^|\/)(backups|cache|config|data|dist|legacy-portable-package|logs|notes\/private|run|runtime)(\/|$)/i;
const forbiddenArtifact = /(^|\/)(secrets\.json|\.env(?:\..*)?|.*\.jsonl)$/i;
const requiredFiles = [
    '.gitattributes',
    '.github/ISSUE_TEMPLATE/bug-report.yml',
    '.github/ISSUE_TEMPLATE/feature-request.yml',
    '.github/pull_request_template.md',
    '.github/workflows/ci.yml',
    'CHANGELOG.md',
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'LICENSE',
    'NOTICE',
    'README.md',
    'SECURITY.md',
    'SUPPORT.md',
    'airi/LICENSE',
    'airi/package.json',
    'airi/pnpm-lock.yaml',
    '启动 DreamLand.cmd',
    'packaging/windows-portable/assets/启动 DreamLand.cmd',
    'packaging/windows-portable/assets/关闭 DreamLand.cmd',
];

const tracked = trackedFiles();
const violations = tracked.filter(file => {
    // AIRI is a source workspace inside this repository. Its upstream source tree
    // legitimately contains directories such as config/, data/, and dist/; its
    // own .gitignore remains responsible for excluding generated and local state.
    if (isAiriSource(file)) {
        return false;
    }
    if (allowedPrivatePlaceholders.has(file)) {
        return false;
    }
    return forbiddenPath.test(file) || forbiddenArtifact.test(file) || file.toLowerCase() === 'config.yaml';
});

for (const required of requiredFiles) {
    if (!fs.existsSync(path.join(repositoryRoot, required))) {
        violations.push(`missing required file: ${required}`);
    }
}

// Each Windows workspace has one startup entry and explicit maintenance tools.
// Old aliases otherwise survive rebranding and appear beside the current launcher.
for (const [directory, allowedEntries] of [
    ['', new Set(['启动 DreamLand.cmd', '备份用户数据.cmd', '打开用户数据目录.cmd', '查看运行日志.cmd'])],
    ['packaging/windows-portable/assets', new Set(['启动 DreamLand.cmd', '关闭 DreamLand.cmd', '备份用户数据.cmd', '打开用户数据目录.cmd', '查看运行日志.cmd'])],
]) {
    for (const entry of fs.readdirSync(path.join(repositoryRoot, directory))) {
        if (/\.(cmd|bat)$/i.test(entry) && !allowedEntries.has(entry)) {
            violations.push(`unexpected Windows entry: ${path.posix.join(directory, entry)}`);
        }
    }
}

if (fs.existsSync(path.join(repositoryRoot, 'airi', '.git'))) {
    violations.push('airi/.git must not exist; AIRI belongs to the root Git repository');
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
if (packageJson.private !== true) {
    violations.push('package.json must set "private": true to prevent accidental npm publication');
}

if (violations.length > 0) {
    console.error('Repository hygiene check failed:');
    for (const violation of violations) {
        console.error(`- ${violation}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Repository hygiene check passed (${tracked.length} tracked files inspected).`);
}
