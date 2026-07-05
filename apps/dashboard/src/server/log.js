/**
 * Server-side structured logger for the dashboard API routes (pino).
 *
 * Same JSON convention as the bridge's logger
 * (services/ditto-bridge/logger.js): `{ ts, level, svc, event?, thing_id?,
 * command_id?, msg, ... }`. A command carries the SAME command_id from the
 * dashboard gate through to the bridge, so one
 * `grep '"command_id":"CMD-..."'` across both services' logs reconstructs the
 * full lifecycle (WI-3).
 *
 * NEVER import this from client-side code — server routes only (like db.js).
 */
import pino from "pino";

// One instance across hot reloads in dev.
const g = globalThis;
if (!g._dashboardLogger) {
  g._dashboardLogger = pino({
    base: { svc: "dashboard" },
    messageKey: "msg",
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    level: process.env.LOG_LEVEL || "info",
  });
}

const base = g._dashboardLogger;

function fieldsFrom(rest) {
  if (rest.length === 0) return {};
  if (rest.length === 1 && rest[0] && typeof rest[0] === "object" && !(rest[0] instanceof Error)) {
    return rest[0];
  }
  const detail = rest
    .map((r) => (r instanceof Error ? r.message : typeof r === "object" ? JSON.stringify(r) : String(r)))
    .join(" ");
  return { detail };
}

function make(level) {
  return (msg, ...rest) => base[level](fieldsFrom(rest), typeof msg === "string" ? msg : String(msg));
}

export const log = {
  info: make("info"),
  warn: make("warn"),
  error: make("error"),
  debug: make("debug"),
};
