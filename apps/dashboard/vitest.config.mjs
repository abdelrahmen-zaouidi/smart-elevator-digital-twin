import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node environment: these suites cover pure logic + server route handlers,
// no DOM. Route tests mock pg/fetch at the module boundary and stay hermetic
// (no live Ditto / Postgres / MQTT needed).
// Pin root to this file's dir so the suite resolves the same whether invoked
// from apps/dashboard (npx vitest) or from the repo root via --config.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    globals: true,
    // Route tests import pino (via src/server/log.js). pino's stream can
    // destabilize tinypool's thread workers ("Worker exited unexpectedly");
    // run tests in a single forked process instead — deterministic + fast.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    include: [
      "src/**/*.test.{js,mjs}",
      "app/**/*.test.{js,mjs}",
    ],
    // Route tests set process.env before a dynamic import(); isolate modules
    // so env/mocks from one file never leak into another.
    isolate: true,
    restoreMocks: true,
  },
});
