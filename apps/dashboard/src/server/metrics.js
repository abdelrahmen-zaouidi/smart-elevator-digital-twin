/**
 * Prometheus metrics registry for the dashboard's server routes (prom-client).
 * Exposed at GET /api/system/metrics. Server-side only.
 *
 * A single registry survives Next.js hot reloads via globalThis (like db.js).
 */
import client from "prom-client";

const g = globalThis;
if (!g._dashboardMetrics) {
  const register = new client.Registry();
  register.setDefaultLabels({ svc: "dashboard" });
  client.collectDefaultMetrics({ register });

  const gateDecisions = new client.Counter({
    name: "dashboard_gate_decisions_total",
    help: "Command safety-gate decisions",
    labelNames: ["verdict", "command"], // verdict: accepted | rejected
    registers: [register],
  });

  const commandRoundtrip = new client.Histogram({
    name: "dashboard_gate_admission_seconds",
    help: "Latency from POST /api/commands receipt to the safety-gate verdict (twin load + gate)",
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    labelNames: ["accepted"],
    registers: [register],
  });

  const healthProbe = new client.Gauge({
    name: "dashboard_health_probe_status",
    help: "Latest /api/system/health probe status (1=ok, 0.5=degraded, 0=down)",
    labelNames: ["dependency"],
    registers: [register],
  });

  g._dashboardMetrics = { register, gateDecisions, commandRoundtrip, healthProbe };
}

export const metrics = g._dashboardMetrics;

const STATUS_VALUE = { ok: 1, degraded: 0.5, down: 0 };

/** Record a health payload's per-dependency statuses as gauges. */
export function recordHealth(payload) {
  if (!payload || !payload.checks) return;
  for (const [dependency, check] of Object.entries(payload.checks)) {
    metrics.healthProbe.set({ dependency }, STATUS_VALUE[check.status] ?? 0);
  }
}
