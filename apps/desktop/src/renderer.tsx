import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  LightTableStandaloneApp,
  type LightTableHost
} from '@lighttable/app';
import './renderer.css';

const desktopHost: LightTableHost = {
  kind: 'electron',
  async openFile() {
    const payload = await window.lightTableDesktop.openFile();
    if (!payload) return null;
    return new File([Uint8Array.from(payload.bytes).buffer], payload.name, {
      type: payload.type
    });
  },
  async save({ file }) {
    return window.lightTableDesktop.saveFile({
      suggestedName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer())
    });
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LightTableStandaloneApp host={desktopHost} />
  </React.StrictMode>
);
