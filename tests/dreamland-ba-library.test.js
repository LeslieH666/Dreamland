import { expect, test } from '@jest/globals';
import library from '../scripts/download-blue-archive-ui.cjs';

const make = resource_path => ({ resource_path, resource_size: 32, resource_hash: 'a'.repeat(32) });

test('selects UI controls and dependencies while excluding game scenes, portraits and illustrations', () => {
    const entries = [
        'GameData/Android/assets-_mx-uis-atlas-_mxdependency-2026_assets_all_1.bundle',
        'GameData/Android/uis-00_images-bigbtn-_mxload-2026_assets_all_2.bundle',
        'GameData/Android/uis-03_scenario-01_background-_mxload-3.bundle',
        'GameData/Android/uis-03_scenario-02_character-_mxload-4.bundle',
        'GameData/Android/uis-01_common-08_lobbyillust-_mxload-5.bundle',
        'GameData/Android/characters-spine-6.bundle',
        'GameData/MediaResources/UIs/03_Scenario/01_Background/BG_Test.jpg',
    ];
    const selected = library.selectUiEntries({ resources: entries.map(make) });
    expect(selected.entries.map(entry => entry.path)).toEqual(entries.slice(0, 2));
    expect(selected.excluded).toHaveLength(3);
});

test('rejects unsafe filenames, duplicate resources and unverified catalog entries', () => {
    const valid = make('Preload/Android/uis-common.bundle');
    expect(() => library.selectUiEntries({ resources: [make('Preload/Android/../uis-common.bundle')] })).toThrow('Invalid');
    expect(() => library.selectUiEntries({ resources: [valid, valid] })).toThrow('duplicate');
    expect(() => library.selectUiEntries({ resources: [{ ...valid, resource_hash: '' }] })).toThrow('Invalid');
    expect(() => library.selectUiEntries({ resources: [{ ...valid, resource_size: -1 }] })).toThrow('Invalid');
});
