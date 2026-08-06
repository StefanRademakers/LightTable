import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createLightTableImageClipboard,
  LightTableStandaloneApp,
  type LightTableAutomationDriver,
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

const desktopHost: LightTableHost = {
  kind: 'electron',
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
