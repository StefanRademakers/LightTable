import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'cross-origin-isolated=(self)'
};

export default defineConfig({
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
          .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          .replace("connect-src 'self' blob:;", "connect-src 'self' blob: ws: wss:;");
      }
    }
  ],
  // @lighttable/app is workspace source, not a precompiled third-party
  // dependency. Vite's dependency optimizer cannot preserve its
  // import.meta.glob icon registry, which leaves the dev build with an empty
  // icon map. Transform it as application source so HMR and asset URLs behave
  // exactly like the production bundle.
  optimizeDeps: {
    exclude: ['@lighttable/app']
  },
  worker: {
    format: 'es'
  }
});
