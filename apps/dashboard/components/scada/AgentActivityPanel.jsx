"use client";

/**
 * AgentActivityPanel — the live, real-data view of the autonomous loop.
 *
 * Polls GET /api/agent/activity and renders one chronological stream that
 * interleaves:
 *   - REASON rows: what the dispatch brain decided, with confidence, the
 *     plain-language reason, shadow (challenger) agreement and any guardrails.
 *   - GATE rows: how the deterministic Command Safety Gate admitted or rejected
 *     each command — the visible proof that agents cannot act without rule-based
 *     admission.
 *
 * Read-only: this panel performs no writes and runs no LLM. It only visualizes
 * the decision/command stores the system already persists.
 */

import { useEffect, useState, useCallback } from "react";
import { Brain, ShieldCheck, ShieldAlert, Cpu, RefreshCw, Sparkles } from "lucide-react";
import ChartCard from "./ChartCard";

const POLL_MS = 5000;

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
}

function confidenceColor(c) {
  if (c == null) return "text-gray-400";
  if (c >= 0.66) return "text-green-400";
  if (c >= 0.33) return "text-yellow-400";
  return "text-red-400";
}

const STATUS_STYLE = {
  DISPATCHED: "bg-blue-900/30 border-blue-700/50 text-blue-300",
  SELECTED: "bg-cyan-900/30 border-cyan-700/50 text-cyan-300",
  HELD: "bg-gray-800 border-gray-700 text-gray-400",
  OVERRIDE: "bg-red-900/30 border-red-700/50 text-red-300",
};

function StatusBadge({ status }) {
  const cls = STATUS_STYLE[status] || "bg-gray-800 border-gray-700 text-gray-400";
  return (
    <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${cls}`}>
      {status || "—"}
    </span>
  );
}

function ReasonRow({ item }) {
  return (
    <li className="flex gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
      <Brain size={16} className="text-blue-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-gray-500">{fmtTime(item.ts)}</span>
          <span className="font-mono text-xs text-blue-300 font-bold">{item.agent}</span>
          <span className="text-gray-600">→</span>
          <span className="px-2 py-0.5 rounded font-mono text-xs font-bold border bg-blue-900/30 border-blue-700/50 text-blue-300">
            {item.policy || "—"}
          </span>
          {item.confidence != null && (
            <span className={`font-mono text-xs ${confidenceColor(item.confidence)}`}>
              {Math.round(item.confidence * 100)}%
            </span>
          )}
          <StatusBadge status={item.status} />
        </div>
        {item.reason && <p className="text-xs text-gray-300 mt-1">{item.reason}</p>}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {item.shadow_agreement && (
            <span className="text-[11px] font-mono text-purple-300">
              shadow agree {item.shadow_agreement}
            </span>
          )}
          {item.previous_policy && item.previous_policy !== item.policy && (
            <span className="text-[11px] font-mono text-gray-500">
              from {item.previous_policy}
            </span>
          )}
          {item.guardrails?.length > 0 && (
            <span className="text-[11px] font-mono text-yellow-400">
              guardrails: {item.guardrails.join(", ")}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function GateRow({ item }) {
  const accepted = item.accepted;
  const Icon = accepted ? ShieldCheck : ShieldAlert;
  return (
    <li className="flex gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
      <Icon size={16} className={`${accepted ? "text-green-400" : "text-red-400"} mt-0.5 shrink-0`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-gray-500">{fmtTime(item.ts)}</span>
          <Cpu size={12} className="text-gray-500" />
          <span className="font-mono text-xs text-gray-300">{item.agent}</span>
          <span className="text-gray-600">·</span>
          <span className="font-mono text-xs text-gray-200 font-bold">{item.command}</span>
          <span
            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
              accepted
                ? "bg-green-900/30 border-green-700/50 text-green-300"
                : "bg-red-900/30 border-red-700/50 text-red-300"
            }`}
          >
            GATE {item.decision}
          </span>
          {item.risk_score != null && (
            <span className="font-mono text-[11px] text-gray-500">risk {item.risk_score}</span>
          )}
        </div>
        {!accepted && item.rejection_reasons?.length > 0 && (
          <p className="text-[11px] font-mono text-red-300/90 mt-1">
            {item.rejection_reasons.join("; ")}
          </p>
        )}
      </div>
    </li>
  );
}

export default function AgentActivityPanel() {
  const [data, setData] = useState([]);
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [narration, setNarration] = useState(null); // { enabled, text, provider, model, policy }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/activity?limit=40", { cache: "no-store" });
      const body = await res.json();
      setData(Array.isArray(body.data) ? body.data : []);
      setCounts(body.counts || null);
      setError(body.error || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
    // Best-effort LLM "why" for the latest decision. Silently hidden when the
    // LLM is disabled (enabled:false) or unavailable — never blocks the feed.
    try {
      const res = await fetch("/api/agent/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setNarration(await res.json());
    } catch {
      setNarration(null);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  return (
    <ChartCard
      title="Agent Activity Timeline"
      icon="🧠"
      subtitle="Live autonomous decisions & safety-gate admissions — real data"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-[11px] font-mono text-gray-500">
          <span className="flex items-center gap-1"><Brain size={12} className="text-blue-400" /> reason {counts?.reason ?? 0}</span>
          <span className="flex items-center gap-1"><ShieldCheck size={12} className="text-green-400" /> gate {counts?.gate ?? 0}</span>
        </div>
        <button
          onClick={load}
          className="px-2 py-1 rounded text-xs font-mono border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          <RefreshCw size={12} /> refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-red-900/30 border border-red-700/50 text-red-300 text-xs font-mono">
          {error}
        </div>
      )}

      {/* LLM "why" — only rendered when the (optional) LLM is enabled and returns text. */}
      {narration?.enabled && narration?.text && (
        <div className="mb-3 p-3 rounded-lg bg-indigo-900/20 border border-indigo-700/40">
          <p className="text-xs text-indigo-300 uppercase tracking-wide mb-1 flex items-center gap-1">
            <Sparkles size={13} /> Why the latest decision{narration.policy ? ` — ${narration.policy}` : ""}
          </p>
          <p className="text-sm text-gray-200">{narration.text}</p>
          {(narration.provider || narration.model) && (
            <p className="text-[10px] font-mono text-indigo-300/70 mt-1">
              {narration.provider}{narration.model ? `/${narration.model}` : ""}
            </p>
          )}
        </div>
      )}

      {loaded && data.length === 0 && !error ? (
        <div className="p-4 text-center text-xs text-gray-500 font-mono border border-dashed border-gray-800 rounded-lg">
          No agent activity yet. Start the dispatch engine and issue a command to populate the feed.
        </div>
      ) : (
        <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {data.map((item) =>
            item.kind === "REASON"
              ? <ReasonRow key={item.id} item={item} />
              : <GateRow key={item.id} item={item} />,
          )}
        </ul>
      )}
    </ChartCard>
  );
}
