/**
 * GET /api/dispatch — adaptive dispatch status (read-only).
 *
 * Fetches the twin from Ditto, runs the orchestrator (Brain A + any shadow
 * brains) for the LIVE recommendation, and returns it alongside the twin's
 * stored intent (control.dispatch_policy) and the device-reported applied
 * policy (control.device_applied_policy). This is a pure read — it performs no
 * Ditto writes and records no cooldown (planDispatchUpdate previews the gate
 * with getRejectionReasons). Manual overrides go through POST /api/commands.
 */

import { NextResponse } from "next/server";
import { planDispatchUpdate } from "@smart-elevator/shared/dispatch/orchestrator.js";
import { POLICY_CATALOG, POLICY_IDS } from "@smart-elevator/shared/dispatch/index.js";

export const dynamic = "force-dynamic";

const DITTO_URL = (
  process.env.DITTO_URL || process.env.DITTO_BASE_URL || process.env.NEXT_PUBLIC_DITTO_URL || "http://127.0.0.1:8080"
).replace(/\/+$/, "");
const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || "ditto";
const DITTO_AUTH = "Basic " + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64");
const DITTO_TIMEOUT_MS = Number.parseInt(process.env.DITTO_TIMEOUT_MS || "8000", 10);
const PRIMARY_THING_ID = process.env.PRIMARY_THING_ID || "building:floor1:elevator";

const POLICIES = POLICY_IDS.map((id) => ({
  id, name: POLICY_CATALOG[id].name, description: POLICY_CATALOG[id].description,
}));

async function loadTwin(thingId) {
  try {
    const res = await fetch(`${DITTO_URL}/api/2/things/${encodeURIComponent(thingId)}`, {
      headers: { Authorization: DITTO_AUTH, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(DITTO_TIMEOUT_MS),
    });
    if (!res.ok) return { twin: null, reachable: false };
    const twin = await res.json();
    twin.last_telemetry_at = twin._modified || new Date().toISOString();
    return { twin, reachable: true };
  } catch {
    return { twin: null, reachable: false };
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const thingId = searchParams.get("thing_id") || PRIMARY_THING_ID;

  const { twin, reachable } = await loadTwin(thingId);
  if (!reachable || !twin) {
    return NextResponse.json(
      { error: "Ditto unreachable", policies: POLICIES, recommendation: null, intent: null, applied: null, shadow: [] },
      { status: 503 },
    );
  }

  try {
    const plan = planDispatchUpdate(twin, { now: Date.now(), thing_id: thingId, ditto_reachable: true });
    const control = twin.features?.control?.properties || {};
    const d = plan.decision;
    return NextResponse.json({
      error: null,
      thing_id: thingId,
      recommendation: {
        policy_id: d.policy_id,
        confidence: d.confidence,
        reason: d.reason,
        overridden_by: d.overridden_by,
        params: d.params,
        eligible_policies: d.eligible_policies,
        score_table: d.score_table,
        guardrails: d.guardrails,
      },
      changed: plan.changed,
      should_dispatch: plan.should_dispatch,
      skip_reason: plan.skip_reason,
      shadow: plan.shadow,
      intent: control.dispatch_policy || null,
      applied: control.device_applied_policy || null,
      policies: POLICIES,
    });
  } catch (err) {
    console.error("[api/dispatch]", err.message);
    return NextResponse.json(
      { error: err.message, policies: POLICIES, recommendation: null, intent: null, applied: null, shadow: [] },
      { status: 500 },
    );
  }
}
