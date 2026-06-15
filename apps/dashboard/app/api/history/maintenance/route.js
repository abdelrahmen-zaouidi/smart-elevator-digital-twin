import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const limit   = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const status  = searchParams.get("status"); // optional: OPEN, IN_PROGRESS, CLOSED

  try {
    const params = [thingId];
    const extra = [];
    if (status) { params.push(status); extra.push(`AND status = $${params.length}`); }
    params.push(limit);

    const rows = await queryRows(
      `SELECT work_order_id, created_at, closed_at, issue_key, priority,
              wear_index, estimated_failure_days, status,
              tasks, evidence
       FROM maintenance_work_orders
       WHERE thing_id = $1 ${extra.join(" ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return NextResponse.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    console.error("[api/history/maintenance]", err.message);
    return NextResponse.json({ data: [], total: 0, error: err.message }, { status: 500 });
  }
}
