import { app, BrowserWindow, dialog, Menu, screen, webContents } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node-pty';
import { PreferencesStore, visibleBounds } from './preferences.ts';
import { SessionManager } from './session-manager.ts';
import { buildShellLaunch, shellCurrentDirectory, terminatePty } from './shell.ts';
import { registerTerminalIpc } from './terminal-ipc.ts';
import type { MenuAction } from '../shared/terminal-protocol.ts';

// An isolated data directory also makes automated smoke tests non-destructive.
if (process.env.Y_TERM_TEST_DATA) app.setPath('userData', process.env.Y_TERM_TEST_DATA);
app.setName('Y-Term');

const documentPath = join(__dirname, '../renderer/index.html');
const documentUrl = pathToFileURL(documentPath).href;
let preferences: PreferencesStore;
let manager: SessionManager;

function sendAction(action: MenuAction): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('terminal:action', action);
}

function createWindow(): void {
  const window = new BrowserWindow({
    ...visibleBounds(preferences.get().bounds, screen.getAllDisplays().map(d => d.workArea)),
    minWidth: 640, minHeight: 400, title: 'Y-Term',
    backgroundColor: preferences.get().theme === 'dark' ? '#101216' : '#faf9f6',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 17 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false,
    },
  });
  const owner = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('render-process-gone', () => manager.closeOwner(owner));
  window.on('close', () => {
    try { preferences.save({ ...preferences.get(), bounds: window.getNormalBounds() }); }
    catch (error) { console.error('Could not save window bounds:', error); }
    manager.closeOwner(owner);
  });
  window.webContents.on('destroyed', () => manager.closeOwner(owner));
  window.once('ready-to-show', () => window.show());
  void window.loadURL(documentUrl).catch(error => dialog.showErrorBox('Y-Term could not open', String(error)));
}

function setMenu(): void {
  const action = (label: string, accelerator: string, command: MenuAction): MenuItemConstructorOptions => ({ label, accelerator, click: () => sendAction(command) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Y-Term', submenu: [
      { role: 'about' }, { type: 'separator' }, action('Settings…', 'CmdOrCtrl+,', 'settings'),
      { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Shell', submenu: [
      action('New Tab', 'CmdOrCtrl+T', 'new-tab'),
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
      action('Close Tab', 'CmdOrCtrl+W', 'close-tab'),
      { type: 'separator' }, action('Clear Display', 'CmdOrCtrl+K', 'clear'),
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, action('Find…', 'CmdOrCtrl+F', 'find')] },
    { label: 'View', submenu: [action('Increase Font Size', 'CmdOrCtrl+Plus', 'zoom-in'), action('Decrease Font Size', 'CmdOrCtrl+-', 'zoom-out'), action('Reset Font Size', 'CmdOrCtrl+0', 'zoom-reset'), { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, action('Next Tab', 'Ctrl+Tab', 'next-tab'), action('Previous Tab', 'Ctrl+Shift+Tab', 'previous-tab'), { type: 'separator' }, { role: 'front' }] },
  ]));
}

void app.whenReady().then(() => {
  app.dock?.setIcon(join(__dirname, '../../assets/icon.png'));
  preferences = new PreferencesStore(app.getPath('userData'));
  manager = new SessionManager((size, cwd) => {
    const launch = buildShellLaunch({ ...preferences.get(), ...(cwd ? { cwd } : {}) }, size, process.env);
    return spawn(launch.file, launch.args, launch.options);
  }, (owner, event) => {
    const contents = webContents.fromId(owner);
    if (contents && !contents.isDestroyed()) contents.send('terminal:event', event);
  }, terminatePty, shellCurrentDirectory);
  registerTerminalIpc(manager, preferences, documentUrl);
  setMenu(); createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { dialog.showErrorBox('Y-Term could not start', String(error)); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  for (const window of BrowserWindow.getAllWindows()) manager?.closeOwner(window.webContents.id);
});
