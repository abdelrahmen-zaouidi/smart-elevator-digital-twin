/**
 * In-memory token-bucket rate limiter.
 *
 * LIMITATION: process-local state — correct for the single-instance host
 * deployment only. A multi-instance deployment would need a shared store
 * (Redis). Documented here on purpose; the safety gate's own per-command
 * cooldown is a separate, deterministic layer and is unaffected.
 */
const buckets = (globalThis._rateBuckets ||= new Map());

/**
 * @param {string} key           bucket identity (e.g. `${user}:${ip}`)
 * @param {number} capacity      burst size (max tokens)
 * @param {number} refillPerSec  sustained rate (tokens added per second)
 * @returns {{ allowed: boolean, retryAfter: number }}
 */
export function takeToken(key, capacity, refillPerSec) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
  }
  // Refill based on elapsed time.
  const elapsedSec = (now - b.last) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
  b.last = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfter: 0 };
  }
  const deficit = 1 - b.tokens;
  return { allowed: false, retryAfter: Math.ceil(deficit / refillPerSec) };
}

/** Test helper: clear all buckets. */
export function _resetRateLimiter() {
  buckets.clear();
}
