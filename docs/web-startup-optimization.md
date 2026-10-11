# Web startup and registration (2026-10-11)

Server Web settings no longer expose the desktop encrypted user-space switcher. Desktop mode retains its existing controls; account directories and encryption implementation remain intact.

System/help templates and the extension menu templates load concurrently. Eligible extension JS/CSS resources preload together, while extension activation and hooks retain their existing order. The shell cache reuses fresh static assets for five minutes, refreshes navigations online, and never caches API responses. Its cache version is bumped for rollout.

API registration prepares per-account defaults with asynchronous file operations before publishing the account. Required setup also runs with startup content checks disabled. Missing settings on old API accounts are repaired without overwriting existing settings. Public server accounts skip desktop first-run onboarding. Concurrent registration for the same handle is rejected, and the registration UI prevents duplicate submissions.

This is the first performance phase. Framework migration, lazy TTS provider imports and authoritative-chat API migration are separate work. Resource preloading does not execute optional extensions or alter prompt assembly.

Validation uses isolated synthetic accounts, template concurrency/cache tests, registration/default-repair tests, browser model selection and generation, and both nine-case byte-identical prompt oracles. Browser initialization caught a locale dependency during development: language support must be resolved before loading translations; retain that ordering.
