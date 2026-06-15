/**
 * GET /api/history/dispatch — recent dispatch decisions with their reward.
 *
 * Joins dispatch_decision_log to the latest dispatch_outcome per decision so the
 * dashboard and the promotion evaluator can chart policy choices against the
 * realized reward over time.
 */

import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 1000);
  const onlyChanges = searchParams.get("changes") === "1";

  try {
    const params = [thingId];
    let changeClause = "";
    if (onlyChanges) changeClause = "AND d.changed = true";
    params.push(limit);

    const rows = await queryRows(
      `SELECT d.decision_id, d.ts, d.active_brain, d.active_policy, d.previous_policy,
              d.overridden_by, d.confidence, d.changed, d.dispatched, d.reason,
              d.guardrails, d.shadow,
              o.reward, o.avg_wait_s, o.energy_kwh, o.machine_stress,
              o.fairness_penalty, o.safety_violation
       FROM dispatch_decision_log d
       LEFT JOIN LATERAL (
         SELECT reward, avg_wait_s, energy_kwh, machine_stress, fairness_penalty, safety_violation
         FROM dispatch_outcome o
         WHERE o.decision_id = d.decision_id
         ORDER BY o.window_end DESC
         LIMIT 1
       ) o ON true
       WHERE d.thing_id = $1 ${changeClause}
       ORDER BY d.ts DESC
       LIMIT $${params.length}`,
      params,
    );

    return NextResponse.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    console.error("[api/history/dispatch]", err.message);
    return NextResponse.json({ data: [], total: 0, error: err.message }, { status: 500 });
  }
}
