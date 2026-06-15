"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, ShieldX, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import ChartCard from "./ChartCard";

/**
 * Command Safety Gate panel.
 *
 * Displays the most recent deterministic safety-gate decisions across all
 * command sources (dashboard, n8n, operator, system). For each decision the
 * panel shows the full safety snapshot, the rejection trace, and the Ditto
 * write outcome so a jury can see exactly why a command was admitted or
 * blocked.
 *
 * Architectural note (must stay visible on the panel): AI / n8n can propose
 * commands, but the deterministic safety gate decides whether they execute.
 * The LLM is never authoritative.
 */

const DECISION_FILTERS = ["all", "ACCEPTED", "REJECTED", "FAILED", "PENDING"];
const SOURCE_FILTERS = ["all", "dashboard", "n8n", "operator", "system"];

const SEVERITY_BADGE = {
  ACCEPTED: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  REJECTED: "bg-red-900/40 text-red-300 border-red-700",
  FAILED:   "bg-orange-900/40 text-orange-300 border-orange-700",
  PENDING:  "bg-amber-900/40 text-amber-300 border-amber-700",
};

const SOURCE_BADGE = {
  dashboard: "bg-cyan-900/40 text-cyan-300 border-cyan-700",
  n8n:       "bg-purple-900/40 text-purple-300 border-purple-700",
  operator:  "bg-blue-900/40 text-blue-300 border-blue-700",
  system:    "bg-gray-800 text-gray-300 border-gray-700",
};

function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

function DecisionBadge({ decision }) {
  const variant = SEVERITY_BADGE[decision] || SEVERITY_BADGE.PENDING;
  const Icon = decision === "ACCEPTED" ? CheckCircle2 : decision === "REJECTED" ? XCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide ${variant}`}>
      <Icon size={11} />
      {decision || "PENDING"}
    </span>
  );
}

function SourceBadge({ source }) {
  const variant = SOURCE_BADGE[source] || SOURCE_BADGE.system;
  return (
    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-mono ${variant}`}>
      {source}
    </span>
  );
}

