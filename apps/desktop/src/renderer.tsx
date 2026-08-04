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

const desktopHost: LightTableHost = {
  kind: 'electron',
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
    if (!payload) return null;
    return new File([Uint8Array.from(payload.bytes).buffer], payload.name, {
      type: payload.type
    });
  },
  async listRecentFiles() {
    return (await window.lightTableDesktop.listRecentFiles()).map((entry) => ({
      id: entry.id,
      name: entry.name,
      thumbnailUrl: entry.thumbnailDataUrl
    }));
  },
  async openRecentFile(id) {
    const payload = await window.lightTableDesktop.openRecentFile(id);
    if (!payload) return null;
    return new File([Uint8Array.from(payload.bytes).buffer], payload.name, {
      type: payload.type
    });
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
  async save({ file }) {
    return window.lightTableDesktop.saveFile({
      suggestedName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer())
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
