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
