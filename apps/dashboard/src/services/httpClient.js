/**
 * Shared browser fetch helper: per-request timeout + safe retry/backoff.
 *
 * Retry policy is HTTP-idempotency aware so we never double-execute a
 * state-changing call:
 *   - GET / HEAD / PUT / DELETE  → retried on transient failures (network
 *     error, timeout, 5xx) with exponential backoff. PUT/DELETE are idempotent
 *     by HTTP semantics, so a replay is safe.
 *   - POST                       → NOT retried by default (a timed-out POST may
 *     have already been processed server-side). Callers that know a POST is
 *     safe to replay can pass `retries` explicitly.
 *
 * Always resolves to { ok, status, data } or throws on network/timeout — the
 * caller owns its result-envelope shape.
 */

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const TRANSIENT = /timeout|abort|Failed to fetch|NetworkError|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson(url, options = {}) {
  const { timeoutMs = 8000, retries, retryBackoffMs = 300, ...fetchOptions } = options;
  const method = (fetchOptions.method || "GET").toUpperCase();
  const maxRetries = Number.isInteger(retries) ? retries : (IDEMPOTENT_METHODS.has(method) ? 2 : 0);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await response.json().catch(() => ({}));

      // Retry idempotent requests on a transient server error.
      if (!response.ok && response.status >= 500 && attempt < maxRetries) {
        await sleep(retryBackoffMs * (attempt + 1));
        continue;
      }

      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      clearTimeout(timer);
      lastError = error?.name === "AbortError" ? new Error(`timeout after ${timeoutMs}ms`) : error;
      const transient = error?.name === "AbortError" || TRANSIENT.test(error?.message || "");
      if (attempt < maxRetries && transient) {
        await sleep(retryBackoffMs * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}
