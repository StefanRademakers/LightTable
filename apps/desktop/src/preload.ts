import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  DesktopRecoveryWritePayload,
  DesktopSavePayload,
  LightTableDesktopBridge
} from './desktopBridge';

// Start the initial OS-open handoff as soon as the trusted preload executes;
// renderer bundle evaluation and React mounting must not gate prepared bytes.
const initialLaunchFiles = ipcRenderer.invoke('lighttable:take-launch-files');

const bridge: LightTableDesktopBridge = {
  automationEnabled: process.argv.includes('--lighttable-automation'),
  openFile: () => ipcRenderer.invoke('lighttable:open-file'),
  openFiles: () => ipcRenderer.invoke('lighttable:open-files'),
  takeInitialLaunchFiles: () => initialLaunchFiles,
  takeLaunchFiles: () => ipcRenderer.invoke('lighttable:take-launch-files'),
  onLaunchFilesAvailable: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('lighttable:launch-files-available', handler);
    return () => ipcRenderer.removeListener('lighttable:launch-files-available', handler);
  },
  listRecentFiles: () => ipcRenderer.invoke('lighttable:list-recent-files'),
  loadRecentFileThumbnail: (id: string) =>
    ipcRenderer.invoke('lighttable:load-recent-file-thumbnail', id),
  openRecentFile: (id: string) => ipcRenderer.invoke('lighttable:open-recent-file', id),
  rememberOpenedFiles: (files) => ipcRenderer.invoke('lighttable:remember-opened-files',
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  revealRecentFile: (id) => ipcRenderer.invoke('lighttable:reveal-recent-file', id),
  removeRecentFile: (id: string) => ipcRenderer.invoke('lighttable:remove-recent-file', id),
  clearRecentFiles: () => ipcRenderer.invoke('lighttable:clear-recent-files'),
  chooseProjectParent: () => ipcRenderer.invoke('lighttable:project-choose-parent'),
  createProject: (request) => ipcRenderer.invoke('lighttable:project-create', request),
  currentProject: () => ipcRenderer.invoke('lighttable:project-current'),
  openProject: () => ipcRenderer.invoke('lighttable:project-open'),
  listRecentProjects: () => ipcRenderer.invoke('lighttable:project-list-recent'),
  openRecentProject: (recentId) => ipcRenderer.invoke('lighttable:project-open-recent', recentId),
  loadRecentProjectThumbnail: (recentId) =>
    ipcRenderer.invoke('lighttable:project-recent-thumbnail', recentId),
  openProjectLastUsedDocument: (projectId) =>
    ipcRenderer.invoke('lighttable:project-open-last-document', projectId),
  revealProject: (manifestPath) => ipcRenderer.invoke('lighttable:project-reveal', manifestPath),
  closeProject: () => ipcRenderer.invoke('lighttable:project-close'),
  removeRecentProject: (recentId) => ipcRenderer.invoke('lighttable:project-remove-recent', recentId),
  clearRecentProjects: () => ipcRenderer.invoke('lighttable:project-clear-recent'),
  setFullscreen: (enabled: boolean) =>
    ipcRenderer.invoke('lighttable:set-fullscreen', enabled),
  closeApplication: () => ipcRenderer.invoke('lighttable:close-application'),
  readActionLibrary: () => ipcRenderer.invoke('lighttable:actions-read'),
  writeActionLibrary: (value: string) => ipcRenderer.invoke('lighttable:actions-write', value),
  onFullscreenChange: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => listener(enabled);
    ipcRenderer.on('lighttable:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:fullscreen-changed', handler);
  },
  onHorizontalWheel: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      input: Parameters<typeof listener>[0]
    ) => listener(input);
    ipcRenderer.on('lighttable:horizontal-wheel', handler);
    return () => ipcRenderer.removeListener('lighttable:horizontal-wheel', handler);
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
  recoveryLocation: () => ipcRenderer.invoke('lighttable:recovery-location'),
  chooseRecoveryLocation: () => ipcRenderer.invoke('lighttable:recovery-location-choose'),
  resetRecoveryLocation: () => ipcRenderer.invoke('lighttable:recovery-location-reset'),
  applyRecoveryLocation: (path?: string) => ipcRenderer.invoke('lighttable:recovery-location-apply', path),
  writeClipboardPng: (bytes: Uint8Array) =>
    ipcRenderer.invoke('lighttable:clipboard-write-png', bytes),
  readClipboardImage: () =>
    ipcRenderer.invoke('lighttable:clipboard-read-image'),
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
  approveAgentClient: (clientId, scopes, persistent) => ipcRenderer.invoke('lighttable:agent-client-approve', clientId, scopes, persistent),
  localMcpTestStatus: () => ipcRenderer.invoke('lighttable:local-mcp-status'),
  startLocalMcpTest: () => ipcRenderer.invoke('lighttable:local-mcp-start'),
  stopLocalMcpTest: () => ipcRenderer.invoke('lighttable:local-mcp-stop'),
  authorizeLocalMcpCodex: () => ipcRenderer.invoke('lighttable:local-mcp-authorize-codex'),
  onLocalMcpTestStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on('lighttable:local-mcp-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:local-mcp-changed', handler);
  },
  revokeAgentClient: (clientId) => ipcRenderer.invoke('lighttable:agent-client-revoke', clientId),
  revokeAgentDevice: () => ipcRenderer.invoke('lighttable:agent-device-revoke'),
  cancelAgentActivity: () => ipcRenderer.invoke('lighttable:agent-activity-cancel'),
  undoAgentActivity: () => ipcRenderer.invoke('lighttable:agent-activity-undo'),
  onAgentTunnelStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on('lighttable:agent-tunnel-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:agent-tunnel-changed', handler);
  },
  genAiProviderSnapshots: () => ipcRenderer.invoke('lighttable:genai-provider-snapshots'),
  connectGenAiProvider: (providerId) =>
    ipcRenderer.invoke('lighttable:genai-provider-connect', providerId),
  disconnectGenAiProvider: (providerId) =>
    ipcRenderer.invoke('lighttable:genai-provider-disconnect', providerId),
  listGenAiModels: (providerId) =>
    ipcRenderer.invoke('lighttable:genai-model-list', providerId),
  loadGenAiWorkflow: (providerId, modelId, mode) =>
    ipcRenderer.invoke('lighttable:genai-workflow-load', providerId, modelId, mode),
  estimateGenAiCost: (providerId, modelId, mode, fields) =>
    ipcRenderer.invoke('lighttable:genai-cost-estimate', providerId, modelId, mode, fields),
  submitGenAiGeneration: (projectId, request) =>
    ipcRenderer.invoke('lighttable:genai-generation-submit', projectId, request),
  listGenAiJobs: (projectId) => ipcRenderer.invoke('lighttable:genai-jobs-list', projectId),
  stopGenAiJobTracking: (projectId, jobId) =>
    ipcRenderer.invoke('lighttable:genai-job-stop-tracking', projectId, jobId),
  resumeGenAiJobTracking: (projectId, jobId) =>
    ipcRenderer.invoke('lighttable:genai-job-resume-tracking', projectId, jobId),
  revealGenAiResult: (projectId, jobId) =>
    ipcRenderer.invoke('lighttable:genai-result-reveal', projectId, jobId),
  deleteGenAiJob: (projectId, jobId) =>
    ipcRenderer.invoke('lighttable:genai-job-delete', projectId, jobId),
  loadGenAiProjectAssetCatalog: (projectId) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-catalog', projectId),
  refreshGenAiProjectAssets: (projectId) =>
    ipcRenderer.invoke('lighttable:genai-project-assets-refresh', projectId),
  loadGenAiProjectAssetPreview: (projectId, assetId) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-preview', projectId, assetId),
  loadGenAiProjectAsset: (projectId, assetId) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-load', projectId, assetId),
  importGenAiProjectAsset: (projectId, asset) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-import', projectId, asset),
  revealGenAiProjectAsset: (projectId, assetId) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-reveal', projectId, assetId),
  renameGenAiProjectAsset: (projectId, assetId, name) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-rename', projectId, assetId, name),
  deleteGenAiProjectAsset: (projectId, assetId) =>
    ipcRenderer.invoke('lighttable:genai-project-asset-delete', projectId, assetId),
  loadGenAiProjectSetup: (projectId) => ipcRenderer.invoke('lighttable:genai-project-setup-load', projectId),
  saveGenAiProjectSetup: (projectId, setup) => ipcRenderer.invoke('lighttable:genai-project-setup-save', projectId, setup),
  onGenAiProviderStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) =>
      listener(snapshot);
    ipcRenderer.on('lighttable:genai-provider-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:genai-provider-changed', handler);
  },
  localAiModelStatus: () => ipcRenderer.invoke('lighttable:local-ai-model-status'),
  installLocalAiModel: () => ipcRenderer.invoke('lighttable:local-ai-model-install'),
  configureLocalAi: (settings) => ipcRenderer.invoke('lighttable:local-ai-configure', settings),
  testLocalAiConnection: (settings) => ipcRenderer.invoke('lighttable:local-ai-test-connection', settings),
  configureAiProviders: (providers) => ipcRenderer.invoke('lighttable:ai-provider-configure', providers),
  testAiProvider: (provider) => ipcRenderer.invoke('lighttable:ai-provider-test', provider),
  openAiProviderHelp: (provider) => ipcRenderer.invoke('lighttable:ai-provider-help', provider),
  onLocalAiModelStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on('lighttable:local-ai-model-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:local-ai-model-changed', handler);
  },
  onGenAiProjectAssetsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string) => listener(projectId);
    ipcRenderer.on('lighttable:genai-project-assets-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:genai-project-assets-changed', handler);
  },
  onGenAiJobChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, jobEvent: Parameters<typeof listener>[0]) => listener(jobEvent);
    ipcRenderer.on('lighttable:genai-job-changed', handler);
    return () => ipcRenderer.removeListener('lighttable:genai-job-changed', handler);
  }
};

contextBridge.exposeInMainWorld('lightTableDesktop', bridge);
