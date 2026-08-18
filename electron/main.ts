import { app, BrowserWindow, shell, dialog, Menu } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { getDb, closeDb } from './database';
import { registerIpcHandlers } from './ipcHandlers';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Do not auto-download until the user confirms; we'll trigger download manually.
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;

let mainWindow: BrowserWindow | null = null;
let manualUpdateCheck = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'Log2Go Desktop',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = win;

  win.on('closed', () => {
    mainWindow = null;
  });

  // Allow loading CDN resources for globe.gl
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Remove CSP that might block CDN scripts
        'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https: blob:; font-src 'self' data: https:; connect-src 'self' https:;"],
      },
    });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(app.getAppPath(), 'dist-renderer', 'index.html'));
  }
}

function getDialogParent(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0]!;
}

function showUpdateAvailable(version: string) {
  const result = dialog.showMessageBoxSync(getDialogParent(), {
    type: 'info',
    buttons: ['Download & Install', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update Available',
    message: `Log2Go v${version} is available.`,
    detail: 'The update will download in the background and prompt you to install when ready.',
  });

  if (result === 0) {
    void autoUpdater.downloadUpdate();
  }
}

function showUpToDate() {
  dialog.showMessageBoxSync(getDialogParent(), {
    type: 'info',
    buttons: ['OK'],
    title: "You're up to date!",
    message: `Log2Go v${app.getVersion()}`,
  });
}

function showUpdateError(message: string) {
  dialog.showMessageBoxSync(getDialogParent(), {
    type: 'error',
    buttons: ['OK'],
    title: 'Update Error',
    message: 'Could not check for updates',
    detail: message,
  });
}

function checkForUpdatesInteractive() {
  manualUpdateCheck = true;
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      console.error('Manual update check failed:', err);
      showUpdateError(err instanceof Error ? err.message : String(err));
    })
    .finally(() => {
      // Give events time to fire before clearing the flag.
      setTimeout(() => {
        manualUpdateCheck = false;
      }, 500);
    });
}

autoUpdater.on('update-available', (info) => {
  showUpdateAvailable(info.version);
});

autoUpdater.on('update-not-available', () => {
  if (manualUpdateCheck) {
    showUpToDate();
  }
});

autoUpdater.on('update-downloaded', () => {
  const result = dialog.showMessageBoxSync(getDialogParent(), {
    type: 'info',
    buttons: ['Install & Restart', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update Ready',
    message: 'A Log2Go update has been downloaded and is ready to install.',
    detail: 'Install now to restart the app and apply the update.',
  });

  if (result === 0) {
    autoUpdater.quitAndInstall();
  }
});

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err);
  if (manualUpdateCheck) {
    showUpdateError(err instanceof Error ? err.message : String(err));
  }
});

function buildMenu() {
  const aboutItem: Electron.MenuItemConstructorOptions = {
    label: 'About Log2Go Desktop',
    click: () => {
      dialog.showMessageBoxSync(getDialogParent(), {
        type: 'info',
        buttons: ['OK'],
        title: 'About Log2Go Desktop',
        message: 'Log2Go Desktop',
        detail: `Version ${app.getVersion()}\nAmateur radio logging with offline mode.`,
      });
    },
  };

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: 'Check for Updates',
    click: () => {
      checkForUpdatesInteractive();
    },
  };

  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.getName(),
        submenu: [
          aboutItem,
          { type: 'separator' },
          checkForUpdatesItem,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [aboutItem, { type: 'separator' }, checkForUpdatesItem],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        label: 'Help',
        submenu: [aboutItem, { type: 'separator' }, checkForUpdatesItem],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

app.whenReady().then(() => {
  // Initialize local SQLite database and register IPC handlers
  getDb();
  registerIpcHandlers();
  buildMenu();

  createWindow();

  // Silent background update check ~30 seconds after launch.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Non-intrusive: log only, no dialog on silent auto-check errors.
    });
  }, 30000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeDb();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeDb();
});
