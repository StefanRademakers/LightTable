import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createLightTableImageClipboard,
  createLocalLightTableFunnelTelemetry,
  configureVectorRendererDetailedProfiling,
  LightTableStandaloneApp,
  prepareLightTableRenderingRuntime,
  registerExternalMediaSource,
  type LightTableAutomationDriver,
  type LightTableHost
} from '@lighttable/app/standalone';
import './renderer.css';
import { invokeAgentDriver } from './agentDriverBridge';
import type { DesktopFilePayload } from './desktopBridge';
import { normalizeDesktopGenAiError } from './genai/desktopGenAiError';

configureVectorRendererDetailedProfiling(
  import.meta.env.VITE_LIGHTTABLE_VECTOR_PROFILE === 'true'
);

if (navigator.userAgent.includes('Windows')) {
  const titlebarIconUrl = new URL('../../../icon/logo_emblem.png', import.meta.url).href;
  document.documentElement.classList.add('lighttable-windows-titlebar');
  document.documentElement.style.setProperty(
    '--lighttable-window-icon',
    `url("${titlebarIconUrl}")`
  );
}

const uiDevtoolsEnabled = import.meta.env.VITE_LIGHTTABLE_UI_DEVTOOLS === 'true';
const UiInspectorHost = uiDevtoolsEnabled
  ? React.lazy(() => import('@lighttable/app/ui-devtools').then((module) => ({
      default: module.UiInspectorHost
    })))
  : null;
const openUiStyleGuide = uiDevtoolsEnabled
  ? () => { void import('@lighttable/app/ui-devtools').then((module) => module.requestUiStyleGuide()); }
  : undefined;

const removeHorizontalWheelBridge = window.lightTableDesktop.onHorizontalWheel((input) => {
  window.dispatchEvent(new CustomEvent('lighttable:desktop-horizontal-wheel', {
    detail: input
  }));
});
window.addEventListener('beforeunload', removeHorizontalWheelBridge, { once: true });

const desktopFile = (payload: DesktopFilePayload | null) => {
  if (!payload) return null;
  const bytes = payload.bytes ? Uint8Array.from(payload.bytes).buffer : new ArrayBuffer(0);
  const file = new File([bytes], payload.name, {
    type: payload.type
  });
  if (payload.mediaSource) {
    const { id, url, byteLength } = payload.mediaSource;
    let released = false;
    registerExternalMediaSource(file, {
      url,
      byteLength,
      release: () => {
        if (released) return;
        released = true;
        void window.lightTableDesktop.releaseMediaSource(id);
      }
    });
  }
  if (payload.sourcePath) {
    Object.defineProperty(file, 'lightTableSourcePath', {
      value: payload.sourcePath,
      enumerable: false
    });
  }
  return file;
};

// Claim the initial OS-open handoff during renderer module bootstrap. Main has
// already started bounded file I/O, so this overlaps bridge delivery and the
// shared GPU runtime with React/application mounting without prewarming an
// ordinary empty launch.
const bootstrapLaunchFiles = window.lightTableDesktop.takeInitialLaunchFiles()
  .then((payloads) => {
    const files = payloads.map((payload) => desktopFile(payload))
      .filter((file): file is File => Boolean(file));
    if (files.length) void prepareLightTableRenderingRuntime().catch(() => undefined);
    return files;
  })
  .catch(() => [] as File[]);
let bootstrapLaunchFilesClaimed = false;

