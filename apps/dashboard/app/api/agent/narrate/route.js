/**
 * POST /api/agent/narrate — optional LLM "why" for a dispatch decision.
 *
 * Body: { decision_id?, thing_id? }. With no decision_id it narrates the most
 * recent decision for the thing. Fetches the already-logged decision from
 * dispatch_decision_log (real data), hands it to the non-authoritative narrator,
 * and returns the plain-language explanation.
 *
 * Best-effort and side-effect-free: it performs NO writes and NO actuation, and
 * it never 500s the UI — when the LLM is disabled it returns { enabled:false }
 * so the dashboard simply hides the why-card.
 */

import { NextResponse } from "next/server";
import { narrate } from "@smart-elevator/shared/llm/index.js";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

const PRIMARY_THING_ID = process.env.PRIMARY_THING_ID || "building:floor1:elevator";

function asArrayOrObj(v) {
  if (v == null) return v;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

async function loadDecision(thingId, decisionId) {
  const where = decisionId ? "d.decision_id = $1" : "d.thing_id = $1";
  const rows = await queryRows(
    `SELECT d.decision_id, d.ts, d.active_brain, d.active_policy, d.previous_policy,
            d.confidence, d.reason, d.guardrails, d.shadow, d.score_table, d.context
     FROM dispatch_decision_log d
     WHERE ${where}
     ORDER BY d.ts DESC
     LIMIT 1`,
    [decisionId || thingId],
  );
  return rows[0] || null;
}

// Pull a small, human-relevant slice out of the decision's stored context so the
// narrator can ground its explanation without a separate Ditto round-trip.
function twinSummaryFromContext(context) {
  const c = asArrayOrObj(context) || {};
  const pick = (...keys) => {
    for (const k of keys) if (c[k] != null) return c[k];
    return undefined;
  };
  return {
    current_floor: pick("current_floor", "floor"),
    queue_length: pick("queue_length", "pending_calls", "queue"),
    up_down_ratio: pick("up_down_ratio", "call_ratio"),
    motor_temp_c: pick("motor_temp_c", "temperature_c"),
    motor_vibration: pick("vibration_level", "motor_vibration"),
    rul: pick("rul", "remaining_useful_life"),
    energy_tariff: pick("tariff", "energy_tariff"),
    system_mode: pick("system_mode", "mode"),
  };
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* allow empty body */ }
  const thingId = body.thing_id || PRIMARY_THING_ID;
  const decisionId = body.decision_id || null;

  let decisionRow = null;
  try {
    decisionRow = await loadDecision(thingId, decisionId);
  } catch (err) {
    console.error("[api/agent/narrate] db:", err.message);
    // Fall through: narrate() will still report enabled/disabled correctly.
  }

  if (!decisionRow) {
    return NextResponse.json({ enabled: false, text: null, error: "no decision found", decision_id: decisionId });
  }

  const decision = {
    active_policy: decisionRow.active_policy,
    previous_policy: decisionRow.previous_policy,
    active_brain: decisionRow.active_brain,
    confidence: decisionRow.confidence != null ? Number(decisionRow.confidence) : null,
    reason: decisionRow.reason,
    guardrails: asArrayOrObj(decisionRow.guardrails) || [],
    score_table: asArrayOrObj(decisionRow.score_table) || [],
    shadow_agreement: (() => {
      const s = asArrayOrObj(decisionRow.shadow);
      if (!Array.isArray(s) || s.length === 0) return null;
      const agree = s.filter((x) => x?.decision?.policy_id === decisionRow.active_policy).length;
      return `${agree}/${s.length}`;
    })(),
  };

  const result = await narrate({
    decision,
    twinSummary: twinSummaryFromContext(decisionRow.context),
  });

  return NextResponse.json({ ...result, decision_id: decisionRow.decision_id, policy: decisionRow.active_policy });
}
