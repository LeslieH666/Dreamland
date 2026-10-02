import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import preparation from '../scripts/prepare-blue-archive-assets.cjs';

let root;
let source;
let manifest;
const buffer = Buffer.from('89504e470d0a1a0a00000000', 'hex');
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-packaging-'));
    source = path.join(root, 'source');
    fs.mkdirSync(source);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    manifest = { version: 2, gameVersion: 'synthetic', assets: [{ file: 'Synthetic.png', sha256 }] };
    fs.writeFileSync(path.join(source, 'Synthetic.png'), buffer);
    fs.writeFileSync(path.join(source, 'installed.json'), JSON.stringify(manifest));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('copies the verified artwork allowlist, excludes previews and validates the result', () => {
    fs.writeFileSync(path.join(source, 'synthetic-preview.html'), 'not distributable');
    const destination = path.join(root, 'package');
    expect(preparation.prepareBaPack(source, destination, manifest)).toBe(1);
    expect(fs.readdirSync(destination).sort()).toEqual(['Synthetic.png', 'installed.json']);
    expect(preparation.verifyBaPack(destination, manifest).files).toEqual(['Synthetic.png']);
});
test('rejects corrupt/missing artwork before touching an existing destination', () => {
    const destination = path.join(root, 'package');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'sentinel'), 'keep');
    fs.writeFileSync(path.join(source, 'Synthetic.png'), 'corrupted');
    expect(() => preparation.prepareBaPack(source, destination, manifest)).toThrow('checksum');
    expect(fs.readdirSync(destination)).toEqual(['sentinel']);
    fs.unlinkSync(path.join(source, 'Synthetic.png'));
    expect(() => preparation.prepareBaPack(source, destination, manifest)).toThrow();
});
test('rejects traversal and a manifest from another game version', () => {
    expect(() => preparation.verifyBaPack(source, { ...manifest, assets: [{ file: '../outside.png' }] })).toThrow('filename');
    expect(() => preparation.verifyBaPack(source, { ...manifest, gameVersion: 'wrong' })).toThrow('version');
});
