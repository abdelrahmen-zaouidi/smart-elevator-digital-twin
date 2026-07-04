/**
 * Browser-side helper to submit operator commands to the Command Safety Gate.
 *
 * Important: this DOES NOT call Ditto directly. It POSTs to the dashboard's
 * /api/commands route, which is the single trusted enforcement point. The
 * route runs the deterministic safety gate, persists the decision, and only
 * then forwards the (possibly empty) Ditto write plan to Eclipse Ditto.
 *
 * The function never throws. It always returns a decision envelope; check
 * `decision.accepted` to know whether the command went through.
 */

import { env } from "../config/env.js";
import { createCommandId, createCorrelationId } from "@smart-elevator/shared/commandSafetyGate.js";
import { fetchJson } from "./httpClient.js";

/**
 * Submit a command through the safety gate.
 *
 * @param {object} request
 *   command         — canonical command name (MOVE_TO_FLOOR, EMERGENCY_STOP, ...)
 *   target_floor    — required for MOVE_TO_FLOOR
 *   incident_id     — required for CLEAR_RESOLVED_INCIDENT
 *   reason          — operator-supplied reason; required for most commands
 *   confirmation    — boolean; required for dangerous commands
 *   device_action   — required for DEVICE_DIAGNOSTIC
 *   source_agent    — operator id; defaults to "dashboard-operator"
 *   requested_by    — display name
 *
 * @returns {Promise<object>} the decision envelope (with rejection_reasons,
 *                            ditto_write_status, audit_status, etc.)
 */
export async function submitCommand(request) {
  const body = {
    command: request.command,
    thing_id: request.thing_id || env.THING_ID,
    command_id: request.command_id || createCommandId(),
    correlation_id: request.correlation_id || createCorrelationId(),
    reason: request.reason ?? [],
    confirmation: request.confirmation === true,
    human_approved: request.human_approved === true,
    target_floor: request.target_floor,
    incident_id: request.incident_id,
    // Keep command-specific control fields explicit at the safety boundary.
    // The SET_FAN gate requires fan_state; dropping it here makes the server
    // correctly reject the operator command before any Ditto write happens.
    fan_state: request.fan_state,
    fan_mode: request.fan_mode,
    mode: request.mode,
    device_action: request.device_action,
    metadata: request.metadata || {},
  };

  try {
    // A command is state-changing, so it is sent with a timeout but is NEVER
    // auto-retried (retries: 0) — a timed-out command may already have been
    // applied by the safety gate, and the operator can resubmit deliberately.
    const { ok, status, data: decision } = await fetchJson("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      retries: 0,
      timeoutMs: 10000,
    });
    if (!ok) {
      return {
        ok: false,
        accepted: false,
        decision: "FAILED",
        command: body.command,
        command_id: body.command_id,
        correlation_id: body.correlation_id,
        rejection_reasons: [decision?.error || `HTTP ${status}`],
        ditto_write_status: "FAILED",
        audit_status: "PENDING",
        safety_snapshot: {},
      };
    }
    return decision;
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      decision: "FAILED",
      command: body.command,
      command_id: body.command_id,
      correlation_id: body.correlation_id,
      rejection_reasons: [`NETWORK: ${error.message}`],
      ditto_write_status: "FAILED",
      audit_status: "PENDING",
      safety_snapshot: {},
    };
  }
}

/**
 * Ask the trusted server boundary to reconcile a terminal device result from
 * Ditto into the durable command log. The browser supplies only the command
 * identifier; status and reason are read server-side from Eclipse Ditto.
 */
export async function reconcileCommandResult(commandId) {
  if (!commandId) return null;

  try {
    const { ok, data } = await fetchJson("/api/commands", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command_id: commandId }),
      retries: 1,
      timeoutMs: 8000,
    });
    return ok ? data : null;
  } catch (error) {
    console.warn("[SCADA] command result reconciliation deferred", {
      command_id: commandId,
      error: error.message,
    });
    return null;
  }
}
