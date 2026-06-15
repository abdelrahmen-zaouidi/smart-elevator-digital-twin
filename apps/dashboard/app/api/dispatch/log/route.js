/**
 * POST /api/dispatch/log — append one dispatch decision to dispatch_decision_log.
 *
 * The dispatch engine calls this every tick (best-effort) so every binding
 * decision + shadow opinion + context snapshot becomes a training row and audit
 * record. Pure persistence: the safety gate / Ditto write happen elsewhere.
 */

import { NextResponse } from "next/server";
import { query } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

const PRIMARY_THING_ID = process.env.PRIMARY_THING_ID || "building:floor1:elevator";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const d = body.decision || {};
  const thingId = body.thing_id || PRIMARY_THING_ID;

  try {
    const result = await query(
      `INSERT INTO dispatch_decision_log (
         thing_id, active_brain, active_policy, previous_policy, overridden_by,
         confidence, changed, dispatched, command_id, reason,
         context, score_table, shadow, guardrails
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb
       ) RETURNING decision_id, ts`,
      [
        thingId,
        d.brain_id || body.active_brain || "scorer_v1",
        d.policy_id || "SCAN_COLLECTIVE",
        d.previous_policy ?? null,
        d.overridden_by ?? null,
        d.confidence ?? null,
        body.changed === true,
        body.should_dispatch === true,
        body.command_id ?? null,
        d.reason ?? null,
        JSON.stringify(d.factors || body.context || {}),
        JSON.stringify(d.score_table || []),
        JSON.stringify(body.shadow || []),
        JSON.stringify(d.guardrails || []),
      ],
    );
    return NextResponse.json({ ok: true, decision_id: result.rows[0].decision_id, ts: result.rows[0].ts });
  } catch (err) {
    console.error("[api/dispatch/log]", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
