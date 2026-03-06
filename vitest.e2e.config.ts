import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts", "test/e2e/**/*.e2e-spec.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
