import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'cross-origin-isolated=(self)'
};

const uiDevtoolsEnabled = process.env.LIGHTTABLE_UI_DEVTOOLS === '1';

export default defineConfig({
  define: {
    'import.meta.env.VITE_LIGHTTABLE_UI_DEVTOOLS': JSON.stringify(uiDevtoolsEnabled ? 'true' : 'false')
  },
  // Keep the Electron renderer on the same first-party source/HMR graph as
  // the web host. CSS edits in @lighttable/app then update without restarting
  // Electron or recreating the active document.
  resolve: {
    alias: {
      '@lighttable/app/standalone': fileURLToPath(
        new URL('../../packages/lighttable-app/src/standalone.ts', import.meta.url)
      ),
      '@lighttable/app/ui-devtools': fileURLToPath(
        new URL('../../packages/lighttable-app/src/ui-devtools.ts', import.meta.url)
      ),
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
    // Transformers.js is referenced only by lazy inference workers. Without
    // an explicit entry Vite discovers it on first tool activation, rebuilds
    // optimized dependencies and reloads the complete editor document.
    // Pre-bundling the runtime does not load any model or model weights.
    include: ['@huggingface/transformers'],
    // Workspace code must remain in Vite's live source graph. Optimizing one
    // of these packages can leave an old GPU pipeline active after HMR even
    // though its caller already runs the new source.
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
    // StoryBuilder commonly owns 5173 during adapter development. A fixed,
    // strict desktop port prevents Electron from silently navigating to that
    // unrelated Vite renderer and executing a stale LightTable module graph.
    port: 5174,
    strictPort: true,
    headers: isolationHeaders
  },
  preview: {
    headers: isolationHeaders
  },
  plugins: [
    react(),
    {
      name: 'lighttable-electron-development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // React Fast Refresh is injected as a small inline module by Vite.
        // Keep the packaged application's strict CSP, but allow that generated
        // bootstrap and the HMR websocket while running `npm run dev:desktop`.
        return html
          .replace(
            "script-src 'self' 'wasm-unsafe-eval';",
            "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';"
          )
          .replace("connect-src 'self' blob:;", "connect-src 'self' blob: ws: wss:;");
      }
    }
  ],
  worker: {
    format: 'es'
  }
});
