import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopSavePayload, LightTableDesktopBridge } from './desktopBridge';

const bridge: LightTableDesktopBridge = {
  openFile: () => ipcRenderer.invoke('lighttable:open-file'),
  saveFile: (payload: DesktopSavePayload) =>
    ipcRenderer.invoke('lighttable:save-file', payload)
};

contextBridge.exposeInMainWorld('lightTableDesktop', bridge);
