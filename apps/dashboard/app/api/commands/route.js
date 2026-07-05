/**
 * POST /api/commands — Command Safety Gate enforcement point.
 *
 * Every operator command from the dashboard MUST go through this route. The
 * route runs the deterministic safety gate, persists the decision (accepted
 * or rejected) to control_command_log, audits the decision via the n8n
 * audit-agent webhook, and — only if accepted — performs the planned Ditto
 * writes.
 *
 * Invariant: rejected commands never produce Ditto writes.
 *
 * Auth model: this route runs server-side inside the Next.js dashboard. It
 * is the single trusted boundary between operator input and Eclipse Ditto.
 * The route is intentionally NOT exposed to the public internet in a local
 * Docker deployment; for production, layer an auth provider in front of it.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  validateCommand,
  SAFETY_GATE_CONFIG,
  SAFETY_GATE_VERSION,
} from "@smart-elevator/shared/commandSafetyGate.js";
import {
  commandResultForId,
  normalizeCommandStatus,
} from "@smart-elevator/shared/commandLifecycle.js";
import { query } from "../../../src/server/db.js";
import { log } from "../../../src/server/log.js";
import { metrics } from "../../../src/server/metrics.js";
import { auth } from "../../../auth.js";
import { canIssueCommands, normalizeRole } from "../../../src/server/authRoles.js";

export const dynamic = "force-dynamic";

// Resolve the acting principal: prefer a per-user Auth.js session (RBAC),
// fall back to the existing HTTP Basic / trusted-local-boundary identity so
// API clients, tests, and local dev keep working. Never throws.
async function resolvePrincipal(request) {
  try {
    const session = await auth();
    if (session?.user?.username) {
      return {
        subject: session.user.username,
        user_id: session.user.id ?? null,
        role: normalizeRole(session.user.role),
        authentication: "AUTHJS_SESSION",
      };
    }
  } catch {
    // No session / auth unavailable -> fall through to Basic.
  }
  return resolveDashboardPrincipal(request);
}

const DITTO_URL = (
  process.env.DITTO_URL ||
  process.env.DITTO_BASE_URL ||
  process.env.NEXT_PUBLIC_DITTO_URL ||
  "http://127.0.0.1:8080"
).replace(/\/+$/, "");

const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || "ditto";
const DITTO_AUTH = "Basic " + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64");
const DITTO_TIMEOUT_MS = Number.parseInt(process.env.DITTO_TIMEOUT_MS || "8000", 10);
const PRIMARY_THING_ID = process.env.PRIMARY_THING_ID || "building:floor1:elevator";
const DASHBOARD_AUTH_USER = process.env.DASHBOARD_BASIC_AUTH_USER || "operator";
const DASHBOARD_AUTH_PASS = process.env.DASHBOARD_BASIC_AUTH_PASS || "";
const DASHBOARD_OPERATOR_ROLE = String(process.env.DASHBOARD_OPERATOR_ROLE || "OPERATOR").toUpperCase();

const N8N_AUDIT_URL = (
  process.env.N8N_AUDIT_URL ||
  (process.env.WEBHOOK_URL ? `${process.env.WEBHOOK_URL.replace(/\/+$/, "")}/webhook/audit-agent` : null)
);
const DEVICE_ACTION_COMMANDS = new Set([
  "MOVE_TO_FLOOR",
  "OPEN_DOOR",
  "CLOSE_DOOR",
  "CLEAR_QUEUE",
  "SET_FAN",
  "EMERGENCY_STOP",
  "RESET_EMERGENCY",
  "RESUME_NORMAL_MODE",
  "RESET_ACTIVE_PROBLEMS",
  "LOCKDOWN",
  "RELEASE_LOCKDOWN",
  "SOFT_STOP",
  "HOME",
  "FRESH_START_RESET",
  "DEVICE_DIAGNOSTIC",
  "REQUEST_STATUS_REFRESH",
  "SET_DISPATCH_POLICY",
]);

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthorization(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Derive operator identity at the trusted server boundary. Client-provided
 * source/role/authorized fields are deliberately ignored.
 */
