/**
 * DreamLand mobile theme — the shared "remake" surface tokens.
 *
 * These mirror the Web theme (public/css/dreamland-theme.css) so both clients read the
 * same accent, canvas, surfaces, borders and text. Screens import `theme` instead of
 * hard-coding colors; new surfaces should reference these tokens rather than adding hex
 * literals.
 */

import { Platform } from 'react-native';

export const theme = {
    /** Primary / accent. */
    primary: '#c9505b',
    primaryStrong: '#b5434e',

    /** Page canvas and card surfaces. */
    background: '#f3f5f8',
    surface: '#ffffff',
    soft: '#f5f6f9',

    /** Typography. */
    text: '#273446',
    muted: '#778292',
    onPrimary: '#ffffff',

    /** Borders and dividers. */
    border: '#e4e8ef',
    rowLine: '#eff2f6',

    /** Buttons. */
    quietBg: '#eef1f5',
    quietText: '#526172',
    danger: '#b94651',
    dangerBg: '#fff0f1',

    /** Tables. */
    tableHeadBg: '#fafbfc',
    tableHeadText: '#8b96a5',

    /** Card geometry. */
    radius: 10,

    /** The system font stack (RN already defaults to the system font). */
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
} as const;

export type Theme = typeof theme;
