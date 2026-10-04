import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_USER } from '../constants.js';
import { waitForUserSpaceTasks } from './activity.js';

const FORMAT_VERSION = 1;
const CHUNK_SIZE = 1024 * 1024;
const OPEN_MARKER = '.working-open';
const KDF_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let active = null;
const derivePasswordKey = promisify(crypto.scrypt);
let operations = Promise.resolve();
let busy = false;

function exclusively(operation) {
    const result = operations.then(async () => {
        busy = true;
        try { return await operation(); } finally { busy = false; }
    });
    operations = result.catch(() => {});
    return result;
}

async function mapFiles(items, action) {
    let cursor = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (!failure && cursor < items.length) {
            const item = items[cursor++];
            try { await action(item); } catch (error) { failure ??= error; }
        }
    }));
    if (failure) throw failure;
}

function assertHandle(handle) {
    if (typeof handle !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(handle)) {
        throw new Error('Invalid user space handle.');
    }
}

function within(parent, child) {
    const relative = path.relative(parent, child);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function removeOwned(target, parent) {
    const parentPath = path.resolve(parent);
    const targetPath = path.resolve(target);
    if (!within(parentPath, targetPath) || !within(fs.realpathSync(parentPath), fs.realpathSync(targetPath))
        || fs.lstatSync(targetPath).isSymbolicLink()) {
        throw new Error('Refusing to remove an unexpected data path.');
    }
    await fs.promises.rm(targetPath, { recursive: true, force: false });
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

async function transformFile(source, destination, key, nonce, tag = null, sizeHint = Infinity) {
    const transform = tag ? crypto.createDecipheriv('aes-256-gcm', key, nonce) : crypto.createCipheriv('aes-256-gcm', key, nonce);
    if (tag) transform.setAuthTag(tag);
    const hash = crypto.createHash('sha256');
    if (sizeHint <= CHUNK_SIZE) {
        if ((await fs.promises.stat(source)).size !== sizeHint) throw new Error('Vault file size changed.');
        const input = await fs.promises.readFile(source);
        const transformed = Buffer.concat([transform.update(input), transform.final()]);
        const plain = tag ? transformed : input;
        hash.update(plain);
        if (destination) {
            const output = await fs.promises.open(destination, 'wx');
            try {
                await output.writeFile(transformed);
                if (!tag) await output.sync();
            } finally { await output.close(); }
        }
        return { size: plain.length, sha256: hash.digest('hex'), tag: tag || transform.getAuthTag() };
    }
    let size = 0;
    const digest = new Transform({ transform(chunk, _encoding, callback) {
        hash.update(chunk); size += chunk.length; callback(null, chunk);
    } });
    const input = fs.createReadStream(source, { highWaterMark: CHUNK_SIZE });
    const output = destination ? fs.createWriteStream(destination, { flags: 'wx' }) : new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    await pipeline(...(tag ? [input, transform, digest, output] : [input, digest, transform, output]));
    if (destination && !tag) {
        const durable = await fs.promises.open(destination, 'r+');
        try { await durable.sync(); } finally { await durable.close(); }
    }
    return { size, sha256: hash.digest('hex'), tag: tag || transform.getAuthTag() };
}

async function readVault(paths, password) {
    const header = JSON.parse(fs.readFileSync(path.join(paths.vault, 'vault.json'), 'utf8'));
    if (header.version !== FORMAT_VERSION) throw new Error('Unsupported vault version.');
    if (header.workingMarkerVersion !== undefined && header.workingMarkerVersion !== 1) throw new Error('Unsupported working-space marker.');
    const salt = Buffer.from(header.salt, 'base64');
    if (salt.length !== 16) throw new Error('Invalid vault salt.');
    const passwordKey = await derivePasswordKey(password.normalize(), salt, 32, KDF_OPTIONS);
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

async function createManifest(paths, stage, key) {
    const entries = [];
    const filesPath = path.join(stage, 'files');
    fs.mkdirSync(filesPath);
    const pending = [];
    for (const [scope, sourceRoot] of [['main', paths.main], ['demo', paths.demo], ['legacyDemo', paths.legacyDemo], ['backups', paths.backups]]) {
        if (!sourceRoot || !fs.existsSync(sourceRoot)) continue;
        if (fs.lstatSync(sourceRoot).isSymbolicLink()) throw new Error('A user space contains a symbolic link.');
        if (scope !== 'backups' && !within(fs.realpathSync(paths.root), fs.realpathSync(sourceRoot))) {
            throw new Error('A user space points outside the data directory.');
        }
        entries.push({ scope, type: 'root', mtimeMs: (await fs.promises.stat(sourceRoot)).mtimeMs });
        const visit = async (folder, relative = '') => {
            for (const item of await fs.promises.readdir(folder, { withFileTypes: true })) {
                if (scope === 'backups' && !relative && item.name === '!README.md') continue;
                const current = path.join(folder, item.name);
                const child = relative ? `${relative}/${item.name}` : item.name;
                if (item.isSymbolicLink()) throw new Error('A user space contains a symbolic link.');
                const stat = await fs.promises.stat(current);
                if (item.isDirectory()) {
                    entries.push({ scope, type: 'directory', path: child, mtimeMs: stat.mtimeMs });
                    await visit(current, child);
                } else if (item.isFile()) {
                    const id = crypto.randomUUID();
                    const nonce = crypto.randomBytes(12);
                    const entry = { scope, type: 'file', path: child, id, size: stat.size, nonce: nonce.toString('base64'), mtimeMs: stat.mtimeMs };
                    entries.push(entry);
                    pending.push({ current, entry, nonce });
                } else {
                    throw new Error('A user space contains an unsupported file type.');
                }
            }
        };
        await visit(sourceRoot);
    }
    await mapFiles(pending, async ({ current, entry, nonce }) => {
        const result = await transformFile(current, path.join(filesPath, entry.id), key, nonce, null, entry.size);
        entry.sha256 = result.sha256;
        entry.tag = result.tag.toString('base64');
    });
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

async function verifyEntries(stage, entries, key) {
    await mapFiles(entries.filter(entry => entry.type === 'file'), async entry => {
        const source = path.join(stage, 'files', entry.id);
        const result = await transformFile(source, null, key, Buffer.from(entry.nonce, 'base64'), Buffer.from(entry.tag, 'base64'), entry.size);
        if (result.sha256 !== entry.sha256 || result.size !== entry.size) throw new Error('Vault verification failed.');
    });
}

async function verifySources(paths, entries) {
    await mapFiles(entries, async entry => {
        const source = entry.type === 'root' ? paths[entry.scope] : validatedPath(paths[entry.scope], entry.path);
        const stat = await fs.promises.stat(source);
        if ((entry.type === 'file' && stat.size !== entry.size) || stat.mtimeMs !== entry.mtimeMs) {
            throw new Error('A user file changed while the space was being encrypted.');
        }
    });
}

async function removeSources(paths) {
    for (const scope of ['main', 'demo', 'legacyDemo']) {
        if (fs.existsSync(paths[scope])) await removeOwned(paths[scope], paths.root);
    }
    if (paths.backups && fs.existsSync(paths.backups)) {
        for (const name of fs.readdirSync(paths.backups)) {
            if (name !== '!README.md') await removeOwned(path.join(paths.backups, name), paths.backups);
        }
    }
}

// Late writes from a closing browser are fragments, not a complete working space.
// Preserve them encrypted without replacing the last complete vault.
async function preserveFragments(paths, header, key) {
    const stage = path.join(paths.vaultRoot, `.stage-${crypto.randomUUID()}`);
    fs.mkdirSync(stage);
    try {
        const entries = await createManifest(paths, stage, key);
        fs.writeFileSync(path.join(stage, 'vault.json'), JSON.stringify({ ...header, manifest: sealBuffer(Buffer.from(JSON.stringify(entries)), key) }), { flag: 'wx' });
        await verifyEntries(stage, entries, key);
        await verifySources(paths, entries);
        fs.renameSync(stage, path.join(paths.vaultRoot, `${path.basename(paths.main)}.fragment-${crypto.randomUUID()}`));
        await removeSources(paths);
    } finally {
        if (fs.existsSync(stage)) await removeOwned(stage, paths.vaultRoot);
    }
}

/** Return true only when the account has a committed encrypted vault. */
export function hasUserVault(dataRoot, handle) {
    return fs.existsSync(path.join(vaultPaths(dataRoot, handle).vault, 'vault.json'));
}

export function getUnlockedUserSpace() {
    return busy ? null : active?.handle ?? null;
}

export function isUserSpaceBusy() { return busy; }

/** Encrypt an account before it becomes inactive. Its previous encrypted snapshot is retained for rollback. */
export function sealUserSpace(dataRoot, handle, password = null) {
    return exclusively(() => sealSpace(dataRoot, handle, password));
}

async function sealSpace(dataRoot, handle, password = null) {
    await waitForUserSpaceTasks(handle);
    const paths = vaultPaths(dataRoot, handle);
    if (!fs.existsSync(paths.main) && !fs.existsSync(paths.demo) && !fs.existsSync(paths.legacyDemo)) {
        throw new Error('The user space is not open.');
    }
    if (password === null && active?.handle !== handle) {
        throw new Error('The user space key is unavailable.');
    }
    const firstSeal = !hasUserVault(dataRoot, handle);
    const existing = !firstSeal && active?.handle !== handle ? await readVault(paths, password) : null;
    const hasBackups = active?.handle === handle ? active.backups : existing?.entries.some(entry => entry.scope === 'backups');
    if (!paths.backups && hasBackups) paths.backups = path.join(path.dirname(paths.root), 'backups');
    const salt = active?.handle === handle ? active.salt : existing ? Buffer.from(existing.header.salt, 'base64') : crypto.randomBytes(16);
    const key = active?.handle === handle ? active.key : existing?.key ?? crypto.randomBytes(32);
    let wrappedKey = active?.handle === handle ? active.wrappedKey : existing?.header.wrappedKey;
    if (!wrappedKey) {
        const passwordKey = await derivePasswordKey(password.normalize(), salt, 32, KDF_OPTIONS);
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
        const entries = await createManifest(paths, stage, key);
        const header = { version: FORMAT_VERSION, workingMarkerVersion: 1, salt: salt.toString('base64'), wrappedKey,
            manifest: sealBuffer(Buffer.from(JSON.stringify(entries)), key) };
        fs.writeFileSync(path.join(stage, 'vault.json'), JSON.stringify(header), { flag: 'wx' });
        await verifyEntries(stage, entries, key);
        await verifySources(paths, entries);
        const previous = path.join(paths.vaultRoot, `${handle}.previous`);
        if (!firstSeal) {
            if (fs.existsSync(previous)) await removeOwned(previous, paths.vaultRoot);
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
            await fs.promises.cp(paths.vault, initialBackup, { recursive: true, errorOnExist: true, force: false });
        }
        await verifySources(paths, entries);
        await removeSources(paths);
        if (active?.handle === handle) active = null;
        key.fill(0);
        return { files: entries.filter(entry => entry.type === 'file').length, backup: firstSeal };
    } catch (error) {
        if (!committed && fs.existsSync(stage)) await removeOwned(stage, paths.vaultRoot);
        if (active?.handle !== handle) key.fill(0);
        throw error;
    }
}

/** Unlock one account after its password hash has been verified. Only one account is open at a time. */
export function unlockUserSpace(dataRoot, handle, password, onProgress = () => {}) {
    return exclusively(() => unlockSpace(dataRoot, handle, password, onProgress));
}

async function unlockSpace(dataRoot, handle, password, onProgress) {
    if (active?.handle === handle) return;
    onProgress({ phase: 'sealing', completed: 0, total: 0 });
    if (active) await sealSpace(dataRoot, active.handle);
    const paths = vaultPaths(dataRoot, handle);
    assertVaultRoot(paths);
    const remaining = fs.existsSync(paths.main) || fs.existsSync(paths.demo) || fs.existsSync(paths.legacyDemo);
    const legacyWorkingSpace = remaining && fs.existsSync(path.join(paths.main, 'settings.json'))
        && !Object.hasOwn(JSON.parse(fs.readFileSync(path.join(paths.vault, 'vault.json'), 'utf8')), 'workingMarkerVersion');
    const completeWorkingSpace = fs.existsSync(path.join(paths.vault, OPEN_MARKER)) || legacyWorkingSpace;
    if (remaining && completeWorkingSpace) {
        // An interrupted process can leave the working directory open. The
        // authenticated password lets us preserve its latest files and retain
        // the prior encrypted snapshot before opening it again.
        await sealSpace(dataRoot, handle, password);
    }
    onProgress({ phase: 'key', completed: 0, total: 0 });
    const { header, key, entries } = await readVault(paths, password);
    const hasBackups = entries.some(entry => entry.scope === 'backups');
    if (!paths.backups && hasBackups) paths.backups = path.join(path.dirname(paths.root), 'backups');
    if (remaining && !completeWorkingSpace) {
        try { await preserveFragments(paths, header, key); } catch (error) { key.fill(0); throw error; }
    }
    const stage = path.join(paths.root, `._unlock-${crypto.randomUUID()}`);
    fs.mkdirSync(stage);
    const moved = [];
    const createdFolders = new Set();
    const roots = { main: path.join(stage, 'main'), demo: path.join(stage, 'demo'), legacyDemo: path.join(stage, 'legacyDemo'), backups: path.join(stage, 'backups') };
    try {
        const seen = new Set();
        const files = [];
        for (const entry of entries) {
            const targetRoot = roots[entry.scope];
            if (!targetRoot || !['root', 'directory', 'file'].includes(entry.type)) throw new Error('Invalid vault manifest.');
            if (entry.type === 'root') {
                await fs.promises.mkdir(targetRoot, { recursive: true });
                createdFolders.add(targetRoot);
                continue;
            }
            const target = validatedPath(targetRoot, entry.path);
            if (seen.has(target)) throw new Error('Duplicate vault path.');
            seen.add(target);
            if (entry.type === 'directory') {
                await fs.promises.mkdir(target, { recursive: true });
                createdFolders.add(target);
            } else {
                if (typeof entry.id !== 'string' || !/^[a-f0-9-]{36}$/.test(entry.id)) throw new Error('Invalid vault file ID.');
                const parent = path.dirname(target);
                if (!createdFolders.has(parent)) {
                    await fs.promises.mkdir(parent, { recursive: true });
                    createdFolders.add(parent);
                }
                files.push({ entry, target });
            }
        }
        let completed = 0;
        onProgress({ phase: 'decrypt', completed, total: files.length });
        await mapFiles(files, async ({ entry, target }) => {
            const source = path.join(paths.vault, 'files', entry.id);
            const result = await transformFile(source, target, key, Buffer.from(entry.nonce, 'base64'), Buffer.from(entry.tag, 'base64'), entry.size);
            if (result.sha256 !== entry.sha256 || result.size !== entry.size) throw new Error('Vault file verification failed.');
            await fs.promises.utimes(target, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
            onProgress({ phase: 'decrypt', completed: ++completed, total: files.length });
        });
        for (const entry of [...entries].reverse()) {
            if (entry.type !== 'directory') continue;
            const target = validatedPath(roots[entry.scope], entry.path);
            await fs.promises.utimes(target, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
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
        fs.writeFileSync(path.join(paths.vault, OPEN_MARKER), '1', { flag: 'w' });
        await removeOwned(stage, paths.root);
        active = { handle, key, salt: Buffer.from(header.salt, 'base64'), wrappedKey: header.wrappedKey, backups: hasBackups };
    } catch (error) {
        for (const item of moved.reverse()) {
            if (fs.existsSync(item.from)) fs.renameSync(item.from, item.to);
        }
        if (fs.existsSync(stage)) await removeOwned(stage, paths.root);
        key.fill(0);
        throw error;
    }
}

/** Change the password wrapping the data key without writing a plaintext copy. */
export function rewrapUserSpace(dataRoot, handle, oldPassword, newPassword) {
    return exclusively(() => rewrapSpace(dataRoot, handle, oldPassword, newPassword));
}

async function rewrapSpace(dataRoot, handle, oldPassword, newPassword) {
    const paths = vaultPaths(dataRoot, handle);
    assertVaultRoot(paths);
    const { header, key } = await readVault(paths, oldPassword);
    try {
        const salt = crypto.randomBytes(16);
        const passwordKey = await derivePasswordKey(newPassword.normalize(), salt, 32, KDF_OPTIONS);
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
    return exclusively(() => active ? sealSpace(dataRoot, active.handle) : null);
}

export function purgeUserVault(dataRoot, handle) {
    return exclusively(() => purgeSpace(dataRoot, handle));
}

async function purgeSpace(dataRoot, handle) {
    if (active?.handle === handle) throw new Error('Cannot purge an open user space.');
    const paths = vaultPaths(dataRoot, handle);
    assertVaultRoot(paths);
    if (fs.existsSync(paths.vaultRoot)) {
        for (const name of fs.readdirSync(paths.vaultRoot)) {
            if (name.startsWith(`${handle}.fragment-`) && /^[a-f0-9-]{36}$/i.test(name.slice(handle.length + 10))) await removeOwned(path.join(paths.vaultRoot, name), paths.vaultRoot);
        }
    }
    for (const target of [paths.vault, path.join(paths.vaultRoot, `${handle}.initial`), path.join(paths.vaultRoot, `${handle}.previous`)]) {
        if (fs.existsSync(target)) await removeOwned(target, paths.vaultRoot);
    }
    for (const target of [paths.main, paths.demo, paths.legacyDemo]) {
        if (fs.existsSync(target)) await removeOwned(target, paths.root);
    }
}