function RowExpanded({ row }) {
  const snap = row.safety_snapshot || {};
  const reasons = Array.isArray(row.rejection_reasons) ? row.rejection_reasons : [];
  const ditto = Array.isArray(row.ditto_payload) ? row.ditto_payload : [];

  return (
    <div className="mt-2 border-t border-gray-800 pt-3 text-xs text-gray-300 space-y-3">
      {reasons.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-red-300 mb-1">
            Rejection Reasons
          </div>
          <ul className="space-y-0.5">
            {reasons.map((r, idx) => (
              <li key={idx} className="font-mono text-red-200">{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
        <div><span className="text-gray-500">Floor:</span> {snap.current_floor ?? "—"} {row.target_floor != null && <span className="text-gray-500">→ {row.target_floor}</span>}</div>
        <div><span className="text-gray-500">Door:</span> {snap.door_state ?? "—"}</div>
        <div><span className="text-gray-500">Load:</span> {snap.load_kg != null ? `${Math.round(snap.load_kg)} kg` : "—"}</div>
        <div><span className="text-gray-500">E-Stop:</span> {snap.emergency_stop === true ? "ACTIVE" : snap.emergency_stop === false ? "clear" : "—"}</div>
        <div><span className="text-gray-500">Mode:</span> {row.system_mode ?? snap.system_mode ?? "—"}</div>
        <div><span className="text-gray-500">Alert:</span> {snap.alert_level ?? "—"}</div>
        <div><span className="text-gray-500">Risk:</span> {row.risk_score ?? "—"}</div>
        <div><span className="text-gray-500">Ditto:</span> {row.ditto_write_status ?? "—"}</div>
      </div>

      {ditto.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 mb-1">
            Planned Ditto Writes
          </div>
          <ul className="space-y-0.5 font-mono">
            {ditto.map((w, idx) => (
              <li key={idx}>
                <span className="text-cyan-300">{w.path}</span>{" "}
                <span className="text-gray-500">=</span>{" "}
                <span className="text-emerald-200">{JSON.stringify(w.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px] text-gray-500 font-mono">
        <div>cmd_id: <span className="text-gray-300">{row.command_id}</span></div>
        <div>corr_id: <span className="text-gray-300">{row.correlation_id}</span></div>
        <div>audit: <span className="text-gray-300">{row.audit_status ?? "—"}</span></div>
        {row.error_message && (
          <div className="col-span-2 md:col-span-3">err: <span className="text-orange-300">{row.error_message}</span></div>
        )}
      </div>
    </div>
  );
}

function CommandRow({ row }) {
  const [open, setOpen] = useState(false);
  const accent =
    row.decision === "ACCEPTED" ? "border-l-emerald-700"
    : row.decision === "REJECTED" ? "border-l-red-700"
    : row.decision === "FAILED"   ? "border-l-orange-700"
    : "border-l-amber-700";

  return (
    <div className={`bg-gray-950/60 border border-gray-800 ${accent} border-l-4 rounded-lg p-3 hover:border-gray-700 transition`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          <DecisionBadge decision={row.decision} />
          <SourceBadge source={row.source || "—"} />
          <span className="font-mono text-xs font-bold text-gray-100 truncate">{row.command}</span>
          {row.target_floor != null && (
            <span className="text-[10px] text-gray-500 font-mono">→ floor {row.target_floor}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono shrink-0">
          <span title={row.requested_by}>{row.source_agent || row.requested_by || "—"}</span>
          <span title={row.created_at}>{relativeTime(row.created_at)}</span>
        </div>
      </button>
      {open && <RowExpanded row={row} />}
    </div>
  );
}

export default function CommandSafetyGatePanel({ thingId, refreshIntervalMs = 5000 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [lastFetch, setLastFetch] = useState(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (thingId) params.set("thing_id", thingId);
      params.set("limit", "30");
      if (decisionFilter !== "all") params.set("decision", decisionFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      const response = await fetch(`/api/commands/recent?${params.toString()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error || `HTTP ${response.status}`);
        setRows([]);
      } else {
        setError(null);
        setRows(body.data || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLastFetch(new Date());
    }
  }, [thingId, decisionFilter, sourceFilter]);

  useEffect(() => {
    fetchRows();
    if (refreshIntervalMs > 0) {
      const id = setInterval(fetchRows, refreshIntervalMs);
      return () => clearInterval(id);
    }
    return undefined;
  }, [fetchRows, refreshIntervalMs]);

  const counts = useMemo(() => {
    const c = { ACCEPTED: 0, REJECTED: 0, FAILED: 0, PENDING: 0 };
    for (const r of rows) {
      const k = r.decision || "PENDING";
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [rows]);

  return (
    <ChartCard
      title="Command Safety Gate"
      icon={<ShieldCheck size={16} className="text-emerald-400 inline" />}
      subtitle="Deterministic admission control for every operator and agent command. Rule-based; LLM is non-authoritative."
    >
      {/* Authority banner */}
      <div className="-mt-2 mb-4 bg-gray-950 border border-emerald-900/40 rounded-lg px-3 py-2 flex items-start gap-2">
        <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-300 leading-snug">
          AI agents (n8n) and operators may <em>request</em> commands. This deterministic gate
          decides whether they execute. Rejected commands never reach Eclipse Ditto.
          <span className="block text-gray-500 mt-0.5">
            Academic research prototype — not a substitute for certified elevator safety hardware.
          </span>
        </p>
      </div>

      {/* Counter strip */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-emerald-900/20 border border-emerald-800 rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-emerald-300">{counts.ACCEPTED}</div>
          <div className="text-[9px] text-emerald-400 uppercase tracking-wide">Accepted</div>
        </div>
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-red-300">{counts.REJECTED}</div>
          <div className="text-[9px] text-red-400 uppercase tracking-wide">Rejected</div>
        </div>
        <div className="bg-orange-900/20 border border-orange-800 rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-orange-300">{counts.FAILED}</div>
          <div className="text-[9px] text-orange-400 uppercase tracking-wide">Failed</div>
        </div>
        <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-amber-300">{counts.PENDING}</div>
          <div className="text-[9px] text-amber-400 uppercase tracking-wide">Pending</div>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-[10px] text-gray-500 uppercase tracking-wide">Decision:</label>
        {DECISION_FILTERS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecisionFilter(d)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
              decisionFilter === d
                ? "bg-cyan-900/40 border-cyan-700 text-cyan-200"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700"
            }`}
          >
            {d}
          </button>
        ))}
        <span className="text-gray-700 mx-1">|</span>
        <label className="text-[10px] text-gray-500 uppercase tracking-wide">Source:</label>
        {SOURCE_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSourceFilter(s)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
              sourceFilter === s
                ? "bg-cyan-900/40 border-cyan-700 text-cyan-200"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700"
            }`}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={fetchRows}
          className="ml-auto px-2 py-0.5 rounded text-[10px] bg-gray-900 border border-gray-700 text-gray-300 hover:border-gray-600 inline-flex items-center gap-1"
          title="Refresh now"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300 inline-flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {rows.length === 0 && !loading && (
          <div className="text-center py-8 text-xs text-gray-500">
            <ShieldX size={28} className="mx-auto mb-2 opacity-50" />
            No safety-gate decisions yet for the current filter.
          </div>
        )}
        {rows.map((row) => (
          <CommandRow key={row.command_id} row={row} />
        ))}
      </div>

      {lastFetch && (
        <div className="mt-2 text-[9px] text-gray-600 text-right font-mono">
          last refresh: {lastFetch.toLocaleTimeString()}
        </div>
      )}
    </ChartCard>
  );
}
