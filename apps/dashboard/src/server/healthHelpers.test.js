import { describe, it, expect } from "vitest";
import { deriveBridge, overallStatus } from "./healthHelpers.js";

const OFFLINE = 15000;

describe("deriveBridge", () => {
  it("is degraded when Ditto is not ok", () => {
    const r = deriveBridge({ status: "down" }, OFFLINE);
    expect(r.status).toBe("degraded");
    expect(r.detail).toMatch(/Ditto unreachable/);
  });

  it("is degraded when the twin has no telemetry timestamps yet", () => {
    const r = deriveBridge({ status: "ok", thing: { features: {} } }, OFFLINE);
    expect(r.status).toBe("degraded");
    expect(r.detail).toMatch(/no telemetry timestamps/);
  });

  it("is ok when the twin is fresh (within 2x offline window)", () => {
    const now = 1_000_000_000_000;
    const thing = {
      features: { microcontroller: { properties: { last_telemetry_at: new Date(now - 3000).toISOString() } } },
    };
    const r = deriveBridge({ status: "ok", thing }, OFFLINE, now);
    expect(r.status).toBe("ok");
    expect(r.detail).toMatch(/bridge merging/);
  });

  it("is degraded when telemetry is older than 2x the offline window", () => {
    const now = 1_000_000_000_000;
    const thing = {
      features: { microcontroller: { properties: { last_status_at: new Date(now - 60000).toISOString() } } },
    };
    const r = deriveBridge({ status: "ok", thing }, OFFLINE, now);
    expect(r.status).toBe("degraded");
    expect(r.detail).toMatch(/device offline or bridge down/);
  });
});

describe("overallStatus", () => {
  it("is ok only when every check is ok", () => {
    expect(overallStatus({
      ditto: { status: "ok" }, bridge: { status: "ok" }, mqtt: { status: "ok" },
      postgres: { status: "ok" }, n8n: { status: "ok" },
    })).toBe("ok");
  });

  it("is down only when BOTH ditto and mqtt are down", () => {
    expect(overallStatus({
      ditto: { status: "down" }, bridge: { status: "degraded" }, mqtt: { status: "down" },
      postgres: { status: "ok" }, n8n: { status: "ok" },
    })).toBe("down");
  });

  it("is degraded when only some checks are down", () => {
    expect(overallStatus({
      ditto: { status: "ok" }, bridge: { status: "ok" }, mqtt: { status: "down" },
      postgres: { status: "ok" }, n8n: { status: "ok" },
    })).toBe("degraded");
  });
});
