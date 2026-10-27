import { app, autoUpdater, BrowserWindow, dialog, Menu, net, Notification, screen, webContents } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node-pty';
import { AttentionBadge } from './attention.ts';
import { PreferencesStore, visibleBounds } from './preferences.ts';
import { SessionManager } from './session-manager.ts';
import { buildShellLaunch, runningAgentsAsync, shellCurrentDirectory, shellCurrentDirectoryAsync, terminatePty } from './shell.ts';
import { registerTerminalIpc } from './terminal-ipc.ts';
import type { MenuAction } from '../shared/terminal-protocol.ts';
import { UpdateManager, releaseApiUrl } from './updates.ts';
import { GitService } from './git.ts';

// An isolated data directory also makes automated smoke tests non-destructive.
if (process.env.Y_TERM_TEST_DATA) app.setPath('userData', process.env.Y_TERM_TEST_DATA);
app.setName('Y-Term');

const documentPath = join(__dirname, '../renderer/index.html');
const documentUrl = pathToFileURL(documentPath).href;
let preferences: PreferencesStore;
let manager: SessionManager;
let updates: UpdateManager;
const attention = new AttentionBadge(text => app.dock?.setBadge(text));
const git = new GitService();
// Electron drops click handlers of notifications that are garbage collected.
const notifications = new Set<Notification>();

function sendAction(action: MenuAction): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('terminal:action', action);
}

function notifyAttention(contents: WebContents, tab: string, title: string, body: string): void {
  const window = BrowserWindow.fromWebContents(contents);
  if (!window || window.isFocused()) return;
  app.dock?.bounce('informational');
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notifications.add(notification);
  notification.on('close', () => notifications.delete(notification));
  notification.on('click', () => {
    notifications.delete(notification);
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send('attention:activate', tab);
  });
  notification.show();
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
  window.webContents.on('render-process-gone', () => { manager.closeOwner(owner); attention.clear(owner); git.disposeOwner(owner); });
  window.on('close', () => {
    try { preferences.save({ ...preferences.get(), bounds: window.getNormalBounds() }); }
    catch (error) { console.error('Could not save window bounds:', error); }
    manager.closeOwner(owner);
    attention.clear(owner);
    git.disposeOwner(owner);
  });
  window.webContents.on('destroyed', () => { manager.closeOwner(owner); attention.clear(owner); git.disposeOwner(owner); });
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
    { label: 'View', submenu: [action('Toggle Sidebar', 'CmdOrCtrl+B', 'toggle-sidebar'), action('Toggle Changes', 'CmdOrCtrl+Shift+G', 'toggle-changes'), { type: 'separator' }, action('Increase Font Size', 'CmdOrCtrl+Plus', 'zoom-in'), action('Decrease Font Size', 'CmdOrCtrl+-', 'zoom-out'), action('Reset Font Size', 'CmdOrCtrl+0', 'zoom-reset'), { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
      action('Next Tab', 'Ctrl+Tab', 'next-tab'),
      action('Previous Tab', 'Ctrl+Shift+Tab', 'previous-tab'),
      { ...action('Next Tab', 'Cmd+Shift+]', 'next-tab'), visible: false, acceleratorWorksWhenHidden: true },
      { ...action('Previous Tab', 'Cmd+Shift+[', 'previous-tab'), visible: false, acceleratorWorksWhenHidden: true },
      { type: 'separator' }, { role: 'front' },
    ] },
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
  }, terminatePty, shellCurrentDirectory, shellCurrentDirectoryAsync);
  updates = new UpdateManager({
    version: app.getVersion(),
    enabled: app.isPackaged && process.platform === 'darwin' && process.arch === 'arm64' && !process.env.Y_TERM_TEST_DATA,
    native: autoUpdater,
    fetchRelease: async () => {
      const response = await net.fetch(releaseApiUrl, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      return response.json();
    },
    confirm: async () => {
      const options = {
        type: 'warning' as const, buttons: ['Cancel', 'Update and Restart'], defaultId: 0, cancelId: 0,
        title: 'Update Y-Term?', message: 'Download the update and restart Y-Term?',
        detail: 'When the download finishes, all terminal sessions will end and running processes will be stopped. Save your work before continuing.',
      };
      const window = BrowserWindow.getFocusedWindow();
      const result = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
      return result.response === 1;
    },
    publish: state => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('updates:state', state);
    },
  });
  registerTerminalIpc(manager, preferences, documentUrl, updates, attention, notifyAttention, git);
  void updates.check();
  // Schedule after completion so slow lookups never accumulate overlapping polls.
  const refreshDirectories = async () => {
    await Promise.all([manager.refreshDirectories(shellCurrentDirectoryAsync), manager.refreshAgents(runningAgentsAsync)]);
    setTimeout(refreshDirectories, 1000).unref();
  };
  void refreshDirectories();
  setMenu(); createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { dialog.showErrorBox('Y-Term could not start', String(error)); app.quit(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  const tabCount = manager?.tabCount ?? 0;
  if (tabCount > 1 && !updates?.isInstalling) {
    const response = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Cancel', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'Quit Y-Term?',
      message: `Quit Y-Term and close ${tabCount} tabs?`,
      detail: 'All terminal sessions will end and running processes will be stopped.',
    });
    if (response !== 1) {
      event.preventDefault();
      return;
    }
  }
  for (const window of BrowserWindow.getAllWindows()) manager?.closeOwner(window.webContents.id);
});
