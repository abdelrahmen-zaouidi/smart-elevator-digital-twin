import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// env.js reads process.env at module load, so each case sets env then does a
// fresh dynamic import with the module registry reset.
const KEYS = [
  "NEXT_PUBLIC_DITTO_URL", "VITE_DITTO_URL", "DITTO_URL",
  "NEXT_PUBLIC_THING_ID", "VITE_THING_ID", "THING_ID",
  "NEXT_PUBLIC_MQTT_ID", "PRIMARY_MQTT_ID",
  "NEXT_PUBLIC_MQTT_TELEMETRY_TOPIC", "MQTT_TELEMETRY_TOPIC",
];

beforeEach(() => {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

async function loadEnv() {
  return (await import("./env.js")).env;
}

describe("env config resolution", () => {
  it("falls back to safe localhost defaults", async () => {
    const env = await loadEnv();
    expect(env.DITTO_URL).toBe("http://localhost:8080");
    expect(env.THING_ID).toBe("building:floor1:elevator");
    expect(env.DITTO_PROXY_BASE).toBe("/api/ditto");
  });

  it("prefers NEXT_PUBLIC_DITTO_URL over DITTO_URL and strips trailing slash", async () => {
    process.env.DITTO_URL = "http://server:8080";
    process.env.NEXT_PUBLIC_DITTO_URL = "http://public:9090/";
    const env = await loadEnv();
    expect(env.DITTO_URL).toBe("http://public:9090");
  });

  it("derives the MQTT id from the thing id when not set explicitly", async () => {
    process.env.THING_ID = "building:floor2:elevator";
    const env = await loadEnv();
    expect(env.MQTT_ID).toBe("building-floor2-elevator");
  });

  it("derives the telemetry topic from the thing id", async () => {
    process.env.THING_ID = "building:floor2:elevator";
    const env = await loadEnv();
    expect(env.MQTT_TELEMETRY_TOPIC).toBe("elevator/building-floor2-elevator/telemetry");
  });

  it("builds a percent-encoded Ditto SSE path for the thing", async () => {
    process.env.THING_ID = "building:floor1:elevator";
    const env = await loadEnv();
    expect(env.DITTO_EVENTS_PATH).toContain(encodeURIComponent("building:floor1:elevator"));
  });
});
