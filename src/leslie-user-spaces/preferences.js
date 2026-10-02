import fs from 'node:fs';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { validPreference, loginAppearance, normalizePreference } from '../../public/scripts/leslie-preferences-core.js';

function preferencePath(root) { return path.join(root, 'leslie', 'browser-preferences.json'); }

export function readPreferences(root) {
    const file = preferencePath(root);
    if (!fs.existsSync(file)) return { schemaVersion: 1, values: {}, saved: false };
    const original = fs.readFileSync(file, 'utf8');
    const record = JSON.parse(original);
    if (record?.schemaVersion !== 1 || !record.values || typeof record.values !== 'object' || Array.isArray(record.values)) throw new Error('Unsupported preference record.');
    const entries = Object.entries(record.values).filter(([key, value]) => value !== null && validPreference(key, value));
    const values = Object.fromEntries(entries.map(([key, value]) => [key, normalizePreference(key, value)]));
    if (entries.some(([key, value]) => values[key] !== value)) {
        // Preserve the exact v1 record inside this account for code/data rollback.
        const backup = `${file}.before-momotalk`;
        if (!fs.existsSync(backup)) writeFileAtomicSync(backup, original, 'utf8');
        writeFileAtomicSync(file, JSON.stringify({ ...record, values: { ...record.values, ...values } }), 'utf8');
    }
    return { schemaVersion: 1, saved: true, values };
}

export function patchPreferences(root, changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)
        || Object.entries(changes).some(([key, value]) => !validPreference(key, value))) throw new TypeError('Invalid browser preferences.');
    const current = readPreferences(root);
    const values = { ...current.values };
    for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete values[key];
        else values[key] = normalizePreference(key, value);
    }
    const file = preferencePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Keep the preceding record as a rollback point inside the same encrypted space.
    if (current.saved) fs.copyFileSync(file, `${file}.previous`);
    writeFileAtomicSync(file, JSON.stringify({ schemaVersion: 1, values }), 'utf8');
    return values;
}

export function readLoginAppearance(dataRoot, handle) {
    try {
        const record = JSON.parse(fs.readFileSync(path.join(dataRoot, '_leslie-login-appearance.json'), 'utf8'));
        return loginAppearance(handle ? record.users?.[handle] : record.last);
    } catch { return {}; }
}

export function saveLoginAppearance(dataRoot, handle, values) {
    const file = path.join(dataRoot, '_leslie-login-appearance.json');
    let users = {};
    try { users = JSON.parse(fs.readFileSync(file, 'utf8')).users ?? {}; } catch { /* first theme selection */ }
    const appearance = loginAppearance(values);
    users[handle] = appearance;
    writeFileAtomicSync(file, JSON.stringify({ schemaVersion: 1, last: appearance, users }), 'utf8');
}
