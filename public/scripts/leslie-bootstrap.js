import { initializeUserSpacePreferences } from './leslie-user-preferences.js';

await initializeUserSpacePreferences();
await import('./i18n.js');
await import('../script.js');
await Promise.all([
    './leslie-companion-host.js', './leslie-theme.js', './leslie-settings.js', './leslie-chat-layout.js',
    './leslie-story-choices.js', './leslie-plot-compass.js',
    './leslie-character-workshop/index.js', './leslie-character-import.js', './leslie-safety-test/index.js',
].map(module => import(module)));
