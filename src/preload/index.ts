import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { MenuAction, TerminalAPI, TerminalEvent } from '../shared/terminal-protocol.ts';
import type { UpdateState } from '../shared/update-protocol.ts';

const api: TerminalAPI = {
  getUpdateState: () => ipcRenderer.invoke('updates:get'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: listener => {
    const receive = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on('updates:state', receive);
    return () => { ipcRenderer.removeListener('updates:state', receive); };
  },
  getPathForFile: file => webUtils.getPathForFile(file),
  create: (size, sourceId) => ipcRenderer.invoke('terminal:create', size, sourceId),
  ready: id => ipcRenderer.send('terminal:ready', id),
  write: (id, data, binary = false) => ipcRenderer.send('terminal:write', id, data, binary),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  acknowledge: (id, sequence) => ipcRenderer.send('terminal:ack', id, sequence),
  close: id => ipcRenderer.invoke('terminal:close', id),
  onEvent: listener => {
    const receive = (_event: IpcRendererEvent, value: TerminalEvent) => listener(value);
    ipcRenderer.on('terminal:event', receive);
    return () => { ipcRenderer.removeListener('terminal:event', receive); };
  },
  onAction: listener => {
    const receive = (_event: IpcRendererEvent, value: MenuAction) => listener(value);
    ipcRenderer.on('terminal:action', receive);
    return () => { ipcRenderer.removeListener('terminal:action', receive); };
  },
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: value => ipcRenderer.invoke('preferences:save', value),
  openLink: url => ipcRenderer.invoke('terminal:open-link', url),
  setAttentionCount: count => ipcRenderer.send('attention:count', count),
  notifyAttention: (tab, title, body) => ipcRenderer.send('attention:notify', tab, title, body),
  onAttentionActivate: listener => {
    const receive = (_event: IpcRendererEvent, tab: string) => listener(tab);
    ipcRenderer.on('attention:activate', receive);
    return () => { ipcRenderer.removeListener('attention:activate', receive); };
  },
};
contextBridge.exposeInMainWorld('terminal', api);
