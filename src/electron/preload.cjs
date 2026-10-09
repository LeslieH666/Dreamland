const { contextBridge, ipcRenderer } = require('electron');

const hostId = globalThis.crypto?.randomUUID?.()
    ?? `leslie-page-${Date.now()}-${Math.random().toString(36).slice(2)}`;

contextBridge.exposeInMainWorld('leslieCompanionHost', {
    poll: snapshot => ipcRenderer.invoke('leslie:companion:poll', { hostId, snapshot }),
    publish: (requestId, event) => ipcRenderer.invoke('leslie:companion:publish', { hostId, requestId, event }),
});

function subscribe(channel, callback) {
    if (typeof callback !== 'function') {
        return () => undefined;
    }
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('leslieDesktopMoments', {
    onTick: callback => subscribe('leslie:moments:tick', callback),
    onSetPaused: callback => subscribe('leslie:moments:set-paused', callback),
    reportStatus: status => ipcRenderer.send('leslie:moments:status', status),
});

contextBridge.exposeInMainWorld('leslieDesktopServices', {
    getStatus: () => ipcRenderer.invoke('leslie:services:status'),
    runAction: (service, action) => ipcRenderer.invoke('leslie:services:action', { service, action }),
});
