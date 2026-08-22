import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'bakeoff-dist',
    emptyOutDir: true,
    rollupOptions: { input: 'bakeoff.html' }
  },
  server: { fs: { strict: true } }
});
