import { defineConfig } from 'vitest/config';

/**
 * Desktop tests live in source. Electron Forge output can contain copied
 * provider tests for a different runner, so generated package trees must never
 * participate in Vitest discovery.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}']
  }
});
