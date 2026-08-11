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
      ),
      '@lighttable/genai-core': fileURLToPath(
        new URL('../../packages/genai-core/src/index.ts', import.meta.url)
      ),
      '@lighttable/text-core': fileURLToPath(
        new URL('../../packages/text-core/src/index.ts', import.meta.url)
      ),
      '@lighttable/text-rendering': fileURLToPath(
        new URL('../../packages/text-rendering/src/index.ts', import.meta.url)
      ),
      '@lighttable/text-webgpu': fileURLToPath(
        new URL('../../packages/text-webgpu/src/index.ts', import.meta.url)
      ),
      '@lighttable/vector-core': fileURLToPath(
        new URL('../../packages/vector-core/src/index.ts', import.meta.url)
      ),
      '@lighttable/vector-rendering': fileURLToPath(
        new URL('../../packages/vector-rendering/src/index.ts', import.meta.url)
      ),
      '@lighttable/vector-webgpu': fileURLToPath(
        new URL('../../packages/vector-webgpu/src/index.ts', import.meta.url)
      ),
      '@lighttable/harfbuzz-subset-wasm?url': `${fileURLToPath(
        new URL('../../node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm', import.meta.url)
      )}?url`
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    exclude: [
      '@lighttable/app',
      '@lighttable/genai-core',
      '@lighttable/text-core',
      '@lighttable/text-rendering',
      '@lighttable/text-webgpu',
      '@lighttable/vector-core',
      '@lighttable/vector-rendering',
      '@lighttable/vector-webgpu'
    ]
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
