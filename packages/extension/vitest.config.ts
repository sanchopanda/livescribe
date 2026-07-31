import { defineConfig } from 'vitest/config';

// Standalone config so tests don't pull in the crx/react build pipeline from vite.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
