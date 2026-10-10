import { initializeUserSpacePreferences } from './leslie-user-preferences.js';

// Register the offline-shell service worker. Service workers require a secure context
// (https, or loopback for local development); on an insecure LAN origin the registration
// is simply skipped and the app still works online-only.
if ('serviceWorker' in navigator
    && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* online-only fallback */ });
    });
}

await initializeUserSpacePreferences();
await import('./i18n.js');
await import('../script.js');
await Promise.all([
    './leslie-theme.js', './leslie-settings.js', './leslie-chat-layout.js',
    './leslie-story-choices.js', './leslie-plot-compass.js',
    './leslie-character-workshop/index.js', './leslie-character-import.js', './leslie-safety-test/index.js',
].map(module => import(module)));
