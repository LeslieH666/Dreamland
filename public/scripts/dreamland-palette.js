/** MomoTalk keeps one rose accent in both display modes. */
export const COLOR_PALETTE_META = Object.freeze({
    rose: { label: '桃粉', description: 'MomoTalk 桃粉与暖炭灰', light: '#b94362', dark: '#f2b2c5', headerLight: '#f28ca2', headerDark: '#5d3d4a' },
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
