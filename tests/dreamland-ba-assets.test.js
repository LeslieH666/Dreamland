import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import { BA_ASSETS, getBaAssetUrl, loadBaAssets } from '../public/scripts/dreamland-ba-assets.js';

describe('BA local artwork recovery', () => {
    test('all mapped artwork has a recorded original or explicit adaptation', () => {
        const manifest = JSON.parse(fs.readFileSync(new URL('../public/img/blue-archive/sources.json', import.meta.url)));
        const files = new Set(manifest.assets.map(asset => asset.file));
        for (const file of Object.values(BA_ASSETS)) expect(files.has(file)).toBe(true);
        for (const asset of manifest.assets.filter(asset => asset.kind === 'adaptation')) expect(files.has(asset.source)).toBe(true);
        for (const asset of manifest.assets.filter(asset => asset.kind !== 'adaptation')) expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    test('only known, same-origin files can be loaded', () => {
        expect(getBaAssetUrl('peach')).toBe('/img/blue-archive/local/School_Icon_MomoTalk.png');
        expect(getBaAssetUrl('https://example.com/remote.png')).toBeNull();
        expect(getBaAssetUrl('../../outside')).toBeNull();
        expect(getBaAssetUrl('__proto__')).toBeNull();
    });

    test('one missing sprite does not reject the scene and other artwork', async () => {
        const assets = await loadBaAssets(url => url.endsWith('School_Chat_BG.png') ? Promise.reject(new Error('missing')) : Promise.resolve());
        expect(assets.incoming).toBeUndefined();
        expect(assets.scene).toBe(getBaAssetUrl('scene'));
        expect(Object.keys(assets)).toHaveLength(Object.keys(BA_ASSETS).length - 1);
    });

    test('an unavailable pack falls back without throwing', async () => {
        expect(await loadBaAssets(() => Promise.reject(new Error('offline')))).toEqual({});
    });
});
