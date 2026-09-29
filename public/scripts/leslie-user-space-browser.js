const SWITCH_KEY = 'leslie:user-space-changed';

/** Drop browser-only drafts and notify other open LeslieTavern tabs. */
export function clearUserSpaceBrowserState() {
    try { localStorage.setItem(SWITCH_KEY, `${Date.now()}-${Math.random()}`); } catch { /* storage may be disabled */ }
    try { localStorage.clear(); } catch { /* storage may be disabled */ }
    try { sessionStorage.clear(); } catch { /* storage may be disabled */ }
}

/** Hide an old account's already-rendered content when another tab switches. */
export function watchUserSpaceChanges() {
    const lockOldPage = () => {
        try { sessionStorage.clear(); } catch { /* storage may be disabled */ }
        document.documentElement.style.filter = 'blur(24px)';
        document.documentElement.style.pointerEvents = 'none';
        window.location.assign('/login');
    };
    window.addEventListener('storage', (event) => {
        if (event.key !== SWITCH_KEY) return;
        lockOldPage();
    });

    // A different device can open another account without sending a local
    // storage event. Recheck the session when this page comes into view.
    fetch('/api/users/mode').then(response => response.json()).then(mode => {
        if (!mode.encryptedSpaces) return;
        let handle;
        let checking = false;
        const checkSession = async () => {
            if (checking) return;
            checking = true;
            try {
                const response = await fetch('/api/users/me', { cache: 'no-store' });
                if (response.status === 403 || response.status === 401) return lockOldPage();
                if (response.ok) {
                    const user = await response.json();
                    if (handle && user.handle !== handle) lockOldPage();
                    handle = user.handle;
                }
            } catch { /* a temporary network failure is not a logout */ } finally {
                checking = false;
            }
        };
        void checkSession();
        window.addEventListener('focus', () => void checkSession());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) void checkSession();
        });
        window.setInterval(() => void checkSession(), 10_000);
    }).catch(() => {});
}
