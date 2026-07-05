/**
 * Uniform API error envelope: every non-2xx JSON response uses
 *   { error: { code, message, details? } }
 * so clients (and the OpenAPI spec) get one predictable error shape.
 * Success response shapes are unchanged.
 */
import { NextResponse } from "next/server";

/** Build an error envelope response. */
export function apiError(status, code, message, details) {
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status });
}

// Common shortcuts.
export const badRequest = (message, details) => apiError(400, "BAD_REQUEST", message, details);
export const validationError = (message, details) => apiError(400, "VALIDATION", message, details);
export const unauthorized = (message = "Authentication required", headers) =>
  NextResponse.json({ error: { code: "UNAUTHORIZED", message } }, { status: 401, headers });
export const forbidden = (message) => apiError(403, "FORBIDDEN", message);
export const rateLimited = (message, retryAfterSeconds) =>
  NextResponse.json(
    { error: { code: "RATE_LIMITED", message } },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
export const serviceUnavailable = (message, details) => apiError(503, "UNAVAILABLE", message, details);
