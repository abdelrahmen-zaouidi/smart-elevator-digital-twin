import { defineConfig, devices } from "@playwright/test";

// Smoke-only Playwright config. This runs against a LIVE local stack, not in
// CI's hermetic runners — there is no Ditto stack in CI. Prerequisites:
//   1. Eclipse Ditto stack running (separate compose)
//   2. docker compose --profile demo up -d   (seeded simulator + twin)
//   3. cd apps/dashboard && npm run dev       (or set E2E_BASE_URL)
// Basic-auth demo gate: if apps/dashboard/.env.local sets
// DASHBOARD_BASIC_AUTH_PASS, export E2E_BASIC_USER / E2E_BASIC_PASS so the
// browser sends credentials.
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const httpCredentials =
  process.env.E2E_BASIC_USER && process.env.E2E_BASIC_PASS
    ? { username: process.env.E2E_BASIC_USER, password: process.env.E2E_BASIC_PASS }
    : undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    httpCredentials,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
