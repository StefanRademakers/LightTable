import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createLightTableImageClipboard,
  createLocalLightTableFunnelTelemetry,
  LightTableStandaloneApp,
  type LightTableAutomationDriver,
  type DocumentSessionId,
  type LightTableHost
} from '@lighttable/app';
import './renderer.css';
import type { DesktopFilePayload } from './desktopBridge';

const desktopFile = (payload: DesktopFilePayload | null) => {
  if (!payload) return null;
  const file = new File([Uint8Array.from(payload.bytes).buffer], payload.name, {
    type: payload.type
  });
  if (payload.sourcePath) {
    Object.defineProperty(file, 'lightTableSourcePath', {
      value: payload.sourcePath,
      enumerable: false
    });
  }
  return file;
};

const invokeAgentDriver = async (
  driver: LightTableAutomationDriver,
  method: string,
  parameters: unknown
): Promise<unknown> => {
  const value = parameters as Record<string, unknown>;
  const documentId = String(value.documentId) as DocumentSessionId;
  const layerId = String(value.layerId) as Parameters<LightTableAutomationDriver['queryText']>[1];
  if (method === 'workspace.query') return driver.queryWorkspace();
  if (method === 'document.query') return driver.queryDocument(documentId);
  if (method === 'layer.list') return driver.queryLayers(documentId);
  if (method === 'layer.effects') return driver.queryLayerEffects(documentId, layerId);
  if (method === 'text.query') return driver.queryText(documentId, layerId);
  if (method === 'vector.query') return driver.queryVector(documentId, layerId);
  if (method === 'command.capabilities') return driver.queryCapabilities(documentId);
  if (method === 'task.query') return driver.queryTask(documentId, String(value.taskId));
  if (method === 'task.events') return driver.queryTaskEvents(value.afterCursor as number | undefined, value.limit as number | undefined);
  if (method === 'artifact.list') return driver.listArtifacts();
  if (method === 'artifact.query') return driver.queryArtifact(String(value.artifactId));
  if (method === 'artifact.release') return driver.releaseArtifact(String(value.artifactId));
  if (method === 'artifact.register') {
    if (!(value.bytes instanceof Uint8Array)) throw new Error('Invalid agent artifact bytes.');
    return driver.registerInputArtifact(new File(
      [Uint8Array.from(value.bytes).buffer], String(value.name), { type: String(value.mediaType) }
    ));
  }
  if (method === 'artifact.resolve') {
    const file = driver.resolveArtifact(String(value.artifactId));
    return file ? {
      bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, mediaType: file.type
    } : null;
  }
  if (method === 'gesture.begin') return driver.beginGesture(value);
  if (method === 'gesture.update') return driver.updateGesture(String(value.gestureId), value.samples);
  if (method === 'gesture.finish') return driver.finishGesture(String(value.gestureId), value.commit === true);
  if (method === 'command.execute') return driver.execute({
    protocolVersion: 1, requestId: value.commandRequestId,
    command: value.command, documentId: value.documentId,
    parameters: value.commandParameters ?? {},
    ...(value.expectedDocumentRevision === undefined ? {}
      : { expectedDocumentRevision: value.expectedDocumentRevision })
  });
  throw new Error(`Unsupported Agent Access method: ${method}`);
};

const desktopHost: LightTableHost = {
  kind: 'electron',
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
    approveClient: (clientId, scopes) => window.lightTableDesktop.approveAgentClient(clientId, scopes),
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
    async write({ documentId, record, artifact }) {
      return window.lightTableDesktop.writeRecovery({
        documentId,
        record,
        bytes: new Uint8Array(await artifact.arrayBuffer())
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
  systemFontProvider: {
    async load(asset) {
      const bytes = await window.lightTableDesktop.loadSystemFont(asset.assetId);
      return bytes ? Uint8Array.from(bytes) : null;
    }
  },
  listSystemFonts: () => window.lightTableDesktop.listSystemFonts(),
  clipboard: createLightTableImageClipboard({
    async writePng(blob) {
      await window.lightTableDesktop.writeClipboardPng(
        new Uint8Array(await blob.arrayBuffer())
      );
    },
    async readImage() {
      const bytes = await window.lightTableDesktop.readClipboardPng();
      return bytes
        ? new Blob([Uint8Array.from(bytes).buffer], { type: 'image/png' })
        : null;
    }
  }),
  async openFile() {
    const payload = await window.lightTableDesktop.openFile();
    return desktopFile(payload);
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
    const payload = await window.lightTableDesktop.openRecentFile(id);
    return desktopFile(payload);
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
  subscribeFullscreen(listener) {
    return window.lightTableDesktop.onFullscreenChange(listener);
  },
  confirmDiscardChanges(documentTitle) {
    return window.lightTableDesktop.confirmDiscardChanges(documentTitle);
  },
  async save({ file, transaction }) {
    return window.lightTableDesktop.saveFile({
      suggestedName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
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
    <LightTableStandaloneApp host={desktopHost} />
  </React.StrictMode>
);
