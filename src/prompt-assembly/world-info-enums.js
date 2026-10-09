/**
 * World Info enums and bounds shared by the browser and the server
 * (Phase 2.5.2 step 4, substep 1).
 *
 * Values are moved verbatim from public/scripts/world-info.js so both sides read
 * the same constants; world-info.js re-exports them under their original names.
 */

export const world_info_logic = {
    AND_ANY: 0,
    NOT_ALL: 1,
    NOT_ANY: 2,
    AND_ALL: 3,
};

export const scan_state = {
    /**
     * The scan will be stopped.
     */
    NONE: 0,
    /**
     * Initial state.
     */
    INITIAL: 1,
    /**
     * The scan is triggered by a recursion step.
     */
    RECURSION: 2,
    /**
     * The scan is triggered by a min activations depth skew.
     */
    MIN_ACTIVATIONS: 3,
};

export const DEFAULT_DEPTH = 4;

export const MAX_SCAN_DEPTH = 1000;

/** Default group weight for inclusion-group scoring (moved from world-info.js). */
export const DEFAULT_WEIGHT = 100;
