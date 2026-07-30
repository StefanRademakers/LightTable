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