function resolveDashboardPrincipal(request) {
  const credentials = parseBasicAuthorization(request);

  if (DASHBOARD_AUTH_PASS) {
    const authenticated = credentials
      && safeEqual(credentials.username, DASHBOARD_AUTH_USER)
      && safeEqual(credentials.password, DASHBOARD_AUTH_PASS);
    if (!authenticated) return null;
  }

  return {
    subject: credentials?.username || DASHBOARD_AUTH_USER || "local-operator",
    role: DASHBOARD_OPERATOR_ROLE,
    authentication: DASHBOARD_AUTH_PASS ? "HTTP_BASIC" : "TRUSTED_LOCAL_BOUNDARY",
  };
}

// ---------------------------------------------------------------------------
// Fetch the latest twin state Ditto knows about.
// Returns { twin, ditto_reachable }. Never throws — a Ditto outage MUST be
// reflected to the safety gate as ditto_reachable:false, not as a 500.
// ---------------------------------------------------------------------------
async function loadTwinSnapshot(thingId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DITTO_TIMEOUT_MS);
  try {
    const url = `${DITTO_URL}/api/2/things/${encodeURIComponent(thingId)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: DITTO_AUTH, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return { twin: null, ditto_reachable: false, error: `Ditto GET ${response.status}` };
    }
    const twin = await response.json();
    // Carry a synthetic last_telemetry_at so the gate's stale-twin check can
    // run. We use _modified if Ditto returned it; otherwise now (twin was
    // just fetched). In practice the bridge updates the Thing on every
    // telemetry tick, so _modified reflects telemetry freshness.
    twin.last_telemetry_at = twin._modified || new Date().toISOString();
    return { twin, ditto_reachable: true };
  } catch (error) {
    return { twin: null, ditto_reachable: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Persist the safety-gate decision to control_command_log. Always inserts
// regardless of accepted/rejected — the rejection trace is itself audit
// evidence.
// ---------------------------------------------------------------------------
async function persistDecision(decision, thingId, dittoWriteStatus, auditStatus) {
  const sql = `
    INSERT INTO control_command_log (
      command_id, correlation_id, thing_id, command, command_label,
      requested_by, source_agent, source, reason, risk_score, system_mode,
      current_floor, target_floor, door_state, emergency_stop, load_kg,
      decision, accepted, status, rejection_reasons, safety_snapshot,
      raw_command, ditto_payload, ditto_path, ditto_write_status,
      audit_status, metadata, user_id, username
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18, $19, $20::jsonb, $21::jsonb,
      $22::jsonb, $23::jsonb, $24, $25,
      $26, $27::jsonb, $28, $29
    )
    ON CONFLICT (command_id) DO UPDATE SET
      ditto_write_status = EXCLUDED.ditto_write_status,
      audit_status       = EXCLUDED.audit_status,
      status             = EXCLUDED.status,
      updated_at         = now()
    RETURNING command_id, created_at, updated_at
  `;
  const snap = decision.safety_snapshot || {};
  const dittoPathSummary = (decision.ditto_writes || []).map((w) => w.path).join(",") || null;
  const reasonText = Array.isArray(decision.rejection_reasons) && decision.rejection_reasons.length > 0
    ? decision.rejection_reasons.join("; ")
    : (decision.raw_command?.reason
        ? (Array.isArray(decision.raw_command.reason)
            ? decision.raw_command.reason.join("; ")
            : String(decision.raw_command.reason))
        : null);
  const params = [
    decision.command_id,
    decision.correlation_id,
    thingId,
    decision.command,
    decision.command_label,
    decision.requested_by,
    decision.source_agent,
    decision.source,
    reasonText,
    decision.risk_score ?? 0,
    decision.system_mode,
    snap.current_floor,
    // target_floor column is integer; a malformed (e.g. fractional) request
    // must still persist its rejection trace — raw_command keeps the original.
    Number.isInteger(decision.target_floor) ? decision.target_floor : null,
    snap.door_state,
    snap.emergency_stop,
    typeof snap.load_kg === "number" ? snap.load_kg : null,
    decision.decision,
    decision.accepted,
    decision.decision,                              // legacy status column
    JSON.stringify(decision.rejection_reasons || []),
    JSON.stringify(decision.safety_snapshot || {}),
    JSON.stringify(decision.raw_command || {}),
    JSON.stringify(decision.ditto_writes || []),
    dittoPathSummary,
    dittoWriteStatus,
    auditStatus,
    JSON.stringify({
      audit_severity: decision.audit_severity,
      safety_gate_version: SAFETY_GATE_VERSION,
    }),
    // RBAC audit attribution (migration 010). username == requested_by; user_id
    // is present only for Auth.js-session commands (null for Basic/local/agent).
    decision.user_id ?? decision.raw_command?.user_id ?? null,
    decision.requested_by ?? null,
  ];
  const result = await query(sql, params);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Emit an audit event into audit_log. Best-effort; failure must not fail
// the command.
// ---------------------------------------------------------------------------
async function persistAuditEvent(decision, eventType, errorMessage = null) {
  if (!SAFETY_GATE_CONFIG.COMMAND_AUDIT_ENABLED) return "SKIPPED";
  try {
    await query(
      `INSERT INTO audit_log (
        audit_id, agent_name, event_type, thing_id, action, trigger,
        risk_score, status, severity, correlation_id, workflow_name,
        node_name, error_message, details
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14::jsonb
      )`,
      [
        `${decision.command_id}-${eventType}`,
        "dashboard_safety_gate",
        eventType,
        decision.raw_command?.thing_id || PRIMARY_THING_ID,
        decision.command,
        decision.source_agent || decision.source,
        decision.risk_score ?? 0,
        decision.accepted ? "SUCCESS" : "REJECTED",
        decision.audit_severity || "INFO",
        decision.correlation_id,
        "command_safety_gate",
        eventType,
        errorMessage,
        JSON.stringify({
          command_id: decision.command_id,
          rejection_reasons: decision.rejection_reasons,
          safety_snapshot: decision.safety_snapshot,
          ditto_writes_planned: decision.ditto_writes?.length || 0,
        }),
      ],
    );
    return "OK";
  } catch (error) {
    log.warn("audit_log insert failed", { event: "audit_insert_failed", detail: error.message });
    return "FAILED";
  }
}

// ---------------------------------------------------------------------------
// Best-effort fanout to the n8n audit webhook.
// ---------------------------------------------------------------------------
async function pingN8nAudit(decision, eventType) {
  if (!N8N_AUDIT_URL) return "SKIPPED";
  try {
    const response = await fetch(N8N_AUDIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Shared secret enforced by the n8n webhooks' Header Auth credential.
        // Omitted when unset so local dev without auth still works.
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { "x-n8n-webhook-secret": process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        agent: "dashboard_safety_gate",
        event_type: eventType,
        thing_id: decision.raw_command?.thing_id || PRIMARY_THING_ID,
        action: decision.command,
        correlation_id: decision.correlation_id,
        command_id: decision.command_id,
        risk_score: decision.risk_score,
        status: decision.accepted ? "SUCCESS" : "REJECTED",
        severity: decision.audit_severity || "INFO",
        rejection_reasons: decision.rejection_reasons,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(2500),
    });
    return response.ok ? "OK" : `HTTP_${response.status}`;
  } catch (error) {
    return `ERROR:${error.message}`;
  }
}

function encodeDittoPath(path) {
  return String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function getFeaturePropertyWrite(path) {
  const segments = String(path).split("/").filter(Boolean);
  if (segments.length < 4) return null;
  if (segments[0] !== "features" || segments[2] !== "properties") return null;

  return {
    featureId: segments[1],
    propertySegments: segments.slice(3),
  };
}

function setNestedProperty(target, segments, value) {
  let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }

    if (!cursor[segment] || typeof cursor[segment] !== "object" || Array.isArray(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  });
}

function isMissingFeatureResponse(status, body) {
  if (status !== 404) return false;
  return String(body || "").includes("things:feature.notfound");
}

async function putDittoPath(thingId, path, value) {
  const writePath = encodeDittoPath(path);
  const url = `${DITTO_URL}/api/2/things/${encodeURIComponent(thingId)}/${writePath}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: DITTO_AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(DITTO_TIMEOUT_MS),
  });
  const body = response.ok ? "" : await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, body };
}

