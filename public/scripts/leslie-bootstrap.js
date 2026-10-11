import { initializeUserSpacePreferences } from './leslie-user-preferences.js';
import { getAccessToken, installTokenInjection } from './token-auth.js';

// Install the bearer-token header injection before any chat module issues a request, so
// a public-web session authenticated through /api/v1 carries its token on the legacy
// endpoints too. It is a no-op when no token is stored (desktop cookie session).
installTokenInjection();

// Register the offline-shell service worker. Service workers require a secure context
// (https, or loopback for local development); on an insecure LAN origin the registration
// is simply skipped and the app still works online-only.
if ('serviceWorker' in navigator
    && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* online-only fallback */ });
    });
}

// A navigation cannot carry localStorage bearer tokens. Serve the public shell, then
// send unsigned server visitors to the login entry before loading account modules.
async function startApplication() {
    if (location.pathname === '/app' && !getAccessToken()) {
        const response = await fetch('/version');
        const version = await response.json();
        if (version.mode === 'server') {
            location.replace('/login');
            return;
        }
    }
    await initializeUserSpacePreferences();
    await import('./i18n.js');
    await import('../script.js');
    await Promise.all([
        './leslie-theme.js', './leslie-settings.js', './leslie-chat-layout.js',
        './leslie-story-choices.js', './leslie-plot-compass.js',
        './leslie-character-workshop/index.js', './leslie-character-import.js', './leslie-safety-test/index.js',
    ].map(module => import(module)));
}

await startApplication();
