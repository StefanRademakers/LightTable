import { defineConfig } from 'vite';

const debugBuild = process.env.LIGHTTABLE_BUILD_PROFILE === 'debug';

export default defineConfig({
  build: {
    sourcemap: debugBuild,
    minify: debugBuild ? false : undefined,
    rollupOptions: {
      external: ['electron']
    }
  }
});
