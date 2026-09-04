import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LightTableStandaloneApp } from '@lighttable/app/standalone';
import './web.css';

const titlebarIconUrl = new URL('../../../icon/logo_emblem.png', import.meta.url).href;
document.documentElement.style.setProperty(
  '--lighttable-window-icon',
  `url("${titlebarIconUrl}")`
);

// Keep an accidental Ctrl press during mouse-wheel document zoom from
// changing Chrome's remembered page zoom for the LightTable web app.
window.addEventListener('wheel', (event) => {
  if (event.ctrlKey) event.preventDefault();
}, { capture: true, passive: false });

const uiDevtoolsEnabled = import.meta.env.VITE_LIGHTTABLE_UI_DEVTOOLS === 'true';
const UiInspectorHost = uiDevtoolsEnabled
  ? React.lazy(() => import('@lighttable/app/ui-devtools').then((module) => ({
      default: module.UiInspectorHost
    })))
  : null;
const openUiStyleGuide = uiDevtoolsEnabled
  ? () => { void import('@lighttable/app/ui-devtools').then((module) => module.requestUiStyleGuide()); }
  : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LightTableStandaloneApp
      onOpenStyleGuide={openUiStyleGuide}
      warnBeforeBrowserUnload
    />
    {UiInspectorHost ? (
      <React.Suspense fallback={null}><UiInspectorHost /></React.Suspense>
    ) : null}
  </React.StrictMode>
);
