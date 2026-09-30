import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/setup/global-setup.js'],
    setupFiles: ['tests/setup/worker-env.js'],
    // Integration tests share one database and mutate specific fixture users.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 300_000,
  },
});
