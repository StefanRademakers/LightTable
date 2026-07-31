import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'cross-origin-isolated=(self)'
};

export default defineConfig({
  plugins: [react()],
  // Resolve the workspace package as first-party source. Besides preserving
  // Vite-owned workers and asset globs, this keeps package CSS in the HMR graph
  // instead of hiding it behind npm's node_modules junction.
  resolve: {
    alias: {
      '@lighttable/app': fileURLToPath(
        new URL('../../packages/lighttable-app/src/index.ts', import.meta.url)
      )
    },
    dedupe: ['react', 'react-dom']
  },
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
