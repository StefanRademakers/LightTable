import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopSavePayload, LightTableDesktopBridge } from './desktopBridge';

const bridge: LightTableDesktopBridge = {
  openFile: () => ipcRenderer.invoke('lighttable:open-file'),
  listRecentFiles: () => ipcRenderer.invoke('lighttable:list-recent-files'),
  openRecentFile: (id: string) => ipcRenderer.invoke('lighttable:open-recent-file', id),
  confirmDiscardChanges: (documentTitle: string) =>
    ipcRenderer.invoke('lighttable:confirm-discard-changes', documentTitle),
  saveFile: (payload: DesktopSavePayload) =>
    ipcRenderer.invoke('lighttable:save-file', payload),
  writeClipboardPng: (bytes: Uint8Array) =>
    ipcRenderer.invoke('lighttable:clipboard-write-png', bytes),
  readClipboardPng: () =>
    ipcRenderer.invoke('lighttable:clipboard-read-png')
};

contextBridge.exposeInMainWorld('lightTableDesktop', bridge);
