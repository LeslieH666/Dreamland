/* Download the pinned UI-only library. Runtime artwork stays in public/img. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const VERSION = '1.93.454564';
const BASE_URL = 'https://ba.dn.nexoncdn.co.kr/com.nexon.bluearchive/e3ec4c1e969240ff/';
const ROOT = path.resolve(__dirname, '..');
const LIBRARY = path.join(ROOT, 'resources/blue-archive/ui-library', VERSION);
// These catalog families contain story art, characters, maps, tutorials or
// promotional illustrations rather than reusable interface controls.
const CONTENT_FAMILIES = /(?:uis-03_scenario|uis-00_images-(?:bg|banner|schoolmap)|uis-01_common-(?:01_character|03_nonequipment|04_weapon|08_lobbyillust|13_campaignimage|14_charactercollect|16_cafeitem|20_operator|21_enemyinfo|23_tutorialfailure|28_information|32_tutorialstage|49_battleplayguide|50_permanentraid-portrait)|uis-01_common-27_eventcontent-(?:playguide|main_bgimage|collectioncg|omikujiimg|enter_parcel)|uis-02_tactics-01_character|uis-01_common-49_sns-snspostimg)/i;

function selectUiEntries(catalog) {
    if (!Array.isArray(catalog?.resources)) throw new Error('Invalid resource catalog.');
    const entries = [];
    const excluded = [];
    const seen = new Set();
    for (const resource of catalog.resources) {
        const name = resource.resource_path;
        if (typeof name !== 'string' || !/(^|[-/])uis([-_/]|$)/i.test(name) || !name.endsWith('.bundle')) continue;
        if (!/^(Preload|GameData)\/Android\/[a-zA-Z0-9_.-]+\.bundle$/.test(name)
            || name.includes('..') || seen.has(name) || !Number.isSafeInteger(resource.resource_size)
            || resource.resource_size <= 0 || !/^[a-f0-9]{32}$/.test(resource.resource_hash)) {
            throw new Error('Invalid or duplicate UI resource entry.');
        }
        seen.add(name);
        const entry = { path: name, bytes: resource.resource_size, md5: resource.resource_hash, url: BASE_URL + name };
        if (CONTENT_FAMILIES.test(name)) excluded.push({ path: name, reason: 'game-content-family' });
        else entries.push(entry);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { entries, excluded };
}

async function hashFile(file) {
    const md5 = crypto.createHash('md5');
    const sha256 = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of fs.createReadStream(file)) {
        bytes += chunk.length;
        md5.update(chunk);
        sha256.update(chunk);
    }
    return { bytes, md5: md5.digest('hex'), sha256: sha256.digest('hex') };
}
async function verifyEntry(file, entry) {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes) return null;
        const result = await hashFile(file);
        return result.md5 === entry.md5 ? result : null;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}
function destinationFor(entry) {
    const destination = path.resolve(LIBRARY, 'bundles', entry.path);
    if (!destination.startsWith(path.join(LIBRARY, 'bundles') + path.sep)) throw new Error('Invalid resource destination.');
    return destination;
}
async function downloadEntry(entry) {
    const destination = destinationFor(entry);
    const existing = await verifyEntry(destination, entry);
    if (existing) return { ...entry, ...existing };
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const cached = path.join(ROOT, 'Cache/research/ba-assets/bundles', path.basename(entry.path));
    const cachedHash = await verifyEntry(cached, entry);
    if (cachedHash) {
        // A new file inherits the public project folder ACL, not the cache ACL.
        fs.writeFileSync(destination, fs.readFileSync(cached));
        return { ...entry, ...cachedHash };
    }
    const temporary = destination + '.downloading';
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(entry.url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
            if (!response.ok || !response.body) throw new Error('CDN returned HTTP ' + response.status);
            await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
            const verified = await verifyEntry(temporary, entry);
            if (!verified) throw new Error('Downloaded UI resource failed checksum validation.');
            fs.renameSync(temporary, destination);
            return { ...entry, ...verified };
        } catch (error) {
            fs.rmSync(temporary, { force: true });
            if (attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
    }
}

async function run(checkOnly = false) {
    let catalog;
    if (checkOnly) {
        const manifest = JSON.parse(fs.readFileSync(path.join(LIBRARY, 'manifest.json'), 'utf8'));
        if (manifest.gameVersion !== VERSION) throw new Error('Unexpected library version.');
        if (!Array.isArray(manifest.resources) || !manifest.resources.length || manifest.failed?.length) throw new Error('The UI library is incomplete; rerun the download first.');
        for (const entry of manifest.resources) {
            const hash = await verifyEntry(destinationFor(entry), entry);
            if (!hash || hash.sha256 !== entry.sha256) throw new Error('Library verification failed: ' + entry.path);
        }
        console.log('UI library verified: ' + manifest.resources.length + ' bundles.');
        return;
    }
    const response = await fetch(BASE_URL + 'resource-data.json', { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok) throw new Error('Could not read the pinned CDN catalog.');
    const catalogBytes = Buffer.from(await response.arrayBuffer());
    catalog = JSON.parse(catalogBytes.toString('utf8'));
    const { entries, excluded } = selectUiEntries(catalog);
    if (!entries.length) throw new Error('The catalog contains no UI resources.');
    fs.mkdirSync(LIBRARY, { recursive: true });
    const planned = entries.reduce((bytes, entry) => bytes + entry.bytes, 0);
    console.log('UI-only plan: ' + entries.length + ' bundles, ' + Math.round(planned / 1024 / 1024) + ' MiB.');
    const resources = [];
    const failed = [];
    let next = 0;
    let completed = 0;
    let lastProgress = Date.now();
    async function worker() {
        while (next < entries.length) {
            const entry = entries[next++];
            try { resources.push(await downloadEntry(entry)); } catch (error) { failed.push({ path: entry.path, error: error.message }); }
            completed++;
            if (Date.now() - lastProgress > 15000 || completed === entries.length) {
                console.log('UI downloads: ' + completed + '/' + entries.length + ', failed: ' + failed.length);
                lastProgress = Date.now();
            }
        }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    const manifest = {
        schemaVersion: 1, gameVersion: VERSION, acquired: new Date().toISOString(),
        catalog: { url: BASE_URL + 'resource-data.json', sha256: crypto.createHash('sha256').update(catalogBytes).digest('hex') },
        scope: 'Interface bundles and dependencies only; game-content families excluded.',
        sourceReferences: ['https://github.com/Deathemonic/BA-AD', 'https://bluearchive.jp/system', 'https://kivo.wiki/gallery/1'],
        resources: resources.sort((a, b) => a.path.localeCompare(b.path)), excluded, failed,
    };
    fs.writeFileSync(path.join(LIBRARY, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (failed.length) throw new Error(failed.length + ' UI resources failed; rerun to resume. See manifest.json.');
    console.log('UI library complete: ' + resources.length + ' verified bundles.');
}

module.exports = { selectUiEntries, hashFile, verifyEntry };
if (require.main === module) run(process.argv.includes('--check')).catch(error => { console.error(error.message); process.exitCode = 1; });
