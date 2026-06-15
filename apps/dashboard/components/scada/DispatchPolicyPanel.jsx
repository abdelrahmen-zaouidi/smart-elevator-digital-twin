"use client";

/**
 * DispatchPolicyPanel — the SCADA view of the AI-Adaptive Dispatch engine.
 *
 * Shows, from GET /api/dispatch:
 *   - the LIVE Brain A recommendation (policy, confidence, plain-language reason)
 *   - the transparent score table (why this policy won)
 *   - the twin's stored intent vs the device-reported applied policy
 *   - any shadow (challenger) brain opinions + agreement
 *   - a guarded manual override that POSTs SET_DISPATCH_POLICY through the gate
 *
 * The override is the only write path here and it goes through the same command
 * safety gate as every other command — the panel never writes Ditto directly.
 */

import { useEffect, useState, useCallback } from "react";
import { Brain, Cpu, ShieldAlert, Activity, Hand, RefreshCw } from "lucide-react";
import ChartCard from "./ChartCard";

const POLL_MS = 5000;

function confidenceColor(c) {
  if (c == null) return "text-gray-400";
  if (c >= 0.66) return "text-green-400";
  if (c >= 0.33) return "text-yellow-400";
  return "text-red-400";
}

function PolicyBadge({ policy, overridden }) {
  const color = overridden ? "bg-red-900/30 border-red-700/50 text-red-300"
    : "bg-blue-900/30 border-blue-700/50 text-blue-300";
  return (
    <span className={`px-2 py-1 rounded font-mono text-xs font-bold border ${color}`}>
      {policy || "—"}
    </span>
  );
}

export default function DispatchPolicyPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dispatch", { cache: "no-store" });
      const body = await res.json();
      setData(body);
      setError(body.error || null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  const override = useCallback(async (policyId) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "SET_DISPATCH_POLICY",
          source: "operator",
          source_agent: "dashboard-operator",
          policy_id: policyId,
          reason: ["manual operator override from dashboard"],
          metadata: { brain_id: "manual" },
        }),
      });
      const body = await res.json();
      setNote(body.decision === "ACCEPTED"
        ? `Override accepted: ${policyId}`
        : `Rejected: ${(body.rejection_reasons || [body.error]).join("; ")}`);
      load();
    } catch (e) {
      setNote(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const rec = data?.recommendation;
  const intent = data?.intent;
  const applied = data?.applied;
  const policies = data?.policies || [];
  const shadow = data?.shadow || [];
  const scoreTable = (rec?.score_table || []).filter((r) => r.eligible);

  return (
    <ChartCard title="Adaptive Dispatch Policy" icon="🧭" subtitle="AI brain selecting the most suitable dispatch logic">
      {error && (
        <div className="mb-3 p-2 rounded bg-red-900/30 border border-red-700/50 text-red-300 text-xs font-mono">
          {error}
        </div>
      )}

      {/* Active recommendation */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={16} className="text-blue-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Active (Brain A)</span>
          </div>
          <div className="flex items-center gap-2">
            <PolicyBadge policy={rec?.policy_id} overridden={!!rec?.overridden_by} />
          </div>
          <p className={`text-xs font-mono mt-2 ${confidenceColor(rec?.confidence)}`}>
            confidence {rec?.confidence != null ? `${Math.round(rec.confidence * 100)}%` : "—"}
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={16} className="text-cyan-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Twin Intent</span>
          </div>
          <PolicyBadge policy={intent?.active_policy} />
          <p className="text-xs font-mono mt-2 text-gray-500">
            brain {intent?.active_brain || "—"}
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={16} className="text-green-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Device Applied</span>
          </div>
          <PolicyBadge policy={applied?.policy_id} />
          <p className="text-xs font-mono mt-2 text-gray-500">
            {applied ? `park ${applied.park_floor ?? "—"} · bias ${applied.direction_bias >= 0 ? "+" : ""}${applied.direction_bias ?? 0}` : "no device report"}
          </p>
        </div>
      </div>

      {/* Reason */}
      {rec?.reason && (
        <div className="mb-4 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
            {rec.overridden_by ? <ShieldAlert size={14} className="text-red-400" /> : <Brain size={14} className="text-blue-400" />}
            Why this policy
          </p>
          <p className="text-sm text-gray-200">{rec.reason}</p>
          {rec.guardrails?.length > 0 && (
            <p className="text-xs font-mono text-yellow-400 mt-1">guardrails: {rec.guardrails.join(", ")}</p>
          )}
        </div>
      )}

      {/* Score table */}
      {scoreTable.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Score table (eligible)</p>
          <div className="space-y-1">
            {scoreTable.map((row) => {
              const isTop = row.policy === rec?.policy_id;
              const pct = Math.max(0, Math.min(100, Math.round((row.score || 0) * 100)));
              return (
                <div key={row.policy} className="flex items-center gap-2">
                  <span className={`w-44 text-xs font-mono ${isTop ? "text-blue-300 font-bold" : "text-gray-400"}`}>
                    {row.policy}
                  </span>
                  <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${isTop ? "bg-blue-500" : "bg-gray-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs font-mono text-gray-400">{(row.score ?? 0).toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Shadow / challenger brains */}
      {shadow.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-purple-900/20 border border-purple-700/40">
          <p className="text-xs text-purple-300 uppercase tracking-wide mb-2">Challenger (shadow) brains</p>
          {shadow.map((s) => (
            <div key={s.brain} className="flex items-center justify-between text-xs font-mono text-gray-300">
              <span>{s.brain}</span>
              <span>{s.decision?.policy_id || s.error}</span>
              <span className={s.decision?.policy_id === rec?.policy_id ? "text-green-400" : "text-yellow-400"}>
                {s.decision?.policy_id === rec?.policy_id ? "agrees" : "differs"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Manual override */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
          <Hand size={14} /> Manual override
        </p>
        <div className="flex flex-wrap gap-1.5">
          {policies.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => override(p.id)}
              title={p.description}
              className="px-2 py-1 rounded text-xs font-mono border border-gray-700 bg-gray-800 text-gray-300 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40"
            >
              {p.id}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={load}
            className="px-2 py-1 rounded text-xs font-mono border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 flex items-center gap-1"
          >
            <RefreshCw size={12} /> refresh
          </button>
        </div>
        {note && <p className="text-xs font-mono mt-2 text-gray-400">{note}</p>}
      </div>
    </ChartCard>
  );
}
