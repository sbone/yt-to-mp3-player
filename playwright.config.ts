import { defineConfig } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 3100);
const clientPort = Number(process.env.PLAYWRIGHT_CLIENT_PORT ?? 4173);
const production = process.env.PLAYWRIGHT_PRODUCTION === "1";
const appOrigin = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.PLAYWRIGHT_SCREENSHOTS === "1" ? "**/screenshots.spec.ts" : "**/smoke.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: appOrigin,
    headless: true
  },
  webServer: {
    command: `${production ? "npm run build && " : ""}DEMO_MODE=1 DEMO_RESET=1 PORT=${appPort} DEV_CLIENT_PORT=${clientPort} API_PROXY_TARGET=${appOrigin} ENABLE_TEST_API=1 npm run ${production ? "start" : "dev"}`,
    url: appOrigin,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
