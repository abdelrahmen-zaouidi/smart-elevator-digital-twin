/**
 * Prometheus metrics for the bridge (prom-client) + a tiny HTTP server that
 * exposes GET /metrics and GET /health on an internal port (default 9464).
 *
 * This is the bridge's FIRST listening port. It is published only on the
 * compose network for Prometheus to scrape in-network; it exposes read-only
 * telemetry counters, no control surface. See docker-compose.yml (bridge
 * ports + healthcheck) and infra/prometheus/prometheus.yml.
 */
const http = require("http");
const client = require("prom-client");

const register = new client.Registry();
register.setDefaultLabels({ svc: "bridge" });
client.collectDefaultMetrics({ register });

// --- Domain metrics ---------------------------------------------------------
const telemetryMessages = new client.Counter({
  name: "bridge_ingest_messages_total",
  help: "MQTT messages ingested by the bridge, by topic type",
  labelNames: ["type"], // telemetry | events | status
  registers: [register],
});

const dittoMergeDuration = new client.Histogram({
  name: "bridge_ditto_merge_duration_seconds",
  help: "Latency of a Ditto merge-patch write (the single-thing write bottleneck)",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

const dittoMergeTotal = new client.Counter({
  name: "bridge_ditto_merge_total",
  help: "Ditto merge-patch outcomes",
  labelNames: ["result"], // written | skipped | failed
  registers: [register],
});

const commandLifecycle = new client.Counter({
  name: "bridge_command_lifecycle_total",
  help: "Command lifecycle transitions observed by the bridge",
  labelNames: ["event"], // intent_forwarded | mqtt_published | ack_received | ack_timeout | dropped
  registers: [register],
});

const mqttReconnects = new client.Counter({
  name: "bridge_mqtt_reconnects_total",
  help: "MQTT reconnection attempts",
  registers: [register],
});

// --- Tiny HTTP server -------------------------------------------------------
function startMetricsServer(port = Number(process.env.METRICS_PORT || 9464), log = console) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      try {
        res.setHeader("Content-Type", register.contentType);
        res.end(await register.metrics());
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
      return;
    }
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", svc: "bridge" }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(port, () => {
    if (log.info) log.info("metrics server listening", { event: "metrics_listen", port });
  });
  server.unref(); // never keep the process alive on its own
  return server;
}

module.exports = {
  register,
  startMetricsServer,
  telemetryMessages,
  dittoMergeDuration,
  dittoMergeTotal,
  commandLifecycle,
  mqttReconnects,
};
