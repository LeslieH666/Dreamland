import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_USER } from '../constants.js';

const FORMAT_VERSION = 1;
const CHUNK_SIZE = 1024 * 1024;
const KDF_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let active = null;

function assertHandle(handle) {
    if (typeof handle !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(handle)) {
        throw new Error('Invalid user space handle.');
    }
}

function within(parent, child) {
    const relative = path.relative(parent, child);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function removeOwned(target, parent) {
    const parentPath = path.resolve(parent);
    const targetPath = path.resolve(target);
    if (!within(parentPath, targetPath) || !within(fs.realpathSync(parentPath), fs.realpathSync(targetPath))
        || fs.lstatSync(targetPath).isSymbolicLink()) {
        throw new Error('Refusing to remove an unexpected data path.');
    }
    fs.rmSync(targetPath, { recursive: true, force: false });
}

function vaultPaths(dataRoot, handle) {
    assertHandle(handle);
    const root = path.resolve(dataRoot);
    const vaultRoot = path.join(root, '_leslie-vaults');
    return {
        root,
        vaultRoot,
        vault: path.join(vaultRoot, handle),
        main: path.join(root, handle),
        demo: path.join(root, `${handle}_demo`),
        legacyDemo: path.join(root, '_demo', handle),
        backups: handle === DEFAULT_USER.handle && ['data', 'userdata'].includes(path.basename(root).toLowerCase())
            ? path.join(path.dirname(root), 'backups') : null,
    };
}

function assertVaultRoot(paths) {
    if (fs.existsSync(paths.vaultRoot)
        && (!within(fs.realpathSync(paths.root), fs.realpathSync(paths.vaultRoot))
            || fs.lstatSync(paths.vaultRoot).isSymbolicLink())) {
        throw new Error('The encrypted vault root is outside the data directory.');
    }
}

function sealBuffer(plain, key) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function openBuffer(record, key) {
    const nonce = Buffer.from(record.nonce, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    if (nonce.length !== 12 || tag.length !== 16) {
        throw new Error('Invalid vault encryption metadata.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
}

function writeAll(descriptor, bytes) {
    let offset = 0;
    while (offset < bytes.length) {
        offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    }
}

function transformFile(source, destination, key, nonce, tag = null) {
    const input = fs.openSync(source, 'r');
    let output;
    try {
        if (destination) output = fs.openSync(destination, 'wx');
        const transform = tag
            ? crypto.createDecipheriv('aes-256-gcm', key, nonce)
            : crypto.createCipheriv('aes-256-gcm', key, nonce);
        if (tag) transform.setAuthTag(tag);
        const hash = crypto.createHash('sha256');
        const chunk = Buffer.alloc(Math.min(CHUNK_SIZE, Math.max(4096, fs.fstatSync(input).size)));
        let size = 0;
        let count;
        while ((count = fs.readSync(input, chunk, 0, chunk.length, null)) > 0) {
            const data = chunk.subarray(0, count);
            if (!tag) hash.update(data);
            const transformed = transform.update(data);
            if (tag) hash.update(transformed);
            if (output !== undefined) writeAll(output, transformed);
            size += count;
        }
        const last = transform.final();
        if (tag) hash.update(last);
        if (output !== undefined) {
            writeAll(output, last);
            // The committed encrypted vault remains the durable copy while
            // opening a space. Only newly encrypted output must be synced
            // before plaintext can be removed.
            if (!tag) fs.fsyncSync(output);
        }
        return { size, sha256: hash.digest('hex'), tag: tag || transform.getAuthTag() };
    } finally {
        fs.closeSync(input);
        if (output !== undefined) fs.closeSync(output);
    }
}

function readVault(paths, password) {
    const header = JSON.parse(fs.readFileSync(path.join(paths.vault, 'vault.json'), 'utf8'));
    if (header.version !== FORMAT_VERSION) throw new Error('Unsupported vault version.');
    const salt = Buffer.from(header.salt, 'base64');
    if (salt.length !== 16) throw new Error('Invalid vault salt.');
    const passwordKey = crypto.scryptSync(password.normalize(), salt, 32, KDF_OPTIONS);
    let key;
    try {
        key = openBuffer(header.wrappedKey, passwordKey);
    } finally {
        passwordKey.fill(0);
    }
    if (key.length !== 32) {
        key.fill(0);
        throw new Error('Invalid vault key.');
    }
    try {
        const entries = JSON.parse(openBuffer(header.manifest, key).toString('utf8'));
        if (!Array.isArray(entries)) throw new Error('Invalid vault manifest.');
        return { header, key, entries };
    } catch (error) {
        key.fill(0);
        throw error;
    }
}

function createManifest(paths, stage, key) {
    const entries = [];
    const filesPath = path.join(stage, 'files');
    fs.mkdirSync(filesPath);
    for (const [scope, sourceRoot] of [['main', paths.main], ['demo', paths.demo], ['legacyDemo', paths.legacyDemo], ['backups', paths.backups]]) {
        if (!sourceRoot || !fs.existsSync(sourceRoot)) continue;
        if (fs.lstatSync(sourceRoot).isSymbolicLink()) throw new Error('A user space contains a symbolic link.');
        if (scope !== 'backups' && !within(fs.realpathSync(paths.root), fs.realpathSync(sourceRoot))) {
            throw new Error('A user space points outside the data directory.');
        }
        entries.push({ scope, type: 'root' });
        const visit = (folder, relative = '') => {
            for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
                if (scope === 'backups' && !relative && item.name === '!README.md') continue;
                const current = path.join(folder, item.name);
                const child = relative ? `${relative}/${item.name}` : item.name;
                if (item.isSymbolicLink()) throw new Error('A user space contains a symbolic link.');
                const stat = fs.statSync(current);
                if (item.isDirectory()) {
                    entries.push({ scope, type: 'directory', path: child, mtimeMs: stat.mtimeMs });
                    visit(current, child);
                } else if (item.isFile()) {
                    const id = crypto.randomUUID();
                    const nonce = crypto.randomBytes(12);
                    const result = transformFile(current, path.join(filesPath, id), key, nonce);
                    entries.push({ scope, type: 'file', path: child, id, size: stat.size,
                        sha256: result.sha256, nonce: nonce.toString('base64'), tag: result.tag.toString('base64'), mtimeMs: stat.mtimeMs });
                } else {
                    throw new Error('A user space contains an unsupported file type.');
                }
            }
        };
        visit(sourceRoot);
    }
    return entries;
}

function validatedPath(root, relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':')
        || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error('Invalid vault path.');
    }
    const result = path.resolve(root, ...relative.split('/'));
    if (!within(root, result)) throw new Error('Invalid vault path.');
    return result;
}

function verifyEntries(stage, entries, key) {
    for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const source = path.join(stage, 'files', entry.id);
        const result = transformFile(source, null, key, Buffer.from(entry.nonce, 'base64'), Buffer.from(entry.tag, 'base64'));
        if (result.sha256 !== entry.sha256 || result.size !== entry.size) throw new Error('Vault verification failed.');
    }
}

