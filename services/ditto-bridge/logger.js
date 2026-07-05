/**
 * Structured JSON logger for the bridge (pino).
 *
 * Emits one JSON object per line with the shared field convention:
 *   { ts, level, svc:"bridge", event?, thing_id?, command_id?, msg, ... }
 * so an operator can `grep '"command_id":"CMD-..."'` across bridge + dashboard
 * logs and reconstruct a command's whole lifecycle (WI-3).
 *
 * Ergonomics-preserving shim: the bridge's existing call sites are
 * `log.info(message, fieldsOrDetail?, ...rest)` — the same shape they used
 * with console.*. Rules:
 *   - a single object 2nd arg  -> merged as structured fields
 *   - any other extra args     -> joined into a `detail` string
 * pino's native signature is (mergeObject, message); this shim flips it so the
 * call sites did not need rewriting beyond `console.` -> `log.`.
 */
const pino = require("pino");

const base = pino({
  base: { svc: "bridge" },
  messageKey: "msg",
  // Emit `ts` (ISO-8601) instead of pino's default epoch `time`.
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  level: process.env.LOG_LEVEL || "info",
});

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

module.exports = {
  info: make("info"),
  warn: make("warn"),
  error: make("error"),
  debug: make("debug"),
  // Escape hatch for call sites that want native pino (child loggers, etc.).
  raw: base,
  child: (bindings) => base.child(bindings),
};
