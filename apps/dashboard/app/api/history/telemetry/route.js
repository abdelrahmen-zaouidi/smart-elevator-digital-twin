import { NextResponse } from "next/server";
import { queryRows, ping } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const limit   = Math.min(parseInt(searchParams.get("limit") || "200", 10), 500);
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");

  try {
    const params = [thingId];
    const timeClauses = [];
    if (from) { params.push(from); timeClauses.push(`time >= $${params.length}`); }
    if (to)   { params.push(to);   timeClauses.push(`time <= $${params.length}`); }
    const timeWhere = timeClauses.length ? "AND " + timeClauses.join(" AND ") : "";
    params.push(limit);

    const rows = await queryRows(
      `SELECT time, current_floor, target_floor, load_kg, speed_ms,
              motor_temp_c, vibration_g, power_kw, current_draw_a,
              risk_score, event_type, door_state, severity, system_mode
       FROM telemetry_raw
       WHERE thing_id = $1 ${timeWhere}
       ORDER BY time DESC
       LIMIT $${params.length}`,
      params,
    );

    return NextResponse.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    console.error("[api/history/telemetry]", err.message);
    return NextResponse.json({ data: [], total: 0, error: err.message }, { status: 500 });
  }
}
