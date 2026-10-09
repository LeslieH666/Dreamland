/**
 * Static hosting for the shared prompt-assembly modules (Phase 2.5.2).
 *
 * `public/script.js` is served as a native ES module and only `public/lib.js` is
 * bundled, so a relative import from `public/` cannot reach `src/`. The browser
 * therefore loads these modules from `/prompt-assembly/…`, which this helper
 * maps read-only onto `src/prompt-assembly/`.
 *
 * Kept in its own module so the server and its regression test mount the exact
 * same thing; the files are pure logic with no secrets, so their readability is
 * equivalent to the already-public `public/scripts/**`.
 */

import express from 'express';
import path from 'node:path';

/** URL prefix the browser imports from. */
export const PROMPT_ASSEMBLY_MOUNT = '/prompt-assembly';

/**
 * Mount the prompt-assembly modules.
 * @param {import('express').Express} app Express application.
 * @param {string} serverDirectory Repository root (holds `src/`).
 * @returns {void}
 */
export function mountPromptAssembly(app, serverDirectory) {
    app.use(PROMPT_ASSEMBLY_MOUNT, express.static(path.join(serverDirectory, 'src', 'prompt-assembly'), {
        index: false,
        fallthrough: false,
    }));
}
