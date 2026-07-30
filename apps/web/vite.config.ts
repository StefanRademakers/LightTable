import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'cross-origin-isolated=(self)'
};

export default defineConfig({
  plugins: [react()],
  // @lighttable/app contains Vite-owned assets and module workers. Treat the
  // workspace package as application source so worker URLs stay valid in dev,
  // just as they do in the production bundle and the Electron renderer.
  optimizeDeps: {
    exclude: ['@lighttable/app']
  },
  server: {
    headers: isolationHeaders
  },
  preview: {
    headers: isolationHeaders
  },
  worker: {
    format: 'es'
  }
});
