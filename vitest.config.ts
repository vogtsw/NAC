import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "node_modules",
      "dist",
      "tests/basic.test.ts",
      "tests/core-validation.test.ts",
      "tests/integration.test.ts",
      "tests/integration-quick.test.ts",
      "tests/web-search-fallback.test.ts",
      "tests/scripts/**",
      "tests/e2e/**",
      "tests/integration/**",
      "tests/unit/**",
      "tests/cases/**",
      "tests/fixtures/**",
    ],
    environment: "node",
    testTimeout: 30000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**", "src/api/**"],
    },
  },
});
