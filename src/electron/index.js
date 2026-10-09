import { app, BrowserWindow, ipcMain, Menu, powerMonitor, Tray } from 'electron';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { serverEvents, EVENT_NAMES } from '../server-events.js';
import { sealActiveUserSpace } from '../leslie-user-spaces/vault.js';
import { createSealedExitHandler } from './sealed-exit.js';
import { DREAMLAND_MODE_ENV, RUNTIME_MODE_DESKTOP } from '../runtime-mode.js';

// The Electron shell is the desktop host. Publish the mode before the server
// core is imported so tray, browser launch and desktop exit sealing stay on.
if (String(process.env[DREAMLAND_MODE_ENV] ?? '').trim().toLowerCase() === 'server') {
    console.error(`Refusing to start the DreamLand desktop host with ${DREAMLAND_MODE_ENV}=server. Unset it or use DREAMLAND_MODE=desktop.`);
    app.exit(1);
} else {
    process.env[DREAMLAND_MODE_ENV] = RUNTIME_MODE_DESKTOP;
}

const cliArguments = yargs(process.argv)
    .usage('Usage: <your-start-script> [options]')
    .option('width', {
        type: 'number',
        default: 1280,
        describe: 'The width of the window',
    })
    .option('height', {
        type: 'number',
        default: 800,
        describe: 'The height of the window',
    })
    .option('electronDataRoot', {
        type: 'string',
        default: '',
        describe: 'The Electron cache and window-state directory',
    })
    .parseSync();

if (cliArguments.electronDataRoot) {
    const electronDataRoot = path.resolve(cliArguments.electronDataRoot);
    fs.mkdirSync(electronDataRoot, { recursive: true });
    app.setPath('userData', electronDataRoot);
}

/** @type {string} The URL to load in the window. */
let appUrl;

/** @type {BrowserWindow | undefined} Keep the desktop window alive until it is explicitly closed. */
let mainWindow;
let tray;
let backgroundTickTimer;
let stopRequestTimer;
let isQuitting = false;
let backgroundNoticeShown = false;
let momentsBackgroundState = {
    state: 'starting',
    paused: false,
    pendingCount: 0,
};

function getProjectRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function isMainWindowSender(event) {
    return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

ipcMain.on('leslie:moments:status', (event, message) => {
    if (!isMainWindowSender(event)) {
        return;
    }
    momentsBackgroundState = {
        state: String(message?.state || 'starting').slice(0, 40),
        paused: Boolean(message?.paused),
        pendingCount: Math.max(0, Number(message?.pendingCount) || 0),
    };
    updateTrayMenu();
});

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createSillyTavernWindow();
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

function getMomentsStatusLabel() {
    if (momentsBackgroundState.paused || momentsBackgroundState.state === 'paused') {
        return '朋友圈后台：已暂停';
    }
    if (momentsBackgroundState.state === 'waiting_model') {
        return '朋友圈后台：等待模型连接';
    }
    if (momentsBackgroundState.state === 'busy') {
        return '朋友圈后台：角色正在查看动态';
    }
    if (momentsBackgroundState.state === 'error') {
        return '朋友圈后台：稍后重试';
    }
    return momentsBackgroundState.pendingCount > 0
        ? `朋友圈后台：运行中（待处理 ${momentsBackgroundState.pendingCount}）`
        : '朋友圈后台：运行中';
}

function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) {
        return;
    }
    const statusLabel = getMomentsStatusLabel();
    tray.setToolTip(`DreamLand · ${statusLabel.replace('朋友圈后台：', '')}`);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开 DreamLand', click: showMainWindow },
        { type: 'separator' },
        { label: statusLabel, enabled: false },
        {
            label: momentsBackgroundState.paused ? '继续朋友圈互动' : '暂停朋友圈互动',
            click: () => {
                const paused = !momentsBackgroundState.paused;
                momentsBackgroundState.paused = paused;
                momentsBackgroundState.state = paused ? 'paused' : 'running';
                mainWindow?.webContents.send('leslie:moments:set-paused', paused);
                updateTrayMenu();
            },
        },
        { type: 'separator' },
        {
            label: '退出 DreamLand',
            click: () => {
                app.quit();
            },
        },
    ]));
}

