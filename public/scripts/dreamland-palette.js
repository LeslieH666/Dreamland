/** Color choices do not select another layout or replace game artwork. */
export const COLOR_PALETTE_META = Object.freeze({
    rose: { label: '桃粉', description: 'MomoTalk 桃粉与暖炭灰', light: '#b94362', dark: '#f2b2c5', headerLight: '#f28ca2', headerDark: '#5d3d4a' },
    jade: { label: '青瓷', description: '青绿与暖灰', light: '#23766e', dark: '#75c8ba', headerLight: '#39877d', headerDark: '#34544e' },
    iris: { label: '鸢尾', description: '紫色与暖灰', light: '#6555a2', dark: '#c2b2e9', headerLight: '#8b79b4', headerDark: '#50445d' },
    clay: { label: '暖砂', description: '陶土与奶油白', light: '#a45138', dark: '#e7ac8b', headerLight: '#b8785c', headerDark: '#654a3e' },
    slate: { label: '石墨', description: '中性灰与暖白', light: '#58606a', dark: '#c3c5ca', headerLight: '#757a82', headerDark: '#46474d' },
});
export const COLOR_PALETTES = Object.freeze(Object.keys(COLOR_PALETTE_META));
export function normalizePalette(value) { return COLOR_PALETTES.includes(value) ? value : 'rose'; }

export function applyDreamlandPalette(body, value, dark) {
    const palette = normalizePalette(value);
    const meta = COLOR_PALETTE_META[palette];
    body.dataset.leslieColorPalette = palette;
    const accent = dark ? meta.dark : meta.light;
    body.style.setProperty('--dl-accent', accent);
    body.style.setProperty('--dl-accent-strong', accent);
    body.style.setProperty('--ba-header', dark ? meta.headerDark : meta.headerLight);
    body.style.setProperty('--dl-outgoing', dark ? meta.headerDark : meta.light);
}
