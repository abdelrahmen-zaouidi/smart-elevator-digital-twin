import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Hermetic tests for POST /api/commands. We mock the Postgres layer and global
// fetch (Ditto reads/writes + n8n audit) so no live stack is needed. The point
// is to prove the ROUTE's contract around the deterministic gate — above all
// the architectural invariant: a REJECTED command performs zero Ditto writes.

vi.mock("../../../src/server/db.js", () => ({
  query: vi.fn(async () => ({ rows: [] })),
  queryRows: vi.fn(async () => []),
  ping: vi.fn(async () => ({ ok: true, latency_ms: 1 })),
}));

// Auth.js session is injected per-test via this mock. Default: no session
// (so the route falls back to the Basic / trusted-local principal).
let mockSession = null;
vi.mock("../../../auth.js", () => ({
  auth: vi.fn(async () => mockSession),
}));

const THING_ID = "building:floor1:elevator";

// A twin snapshot the gate treats as healthy + fresh (door closed, idle,
// no emergency). loadTwinSnapshot stamps last_telemetry_at itself.
function healthyTwin() {
  return {
    thingId: THING_ID,
    attributes: { system_mode: "NORMAL" },
    features: {
      cabin: { properties: { current_floor: 0, target_floor: 0, direction: "IDLE", emergency_stop: false, load_kg: 0 } },
      door: { properties: { state: "CLOSED" } },
      motor: { properties: { health_status: "GOOD" } },
    },
    _modified: new Date().toISOString(),
  };
}

// Build a fetch mock that answers the Ditto GET (twin load) and records any
// PUT (a Ditto write) + n8n POSTs. `putUrls` lets tests assert zero writes.
function installFetchMock({ twin = healthyTwin() } = {}) {
  const putUrls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    if (method === "GET" && String(url).includes("/api/2/things/")) {
      return { ok: true, status: 200, json: async () => twin, text: async () => "" };
    }
    if (method === "PUT") {
      putUrls.push(String(url));
      return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
    }
    // n8n audit POST or anything else
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  });
  return { putUrls };
}

function postRequest(body, headers = {}) {
  return new Request("http://localhost:3000/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

let route;
beforeEach(async () => {
  vi.resetModules();
  globalThis._rateBuckets?.clear(); // isolate rate-limit state between tests
  mockSession = null; // default: no Auth.js session
  // Trusted-local boundary: no dashboard password configured -> auth passes.
  delete process.env.DASHBOARD_BASIC_AUTH_PASS;
  process.env.DITTO_URL = "http://ditto.test:8080";
  process.env.PRIMARY_THING_ID = THING_ID;
  route = await import("./route.js");
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DASHBOARD_BASIC_AUTH_PASS;
});

describe("POST /api/commands", () => {
  it("rejects malformed JSON with 400", async () => {
    installFetchMock();
    const badReq = new Request("http://localhost:3000/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await route.POST(badReq);
    expect(res.status).toBe(400);
  });

  it("INVARIANT: a rejected command performs ZERO Ditto writes", async () => {
    const { putUrls } = installFetchMock();
    // target_floor out of range (MAX_FLOOR=3) -> deterministic gate rejection.
    const res = await route.POST(postRequest({
      command: "MOVE_TO_FLOOR",
      target_floor: 99,
      reason: "unit-test out-of-range",
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.accepted).toBe(false);
    expect(data.ditto_write_status).toBe("SKIPPED");
    expect(putUrls).toHaveLength(0); // the whole point
  });

  it("accepts a valid low-risk command and writes the pending_command intent", async () => {
    const { putUrls } = installFetchMock();
    const res = await route.POST(postRequest({
      command: "OPEN_DOOR",
      reason: "unit-test open",
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.accepted).toBe(true);
    // At least one PUT, and the command intent lands on the control feature.
    expect(putUrls.length).toBeGreaterThan(0);
    expect(putUrls.some((u) => u.includes("features/control/properties/pending_command"))).toBe(true);
  });

  it("requires authentication when a dashboard password is configured", async () => {
    // Reload the module with a password set so the auth branch is active.
    vi.resetModules();
    process.env.DASHBOARD_BASIC_AUTH_PASS = "s3cret";
    process.env.DASHBOARD_BASIC_AUTH_USER = "operator";
    const guarded = await import("./route.js");
    installFetchMock();
    const res = await guarded.POST(postRequest({ command: "OPEN_DOOR", reason: "x" }));
    expect(res.status).toBe(401);
  });

  it("RBAC: a viewer session is blocked with 403 BEFORE the gate (zero Ditto writes)", async () => {
    mockSession = { user: { id: "2", username: "view_test", role: "viewer" } };
    const { putUrls } = installFetchMock();
    const res = await route.POST(postRequest({ command: "OPEN_DOOR", reason: "rbac" }));
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error.message).toMatch(/viewer.*not permitted/i);
    expect(data.error.code).toBe("FORBIDDEN");
    expect(putUrls).toHaveLength(0);
  });

  it("returns the 400 VALIDATION envelope for a malformed command payload", async () => {
    installFetchMock();
    // `command` must be a non-empty string; here it is a number.
    const res = await route.POST(postRequest({ command: 123 }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION");
    expect(data.error.details).toBeTruthy();
  });

  it("rate-limits after the burst is exhausted (429 + Retry-After envelope)", async () => {
    installFetchMock();
    // Burst capacity is 5; the 6th command in a burst is limited.
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await route.POST(postRequest({ command: "OPEN_DOOR", reason: `burst-${i}` }));
    }
    const data = await last.json();
    expect(last.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMITED");
    expect(last.headers.get("Retry-After")).toBeTruthy();
  });

  it("RBAC: an operator session may issue commands and is attributed in the audit row", async () => {
    mockSession = { user: { id: "1", username: "op_test", role: "operator" } };
    const db = await import("../../../src/server/db.js");
    const { putUrls } = installFetchMock();
    const res = await route.POST(postRequest({ command: "OPEN_DOOR", reason: "rbac" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.accepted).toBe(true);
    expect(putUrls.length).toBeGreaterThan(0);
    // The control_command_log INSERT carries the authenticated identity
    // (username is the last-but-... param; assert the call included it).
    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO control_command_log"),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall[1]).toContain("op_test"); // username persisted
  });
});
