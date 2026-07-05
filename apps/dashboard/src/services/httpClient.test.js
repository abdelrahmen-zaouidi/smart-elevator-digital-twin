import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJson } from "./httpClient.js";

// Deterministic backoff: make sleep() resolve immediately so retry tests are fast.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Helper: drive fetchJson to completion while auto-advancing timers (backoff).
async function run(promiseFactory) {
  const p = promiseFactory();
  await vi.runAllTimersAsync();
  return p;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("fetchJson", () => {
  it("returns { ok, status, data } on success", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { hello: "world" }));
    const res = await run(() => fetchJson("/x"));
    expect(res).toEqual({ ok: true, status: 200, data: { hello: "world" } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT throw on a 4xx and does not retry it", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { error: "bad" }));
    const res = await run(() => fetchJson("/x"));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent GET on a 5xx up to the default 2 retries (3 calls)", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    const res = await run(() => fetchJson("/x"));
    expect(res.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("recovers when a retried GET eventually succeeds", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const res = await run(() => fetchJson("/x"));
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("NEVER auto-retries a POST (idempotency safety)", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const res = await run(() => fetchJson("/x", { method: "POST" }));
    expect(res.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a POST only when the caller opts in via retries", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const res = await run(() => fetchJson("/x", { method: "POST", retries: 1 }));
    expect(res.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 + 1 explicit retry
  });

  it("retries an idempotent request on a transient network error, then rethrows", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    // Attach the rejection handler BEFORE flushing timers so the flush never
    // observes a momentarily-unhandled rejection.
    const p = fetchJson("/x");
    const assertion = expect(p).rejects.toThrow(/ECONNREFUSED/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("surfaces a timeout as an Error (abort mapped to a timeout message)", async () => {
    // fetch that rejects with an AbortError when signalled.
    global.fetch = vi.fn().mockImplementation((_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      }),
    );
    const p = fetchJson("/x", { timeoutMs: 50, retries: 0 });
    const assertion = expect(p).rejects.toThrow(/timeout after 50ms/);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
