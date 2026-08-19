import { app, BrowserWindow, shell, dialog, Menu, clipboard } from 'electron';
import path from 'node:path';
import https from 'node:https';
import fs from 'node:fs';
import { autoUpdater } from 'electron-updater';
import { getDb, closeDb } from './database';
import { registerIpcHandlers } from './ipcHandlers';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Do not auto-download until the user confirms; we'll trigger download manually.
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;

let mainWindow: BrowserWindow | null = null;
let manualUpdateCheck = false;

const FEEDBACK_API_URL = 'https://api.log2goapp.net/api/feedback';

// Public-facing support email. Override via SUPPORT_EMAIL env var for privacy.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@ke5zqv.net';

function getCrashLogPath(): string {
  return path.join(app.getPath('userData'), 'crash-logs.txt');
}

function appendCrashLog(entry: string): void {
  try {
    fs.appendFileSync(getCrashLogPath(), `${entry}\n`, { encoding: 'utf8' });
  } catch (e) {
    console.error('[CrashReporter] Failed to write crash log:', e);
  }
}

function formatCrashReport(
  error: unknown,
  context: string,
  timestamp = new Date().toISOString(),
): { message: string; appVersion: string; platform: string } {
  const appVersion = app.getVersion();
  const platform = process.platform;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : 'No stack trace available';

  const body = [
    'CRASH REPORT',
    '',
    `Context: ${context}`,
    `Error: ${errorMessage}`,
    `Stack: ${stack}`,
    `Version: ${appVersion}`,
    `Platform: ${platform}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');

  return { message: body, appVersion, platform };
}

function reportCrash(error: unknown, context: string): Promise<boolean> {
  const timestamp = new Date().toISOString();
  const { message, appVersion } = formatCrashReport(error, context, timestamp);

  // Always persist locally first.
  appendCrashLog(`[${timestamp}] ${context}\n${message}\n---`);

  return new Promise((resolve) => {
    const url = new URL(FEEDBACK_API_URL);
    const payload = JSON.stringify({
      category: 'Bug Report',
      message,
      email: SUPPORT_EMAIL,
      app_version: appVersion,
      platform: 'Desktop (Electron)',
    });

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const success = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        resolve(success);
      },
    );

    req.on('error', (err) => {
      console.error('[CrashReporter] Failed to send crash report:', err);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

function showCrashDialog(error: unknown, context: string): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  dialog.showMessageBoxSync(getDialogParent(), {
    type: 'error',
    buttons: ['OK'],
    title: 'Unexpected Error',
    message: `An unexpected error occurred (${context}).`,
    detail: `${errorMessage}\n\nA report has been sent to ${SUPPORT_EMAIL}.`,
  });
}

function showFatalCrashDialog(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  dialog.showMessageBoxSync(getDialogParent(), {
    type: 'error',
    buttons: ['Close Application'],
    title: 'Critical Error',
    message: 'Log2Go Desktop encountered a critical error and cannot continue.',
    detail: `${errorMessage}\n\nA crash report has been sent to ${SUPPORT_EMAIL}. Please restart the app.`,
  });
}

// Global crash/error reporting.
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
  void reportCrash(error, 'uncaughtException').then(() => {
    showFatalCrashDialog(error);
    app.quit();
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  void reportCrash(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection').then(
    () => {
      showCrashDialog(reason, 'unhandled promise rejection');
    },
  );
});

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
    void win.loadFile(path.join(app.getAppPath(), 'dist-renderer', 'index.html'))
      .catch((err) => {
        console.error('Failed to load renderer index.html:', err);
        void reportCrash(err, 'renderer-load-error');
      });
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

async function showUpdateError(message: string, rawError: unknown): Promise<void> {
  const fullError = formatCrashReport(rawError, 'autoUpdater error');
  const buttons = ['Copy Error', 'Report to Support', 'OK'];
  const result = dialog.showMessageBoxSync(getDialogParent(), {
    type: 'error',
    buttons,
    defaultId: 2,
    cancelId: 2,
    title: 'Update Error',
    message: 'Could not check for updates',
    detail: message,
  });

  if (result === 0) {
    // Copy Error
    clipboard.writeText(fullError.message);
    dialog.showMessageBoxSync(getDialogParent(), {
      type: 'info',
      buttons: ['OK'],
      title: 'Copied',
      message: 'Error details copied to clipboard.',
    });
  } else if (result === 1) {
    // Report to Support
    const reported = await reportCrash(rawError, 'autoUpdater error');
    dialog.showMessageBoxSync(getDialogParent(), {
      type: reported ? 'info' : 'warning',
      buttons: ['OK'],
      title: reported ? 'Report Sent' : 'Report Failed',
      message: reported
        ? `The error has been reported to ${SUPPORT_EMAIL}.`
        : 'Failed to send the report. Details were saved to crash-logs.txt.',
    });
  }
}

function openFeedback() {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('app:openFeedback');
  }
}
function checkForUpdatesInteractive() {
  manualUpdateCheck = true;
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      console.error('Manual update check failed:', err);
      void showUpdateError(err instanceof Error ? err.message : String(err), err);
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
  // Log and report all updater errors, not only manual ones.
  void reportCrash(err, 'autoUpdater error');
  if (manualUpdateCheck) {
    void showUpdateError(err instanceof Error ? err.message : String(err), err);
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

  const feedbackItem: Electron.MenuItemConstructorOptions = {
    label: 'Send Feedback',
    click: () => {
      openFeedback();
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
        submenu: [aboutItem, { type: 'separator' }, checkForUpdatesItem, { type: 'separator' }, feedbackItem],
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
    autoUpdater.checkForUpdates().catch((err) => {
      // Non-intrusive: log and report, but do not show dialog on silent auto-check errors.
      console.error('Silent update check failed:', err);
      void reportCrash(err, 'silent update check');
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