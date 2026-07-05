#!/usr/bin/env node
/**
 * live-command-campaign.mjs — GAPS M10: live command-path campaign.
 *
 * Drives >= 50 operator commands through the REAL stack via POST
 * /api/commands only (never bypassing the deterministic safety gate):
 *
 *   dashboard API -> safety gate -> control_command_log/audit_log ->
 *   Ditto intent -> bridge -> MQTT -> authenticated simulator.
 *
 * Covers every live-testable gate rule family with both accepted and
 * rejected classes: command catalog (unknown commands), required fields,
 * operator reason, human confirmation, system-mode guards after real
 * EMERGENCY_STOP / LOCKDOWN / MAINTENANCE cycles, floor bounds, payload
 * validity (fan state, diagnostic action, dispatch policy),
 * duplicate/cooldown, and the reject-with-zero-write invariant (every
 * REJECTED response must carry ditto_write_status = SKIPPED).
 *
 * Rule families that require fault injection or an unhealthy plant state
 * (twin-freshness, Ditto-unavailability, interlock flags such as
 * overload/forced-entry, risk-threshold caps) stay covered by the unit
 * suite (test-command-safety-gate.mjs): with the anomaly engine disabled
 * (SIM_ANOMALY_PROFILE=disabled for reproducibility) the healthy simulator
 * clears those conditions between ticks, as pre-campaign dry runs showed.
 *
 * Usage:  node scripts/validation/live-command-campaign.mjs
 * Output: evidence/command-campaign/campaign-<UTC date>.jsonl  (raw)
 *         evidence/command-campaign/campaign-<UTC date>-summary.json
 *
 * Operator credentials are read from apps/dashboard/.env.local
 * (DASHBOARD_BASIC_AUTH_USER / DASHBOARD_BASIC_AUTH_PASS) and are never
 * written to the evidence artifacts.
 */

import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = process.env.CAMPAIGN_API_URL || "http://localhost:3000/api/commands";
const GAP_MS = Number(process.env.CAMPAIGN_GAP_MS || 3600);        // > 3 s cooldown
const FAST_MS = Number(process.env.CAMPAIGN_FAST_MS || 300);       // inside cooldown window

