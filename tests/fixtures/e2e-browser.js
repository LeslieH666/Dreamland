/**
 * Browser channel used by the Playwright specs.
 *
 * The suite defaults to the Microsoft Edge channel, which is what the project
 * is developed against. Set LESLIE_E2E_CHANNEL to run it on another channel
 * (for example `chromium`) on machines without Edge installed.
 */
export const E2E_BROWSER_CHANNEL = process.env.LESLIE_E2E_CHANNEL || 'msedge';
