/** Shared runtime mode and administrator-provided model catalog. */
export const serverModels = { mode: null, models: [], selectedId: '', loading: true, error: '' };
let pending;

/** Notify the settings view and chat adapter about catalog changes. */
function notify() {
    document.documentElement.dataset.dreamlandMode = serverModels.mode ?? 'pending';
    document.dispatchEvent(new CustomEvent('dreamland:server-models'));
}

/** @param {string} id Catalog id. @returns {boolean} Whether selection succeeded. */
export function selectServerModel(id) {
    if (!serverModels.models.some(model => model.id === id)) return false;
    serverModels.selectedId = id;
    notify();
    return true;
}

/**
 * Fetch the runtime mode and catalog; unknown mode never exposes personal API controls.
 * @param {{headers?: object, preferredId?: string}} options Request options.
 * @returns {Promise<void>} Resolves after catalog loading.
 */
export async function refreshServerModels({ headers = {}, preferredId = '' } = {}) {
    if (pending) return pending;
    pending = (async () => {
        serverModels.loading = true;
        serverModels.error = '';
        notify();
        try {
            const version = await fetch('/version');
            if (!version.ok) throw new Error('无法确认服务器运行模式，请刷新重试。');
            const { mode } = await version.json();
            if (!['server', 'desktop'].includes(mode)) throw new Error('无法确认服务器运行模式，请刷新重试。');
            serverModels.mode = mode;
            if (mode === 'desktop') return;
            const response = await fetch('/api/v1/models', { headers });
            if (!response.ok) throw new Error('无法加载服务器模型，请重新登录或稍后重试。');
            const data = await response.json();
            serverModels.models = (Array.isArray(data.models) ? data.models : [])
                .filter(model => model.enabled !== false && typeof model.id === 'string')
                .map(model => ({ id: model.id, name: String(model.name ?? model.id) }));
            const selected = serverModels.selectedId || preferredId;
            serverModels.selectedId = serverModels.models.some(model => model.id === selected)
                ? selected : (serverModels.models[0]?.id ?? '');
        } catch (error) {
            serverModels.models = [];
            serverModels.selectedId = '';
            serverModels.error = error.message;
        } finally {
            serverModels.loading = false;
            pending = null;
            notify();
        }
    })();
    return pending;
}