function verifySources(paths, entries) {
    for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const source = validatedPath(paths[entry.scope], entry.path);
        const stat = fs.statSync(source);
        if (stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs) {
            throw new Error('A user file changed while the space was being encrypted.');
        }
    }
}

/** Return true only when the account has a committed encrypted vault. */
export function hasUserVault(dataRoot, handle) {
    return fs.existsSync(path.join(vaultPaths(dataRoot, handle).vault, 'vault.json'));
}

export function getUnlockedUserSpace() {
    return active?.handle ?? null;
}

/** Encrypt an account before it becomes inactive. Its previous encrypted snapshot is retained for rollback. */
export function sealUserSpace(dataRoot, handle, password = null) {
    const paths = vaultPaths(dataRoot, handle);
    if (!fs.existsSync(paths.main) && !fs.existsSync(paths.demo) && !fs.existsSync(paths.legacyDemo)) {
        throw new Error('The user space is not open.');
    }
    if (password === null && active?.handle !== handle) {
        throw new Error('The user space key is unavailable.');
    }
    const firstSeal = !hasUserVault(dataRoot, handle);
    const existing = !firstSeal && active?.handle !== handle ? readVault(paths, password) : null;
    const hasBackups = active?.handle === handle ? active.backups : existing?.entries.some(entry => entry.scope === 'backups');
    if (!paths.backups && hasBackups) paths.backups = path.join(path.dirname(paths.root), 'backups');
    const salt = active?.handle === handle ? active.salt : existing ? Buffer.from(existing.header.salt, 'base64') : crypto.randomBytes(16);
    const key = active?.handle === handle ? active.key : existing?.key ?? crypto.randomBytes(32);
    let wrappedKey = active?.handle === handle ? active.wrappedKey : existing?.header.wrappedKey;
    if (!wrappedKey) {
        const passwordKey = crypto.scryptSync(password.normalize(), salt, 32, KDF_OPTIONS);
        try {
            wrappedKey = sealBuffer(key, passwordKey);
        } finally {
            passwordKey.fill(0);
        }
    }
    fs.mkdirSync(paths.vaultRoot, { recursive: true });
    assertVaultRoot(paths);
    const stage = path.join(paths.vaultRoot, `.stage-${crypto.randomUUID()}`);
    fs.mkdirSync(stage);
    let committed = false;
    try {
        const entries = createManifest(paths, stage, key);
        const header = { version: FORMAT_VERSION, salt: salt.toString('base64'), wrappedKey,
            manifest: sealBuffer(Buffer.from(JSON.stringify(entries)), key) };
        fs.writeFileSync(path.join(stage, 'vault.json'), JSON.stringify(header), { flag: 'wx' });
        verifyEntries(stage, entries, key);
        verifySources(paths, entries);
        const previous = path.join(paths.vaultRoot, `${handle}.previous`);
        if (!firstSeal) {
            if (fs.existsSync(previous)) removeOwned(previous, paths.vaultRoot);
            fs.renameSync(paths.vault, previous);
        }
        try {
            fs.renameSync(stage, paths.vault);
        } catch (error) {
            if (!firstSeal) fs.renameSync(previous, paths.vault);
            throw error;
        }
        committed = true;
        if (firstSeal) {
            const initialBackup = path.join(paths.vaultRoot, `${handle}.initial`);
            fs.cpSync(paths.vault, initialBackup, { recursive: true, errorOnExist: true, force: false });
        }
        verifySources(paths, entries);
        if (fs.existsSync(paths.main)) removeOwned(paths.main, paths.root);
        if (fs.existsSync(paths.demo)) removeOwned(paths.demo, paths.root);
        if (fs.existsSync(paths.legacyDemo)) removeOwned(paths.legacyDemo, paths.root);
        if (paths.backups && fs.existsSync(paths.backups)) {
            for (const name of fs.readdirSync(paths.backups)) {
                if (name !== '!README.md') removeOwned(path.join(paths.backups, name), paths.backups);
            }
        }
        if (active?.handle === handle) active = null;
        key.fill(0);
        return { files: entries.filter(entry => entry.type === 'file').length, backup: firstSeal };
    } catch (error) {
        if (!committed && fs.existsSync(stage)) removeOwned(stage, paths.vaultRoot);
        if (active?.handle !== handle) key.fill(0);
        throw error;
    }
}

