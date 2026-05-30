import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId   = searchParams.get("thing_id")  || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const component = searchParams.get("component"); // optional filter
  const limit     = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

  try {
    const params = [thingId];
    const extra = [];
    if (component) { params.push(component); extra.push(`AND component = $${params.length}`); }
    params.push(limit);

    const rows = await queryRows(
      `SELECT id, checked_at, component, status, latency_ms, error_message
       FROM system_health_history
       WHERE thing_id = $1 ${extra.join(" ")}
       ORDER BY checked_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return NextResponse.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    console.error("[api/history/system-health]", err.message);
    return NextResponse.json({ data: [], total: 0, error: err.message }, { status: 500 });
  }
}
