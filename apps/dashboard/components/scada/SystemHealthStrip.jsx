// Compact platform-health chips for the ElevatorOS top bar.
// Read-only view over GET /api/system/health (5 s server cache); polls every
// 15 s via the shared fetchJson helper and silently degrades to a single
// muted chip when the endpoint itself is unreachable.

import { useEffect, useState } from "react";
import { T } from "../../src/theme/tokens";
import { fetchJson } from "../../src/services/httpClient";

const POLL_MS = 15_000;
const ORDER = ["ditto", "bridge", "mqtt", "postgres", "n8n"];
const LABELS = { ditto: "DITTO", bridge: "BRIDGE", mqtt: "MQTT", postgres: "PG", n8n: "N8N" };

const statusColor = (status) =>
  status === "ok" ? T.green : status === "degraded" ? T.yellow : status === "down" ? T.red : T.border;

function Chip({ label, status, title }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        opacity: status === "unknown" ? 0.55 : 0.9,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: statusColor(status),
          boxShadow: status === "ok" ? `0 0 4px ${T.green}` : "none",
        }}
      />
      {label}
    </span>
  );
}

export default function SystemHealthStrip() {
  const [health, setHealth] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { ok, data } = await fetchJson("/api/system/health", { timeoutMs: 6000 });
        if (cancelled) return;
        if (ok && data?.checks) {
          setHealth(data);
          setUnavailable(false);
        } else {
          setUnavailable(true);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (unavailable && !health) {
    return <Chip label="HEALTH n/a" status="unknown" title="Platform health endpoint unreachable" />;
  }
  if (!health) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "3px 10px",
        borderRadius: 999,
        border: `1px solid ${T.border}`,
      }}
      aria-label={`Platform health: ${health.status}`}
    >
      {ORDER.map((key) => {
        const check = health.checks[key] || { status: "unknown", detail: "no data" };
        const latency = Number.isFinite(check.latency_ms) ? ` (${check.latency_ms}ms)` : "";
        return (
          <Chip
            key={key}
            label={LABELS[key]}
            status={unavailable ? "unknown" : check.status}
            title={`${LABELS[key]}: ${check.status}${latency} — ${check.detail || ""}`}
          />
        );
      })}
    </span>
  );
}
