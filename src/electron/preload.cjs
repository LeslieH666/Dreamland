const { contextBridge, ipcRenderer } = require('electron');

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
