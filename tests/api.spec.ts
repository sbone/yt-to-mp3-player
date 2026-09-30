import { expect, test } from "@playwright/test";
import { getDashboard } from "../src/client/api.js";

for (const [body, message] of [["upstream unavailable", "upstream unavailable"], ['{"message":"Try again"}', "Try again"], ["", "Request failed with status 502"]]) {
  test(`API preserves error response: ${message}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(body, { status: 502 });
    try {
      await expect(getDashboard()).rejects.toMatchObject({ name: "Error", message, status: 502 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
