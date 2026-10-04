/* Archive only indexed public game artwork, never workspace/user directories. */
const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
const { hashFile } = require('./download-blue-archive-ui.cjs');

async function packageLibrary() {
    const project = path.resolve(__dirname, '..');
    const root = path.join(project, 'resources/blue-archive/ui-library/1.93.454564');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json')));
    if (manifest.failed.length || index.errors.length) throw new Error('Finish validating the library before packaging.');
    const files = [{ file: 'manifest.json' }, { file: 'index.json' },
        ...manifest.resources.map(entry => ({ file: 'bundles/' + entry.path, sha256: entry.sha256 })),
        ...index.images.map(image => ({ file: image.file, sha256: image.sha256 }))];
    const seen = new Set();
    for (const entry of files) {
        const file = path.resolve(root, entry.file);
        if (!file.startsWith(root + path.sep) || seen.has(file)) throw new Error('Invalid or duplicate library path.');
        seen.add(file);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid library file.');
        if (entry.sha256 && (await hashFile(file)).sha256 !== entry.sha256) throw new Error('Library checksum failed: ' + entry.file);
    }
    const outputDirectory = path.join(project, 'Cache/research/ba-ui-release');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const name = 'blue-archive-ui-' + manifest.gameVersion + '.zip';
    const output = path.join(outputDirectory, name);
    const stream = fs.createWriteStream(output);
    const archive = archiver('zip', { zlib: { level: 1 } });
    const done = new Promise((resolve, reject) => {
        stream.once('close', resolve);
        stream.once('error', reject);
        archive.once('error', reject);
        archive.once('warning', reject);
    });
    archive.pipe(stream);
    for (const entry of files) archive.file(path.join(root, entry.file), { name: manifest.gameVersion + '/' + entry.file });
    await archive.finalize();
    await done;
    const summary = {
        schemaVersion: 1, gameVersion: manifest.gameVersion, bundles: manifest.resources.length,
        images: index.images.length, atlases: index.atlases.length, dynamicTextures: index.dynamicTextures.length, archive: name,
        bytes: fs.statSync(output).size, sha256: (await hashFile(output)).sha256,
        url: 'https://github.com/LeslieH666/LeslieTavern/releases/download/ba-ui-library-' + manifest.gameVersion + '/' + name,
        scope: manifest.scope, catalog: manifest.catalog,
    };
    if (summary.bytes >= 2 * 1024 * 1024 * 1024) throw new Error('Split the archive before publishing.');
    fs.writeFileSync(path.join(project, 'resources/blue-archive/ui-release.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(outputDirectory, 'SHA256SUMS.txt'), summary.sha256 + '  ' + name + '\n');
    // A compact, tracked provenance index links each archive file to its source.
    const provenance = { ...manifest, images: index.images, dynamicTextures: index.dynamicTextures,
        atlases: index.atlases.map(atlas => ({ name: atlas.name, bundle: atlas.bundle, sprites: atlas.sprites.length })) };
    fs.writeFileSync(path.join(project, 'resources/blue-archive/ui-library-index.json'), JSON.stringify(provenance) + '\n');
    console.log('UI release archive ready: ' + summary.bundles + ' bundles, ' + summary.images + ' images, ' + Math.round(summary.bytes / 1024 / 1024) + ' MiB.');
    console.log('SHA-256: ' + summary.sha256);
}

if (require.main === module) packageLibrary().catch(error => { console.error(error.message); process.exitCode = 1; });
