import { BrowserWindow, ipcMain, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { PreferencesStore } from './preferences.ts';
import type { SessionManager } from './session-manager.ts';
import { isSafeExternalUrl, isTrustedFrame } from './security.ts';
import type { UpdateManager } from './updates.ts';

export function registerTerminalIpc(manager: SessionManager, preferences: PreferencesStore, documentUrl: string, updates: UpdateManager): void {
  function owner(event: IpcMainEvent | IpcMainInvokeEvent): number {
    if (!BrowserWindow.fromWebContents(event.sender) || !isTrustedFrame(event.senderFrame?.url, documentUrl, event.senderFrame === event.sender.mainFrame)) {
      throw new Error('Untrusted terminal request.');
    }
    return event.sender.id;
  }
  ipcMain.handle('updates:get', event => { owner(event); return updates.getState(); });
  ipcMain.handle('updates:check', async event => { owner(event); await updates.check(true); return updates.getState(); });
  ipcMain.handle('updates:install', event => { owner(event); return updates.install(); });
  ipcMain.handle('terminal:create', (event, size, sourceId) => {
    const id = manager.create(owner(event), size, sourceId);
    void updates.check();
    return id;
  });
  ipcMain.handle('terminal:close', (event, id) => manager.close(owner(event), id));
  ipcMain.handle('preferences:get', event => { owner(event); return preferences.get(); });
  ipcMain.handle('preferences:save', (event, value) => {
    owner(event);
    // Window placement belongs to the main process, not renderer preferences.
    return preferences.save({ ...value, bounds: preferences.get().bounds });
  });
  ipcMain.handle('terminal:open-link', async (event, value) => {
    owner(event);
    if (!isSafeExternalUrl(value)) throw new Error('Only HTTP and HTTPS links can be opened.');
    await shell.openExternal(value);
  });
  const listen = (channel: string, handler: (event: IpcMainEvent, ...args: any[]) => void) => {
    ipcMain.on(channel, (event, ...args) => {
      try { owner(event); handler(event, ...args); }
      catch { /* Ignore stale/invalid fire-and-forget input; never crash main. */ }
    });
  };
  listen('terminal:ready', (event, id) => manager.ready(event.sender.id, id));
  listen('terminal:write', (event, id, data, binary) => manager.write(event.sender.id, id, data, binary));
  listen('terminal:resize', (event, id, cols, rows) => manager.resize(event.sender.id, id, cols, rows));
  listen('terminal:ack', (event, id, sequence) => manager.ack(event.sender.id, id, sequence));
}
