import { describe, expect, jest, test } from '@jest/globals';
import fs from 'node:fs';
import { BA_ASSETS, getBaAssetUrl, loadBaAssets, loadBaImage, describeBaAssetStatus } from '../public/scripts/dreamland-ba-assets.js';

describe('BA local artwork recovery', () => {
    test('all mapped artwork has a recorded original or explicit adaptation', () => {
        const manifest = JSON.parse(fs.readFileSync(new URL('../public/img/blue-archive/sources.json', import.meta.url)));
        const files = new Set(manifest.assets.map(asset => asset.file));
        for (const file of Object.values(BA_ASSETS)) expect(files.has(file)).toBe(true);
        for (const asset of manifest.assets.filter(asset => asset.kind === 'adaptation')) expect(files.has(asset.source)).toBe(true);
        for (const asset of manifest.assets.filter(asset => asset.kind !== 'adaptation')) expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    test('only known, same-origin files can be loaded', () => {
        expect(getBaAssetUrl('peach')).toBe('/img/blue-archive/bundled/School_Icon_MomoTalk.png');
        expect(getBaAssetUrl('https://example.com/remote.png')).toBeNull();
        expect(getBaAssetUrl('../../outside')).toBeNull();
        expect(getBaAssetUrl('__proto__')).toBeNull();
    });

    test('one missing sprite does not reject the scene and other artwork', async () => {
        const assets = await loadBaAssets(url => new URL(url, 'http://localhost').pathname.endsWith('School_Chat_BG.png') ? Promise.reject(new Error('missing')) : Promise.resolve(), { pause: () => Promise.resolve() });
        expect(assets.incoming).toBeUndefined();
        expect(assets.scene).toBe(getBaAssetUrl('scene'));
        expect(Object.keys(assets)).toHaveLength(Object.keys(BA_ASSETS).length - 1);
    });

    test('an unavailable pack falls back without throwing', async () => {
        expect(await loadBaAssets(() => Promise.reject(new Error('offline')), { pause: () => Promise.resolve() })).toEqual({});
    });

    test('a transient error retries with a fresh URL and exposes successful resources immediately', async () => {
        const load = jest.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined);
        const onLoaded = jest.fn();
        const assets = await loadBaAssets(load, { keys: ['incoming'], pause: () => Promise.resolve(), onLoaded });
        expect(load).toHaveBeenCalledTimes(2);
        expect(assets.incoming).toContain('School_Chat_BG.png?retry=1');
        expect(onLoaded).toHaveBeenCalledWith('incoming', assets.incoming);
    });

    test('hung requests release handlers and ignore late completion', async () => {
        jest.useFakeTimers();
        let picture;
        class FakeImage { constructor() { picture = this; } }
        try {
            const request = loadBaImage('/synthetic.png', { ImageClass: FakeImage, timeout: 20 });
            const rejected = request.catch(error => error);
            const lateLoad = picture.onload;
            await jest.advanceTimersByTimeAsync(20);
            expect((await rejected).message).toContain('timeout');
            expect(picture.onload).toBeNull();
            expect(picture.onerror).toBeNull();
            lateLoad();
            expect(jest.getTimerCount()).toBe(0);
        } finally { jest.useRealTimers(); }
    });

    test('only a confirmed missing manifest is described as an unrestored pack', () => {
        expect(describeBaAssetStatus('missing', ['incoming'], false)).toContain('读取失败');
        expect(describeBaAssetStatus('missing', ['incoming'], true)).toContain('尚未恢复');
        expect(describeBaAssetStatus('partial', ['incoming'])).toContain('School_Chat_BG.png');
    });
});
