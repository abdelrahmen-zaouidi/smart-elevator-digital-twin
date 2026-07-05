import { test, expect } from "@playwright/test";

// Single smoke test against a LIVE local stack (see playwright.config.ts).
// It is NOT run in CI's hermetic runners — there is no Ditto stack there.
// Run locally:  npm run e2e   (after demo mode + `npm run dev`).
test("ElevatorOS boots, logs in, and shows live platform state", async ({ page }) => {
  await page.goto("/");

  // Local demo lock screen: any username/password unlocks the session.
  await expect(page.getByRole("heading", { name: "ElevatorOS" })).toBeVisible();
  await page.getByLabel("Email or username").fill("e2e-operator");
  await page.getByLabel("Password").fill("e2e-pass");
  await page.getByRole("button", { name: "Login" }).click();

  // Top bar renders after login: the connection indicators + health strip.
  await expect(page.getByText("ESP32-S3")).toBeVisible({ timeout: 15_000 });

  // The SystemHealthStrip renders at least one dependency chip.
  await expect(page.getByText(/DITTO|PG|MQTT/).first()).toBeVisible({ timeout: 15_000 });

  // Live twin state: a floor label / value is present somewhere on the page.
  await expect(page.locator("body")).toContainText(/floor/i, { timeout: 15_000 });
});
