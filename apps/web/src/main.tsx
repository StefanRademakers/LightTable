import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LightTableStandaloneApp } from '@lighttable/app';
import './web.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LightTableStandaloneApp />
  </React.StrictMode>
);
