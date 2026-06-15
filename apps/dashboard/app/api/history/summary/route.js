import { NextResponse } from "next/server";
import { queryRows, ping } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";

  // Ping first to give a clear DB status without a long timeout cascade.
  const dbStatus = await ping();
  if (!dbStatus.ok) {
    return NextResponse.json({
      data: null,
      db: { connected: false, error: dbStatus.error },
      error: dbStatus.error,
    }, { status: 503 });
  }

  try {
    const [telRow, auditRow, notifRow, maintRow] = await Promise.all([
      queryRows(
        `SELECT COUNT(*)::int                                     AS total_rows,
                COUNT(*) FILTER (WHERE event_type = 'ANOMALY_DETECTED')::int AS anomalies,
                COUNT(*) FILTER (WHERE event_type = 'SECURITY_BREACH')::int  AS security_breaches,
                ROUND(AVG(risk_score)::numeric, 1)               AS avg_risk_score,
                MAX(risk_score)                                  AS max_risk_score,
                ROUND(AVG(motor_temp_c)::numeric, 1)             AS avg_motor_temp_c,
                ROUND(MAX(vibration_g)::numeric, 4)              AS max_vibration_g,
                MAX(time)                                        AS last_telemetry_at
         FROM telemetry_raw WHERE thing_id = $1`,
        [thingId],
      ),
      queryRows(
        `SELECT COUNT(*)::int AS total_rows, MAX(created_at) AS last_at
         FROM audit_log WHERE thing_id = $1`,
        [thingId],
      ),
      queryRows(
        `SELECT COUNT(*)::int AS total_rows, MAX(created_at) AS last_at
         FROM notification_outbox WHERE thing_id = $1`,
        [thingId],
      ),
      queryRows(
        `SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS'))::int AS open_count,
                COUNT(*)::int                                                 AS total_count,
                MAX(created_at)                                               AS last_at
         FROM maintenance_work_orders WHERE thing_id = $1`,
        [thingId],
      ),
    ]);

    return NextResponse.json({
      data: {
        telemetry:     telRow[0]  || {},
        audit:         auditRow[0]  || {},
        notifications: notifRow[0]  || {},
        maintenance:   maintRow[0]  || {},
      },
      db: { connected: true, latency_ms: dbStatus.latency_ms },
      error: null,
    });
  } catch (err) {
    console.error("[api/history/summary]", err.message);
    return NextResponse.json({
      data: null,
      db: { connected: true, latency_ms: dbStatus.latency_ms },
      error: err.message,
    }, { status: 500 });
  }
}