function installTray() {
    if (tray && !tray.isDestroyed()) {
        return;
    }
    const iconFile = path.join('img', 'dreamland', process.platform === 'win32' ? 'icon.ico' : 'icon-192.png');
    const iconPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public', iconFile);
    tray = new Tray(iconPath);
    tray.on('double-click', showMainWindow);
    tray.on('click', showMainWindow);
    updateTrayMenu();
}

function sendBackgroundTick(reason = 'timer') {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
        return;
    }
    mainWindow.webContents.send('leslie:moments:tick', { reason, at: new Date().toISOString() });
}

function createSillyTavernWindow() {
    if (!appUrl) {
        console.error('The server has not started yet.');
        return;
    }
    mainWindow = new BrowserWindow({
        height: cliArguments.height,
        width: cliArguments.width,
        minHeight: 640,
        minWidth: 960,
        autoHideMenuBar: true,
        title: 'DreamLand',
        icon: path.resolve(getProjectRoot(), 'public', 'img', 'dreamland', 'icon-192.png'),
        webPreferences: {
            preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
            contextIsolation: true,
            nodeIntegration: false,
            // Character speech is generated after an asynchronous model/API
            // response, so it must not depend on a second user gesture.
            autoplayPolicy: 'no-user-gesture-required',
            // The moments worker must continue while the window is hidden in the system tray.
            backgroundThrottling: false,
        },
    });
    mainWindow.on('close', (event) => {
        if (isQuitting) {
            return;
        }
        event.preventDefault();
        mainWindow.hide();
        if (!backgroundNoticeShown) {
            backgroundNoticeShown = true;
            tray?.displayBalloon?.({
                title: 'DreamLand 已转入后台',
                content: '朋友圈互动会继续运行。需要完全关闭时，请从托盘选择“退出 DreamLand”。',
                iconType: 'info',
            });
        }
    });
    mainWindow.once('closed', () => {
        mainWindow = undefined;
    });
    mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => sendBackgroundTick('window-ready'), 2_000);
    });
    void mainWindow.loadURL(appUrl);
}

function startServer() {
    return new Promise((_resolve, _reject) => {
        serverEvents.addListener(EVENT_NAMES.SERVER_STARTED, ({ url }) => {
            appUrl = url.toString();
            createSillyTavernWindow();
        });
        const sillyTavernRoot = getProjectRoot();
        process.chdir(sillyTavernRoot);

        // Keep Electron on this project's configured data root instead of SillyTavern's global data directory.
        import('../../server.js');
    });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showMainWindow();
    });

    app.whenReady().then(() => {
        app.on('activate', () => {
            showMainWindow();
        });

        installTray();
        powerMonitor.on('resume', () => sendBackgroundTick('resume'));
        backgroundTickTimer = setInterval(() => sendBackgroundTick('timer'), 60_000);
        const stopRequestPath = path.join(getProjectRoot(), 'Run', `LeslieTavern.stop-${process.pid}`);
        stopRequestTimer = setInterval(() => {
            if (!fs.existsSync(stopRequestPath)) return;
            fs.rmSync(stopRequestPath, { force: true });
            app.quit();
        }, 500);
        startServer();
    });

    const allowExit = createSealedExitHandler(async () => {
        const { flushUserStats } = await import('../endpoints/stats.js');
        await flushUserStats();
        await sealActiveUserSpace(globalThis.DATA_ROOT);
    }, () => app.quit(), error => {
        console.error('Could not encrypt the active user space before desktop exit:', error);
        isQuitting = false;
    });
    app.on('before-quit', (event) => {
        if (!allowExit(event)) return;
        isQuitting = true;
        clearInterval(backgroundTickTimer);
        clearInterval(stopRequestTimer);
    });
}
