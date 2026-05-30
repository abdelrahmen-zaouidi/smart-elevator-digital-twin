import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const limit   = Math.min(parseInt(searchParams.get("limit") || "48", 10), 720);
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");

  try {
    const params = [thingId];
    const timeClauses = [];
    if (from) { params.push(from); timeClauses.push(`bucket >= $${params.length}`); }
    if (to)   { params.push(to);   timeClauses.push(`bucket <= $${params.length}`); }
    const timeWhere = timeClauses.length ? "AND " + timeClauses.join(" AND ") : "";
    params.push(limit);

    const rows = await queryRows(
      `SELECT bucket, avg_power_kw, avg_current_a, avg_vibration_g
       FROM hourly_energy
       WHERE thing_id = $1 ${timeWhere}
       ORDER BY bucket DESC
       LIMIT $${params.length}`,
      params,
    );

    return NextResponse.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    console.error("[api/history/energy]", err.message);
    return NextResponse.json({ data: [], total: 0, error: err.message }, { status: 500 });
  }
}
