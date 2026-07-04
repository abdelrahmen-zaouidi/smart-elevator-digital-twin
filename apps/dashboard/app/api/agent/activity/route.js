/**
 * GET /api/agent/activity — unified, read-only "agent activity" stream.
 *
 * Merges the automation decisions the system ALREADY logs into one chronological
 * feed so the dashboard can show the autonomous loop reasoning + acting on real
 * data:
 *
 *   - REASON rows  ← dispatch_decision_log  (Brain A/B policy choice, confidence,
 *                    plain-language reason, score table, shadow agreement, guardrails)
 *   - GATE rows    ← control_command_log    (Command Safety Gate ACCEPT/REJECT with
 *                    rejection reasons — the proof that AI/agents cannot act without
 *                    deterministic admission)
 *
 * This route performs NO writes, runs NO LLM, and adds NO new tables — it only
 * reads the same stores that /api/history/dispatch and /api/history/commands read.
 * Each underlying query is independently guarded so a missing table or transient
 * DB error degrades to a partial/empty feed instead of a 500.
 */

import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

const PRIMARY_THING_ID = process.env.PRIMARY_THING_ID || "building:floor1:elevator";

function toMs(value) {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

// jsonb columns come back already parsed from node-postgres; tolerate the odd
// string just in case the column type ever changes.
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadDecisions(thingId, limit) {
  try {
    const rows = await queryRows(
      `SELECT decision_id, ts, active_brain, active_policy, previous_policy,
              overridden_by, confidence, changed, dispatched, command_id,
              reason, guardrails, shadow, score_table
       FROM dispatch_decision_log
       WHERE thing_id = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [thingId, limit],
    );
    return rows.map((r) => {
      const shadow = asArray(r.shadow);
      const agrees = shadow.filter((s) => s?.decision?.policy_id === r.active_policy).length;
      return {
        id: `dec-${r.decision_id}`,
        ts: r.ts,
        ts_ms: toMs(r.ts),
        kind: "REASON",
        agent: r.active_brain || "scorer_v1",
        policy: r.active_policy,
        previous_policy: r.previous_policy,
        confidence: r.confidence != null ? Number(r.confidence) : null,
        changed: r.changed === true,
        dispatched: r.dispatched === true,
        overridden_by: r.overridden_by || null,
        reason: r.reason || null,
        guardrails: asArray(r.guardrails),
        score_table: asArray(r.score_table).filter((s) => s && s.eligible !== false),
        shadow: shadow.map((s) => ({
          brain: s.brain,
          policy: s?.decision?.policy_id || s?.error || "—",
          agrees: s?.decision?.policy_id === r.active_policy,
        })),
        shadow_agreement: shadow.length ? `${agrees}/${shadow.length}` : null,
        command_id: r.command_id || null,
        status: r.overridden_by ? "OVERRIDE"
          : r.dispatched ? "DISPATCHED"
          : r.changed ? "SELECTED"
          : "HELD",
      };
    });
  } catch (err) {
    console.error("[api/agent/activity] decisions:", err.message);
    return [];
  }
}

async function loadGateOutcomes(thingId, limit) {
  try {
    const rows = await queryRows(
      `SELECT command_id, created_at, command, command_label, source, source_agent,
              requested_by, decision, accepted, rejection_reasons, risk_score, status
       FROM control_command_log
       WHERE thing_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [thingId, limit],
    );
    return rows.map((r) => ({
      id: `cmd-${r.command_id}`,
      ts: r.created_at,
      ts_ms: toMs(r.created_at),
      kind: "GATE",
      agent: r.source_agent || r.requested_by || r.source || "operator",
      source: r.source,
      command: r.command,
      command_label: r.command_label || null,
      decision: r.decision || (r.accepted ? "ACCEPTED" : "REJECTED"),
      accepted: r.accepted === true,
      rejection_reasons: asArray(r.rejection_reasons),
      risk_score: r.risk_score != null ? Number(r.risk_score) : null,
      status: r.status || r.decision || null,
    }));
  } catch (err) {
    console.error("[api/agent/activity] gate:", err.message);
    return [];
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || PRIMARY_THING_ID;
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "40", 10) || 40, 1), 200);
  const kind = (searchParams.get("kind") || "").toUpperCase(); // optional REASON|GATE filter

  // Pull a little extra from each source so the merged+sliced view is dense.
  const perSource = Math.min(limit * 2, 200);
  const [decisions, gate] = await Promise.all([
    kind === "GATE" ? [] : loadDecisions(thingId, perSource),
    kind === "REASON" ? [] : loadGateOutcomes(thingId, perSource),
  ]);

  const merged = [...decisions, ...gate]
    .sort((a, b) => b.ts_ms - a.ts_ms)
    .slice(0, limit);

  return NextResponse.json({
    thing_id: thingId,
    data: merged,
    counts: { reason: decisions.length, gate: gate.length, returned: merged.length },
    error: null,
  });
}
