import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    testTimeout: 120000, // 120 seconds timeout for E2E tests
    hookTimeout: 60000,   // 60 seconds for hooks
    teardownTimeout: 30000, // 30 seconds teardown
    // Environment variables for tests
    env: {
      NODE_ENV: 'test',
      USE_MEMORY_STORE: 'true', // Force in-memory mode
      LOG_LEVEL: 'error', // Reduce log noise in tests
    },
    // Setup files to run before tests
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
    // Resolve configuration for .ts files
    resolve: {
      extensions: ['.ts', '.js', '.json'],
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
    // Global fixtures
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run tests in a single process for consistency
      },
    },
  },
});
