import { defineConfig } from 'vitest/config';

export default defineConfig({
  // @mediavibe/ui is a linked sibling package during suite development. Keep
  // hooks on the consumer's React instance just as the production Vite hosts do.
  resolve: {
    dedupe: ['react', 'react-dom']
  }
});
