import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Every worker provisions a fresh migrated temp SQLite database BEFORE
    // any test module loads, so even static `import { db }` binds the
    // isolated database and never dev.db. See src/test-setup.ts.
    // globalSetup tears down exactly this run's manifest-recorded databases.
    setupFiles: ["./src/test-setup.ts"],
    globalSetup: ["./src/test-global-setup.ts"],
    // Isolated-DB suites (tenant-isolation, buyer-ownership) apply real
    // migrations to a temp SQLite file in beforeAll; allow headroom under
    // parallel load so slow CI does not flake on the default 10s hook budget.
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
