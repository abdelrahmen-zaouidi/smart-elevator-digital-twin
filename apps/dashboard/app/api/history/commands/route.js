import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const limit   = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");

  try {
    const params = [thingId];
    const timeClauses = [];
    if (from) { params.push(from); timeClauses.push(`created_at >= $${params.length}`); }
    if (to)   { params.push(to);   timeClauses.push(`created_at <= $${params.length}`); }
    const timeWhere = timeClauses.length ? "AND " + timeClauses.join(" AND ") : "";
    params.push(limit);

    const rows = await queryRows(
      `SELECT command_id, created_at, executed_at, command, source_agent,
              requested_by, reason, risk_score, status, ditto_path, error_message
       FROM control_command_log
       WHERE thing_id = $1 ${timeWhere}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return NextResponse.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    console.error("[api/history/commands]", err.message);
    return NextResponse.json({ data: [], total: 0, error: err.message }, { status: 500 });
  }
}
