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
  loadRecentFileThumbnail: (id: string) =>
    ipcRenderer.invoke('lighttable:load-recent-file-thumbnail', id),
  openRecentFile: (id: string) => ipcRenderer.invoke('lighttable:open-recent-file', id),
  removeRecentFile: (id: string) => ipcRenderer.invoke('lighttable:remove-recent-file', id),
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
  loadSystemFont: (assetId: string) => ipcRenderer.invoke('lighttable:load-system-font', assetId),
  releaseInfo: () => ipcRenderer.invoke('lighttable:release-info'),
  checkForUpdates: () => ipcRenderer.invoke('lighttable:check-updates'),
  restartToInstallUpdate: (dirtyDocuments: boolean) =>
    ipcRenderer.invoke('lighttable:restart-update', dirtyDocuments),
  agentAccessStatus: () => ipcRenderer.invoke('lighttable:agent-access-status'),
  enableAgentAccess: (port?: number) => ipcRenderer.invoke('lighttable:agent-access-enable', port),
  disableAgentAccess: () => ipcRenderer.invoke('lighttable:agent-access-disable'),
  rotateAgentAccessCredentials: () => ipcRenderer.invoke('lighttable:agent-access-rotate'),
  onAgentAccessStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on('lighttable:agent-access-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:agent-access-changed', handler);
  },
  installAgentAccessHandler: (listener) => {
    const handler = async (_event: Electron.IpcRendererEvent, request: {
      readonly id: string; readonly method: string; readonly parameters: unknown;
    }) => {
      try {
        const value = await listener(request.method, request.parameters);
        ipcRenderer.send('lighttable:agent-access-response', { id: request.id, value });
      } catch (reason) {
        ipcRenderer.send('lighttable:agent-access-response', {
          id: request.id, error: reason instanceof Error ? reason.message : String(reason)
        });
      }
    };
    ipcRenderer.on('lighttable:agent-access-request', handler);
    return () => ipcRenderer.removeListener('lighttable:agent-access-request', handler);
  },
  agentTunnelStatus: () => ipcRenderer.invoke('lighttable:agent-tunnel-status'),
  pairAgentServer: (serverUrl, code) => ipcRenderer.invoke('lighttable:agent-tunnel-pair', serverUrl, code),
  disconnectAgentServer: () => ipcRenderer.invoke('lighttable:agent-tunnel-disconnect'),
  reconnectAgentServer: () => ipcRenderer.invoke('lighttable:agent-tunnel-reconnect'),
  approveAgentClient: (clientId, scopes) => ipcRenderer.invoke('lighttable:agent-client-approve', clientId, scopes),
  revokeAgentClient: (clientId) => ipcRenderer.invoke('lighttable:agent-client-revoke', clientId),
  revokeAgentDevice: () => ipcRenderer.invoke('lighttable:agent-device-revoke'),
  cancelAgentActivity: () => ipcRenderer.invoke('lighttable:agent-activity-cancel'),
  undoAgentActivity: () => ipcRenderer.invoke('lighttable:agent-activity-undo'),
  onAgentTunnelStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on('lighttable:agent-tunnel-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:agent-tunnel-changed', handler);
  }
};

contextBridge.exposeInMainWorld('lightTableDesktop', bridge);