const desktopHost: LightTableHost = {
  kind: 'electron',
  developer: {
    reloadUi: () => window.location.reload(),
    toggleDeveloperTools: () => { void window.lightTableDesktop.toggleDeveloperTools(); }
  },
  actionLibrary: {
    read: () => window.lightTableDesktop.readActionLibrary(),
    write: (value) => window.lightTableDesktop.writeActionLibrary(value)
  },
  localAi: {
    status: () => window.lightTableDesktop.localAiModelStatus(),
    install: () => window.lightTableDesktop.installLocalAiModel(),
    configure: (settings) => window.lightTableDesktop.configureLocalAi(settings),
    testConnection: (settings) => window.lightTableDesktop.testLocalAiConnection(settings),
    configureProviders: (providers) => window.lightTableDesktop.configureAiProviders(providers),
    testProvider: (provider) => window.lightTableDesktop.testAiProvider(provider),
    openProviderHelp: (provider) => window.lightTableDesktop.openAiProviderHelp(provider),
    subscribe: (listener) => window.lightTableDesktop.onLocalAiModelStatus(listener)
  },
  genAi: {
    getProviderSnapshots: () => window.lightTableDesktop.genAiProviderSnapshots(),
    connectProvider: (providerId) => window.lightTableDesktop.connectGenAiProvider(providerId),
    disconnectProvider: (providerId) => window.lightTableDesktop.disconnectGenAiProvider(providerId),
    listModels: (providerId) => window.lightTableDesktop.listGenAiModels(providerId),
    loadWorkflow: (providerId, modelId, mode) =>
      window.lightTableDesktop.loadGenAiWorkflow(providerId, modelId, mode),
    estimateCost: (providerId, modelId, mode, fields) =>
      window.lightTableDesktop.estimateGenAiCost(providerId, modelId, mode, fields),
    submitGeneration: async (projectId, request) => {
      try {
        return await window.lightTableDesktop.submitGenAiGeneration(projectId, request);
      } catch (reason) {
        throw normalizeDesktopGenAiError(reason);
      }
    },
    listJobs: (projectId) => window.lightTableDesktop.listGenAiJobs(projectId),
    stopTracking: (projectId, jobId) => window.lightTableDesktop.stopGenAiJobTracking(projectId, jobId),
    resumeTracking: (projectId, jobId) => window.lightTableDesktop.resumeGenAiJobTracking(projectId, jobId),
    revealResult: (projectId, jobId) => window.lightTableDesktop.revealGenAiResult(projectId, jobId),
    deleteJob: (projectId, jobId) => window.lightTableDesktop.deleteGenAiJob(projectId, jobId),
    loadProjectAssetCatalog: (projectId) => window.lightTableDesktop.loadGenAiProjectAssetCatalog(projectId),
    refreshProjectAssets: (projectId) => window.lightTableDesktop.refreshGenAiProjectAssets(projectId),
    loadProjectAssetPreview: (projectId, assetId) =>
      window.lightTableDesktop.loadGenAiProjectAssetPreview(projectId, assetId),
    loadProjectAsset: (projectId, assetId) =>
      window.lightTableDesktop.loadGenAiProjectAsset(projectId, assetId),
    importProjectAsset: (projectId, asset) =>
      window.lightTableDesktop.importGenAiProjectAsset(projectId, asset),
    revealProjectAsset: (projectId, assetId) =>
      window.lightTableDesktop.revealGenAiProjectAsset(projectId, assetId),
    renameProjectAsset: (projectId, assetId, name) =>
      window.lightTableDesktop.renameGenAiProjectAsset(projectId, assetId, name),
    deleteProjectAsset: (projectId, assetId) =>
      window.lightTableDesktop.deleteGenAiProjectAsset(projectId, assetId),
    loadProjectSetup: (projectId) => window.lightTableDesktop.loadGenAiProjectSetup(projectId),
    saveProjectSetup: (projectId, setup) => window.lightTableDesktop.saveGenAiProjectSetup(projectId, setup),
    subscribe: (listener) => window.lightTableDesktop.onGenAiProviderStatus(listener),
    subscribeProjectAssets: (projectId, listener) => window.lightTableDesktop.onGenAiProjectAssetsChanged((changedProjectId) => {
      if (changedProjectId === projectId) listener();
    }),
    subscribeJobs: (projectId, listener) => window.lightTableDesktop.onGenAiJobChanged((event) => {
      if (event.projectId === projectId) listener(event.job);
    })
  },
  projects: {
    current: () => window.lightTableDesktop.currentProject(),
    chooseParentLocation: () => window.lightTableDesktop.chooseProjectParent(),
    create: (request) => window.lightTableDesktop.createProject(request),
    open: () => window.lightTableDesktop.openProject(),
    listRecent: () => window.lightTableDesktop.listRecentProjects(),
    openRecent: (recentId) => window.lightTableDesktop.openRecentProject(recentId),
    loadRecentThumbnail: (recentId) => window.lightTableDesktop.loadRecentProjectThumbnail(recentId),
    openLastUsedDocument: async (project) =>
      desktopFile(await window.lightTableDesktop.openProjectLastUsedDocument(project.id)),
    reveal: (project) => window.lightTableDesktop.revealProject(project.manifestPath),
    close: () => window.lightTableDesktop.closeProject(),
    removeRecent: (recentId) => window.lightTableDesktop.removeRecentProject(recentId),
    clearRecent: () => window.lightTableDesktop.clearRecentProjects()
  },
  funnel: createLocalLightTableFunnelTelemetry(localStorage),
  agentAccess: {
    status: () => window.lightTableDesktop.agentAccessStatus(),
    enable: (options) => window.lightTableDesktop.enableAgentAccess(options?.port),
    disable: () => window.lightTableDesktop.disableAgentAccess(),
    rotateCredentials: () => window.lightTableDesktop.rotateAgentAccessCredentials(),
    subscribe: (listener) => window.lightTableDesktop.onAgentAccessStatus(listener),
    installDriver: (driver) => window.lightTableDesktop.installAgentAccessHandler(
      (method, parameters) => invokeAgentDriver(driver, method, parameters)
    ),
    tunnelStatus: () => window.lightTableDesktop.agentTunnelStatus(),
    pairServer: (serverUrl, code) => window.lightTableDesktop.pairAgentServer(serverUrl, code),
    disconnectServer: () => window.lightTableDesktop.disconnectAgentServer(),
    reconnectServer: () => window.lightTableDesktop.reconnectAgentServer(),
    approveClient: (clientId, scopes, persistent) => window.lightTableDesktop.approveAgentClient(clientId, scopes, persistent),
    localMcpStatus: () => window.lightTableDesktop.localMcpTestStatus(),
    startLocalMcp: () => window.lightTableDesktop.startLocalMcpTest(),
    stopLocalMcp: () => window.lightTableDesktop.stopLocalMcpTest(),
    authorizeCodex: () => window.lightTableDesktop.authorizeLocalMcpCodex(),
    subscribeLocalMcp: (listener) => window.lightTableDesktop.onLocalMcpTestStatus(listener),
    revokeClient: (clientId) => window.lightTableDesktop.revokeAgentClient(clientId),
    revokeDevice: () => window.lightTableDesktop.revokeAgentDevice(),
    cancelActivity: () => window.lightTableDesktop.cancelAgentActivity(),
    undoActivity: () => window.lightTableDesktop.undoAgentActivity(),
    subscribeTunnel: (listener) => window.lightTableDesktop.onAgentTunnelStatus(listener)
  },
  release: {
    info: () => window.lightTableDesktop.releaseInfo(),
    checkForUpdates: () => window.lightTableDesktop.checkForUpdates(),
    restartToInstall: ({ dirtyDocuments }) =>
      window.lightTableDesktop.restartToInstallUpdate(dirtyDocuments)
  },
  recovery: {
    async write({ documentId, record, artifact, preparedBytes }) {
      return window.lightTableDesktop.writeRecovery({
        documentId,
        record,
        bytes: new Uint8Array(preparedBytes ?? await artifact.arrayBuffer())
      });
    },
    remove: (documentId, throughRevision) =>
      window.lightTableDesktop.removeRecovery(documentId, throughRevision),
    removeRecord: (recoveryId) =>
      window.lightTableDesktop.removeRecoveryRecord(recoveryId),
    list: () => window.lightTableDesktop.listRecoveries(),
    async read(recoveryId) {
      const entry = await window.lightTableDesktop.readRecovery(recoveryId);
      return entry ? {
        record: entry.record,
        artifact: new File(
          [Uint8Array.from(entry.bytes).buffer],
          'recovered-lighttable.png',
          { type: entry.record.mediaType }
        )
      } : null;
    }
  },
  recoveryLocation: {
    current: () => window.lightTableDesktop.recoveryLocation(),
    choose: () => window.lightTableDesktop.chooseRecoveryLocation(),
    reset: () => window.lightTableDesktop.resetRecoveryLocation(),
    apply: (location) => window.lightTableDesktop.applyRecoveryLocation(location.custom ? location.path : undefined)
  },
  systemFontProvider: {
    async load(asset) {
      const bytes = await window.lightTableDesktop.loadSystemFont(asset.assetId);
      return bytes ? Uint8Array.from(bytes) : null;
    }
  },
  listSystemFonts: () => window.lightTableDesktop.listSystemFonts(),
  clipboard: createLightTableImageClipboard({
    async writePng(blob) {
      return window.lightTableDesktop.writeClipboardPng(
        new Uint8Array(await blob.arrayBuffer())
      );
    },
    async readImage() {
      const image = await window.lightTableDesktop.readClipboardImage();
      return image
        ? { blob: new Blob([Uint8Array.from(image.bytes).buffer], { type: image.mediaType }),
            identity: image.identity }
        : null;
    }
  }),
  async openFile() {
    // The native picker usually gives device initialization enough time to
    // finish before the selected bytes arrive in the renderer process.
    void prepareLightTableRenderingRuntime().catch(() => undefined);
    const payload = await window.lightTableDesktop.openFile();
    return desktopFile(payload);
  },
  async openFiles() {
    void prepareLightTableRenderingRuntime().catch(() => undefined);
    return (await window.lightTableDesktop.openFiles())
      .map((payload) => desktopFile(payload))
      .filter((file): file is File => Boolean(file));
  },
  subscribeOpenFiles(listener) {
    let disposed = false;
    let draining = false;
    let requestedAgain = false;
    let bootstrapping = !bootstrapLaunchFilesClaimed;
    bootstrapLaunchFilesClaimed = true;
    const drain = async (): Promise<void> => {
      if (draining) { requestedAgain = true; return; }
      draining = true;
      try {
        do {
          requestedAgain = false;
          // For Explorer/OS opens, overlap the process-wide GPU/Vello runtime
          // with main-process file reading and IPC. This owns no document or
          // canvas state and concurrent requests are coalesced.
          void prepareLightTableRenderingRuntime().catch(() => undefined);
          const files = (await window.lightTableDesktop.takeLaunchFiles())
            .map((payload) => desktopFile(payload))
            .filter((file): file is File => Boolean(file));
          if (!disposed && files.length) listener(files);
        } while (!disposed && requestedAgain);
      } finally {
        draining = false;
        if (!disposed && requestedAgain) void drain();
      }
    };
    const remove = window.lightTableDesktop.onLaunchFilesAvailable(() => {
      if (bootstrapping) requestedAgain = true;
      else void drain();
    });
    if (bootstrapping) {
      void bootstrapLaunchFiles.then((files) => {
        if (!disposed && files.length) listener(files);
      }).finally(() => {
        bootstrapping = false;
        if (!disposed) void drain();
      });
    } else {
      void drain();
    }
    return () => { disposed = true; remove(); };
  },
  async listRecentFiles() {
    return (await window.lightTableDesktop.listRecentFiles()).map((entry) => ({
      id: entry.id,
      name: entry.name,
      available: entry.available
    }));
  },
  loadRecentFileThumbnail(id) {
    return window.lightTableDesktop.loadRecentFileThumbnail(id);
  },
  async openRecentFile(id) {
    void prepareLightTableRenderingRuntime().catch(() => undefined);
    const payload = await window.lightTableDesktop.openRecentFile(id);
    return desktopFile(payload);
  },
  rememberRecentFiles(files) {
    return window.lightTableDesktop.rememberOpenedFiles(files);
  },
  revealRecentFile(id) {
    return window.lightTableDesktop.revealRecentFile(id);
  },
  removeRecentFile(id) {
    return window.lightTableDesktop.removeRecentFile(id);
  },
  clearRecentFiles() {
    return window.lightTableDesktop.clearRecentFiles();
  },
  setFullscreen(enabled) {
    return window.lightTableDesktop.setFullscreen(enabled);
  },
  closeApplication() {
    return window.lightTableDesktop.closeApplication();
  },
  subscribeApplicationCloseRequests(listener) {
    return window.lightTableDesktop.onApplicationCloseRequested(() => {
      void listener().then(
        (approved) => window.lightTableDesktop.respondApplicationCloseRequest(approved),
        () => window.lightTableDesktop.respondApplicationCloseRequest(false)
      ).catch(() => undefined);
    });
  },
  subscribeFullscreen(listener) {
    return window.lightTableDesktop.onFullscreenChange(listener);
  },
  confirmDiscardChanges(documentTitle) {
    return window.lightTableDesktop.confirmDiscardChanges(documentTitle);
  },
  async save({ file, transaction, projectManifestPath, replaceSource }) {
    return window.lightTableDesktop.saveFile({
      suggestedName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      replaceSource,
      projectManifestPath,
      transaction
    });
  },
  installAutomationDriver: window.lightTableDesktop.automationEnabled
    ? (driver) => {
        (window as Window & { __lightTableAutomation?: LightTableAutomationDriver })
          .__lightTableAutomation = driver;
        return () => {
          delete (window as Window & { __lightTableAutomation?: LightTableAutomationDriver })
            .__lightTableAutomation;
        };
      }
    : undefined
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LightTableStandaloneApp host={desktopHost} onOpenStyleGuide={openUiStyleGuide} />
    {UiInspectorHost ? (
      <React.Suspense fallback={null}><UiInspectorHost /></React.Suspense>
    ) : null}
  </React.StrictMode>
);
