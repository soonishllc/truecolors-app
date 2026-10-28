import path from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    testTimeout: 60_000,
    env: {
      AI_PROVIDER: "mock",
      STORAGE_DIR: path.join(tmpdir(), "tc-studio-test-storage"),
      DESIGNER_AGREEMENT_VERSION: "v1",
      SHOPIFY_WEBHOOK_SECRET: "test-secret",
    },
  },
});
