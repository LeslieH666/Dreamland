#!/usr/bin/env node
// Copy only the fixed public-artwork allowlist; never preview files or user data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verifyBaPack(sourceRoot, manifest) {
    const installed = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'installed.json'), 'utf8'));
    if (installed.version !== manifest.version || installed.gameVersion !== manifest.gameVersion || !Array.isArray(installed.assets)) {
        throw new Error('BA artwork manifest is missing or belongs to another version.');
    }
    const files = [];
    for (const asset of manifest.assets) {
        if (!/^[A-Za-z0-9_-]+\.(png|jpg)$/.test(asset.file)) throw new Error('Invalid artwork filename.');
        const record = installed.assets.find(entry => entry.file === asset.file);
        const expected = asset.sha256 || record?.sha256;
        if (!/^[a-f0-9]{64}$/.test(expected || '') || record?.sha256 !== expected) throw new Error('Invalid artwork checksum: ' + asset.file);
        const file = path.join(sourceRoot, asset.file);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) throw new Error('Invalid artwork file: ' + asset.file);
        const buffer = fs.readFileSync(file);
        if (crypto.createHash('sha256').update(buffer).digest('hex') !== expected) throw new Error('Artwork checksum failed: ' + asset.file);
        const validImage = asset.file.endsWith('.png') ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : buffer[0] === 0xff && buffer[1] === 0xd8;
        if (!validImage) throw new Error('Invalid artwork image: ' + asset.file);
        files.push(asset.file);
    }
    return { files, installed: { ...manifest, assets: manifest.assets.map(asset => ({ ...asset, sha256: installed.assets.find(entry => entry.file === asset.file).sha256 })) } };
}
function prepareBaPack(sourceRoot, destination, manifest) {
    // Validate the entire source before creating/replacing any destination file.
    const verified = verifyBaPack(sourceRoot, manifest);
    if (destination) {
        fs.mkdirSync(destination, { recursive: true });
        for (const file of verified.files) fs.copyFileSync(path.join(sourceRoot, file), path.join(destination, file));
        fs.writeFileSync(path.join(destination, 'installed.json'), JSON.stringify(verified.installed));
        verifyBaPack(destination, manifest);
    }
    return verified.files.length;
}
module.exports = { verifyBaPack, prepareBaPack };

if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/img/blue-archive/sources.json'), 'utf8'));
    try {
        const destination = process.argv[2] && process.argv[2] !== '--check' ? path.resolve(process.argv[2]) : null;
        const count = prepareBaPack(path.join(root, 'public/img/blue-archive/bundled'), destination, manifest);
        console.log('BA artwork verified: ' + count + ' images.');
    } catch (error) {
        console.error('BA artwork preparation failed: ' + error.message + ' Restore with scripts/import-blue-archive-assets.py before building.');
        process.exitCode = 1;
    }
}
