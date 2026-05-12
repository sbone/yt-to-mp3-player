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
    await expect(page.getByRole("heading", { name: "Channel Sync Dashboard" })).toBeVisible();
    await expect(page.getByText("Live Activity")).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("channels and runs routes render directly", async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Tracked Channels" })).toBeVisible();

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
