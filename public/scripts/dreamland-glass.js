import { GLASS_RANGES, readAppearance, normalizeAppearance } from './dreamland-appearance-core.js';

/** Share validated glass settings between authenticated pages and the login appearance hint. */
export function applyGlassAppearance(body, storage) {
    for (const key of Object.keys(GLASS_RANGES)) {
        const attribute = 'dreamland' + key[0].toUpperCase() + key.slice(1);
        const value = normalizeAppearance(key, body.dataset[attribute] ?? readAppearance(storage, key));
        body.dataset[attribute] = value;
        body.style.setProperty(key === 'glassBlur' ? '--dl-glass-blur' : '--dl-glass-opacity',
            key === 'glassBlur' ? value + 'px' : (100 - Number(value)) + '%');
        for (const input of body.querySelectorAll(`[data-dreamland-preference="${key}"]`)) input.value = value;
        for (const output of body.querySelectorAll(`[data-dreamland-glass-value="${key}"]`)) {
            output.textContent = value + (key === 'glassBlur' ? ' px' : '%');
        }
    }
}

export function clearGlassAppearance(body) {
    delete body.dataset.dreamlandGlassTransparency;
    delete body.dataset.dreamlandGlassBlur;
}
