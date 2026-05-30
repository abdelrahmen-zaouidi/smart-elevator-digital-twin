/**
 * GET /api/commands/recent — recent Command Safety Gate decisions.
 *
 * Drives the "Command Safety Gate" dashboard panel. Returns the most recent
 * decisions across all sources (dashboard, n8n, operator, system), with the
 * full decision envelope so the UI can render the rejection trace and the
 * safety snapshot for jury review.
 *
 * Query parameters (all optional):
 *   thing_id   — defaults to PRIMARY_THING_ID
 *   limit      — capped at 100, default 25
 *   decision   — ACCEPTED | REJECTED (filters)
 *   source     — dashboard | n8n | operator | system (filters)
 *   command    — canonical command name (filters)
 */

import { NextResponse } from "next/server";
import { queryRows } from "../../../../src/server/db.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || process.env.PRIMARY_THING_ID || "building:floor1:elevator";
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10) || 25, 100);
  const decisionFilter = searchParams.get("decision");
  const sourceFilter = searchParams.get("source");
  const commandFilter = searchParams.get("command");

  const where = ["thing_id = $1"];
  const params = [thingId];
  if (decisionFilter) {
    params.push(decisionFilter.toUpperCase());
    where.push(`decision = $${params.length}`);
  }
  if (sourceFilter) {
    params.push(sourceFilter.toLowerCase());
    where.push(`source = $${params.length}`);
  }
  if (commandFilter) {
    params.push(commandFilter.toUpperCase());
    where.push(`command = $${params.length}`);
  }
  params.push(limit);

  const sql = `
    SELECT command_id, correlation_id, command, command_label,
           source, source_agent, requested_by, reason,
           risk_score, system_mode, current_floor, target_floor,
           door_state, emergency_stop, load_kg,
           decision, accepted, status, rejection_reasons, safety_snapshot,
           ditto_payload, ditto_write_status, audit_status,
           created_at, executed_at, updated_at, error_message
    FROM control_command_log
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;

  try {
    const rows = await queryRows(sql, params);
    return NextResponse.json({
      data: rows,
      total: rows.length,
      filters: {
        thing_id: thingId,
        decision: decisionFilter,
        source: sourceFilter,
        command: commandFilter,
        limit,
      },
      error: null,
    });
  } catch (error) {
    console.error("[api/commands/recent]", error.message);
    return NextResponse.json(
      { data: [], total: 0, error: error.message },
      { status: 500 },
    );
  }
}