async function createFeatureForPropertyWrite(thingId, write) {
  const featureWrite = getFeaturePropertyWrite(write.path);
  if (!featureWrite) return null;

  const properties = {};
  setNestedProperty(properties, featureWrite.propertySegments, write.value);
  const featurePath = `features/${featureWrite.featureId}`;
  return putDittoPath(thingId, featurePath, { properties });
}

// ---------------------------------------------------------------------------
// Execute the planned Ditto writes. Returns { status, errors }.
// Missing Ditto features are created once, then the original property write is
// retried. This keeps command intent durable on freshly initialized Things.
// ---------------------------------------------------------------------------
async function executeDittoWrites(thingId, writes) {
  const errors = [];
  for (const write of writes) {
    try {
      let result = await putDittoPath(thingId, write.path, write.value);

      if (!result.ok && isMissingFeatureResponse(result.status, result.body)) {
        const createResult = await createFeatureForPropertyWrite(thingId, write);
        if (createResult?.ok) {
          result = await putDittoPath(thingId, write.path, write.value);
        } else if (createResult) {
          errors.push(`PUT ${write.path}: ${createResult.status} ${createResult.body.slice(0, 200)}`);
          continue;
        }
      }

      if (!result.ok) {
        errors.push(`PUT ${write.path}: ${result.status} ${result.body.slice(0, 200)}`);
      }
    } catch (error) {
      errors.push(`PUT ${write.path}: ${error.message}`);
    }
  }
  return {
    status: errors.length === 0 ? "SUCCEEDED" : (errors.length < writes.length ? "PARTIAL" : "FAILED"),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Persist a durable command intent in Ditto for the bridge to fan out.
// Telemetry can overwrite physical state such as cabin/target_floor. Command
// intent is separate control-plane state with a unique command_id, so one-shot
// operator commands cannot disappear between telemetry ticks.
// ---------------------------------------------------------------------------
function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  );
}