/** Unlock one account after its password hash has been verified. Only one account is open at a time. */
export function unlockUserSpace(dataRoot, handle, password) {
    if (active?.handle === handle) return;
    if (active) sealUserSpace(dataRoot, active.handle);
    const paths = vaultPaths(dataRoot, handle);
    assertVaultRoot(paths);
    if (fs.existsSync(paths.main) || fs.existsSync(paths.demo) || fs.existsSync(paths.legacyDemo)) {
        // An interrupted process can leave the working directory open. The
        // authenticated password lets us preserve its latest files and retain
        // the prior encrypted snapshot before opening it again.
        sealUserSpace(dataRoot, handle, password);
    }
    const { header, key, entries } = readVault(paths, password);
    const hasBackups = entries.some(entry => entry.scope === 'backups');
    if (!paths.backups && hasBackups) paths.backups = path.join(path.dirname(paths.root), 'backups');
    const stage = path.join(paths.root, `._unlock-${crypto.randomUUID()}`);
    fs.mkdirSync(stage);
    const moved = [];
    const createdFolders = new Set();
    const roots = { main: path.join(stage, 'main'), demo: path.join(stage, 'demo'), legacyDemo: path.join(stage, 'legacyDemo'), backups: path.join(stage, 'backups') };
    try {
        const seen = new Set();
        for (const entry of entries) {
            const targetRoot = roots[entry.scope];
            if (!targetRoot || !['root', 'directory', 'file'].includes(entry.type)) throw new Error('Invalid vault manifest.');
            if (entry.type === 'root') {
                fs.mkdirSync(targetRoot, { recursive: true });
                createdFolders.add(targetRoot);
                continue;
            }
            const target = validatedPath(targetRoot, entry.path);
            if (seen.has(target)) throw new Error('Duplicate vault path.');
            seen.add(target);
            if (entry.type === 'directory') {
                fs.mkdirSync(target, { recursive: true });
                createdFolders.add(target);
            } else {
                if (typeof entry.id !== 'string' || !/^[a-f0-9-]{36}$/.test(entry.id)) throw new Error('Invalid vault file ID.');
                const parent = path.dirname(target);
                if (!createdFolders.has(parent)) {
                    fs.mkdirSync(parent, { recursive: true });
                    createdFolders.add(parent);
                }
                const source = path.join(paths.vault, 'files', entry.id);
                const result = transformFile(source, target, key, Buffer.from(entry.nonce, 'base64'), Buffer.from(entry.tag, 'base64'));
                if (result.sha256 !== entry.sha256 || result.size !== entry.size) throw new Error('Vault file verification failed.');
                fs.utimesSync(target, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
            }
        }
        for (const entry of [...entries].reverse()) {
            if (entry.type !== 'directory') continue;
            const target = validatedPath(roots[entry.scope], entry.path);
            fs.utimesSync(target, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
        }
        for (const scope of ['main', 'demo', 'legacyDemo']) {
            if (scope === 'legacyDemo' && fs.existsSync(roots[scope])) fs.mkdirSync(path.dirname(paths[scope]), { recursive: true });
            if (fs.existsSync(roots[scope])) {
                fs.renameSync(roots[scope], paths[scope]);
                moved.push({ from: paths[scope], to: roots[scope] });
            }
        }
        if (paths.backups && fs.existsSync(roots.backups)) {
            fs.mkdirSync(paths.backups, { recursive: true });
            for (const name of fs.readdirSync(roots.backups)) {
                const destination = path.join(paths.backups, name);
                if (fs.existsSync(destination)) throw new Error('An unsealed backup path already exists.');
                fs.renameSync(path.join(roots.backups, name), destination);
                moved.push({ from: destination, to: path.join(roots.backups, name) });
            }
        }
        removeOwned(stage, paths.root);
        active = { handle, key, salt: Buffer.from(header.salt, 'base64'), wrappedKey: header.wrappedKey, backups: hasBackups };
    } catch (error) {
        for (const item of moved.reverse()) {
            if (fs.existsSync(item.from)) fs.renameSync(item.from, item.to);
        }
        if (fs.existsSync(stage)) removeOwned(stage, paths.root);
        key.fill(0);
        throw error;
    }
}

/** Change the password wrapping the data key without writing a plaintext copy. */
export function rewrapUserSpace(dataRoot, handle, oldPassword, newPassword) {
    const paths = vaultPaths(dataRoot, handle);
    assertVaultRoot(paths);
    const { header, key } = readVault(paths, oldPassword);
    try {
        const salt = crypto.randomBytes(16);
        const passwordKey = crypto.scryptSync(newPassword.normalize(), salt, 32, KDF_OPTIONS);
        try {
            header.salt = salt.toString('base64');
            header.wrappedKey = sealBuffer(key, passwordKey);
        } finally {
            passwordKey.fill(0);
        }
        const temporary = path.join(paths.vault, `.header-${crypto.randomUUID()}`);
        fs.writeFileSync(temporary, JSON.stringify(header), { flag: 'wx' });
        fs.renameSync(temporary, path.join(paths.vault, 'vault.json'));
        if (active?.handle === handle) {
            active.salt = salt;
            active.wrappedKey = header.wrappedKey;
        }
    } finally {
        key.fill(0);
    }
}

export function sealActiveUserSpace(dataRoot) {
    if (active) return sealUserSpace(dataRoot, active.handle);
    return null;
}

export function purgeUserVault(dataRoot, handle) {
    if (active?.handle === handle) throw new Error('Cannot purge an open user space.');
    const paths = vaultPaths(dataRoot, handle);
    assertVaultRoot(paths);
    for (const target of [paths.vault, path.join(paths.vaultRoot, `${handle}.initial`), path.join(paths.vaultRoot, `${handle}.previous`)]) {
        if (fs.existsSync(target)) removeOwned(target, paths.vaultRoot);
    }
    for (const target of [paths.main, paths.demo, paths.legacyDemo]) {
        if (fs.existsSync(target)) removeOwned(target, paths.root);
    }
}
