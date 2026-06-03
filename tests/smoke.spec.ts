import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`console: ${message.text()}`);
    }
  });
  return consoleErrors;
}

test.describe("dev SPA smoke", () => {
  test("dashboard renders without browser errors", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Local Audio Device Sync" })).toBeVisible();
    await expect(page.getByText("Demo Mode: no real downloads or devices used.")).toBeVisible();
    await expect(page.getByText("Live Activity")).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("dashboard updates from SSE without refresh", async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByText("Device status:")).toBeVisible();

    await expect
      .poll(
        async () => {
          await request.post("/api/debug/live", {
            data: {
              deviceStatus: {
                connected: true,
                writable: true,
                volumeName: "TEST-PLAYER",
                mountPath: "/Volumes/TEST-PLAYER",
                reason: null
              },
              deviceReadyForExport: true,
              safeToDisconnect: true
            }
          });
          return page.getByText("connected (TEST-PLAYER)").isVisible();
        },
        { timeout: 10_000 }
      )
      .toBeTruthy();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("channels and runs routes render directly", async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Tracked Sources" })).toBeVisible();

    await page.goto("/runs");
    await expect(page.getByRole("heading", { name: "Sync Runs" })).toBeVisible();

    const channelsResponse = await request.get("/api/channels");
    const channelsJson = (await channelsResponse.json()) as {
      channels: Array<{ handle: string }>;
    };

    if (channelsJson.channels.length > 0) {
      const firstChannel = channelsJson.channels[0];
      await page.goto(`/channels/${encodeURIComponent(firstChannel.handle)}`);
      await expect(page.getByRole("button", { name: "Sync This Channel" })).toBeVisible();
    }

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("reviewer can add a source in demo mode", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/channels");
    await page.getByLabel("Source handle or URL").fill("@demo-new-source");
    await page.getByRole("button", { name: "Add Source" }).click();

    await expect(page.getByText("Source added: demo-new-source")).toBeVisible();
    await expect(page.getByRole("link", { name: "@demo-new-source", exact: true })).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("reviewer can remove a source in demo mode", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/channels");
    await page.getByLabel("Source handle or URL").fill("@demo-remove-source");
    await page.getByRole("button", { name: "Add Source" }).click();
    await expect(page.getByRole("link", { name: "@demo-remove-source", exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("row", { name: /@demo-remove-source/ })
      .getByRole("button", { name: "Remove" })
      .click();

    await expect(page.getByText("Source removed: demo-remove-source")).toBeVisible();
    await expect(page.getByRole("link", { name: "@demo-remove-source", exact: true })).toHaveCount(0);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("demo refresh creates downloaded items without external tools", async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Refresh Library", exact: true }).click();

    await expect
      .poll(
        async () => {
        const response = await request.get("/api/dashboard");
        const dashboard = (await response.json()) as {
          channels: Array<{ handle: string; downloaded_videos: number }>;
          syncState: { library: { running: boolean } };
        };
        const downloaded = dashboard.channels.reduce((sum, channel) => sum + channel.downloaded_videos, 0);
        return !dashboard.syncState.library.running && downloaded > 1;
        },
        { timeout: 20_000 }
      )
      .toBeTruthy();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("demo sync exports queued files to fake player", async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);

    await request.post("/api/sync");
    await expect
      .poll(
        async () => {
        const response = await request.get("/api/live");
        const live = (await response.json()) as {
          state: { library: { running: boolean } };
          pendingExport: unknown[];
        };
        return live.state.library.running ? -1 : live.pendingExport.length;
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sync Player", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Sync Player", exact: true }).click();

    await expect
      .poll(
        async () => {
        const response = await request.get("/api/live");
        const live = (await response.json()) as {
          state: { player: { running: boolean; lastSummary: string | null } };
          pendingExport: unknown[];
        };
        return {
          running: live.state.player.running,
          pending: live.pendingExport.length,
          summary: live.state.player.lastSummary
        };
        },
        { timeout: 20_000 }
      )
      .toEqual(expect.objectContaining({ running: false, pending: 0 }));

    await expect(page.locator(".sync-notification-summary").getByText(/Synced \d+ tracks? to player/)).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("device-not-mounted recovery state is visible", async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/");
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

    await expect(page.getByText("not connected")).toBeVisible();
    await expect(page.getByText("Detection note: Demo player is not mounted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync Player", exact: true })).toBeDisabled();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("invalid detail routes show not-found states", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const missingApiResponses: Array<{ url: string; status: number }> = [];

    page.on("response", (response) => {
      const url = response.url();
      if (response.status() === 404 && (url.includes("/api/channels/") || url.includes("/api/runs/"))) {
        missingApiResponses.push({
          url,
          status: response.status()
        });
      }
    });

    await page.goto("/channels/this-channel-should-not-exist");
    await expect(page.getByRole("heading", { name: "Unknown channel" })).toBeVisible();

    await page.goto("/runs/999999999");
    await expect(page.getByRole("heading", { name: "Run not found" })).toBeVisible();

    expect(
      missingApiResponses.some((response) => response.url.includes("/api/channels/this-channel-should-not-exist"))
    ).toBeTruthy();
    expect(missingApiResponses.some((response) => response.url.includes("/api/runs/999999999"))).toBeTruthy();
    expect(
      consoleErrors.filter((message) => message !== "console: Failed to load resource: the server responded with a status of 404 (Not Found)"),
      consoleErrors.join("\n")
    ).toEqual([]);
  });
});
