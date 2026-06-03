import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const screenshotDir = "artifacts/screenshots";

async function capture(page: Page, name: string): Promise<void> {
  await page.locator("body").screenshot({
    path: `${screenshotDir}/${name}.png`,
    animations: "disabled"
  });
}

test.describe("portfolio screenshots", () => {
  test.setTimeout(60_000);

  test.beforeAll(() => {
    mkdirSync(screenshotDir, { recursive: true });
  });

  test("captures demo portfolio states", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Local Audio Device Sync" })).toBeVisible();
    await page.getByRole("button", { name: "Screenshot" }).click();
    await capture(page, "01-dashboard-empty-state");

    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Tracked Sources" })).toBeVisible();
    await page.getByRole("button", { name: "Screenshot" }).click();
    await capture(page, "02-source-management");

    await page.goto("/");
    await page.getByRole("button", { name: "Screenshot" }).click();
    await page.getByRole("button", { name: "Refresh Library", exact: true }).click();
    await expect(page.getByText(/Downloading Demo live item/)).toBeVisible({ timeout: 10_000 });
    await capture(page, "03-refresh-progress");

    await expect
      .poll(
        async () => {
          const response = await request.get("/api/live");
          const live = (await response.json()) as {
            state: { library: { running: boolean } };
            pendingExport: unknown[];
          };
          return !live.state.library.running && live.pendingExport.length > 0;
        },
        { timeout: 20_000 }
      )
      .toBeTruthy();

    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.getByRole("button", { name: "Sync Player", exact: true }).click();
    await expect(page.getByText(/Copying/)).toBeVisible({ timeout: 10_000 });
    await capture(page, "04-player-sync");

    await expect
      .poll(
        async () => {
          const response = await request.get("/api/live");
          const live = (await response.json()) as { state: { player: { running: boolean } } };
          return !live.state.player.running;
        },
        { timeout: 20_000 }
      )
      .toBeTruthy();

    await page.goto("/channels/demo-recovery");
    await expect(page.getByRole("heading", { name: "@demo-recovery" })).toBeVisible();
    await page.getByRole("button", { name: "Screenshot" }).click();
    await capture(page, "05-recovery-state");

    await page.goto("/");
    await page.getByRole("button", { name: "Screenshot" }).click();
    await request.post("/api/debug/live", {
      data: {
        deviceStatus: {
          connected: false,
          writable: false,
          volumeName: "DEMO-PLAYER",
          mountPath: null,
          reason: "Demo player is not mounted"
        },
        deviceReadyForExport: false,
        safeToDisconnect: false
      }
    });
    await expect(page.getByText("Detection note: Demo player is not mounted")).toBeVisible();
    await capture(page, "06-device-not-mounted");
  });
});
