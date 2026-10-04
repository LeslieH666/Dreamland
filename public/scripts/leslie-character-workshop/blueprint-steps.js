/** Page-only progressive form navigation; no character or account data writes. */
export function initializeBlueprintSteps(root, { isLocked = () => false } = {}) {
    const sections = [...root.querySelectorAll('[data-blueprint-section]')];
    const activeAnimations = new Map();
    let navigationId = 0;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function mark(section, complete) {
        section.classList.toggle('is-confirmed', complete);
        section.querySelector('[data-blueprint-check]').hidden = !complete;
    }

    function cancel(section) {
        const previous = activeAnimations.get(section);
        if (!previous) return;
        previous.animation.cancel();
        previous.resolve();
        activeAnimations.delete(section);
    }

    function transition(section, open) {
        const body = section.querySelector('.leslie-blueprint-body');
        const from = section.open ? body.getBoundingClientRect().height : 0;
        cancel(section);
        if (reducedMotion() || typeof body.animate !== 'function') {
            section.open = open;
            return Promise.resolve();
        }
        if (!section.open && !open) return Promise.resolve();
        section.open = true;
        const to = open ? body.scrollHeight : 0;
        return new Promise(resolve => {
            const animation = body.animate([{ height: `${from}px`, opacity: from ? 1 : 0 }, { height: `${to}px`, opacity: open ? 1 : 0 }], {
                duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)',
            });
            activeAnimations.set(section, { animation, resolve, open });
            animation.onfinish = () => {
                if (activeAnimations.get(section)?.animation !== animation) return;
                section.open = open;
                activeAnimations.delete(section);
                resolve();
            };
        });
    }

    async function activate(target, guide = false) {
        const id = ++navigationId;
        await Promise.all(sections.map(section => transition(section, section === target)));
        if (id !== navigationId || !guide) return;
        const focus = target?.querySelector('summary') ?? root.querySelector('[data-workshop-prompt]');
        focus?.focus({ preventScroll: true });
        focus?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    root.addEventListener('click', event => {
        const section = event.target.closest('[data-blueprint-section]');
        if (!section) return;
        if (event.target.closest('[data-blueprint-complete]')) {
            if (isLocked()) return;
            mark(section, true);
            void activate(sections[sections.indexOf(section) + 1], true);
        } else if (event.target.closest('summary') === section.querySelector('summary')) {
            event.preventDefault();
            const expanded = activeAnimations.get(section)?.open ?? section.open;
            if (!isLocked()) void activate(expanded ? null : section);
        }
    });
    const invalidate = event => {
        if (!event.target.matches('[data-workshop-field]')) return;
        const section = event.target.closest('[data-blueprint-section]');
        if (section) mark(section, false);
    };
    root.addEventListener('input', invalidate);
    root.addEventListener('change', invalidate);
    return {
        reset() {
            navigationId++;
            for (const section of sections) {
                cancel(section);
                section.open = section === sections[0];
                mark(section, false);
            }
        },
    };
}