function buildCommandIntentWrite(decision, thingId) {
  if (!DEVICE_ACTION_COMMANDS.has(decision.command)) return null;

  const raw = decision.raw_command || {};
  const now = new Date().toISOString();
  const reason = Array.isArray(raw.reason) ? raw.reason.join("; ") : raw.reason;

  return {
    path: "features/control/properties/pending_command",
    value: compactObject({
      command_id: decision.command_id,
      correlation_id: decision.correlation_id,
      command: decision.command,
      thing_id: thingId,
      source: decision.source,
      source_agent: decision.source_agent,
      requested_by: decision.requested_by,
      role: decision.role,
      requested_at: decision.requested_at || now,
      queued_at: now,
      status: "PENDING",
      target_floor: decision.target_floor ?? raw.target_floor,
      fan_state: raw.fan_state,
      fan_mode: raw.fan_mode || raw.mode,
      device_action: raw.device_action || raw.action,
      // Adaptive-dispatch intent: the bridge translates these into the
      // DISPATCH_POLICY MQTT command the firmware / simulator understands.
      policy_id: raw.policy_id ? String(raw.policy_id).toUpperCase() : undefined,
      dispatch_params: raw.dispatch_params || raw.params || undefined,
      reason,
      safety_gate_version: SAFETY_GATE_VERSION,
      authorization_context: {
        verified: true,
        issuer: "dashboard-command-gate",
        subject: decision.source_agent,
        role: decision.role,
        source: decision.source,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Mark accepted commands as queued for bridge fanout.
// Architecture invariant: the dashboard writes desired control state to Ditto
// only. The bridge observes Ditto changes and publishes MQTT commands using the
// broker identity that is explicitly allowed to write elevator/+/commands.
// ---------------------------------------------------------------------------
function buildBridgeFanoutResult(writeResult, hasCommandIntent) {
  if (writeResult.status !== "SUCCEEDED") {
    return {
      status: "SKIPPED",
      topic: null,
      error: "Ditto write did not succeed",
    };
  }

  if (!hasCommandIntent) {
    return {
      status: "NO_DEVICE_ACTION",
      topic: null,
      error: null,
    };
  }

  return {
    status: "QUEUED_VIA_DITTO_BRIDGE",
    topic: null,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------
export async function POST(request) {
  const endRoundtrip = metrics.commandRoundtrip.startTimer();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Invalid JSON body",
    }, { status: 400 });
  }

  const principal = await resolvePrincipal(request);
  if (!principal) {
    return NextResponse.json({
      ok: false,
      error: "Dashboard operator authentication required",
    }, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="ElevatorOS Commands", charset="UTF-8"' },
    });
  }

  // RBAC: a viewer may not issue commands. Enforced server-side BEFORE the
  // safety gate runs — the gate keeps deterministic authority over admission,
  // RBAC controls who may reach it at all.
  if (!canIssueCommands(principal.role)) {
    log.warn("command blocked by RBAC", {
      event: "command_rbac_denied", requested_by: principal.subject, role: principal.role,
    });
    return NextResponse.json({
      ok: false,
      error: `Role '${principal.role}' is not permitted to issue commands`,
    }, { status: 403 });
  }

  const trustedCommand = {
    ...body,
    source: "dashboard",
    source_agent: principal.subject,
    requested_by: principal.subject,
    role: principal.role,
    user_id: principal.user_id ?? null,
    metadata: {
      ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      authenticated_by: principal.authentication,
      identity_derived_server_side: true,
    },
  };

  const thingId = trustedCommand.thing_id || PRIMARY_THING_ID;

  // 1. Pull the latest twin state (or note that Ditto is unreachable).
  const { twin, ditto_reachable, error: dittoErr } = await loadTwinSnapshot(thingId);

  // 2. Run the deterministic safety gate.
  const decision = validateCommand(trustedCommand, twin, { ditto_reachable });

  // Structured gate-verdict log, keyed by command_id (same id the bridge logs
  // downstream) and attributed to the resolved operator identity.
  log.info("safety gate decision", {
    event: decision.accepted ? "command_accepted" : "command_rejected",
    command_id: decision.command_id,
    correlation_id: decision.correlation_id,
    thing_id: thingId,
    command: decision.command,
    accepted: decision.accepted,
    risk_score: decision.risk_score ?? null,
    requested_by: principal.subject,
    role: principal.role,
    reason: decision.accepted ? undefined : decision.rejection_reasons,
  });
  metrics.gateDecisions.inc({
    verdict: decision.accepted ? "accepted" : "rejected",
    command: decision.command || "UNKNOWN",
  });
  endRoundtrip({ accepted: String(Boolean(decision.accepted)) });

  // 3. Persist & audit BEFORE any Ditto write — the decision must always
  //    leave a trace, regardless of write success/failure.
  await persistAuditEvent(decision, "COMMAND_RECEIVED");

  if (!decision.accepted) {
    await persistDecision(decision, thingId, "SKIPPED", "PENDING");
    const auditStatus = await persistAuditEvent(decision, "COMMAND_REJECTED");
    const n8nStatus = await pingN8nAudit(decision, "COMMAND_REJECTED");
    await query(
      `UPDATE control_command_log SET audit_status = $1 WHERE command_id = $2`,
      [`${auditStatus}/${n8nStatus}`, decision.command_id],
    );
    return NextResponse.json({
      ok: true,
      ...decision,
      ditto_write_status: "SKIPPED",
      audit_status: `${auditStatus}/${n8nStatus}`,
      twin_reachable: ditto_reachable,
      twin_error: dittoErr || null,
    }, { status: 200 });
  }

  // 4. Accepted — persist as ACCEPTED, then perform Ditto writes.
  const commandIntentWrite = buildCommandIntentWrite(decision, thingId);
  const executionWrites = [
    ...(decision.ditto_writes || []),
    ...(commandIntentWrite ? [commandIntentWrite] : []),
  ];
  const executionDecision = {
    ...decision,
    ditto_writes: executionWrites,
  };

  await persistDecision(executionDecision, thingId, "PENDING", "PENDING");
  await persistAuditEvent(executionDecision, "COMMAND_ACCEPTED");

  const writeResult = await executeDittoWrites(thingId, executionWrites);
  const deviceCommandResult = buildBridgeFanoutResult(writeResult, Boolean(commandIntentWrite));
  const commandSucceeded = writeResult.status === "SUCCEEDED";
  const commandErrors = [writeResult.errors.join(" | "), deviceCommandResult.error]
    .filter(Boolean)
    .join(" | ");

  await persistAuditEvent(
    executionDecision,
    commandSucceeded ? "COMMAND_DITTO_WRITE_SUCCEEDED" : "COMMAND_DITTO_WRITE_FAILED",
    commandErrors || null,
  );
  const n8nStatus = await pingN8nAudit(
    executionDecision,
    commandSucceeded ? "COMMAND_DITTO_WRITE_SUCCEEDED" : "COMMAND_DITTO_WRITE_FAILED",
  );

  await query(
    `UPDATE control_command_log
        SET ditto_write_status = $1,
            audit_status       = $2,
            status             = $3,
            executed_at        = $4,
            error_message      = $5
      WHERE command_id = $6`,
    [
      writeResult.status,
      `OK/${n8nStatus}`,
      commandSucceeded ? "DITTO_WRITE_SUCCEEDED" : "DITTO_WRITE_FAILED",
      commandSucceeded ? new Date().toISOString() : null,
      commandErrors || null,
      decision.command_id,
    ],
  );

  return NextResponse.json({
    ok: true,
    ...executionDecision,
    ditto_write_status: writeResult.status,
    ditto_write_errors: writeResult.errors,
    device_command_status: deviceCommandResult.status,
    device_command_topic: deviceCommandResult.topic,
    device_command_error: deviceCommandResult.error,
    audit_status: `OK/${n8nStatus}`,
    twin_reachable: ditto_reachable,
  }, { status: 200 });
}

/**
 * Reconcile the authoritative terminal device result from Ditto into
 * control_command_log. The browser supplies only command_id; it cannot choose
 * the status or reason.
 */
export async function PATCH(request) {
  const principal = resolveDashboardPrincipal(request);
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const commandId = String(body.command_id || "").trim();
  const thingId = String(body.thing_id || PRIMARY_THING_ID);
  if (!commandId) {
    return NextResponse.json({ ok: false, error: "command_id is required" }, { status: 400 });
  }

  const { twin, ditto_reachable, error } = await loadTwinSnapshot(thingId);
  if (!ditto_reachable) {
    return NextResponse.json({
      ok: false,
      error: error || "Ditto unavailable",
    }, { status: 503 });
  }

  const result = commandResultForId(twin, commandId);
  if (!result) {
    return NextResponse.json({
      ok: false,
      error: "No matching terminal command result in Ditto",
      command_id: commandId,
    }, { status: 409 });
  }

  const status = normalizeCommandStatus(result.status);
  const reason = result.reason || result.message || null;
  const acknowledgedAt = result.completed_at
    || result.rejected_at
    || result.failed_at
    || result.timed_out_at
    || result.updated_at
    || new Date().toISOString();

  await query(
    `UPDATE control_command_log
        SET status          = $1,
            acknowledged_at = $2,
            executed_at     = CASE WHEN $1 = 'COMPLETED' THEN $2 ELSE executed_at END,
            error_message   = CASE WHEN $1 = 'COMPLETED' THEN NULL ELSE $3 END,
            metadata        = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      WHERE command_id = $5 AND thing_id = $6`,
    [
      status,
      acknowledgedAt,
      reason,
      JSON.stringify({
        terminal_result: result,
        reconciled_by: principal.subject,
      }),
      commandId,
      thingId,
    ],
  );

  return NextResponse.json({
    ok: true,
    command_id: commandId,
    status,
    result,
  });
}

// ---------------------------------------------------------------------------
// GET handler: small healthcheck / version probe.
// ---------------------------------------------------------------------------
export async function GET() {
  return NextResponse.json({
    ok: true,
    component: "command_safety_gate",
    version: SAFETY_GATE_VERSION,
    config: SAFETY_GATE_CONFIG,
  });
}
