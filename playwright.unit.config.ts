import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/deviceReconcile.spec.ts", "**/syncService.spec.ts", "**/api.spec.ts"],
  workers: 1
});
