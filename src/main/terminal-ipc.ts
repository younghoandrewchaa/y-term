import { BrowserWindow, ipcMain, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { notificationText } from '../shared/attention.ts';
import type { AttentionBadge } from './attention.ts';
import type { PreferencesStore } from './preferences.ts';
import type { SessionManager } from './session-manager.ts';
import { isSafeExternalUrl, isTrustedFrame } from './security.ts';
import type { UpdateManager } from './updates.ts';
import { homedir } from 'node:os';
import { openFileLink } from './file-links.ts';
import type { GitService } from './git.ts';
import type { GitDiffResult, GitStatusResult } from '../shared/git-protocol.ts';

export function registerTerminalIpc(manager: SessionManager, preferences: PreferencesStore, documentUrl: string, updates: UpdateManager,
  badge: AttentionBadge, notify: (sender: WebContents, tab: string, title: string, body: string) => void, git: GitService): void {
  function owner(event: IpcMainEvent | IpcMainInvokeEvent): number {
    if (!BrowserWindow.fromWebContents(event.sender) || !isTrustedFrame(event.senderFrame?.url, documentUrl, event.senderFrame === event.sender.mainFrame)) {
      throw new Error('Untrusted terminal request.');
    }
    return event.sender.id;
  }
  const directory = (ownerId: number, id: unknown) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid terminal session.');
    return manager.directoryFor(ownerId, id);
  };
  ipcMain.handle('git:status', async (event, id): Promise<GitStatusResult> => {
    const ownerId = owner(event);
    let cwd: string | undefined;
    try { cwd = await directory(ownerId, id); }
    catch (error) {
      if (error instanceof Error && /shell has exited/.test(error.message)) return { kind: 'unavailable', reason: 'session-ended', message: error.message };
      throw error;
    }
    if (!cwd) return { kind: 'unavailable', reason: 'directory-unavailable', message: 'Cannot determine this terminal’s current directory.' };
    const result = await git.status(ownerId, cwd);
    if (await directory(ownerId, id) !== cwd) return { kind: 'unavailable', reason: 'directory-unavailable', message: 'The terminal directory changed. Refresh to try again.' };
    return result;
  });
  ipcMain.handle('git:diff', async (event, id, section, path): Promise<GitDiffResult> => {
    const ownerId = owner(event);
    if (!['unstaged', 'staged'].includes(section) || typeof path !== 'string' || path.length > 32768) throw new Error('Invalid Git file request.');
    const cwd = await directory(ownerId, id);
    if (!cwd) return { kind: 'summary', reason: 'stale', message: 'Cannot determine this terminal’s current directory.' };
    const result = await git.diff(ownerId, cwd, section, path);
    if (await directory(ownerId, id) !== cwd) return { kind: 'summary', reason: 'stale', message: 'The terminal directory changed. Refresh to try again.' };
    return result;
  });
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
  ipcMain.handle('terminal:open-file', async (event, id, value) => {
    const cwd = manager.directory(owner(event), id);
    await openFileLink(value, cwd, homedir(), path => shell.openPath(path));
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
  listen('attention:count', (event, count) => badge.set(event.sender.id, count));
  listen('attention:notify', (event, tab, title, body) => {
    if (typeof tab !== 'string' || !/^tab-\d+$/.test(tab)) return;
    notify(event.sender, tab, notificationText(title, 'Y-Term'), notificationText(body, 'Needs your attention'));
  });
}
