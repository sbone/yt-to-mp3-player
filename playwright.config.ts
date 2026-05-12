import { defineConfig } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 3100);
const clientPort = Number(process.env.PLAYWRIGHT_CLIENT_PORT ?? 4173);
const appOrigin = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: appOrigin,
    headless: true
  },
  webServer: {
    command: `PORT=${appPort} DEV_CLIENT_PORT=${clientPort} API_PROXY_TARGET=${appOrigin} npm run dev`,
    url: appOrigin,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