function readEnvLocal() {
  const envPath = path.join(ROOT, "apps", "dashboard", ".env.local");
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

const env = readEnvLocal();
const AUTH = "Basic " + Buffer.from(
  `${env.DASHBOARD_BASIC_AUTH_USER || "operator"}:${env.DASHBOARD_BASIC_AUTH_PASS || ""}`,
).toString("base64");

const DITTO_URL = (process.env.DITTO_URL || env.DITTO_URL || "http://localhost:8080").replace(/\/+$/, "");
const DITTO_AUTH = "Basic " + Buffer.from(
  `${process.env.DITTO_USER || env.DITTO_USER || "ditto"}:${process.env.DITTO_PASSWORD || env.DITTO_PASSWORD || "ditto"}`,
).toString("base64");
const THING_ID = process.env.PRIMARY_THING_ID || env.PRIMARY_THING_ID || "building:floor1:elevator";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The simulator serves autonomous passenger traffic, so its door opens and
// closes on its own schedule. MOVE_TO_FLOOR is (correctly) rejected by the
// gate while the door is open; an expected-ACCEPTED move therefore waits for
// the door to be CLOSED before it is submitted — experiment control, not a
// gate bypass (the gate still re-checks the twin on admission). The first
// campaign execution without this wait is kept as evidence that the door
// interlock rejects moves live.
async function waitForDoorClosed(maxMs = 45000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${DITTO_URL}/api/2/things/${encodeURIComponent(THING_ID)}/features/door/properties/state`,
        { headers: { Authorization: DITTO_AUTH }, signal: AbortSignal.timeout(4000) },
      );
      if (response.ok) {
        const state = String(await response.json()).toUpperCase();
        if (state === "CLOSED") return true;
      }
    } catch { /* transient — keep polling */ }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Campaign plan. `expect` is the gate decision the catalog predicts; the
// summary reports every mismatch. `family` tags the rule family exercised.
// `gap` = milliseconds to wait BEFORE sending (cooldown tests use FAST_MS).
// ---------------------------------------------------------------------------
const R = "campaign step (GAPS M10 live command campaign)";
const STEPS = [
  // --- Phase 1: NORMAL mode — nominal accepts + stateless rejects ----------
  { family: "accepted/status",  expect: "ACCEPTED", body: { command: "REQUEST_STATUS_REFRESH" } },
  { family: "accepted/move",    expect: "ACCEPTED", body: { command: "MOVE_TO_FLOOR", target_floor: 2, reason: R } },
  { family: "cooldown",         expect: "REJECTED", gap: FAST_MS, body: { command: "MOVE_TO_FLOOR", target_floor: 2, reason: R } },
  { family: "required-fields",  expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", reason: R } },
  { family: "bounds",           expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", target_floor: 7, reason: R } },
  { family: "bounds",           expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", target_floor: -1, reason: R } },
  { family: "bounds",           expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", target_floor: 1.5, reason: R } },
  { family: "reason",           expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", target_floor: 1 } },
  { family: "catalog",          expect: "REJECTED", body: { command: "SELF_TEST_DANCE", reason: R } },
  { family: "catalog",          expect: "REJECTED", body: { command: "OPEN_SHAFT_DOORS", reason: R, confirmation: true } },
  { family: "accepted/door",    expect: "ACCEPTED", body: { command: "OPEN_DOOR", reason: R } },
  { family: "accepted/door",    expect: "ACCEPTED", body: { command: "CLOSE_DOOR", reason: R } },
  { family: "accepted/fan",     expect: "ACCEPTED", body: { command: "SET_FAN", fan_state: "ON", reason: R } },
  { family: "payload-validity", expect: "REJECTED", body: { command: "SET_FAN", fan_state: "TURBO", reason: R } },
  { family: "required-fields",  expect: "REJECTED", body: { command: "SET_FAN", reason: R } },
  { family: "accepted/fan",     expect: "ACCEPTED", body: { command: "SET_FAN", fan_state: "OFF", fan_mode: "MANUAL", reason: R } },
  { family: "accepted/diag",    expect: "ACCEPTED", body: { command: "DEVICE_DIAGNOSTIC", device_action: "BUZZER_TEST", reason: R, confirmation: true } },
  { family: "payload-validity", expect: "REJECTED", body: { command: "DEVICE_DIAGNOSTIC", device_action: "MELT_LCD", reason: R, confirmation: true } },
  { family: "confirmation",     expect: "REJECTED", body: { command: "DEVICE_DIAGNOSTIC", device_action: "BUZZER_TEST", reason: R } },
  { family: "accepted/policy",  expect: "ACCEPTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "UP_PEAK", reason: R } },
  { family: "policy-validity",  expect: "REJECTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "WARP_SPEED", reason: R } },
  { family: "required-fields",  expect: "REJECTED", body: { command: "SET_DISPATCH_POLICY", reason: R } },
  { family: "accepted/policy",  expect: "ACCEPTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "ECO_ENERGY", reason: R } },
  { family: "accepted/queue",   expect: "ACCEPTED", body: { command: "CLEAR_QUEUE", reason: R } },
  { family: "accepted/ack",     expect: "ACCEPTED", body: { command: "ACKNOWLEDGE_ALERT" } },
  { family: "accepted/move",    expect: "ACCEPTED", body: { command: "MOVE_TO_FLOOR", target_floor: 0, reason: R } },
  { family: "mode",             expect: "REJECTED", body: { command: "RESET_EMERGENCY", reason: R, confirmation: true } },
  { family: "mode",             expect: "REJECTED", body: { command: "RELEASE_LOCKDOWN", reason: R, confirmation: true } },
  { family: "mode",             expect: "REJECTED", body: { command: "RESUME_NORMAL_MODE", reason: R, confirmation: true } },

  // --- Phase 2: emergency-stop cycle ---------------------------------------
  { family: "confirmation",     expect: "REJECTED", body: { command: "EMERGENCY_STOP" } },
  { family: "accepted/estop",   expect: "ACCEPTED", body: { command: "EMERGENCY_STOP", confirmation: true } },
  { family: "mode",             expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", target_floor: 3, reason: R } },
  { family: "mode",             expect: "REJECTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "UP_PEAK", reason: R } },
  { family: "accepted/door",    expect: "ACCEPTED", body: { command: "OPEN_DOOR", reason: R } },
  { family: "confirmation",     expect: "REJECTED", body: { command: "RESET_EMERGENCY", reason: R } },
  { family: "accepted/reset",   expect: "ACCEPTED", body: { command: "RESET_EMERGENCY", reason: R, confirmation: true } },
  { family: "accepted/move",    expect: "ACCEPTED", body: { command: "MOVE_TO_FLOOR", target_floor: 1, reason: R } },

  // --- Phase 3: lockdown cycle ----------------------------------------------
  { family: "reason",           expect: "REJECTED", body: { command: "LOCKDOWN", confirmation: true } },
  { family: "accepted/lockdown", expect: "ACCEPTED", body: { command: "LOCKDOWN", reason: R, confirmation: true } },
  { family: "mode",             expect: "REJECTED", body: { command: "MOVE_TO_FLOOR", target_floor: 2, reason: R } },
  { family: "mode",             expect: "REJECTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "ECO_ENERGY", reason: R } },
  { family: "confirmation",     expect: "REJECTED", body: { command: "RELEASE_LOCKDOWN", reason: R } },
  { family: "accepted/release", expect: "ACCEPTED", body: { command: "RELEASE_LOCKDOWN", reason: R, confirmation: true } },
  { family: "accepted/recover", expect: "ACCEPTED", body: { command: "RESET_ACTIVE_PROBLEMS", reason: R, confirmation: true } },

  // --- Phase 4: maintenance cycle -------------------------------------------
  { family: "confirmation",     expect: "REJECTED", body: { command: "SET_MAINTENANCE_MODE", reason: R } },
  { family: "accepted/maint",   expect: "ACCEPTED", body: { command: "SET_MAINTENANCE_MODE", reason: R, confirmation: true } },
  { family: "mode",             expect: "REJECTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "NEAREST_GREEDY", reason: R } },
  { family: "accepted/resume",  expect: "ACCEPTED", body: { command: "RESUME_NORMAL_MODE", reason: R, confirmation: true } },

  // --- Phase 5: post-recovery accepts + cooldown re-check --------------------
  { family: "accepted/move",    expect: "ACCEPTED", body: { command: "MOVE_TO_FLOOR", target_floor: 3, reason: R } },
  { family: "cooldown",         expect: "REJECTED", gap: FAST_MS, body: { command: "MOVE_TO_FLOOR", target_floor: 3, reason: R } },
  { family: "accepted/policy",  expect: "ACCEPTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "BALANCED_INTERFLOOR", reason: R } },
  { family: "accepted/policy",  expect: "ACCEPTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "DOWN_PEAK", reason: R } },
  { family: "cooldown",         expect: "REJECTED", gap: FAST_MS, body: { command: "SET_DISPATCH_POLICY", policy_id: "HEALTH_LIMP", reason: R } },
  { family: "accepted/fan",     expect: "ACCEPTED", body: { command: "SET_FAN", fan_state: "OFF", fan_mode: "AUTO", reason: R } },
  { family: "accepted/status",  expect: "ACCEPTED", body: { command: "REQUEST_STATUS_REFRESH" } },
  { family: "accepted/policy",  expect: "ACCEPTED", body: { command: "SET_DISPATCH_POLICY", policy_id: "SCAN_COLLECTIVE", reason: "restore default policy; " + R } },
  { family: "accepted/recover", expect: "ACCEPTED", body: { command: "RESET_ACTIVE_PROBLEMS", reason: "restore healthy baseline; " + R, confirmation: true } },
];

async function main() {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().slice(0, 10);
  const outDir = path.join(ROOT, "evidence", "command-campaign");
  mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, `campaign-${stamp}.jsonl`);
  const summaryPath = path.join(outDir, `campaign-${stamp}-summary.json`);
  writeFileSync(jsonlPath, "");

  const results = [];
  for (let i = 0; i < STEPS.length; i += 1) {
    const step = STEPS[i];
    await sleep(step.gap ?? GAP_MS);
    if (step.body.command === "MOVE_TO_FLOOR" && step.expect === "ACCEPTED") {
      await waitForDoorClosed();
    }
    const sentAt = new Date().toISOString();
    let record;
    try {
      let response;
      let payload;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: AUTH },
            body: JSON.stringify(step.body),
            signal: AbortSignal.timeout(20000),
          });
          payload = await response.json();
          break;
        } catch (transportError) {
          if (attempt >= 1) throw transportError;   // one retry for transient dev-server hiccups
          await sleep(4000);
        }
      }
      record = {
        seq: i + 1,
        family: step.family,
        expect: step.expect,
        sent_at: sentAt,
        request: step.body,
        http_status: response.status,
        command_id: payload.command_id ?? null,
        decision: payload.decision ?? null,
        accepted: payload.accepted ?? null,
        rejection_reasons: payload.rejection_reasons ?? [],
        ditto_write_status: payload.ditto_write_status ?? null,
        device_command_status: payload.device_command_status ?? null,
        system_mode: payload.system_mode ?? null,
        risk_score: payload.risk_score ?? null,
        match: payload.decision === step.expect,
      };
    } catch (error) {
      record = {
        seq: i + 1, family: step.family, expect: step.expect, sent_at: sentAt,
        request: step.body, http_status: null, decision: "TRANSPORT_ERROR",
        error: error.message, match: false,
      };
    }
    results.push(record);
    appendFileSync(jsonlPath, JSON.stringify(record) + "\n");
    const flag = record.match ? "ok " : "MISMATCH";
    console.log(
      `[${String(record.seq).padStart(2, "0")}/${STEPS.length}] ${flag} ` +
      `${step.body.command} -> ${record.decision} (${step.expect} expected) ` +
      `ditto=${record.ditto_write_status} mode=${record.system_mode}`,
    );
  }

  // ------------------------------------------------------------------ summary
  const accepted = results.filter((r) => r.decision === "ACCEPTED");
  const rejected = results.filter((r) => r.decision === "REJECTED");
  const mismatches = results.filter((r) => !r.match);
  const rejectedNotSkipped = rejected.filter((r) => r.ditto_write_status !== "SKIPPED");
  const acceptedNotSucceeded = accepted.filter((r) => r.ditto_write_status !== "SUCCEEDED");
  const byFamily = {};
  for (const r of results) {
    byFamily[r.family] = byFamily[r.family] || { total: 0, accepted: 0, rejected: 0 };
    byFamily[r.family].total += 1;
    if (r.decision === "ACCEPTED") byFamily[r.family].accepted += 1;
    if (r.decision === "REJECTED") byFamily[r.family].rejected += 1;
  }
  const byCommand = {};
  for (const r of results) {
    const c = r.request.command;
    byCommand[c] = byCommand[c] || { total: 0, accepted: 0, rejected: 0 };
    byCommand[c].total += 1;
    if (r.decision === "ACCEPTED") byCommand[c].accepted += 1;
    if (r.decision === "REJECTED") byCommand[c].rejected += 1;
  }

  const summary = {
    campaign: "GAPS M10 live command campaign",
    api: API,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    total_commands: results.length,
    accepted: accepted.length,
    rejected: rejected.length,
    transport_errors: results.filter((r) => r.decision === "TRANSPORT_ERROR").length,
    expected_decision_mismatches: mismatches.map((m) => ({ seq: m.seq, command: m.request.command, expected: m.expect, got: m.decision, reasons: m.rejection_reasons })),
    zero_write_invariant: {
      rejected_total: rejected.length,
      rejected_with_skipped_writes: rejected.length - rejectedNotSkipped.length,
      violations: rejectedNotSkipped.map((r) => ({ seq: r.seq, command: r.request.command, ditto_write_status: r.ditto_write_status })),
    },
    accepted_write_status: {
      accepted_total: accepted.length,
      accepted_with_succeeded_writes: accepted.length - acceptedNotSucceeded.length,
      exceptions: acceptedNotSucceeded.map((r) => ({ seq: r.seq, command: r.request.command, ditto_write_status: r.ditto_write_status })),
    },
    by_family: byFamily,
    by_command: byCommand,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log("\n===== CAMPAIGN SUMMARY =====");
  console.log(`total=${summary.total_commands} accepted=${summary.accepted} rejected=${summary.rejected} errors=${summary.transport_errors}`);
  console.log(`expected-decision mismatches: ${mismatches.length}`);
  console.log(`zero-write invariant: ${summary.zero_write_invariant.rejected_with_skipped_writes}/${rejected.length} rejected rows SKIPPED (violations: ${rejectedNotSkipped.length})`);
  console.log(`accepted writes SUCCEEDED: ${summary.accepted_write_status.accepted_with_succeeded_writes}/${accepted.length}`);
  console.log(`artifacts: ${jsonlPath}\n           ${summaryPath}`);
  if (mismatches.length > 0 || rejectedNotSkipped.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("campaign failed:", error);
  process.exitCode = 1;
});
