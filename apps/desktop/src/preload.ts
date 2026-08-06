import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopRecoveryWritePayload,
  DesktopSavePayload,
  LightTableDesktopBridge
} from './desktopBridge';

const bridge: LightTableDesktopBridge = {
  automationEnabled: process.argv.includes('--lighttable-automation'),
  openFile: () => ipcRenderer.invoke('lighttable:open-file'),
  listRecentFiles: () => ipcRenderer.invoke('lighttable:list-recent-files'),
  openRecentFile: (id: string) => ipcRenderer.invoke('lighttable:open-recent-file', id),
  clearRecentFiles: () => ipcRenderer.invoke('lighttable:clear-recent-files'),
  setFullscreen: (enabled: boolean) =>
    ipcRenderer.invoke('lighttable:set-fullscreen', enabled),
  onFullscreenChange: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => listener(enabled);
    ipcRenderer.on('lighttable:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:fullscreen-changed', handler);
  },
  confirmDiscardChanges: (documentTitle: string) =>
    ipcRenderer.invoke('lighttable:confirm-discard-changes', documentTitle),
  saveFile: (payload: DesktopSavePayload) =>
    ipcRenderer.invoke('lighttable:save-file', payload),
  writeRecovery: (payload: DesktopRecoveryWritePayload) =>
    ipcRenderer.invoke('lighttable:recovery-write', payload),
  removeRecovery: (documentId: string, throughRevision?: number) =>
    ipcRenderer.invoke('lighttable:recovery-remove', documentId, throughRevision),
  removeRecoveryRecord: (recoveryId: string) =>
    ipcRenderer.invoke('lighttable:recovery-remove-record', recoveryId),
  listRecoveries: () => ipcRenderer.invoke('lighttable:recovery-list'),
  readRecovery: (recoveryId: string) =>
    ipcRenderer.invoke('lighttable:recovery-read', recoveryId),
  writeClipboardPng: (bytes: Uint8Array) =>
    ipcRenderer.invoke('lighttable:clipboard-write-png', bytes),
  readClipboardPng: () =>
    ipcRenderer.invoke('lighttable:clipboard-read-png'),
  listSystemFonts: () => ipcRenderer.invoke('lighttable:list-system-fonts'),
  loadSystemFont: (assetId: string) => ipcRenderer.invoke('lighttable:load-system-font', assetId)
};

contextBridge.exposeInMainWorld('lightTableDesktop', bridge);
