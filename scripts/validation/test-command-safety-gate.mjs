#!/usr/bin/env node
/**
 * Command Safety Gate — deterministic test suite.
 *
 * Uses node:test (built into Node >=18). No external test framework required.
 * Run from repo root:
 *     node scripts/validation/test-command-safety-gate.mjs
 *
 * Each test exercises one rule in packages/shared/commandSafetyGate.js.
 * The suite verifies BOTH that accepted commands carry a Ditto-write plan
 * AND that rejected commands carry zero Ditto writes — i.e. the gate cannot
 * "fail open".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateCommand,
  buildCommandDecision,
  normalizeCommand,
  isCommandAllowed,
  canonicalCommandName,
  getCommandSpec,
  createCommandId,
  createCorrelationId,
  extractSafetySnapshot,
  COMMAND_CATALOG,
  ALLOWED_SOURCES,
  _resetCooldownLedgerForTests,
} from "../../packages/shared/commandSafetyGate.js";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
const NOW_MS = Date.parse("2026-05-13T20:00:00Z");
const FRESH_TS = "2026-05-13T19:59:55Z";   // 5s old, within MAX_TWIN_AGE
const STALE_TS = "2026-05-13T19:59:30Z";   // 30s old, beyond MAX_TWIN_AGE
const THING = "building:floor1:elevator";

function freshTwin(overrides = {}) {
  return {
    last_telemetry_at: FRESH_TS,
    attributes: {
      system_mode: "NORMAL",
      risk_score: 10,
      ...(overrides.attributes || {}),
    },
    features: {
      cabin: {
        properties: {
          current_floor: 0,
          target_floor: 0,
          emergency_stop: false,
          load_kg: 100,
          ...(overrides.cabin || {}),
        },
      },
      door: {
        properties: {
          state: "CLOSED",
          door_forced_entry: false,
          ...(overrides.door || {}),
        },
      },
      security: {
        properties: {
          alert_level: "NORMAL",
          active_security_incident: false,
          ...(overrides.security || {}),
        },
      },
    },
  };
}

function ctx(extra = {}) {
  return { now: NOW_MS, ...extra };
}

function freshGateContext() {
  _resetCooldownLedgerForTests();
  return ctx();
}

// -----------------------------------------------------------------------------
// 1. Catalog integrity
// -----------------------------------------------------------------------------
test("catalog covers the 12 required canonical commands", () => {
  const required = [
    "MOVE_TO_FLOOR", "OPEN_DOOR", "CLOSE_DOOR",
    "EMERGENCY_STOP", "RESET_EMERGENCY",
    "LOCKDOWN", "RELEASE_LOCKDOWN",
    "SET_MAINTENANCE_MODE", "RESUME_NORMAL_MODE",
    "ACKNOWLEDGE_ALERT", "CLEAR_RESOLVED_INCIDENT",
    "REQUEST_STATUS_REFRESH",
  ];
  for (const cmd of required) {
    assert.ok(COMMAND_CATALOG[cmd], `catalog missing canonical command ${cmd}`);
  }
});

test("ALLOWED_SOURCES enumerates exactly the four supported sources", () => {
  assert.deepEqual([...ALLOWED_SOURCES].sort(),
    ["dashboard", "n8n", "operator", "system"]);
});

test("aliases resolve to canonical names", () => {
  assert.equal(canonicalCommandName("REPOSITION"), "MOVE_TO_FLOOR");
  assert.equal(canonicalCommandName("send_to_floor"), "MOVE_TO_FLOOR");
  assert.equal(canonicalCommandName("RESUME_NORMAL"), "RESET_EMERGENCY");
  assert.equal(canonicalCommandName("DOOR_HOLD_OPEN"), "OPEN_DOOR");
  assert.equal(canonicalCommandName(""), null);
  assert.equal(canonicalCommandName("FRY_THE_MOTOR"), null);
});

test("isCommandAllowed gates the alias map", () => {
  assert.ok(isCommandAllowed("EMERGENCY_STOP"));
  assert.ok(isCommandAllowed("REPOSITION"));
  assert.equal(isCommandAllowed("DROP_CABIN"), false);
});

// -----------------------------------------------------------------------------
// 2. ID generators
// -----------------------------------------------------------------------------
test("createCommandId and createCorrelationId return distinct strings", () => {
  const a = createCommandId();
  const b = createCommandId();
  assert.match(a, /^CMD-/);
  assert.notEqual(a, b);
  const c = createCorrelationId();
  assert.match(c, /^CID-/);
});

// -----------------------------------------------------------------------------
// 3. normalizeCommand
// -----------------------------------------------------------------------------
test("normalizeCommand fills defaults and resolves aliases", () => {
  const n = normalizeCommand({ command: "REPOSITION", target_floor: 3 });
  assert.equal(n.raw_command_name, "REPOSITION");
  assert.equal(n.canonical_command, "MOVE_TO_FLOOR");
  assert.equal(n.target_floor, 3);
  assert.ok(n.command_id.startsWith("CMD-"));
  assert.ok(n.correlation_id.startsWith("CID-"));
  assert.deepEqual(n.reason, []);
});

test("normalizeCommand accepts reason as string or array", () => {
  assert.deepEqual(normalizeCommand({ reason: "test" }).reason, ["test"]);
  assert.deepEqual(normalizeCommand({ reason: ["a", "b"] }).reason, ["a", "b"]);
  assert.deepEqual(normalizeCommand({ reason: ["", null, "x"] }).reason, ["x"]);
});

// -----------------------------------------------------------------------------
// 4. Allow-list — unknown command is rejected
// -----------------------------------------------------------------------------
test("unknown command is rejected", () => {
  const decision = validateCommand(
    { command: "DROP_CABIN", source: "dashboard", source_agent: "op", reason: "x", confirmation: true },
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r.includes("not in allow-list")));
  assert.deepEqual(decision.ditto_writes, []);
});

// -----------------------------------------------------------------------------
// 5. MOVE_TO_FLOOR — target validation
// -----------------------------------------------------------------------------
test("MOVE_TO_FLOOR with valid target is accepted", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 3, source: "dashboard",
      source_agent: "operator-1", reason: "passenger request" },
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, true, decision.rejection_reasons.join(", "));
  assert.equal(decision.decision, "ACCEPTED");
  assert.ok(decision.ditto_writes.length > 0, "must produce Ditto writes");
  assert.equal(decision.ditto_writes[0].path, "features/cabin/properties/target_floor");
  assert.equal(decision.ditto_writes[0].value, 3);
});

test("MOVE_TO_FLOOR with out-of-range target is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 99, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r.includes("target floor outside allowed range")));
  assert.deepEqual(decision.ditto_writes, []);
});

test("MOVE_TO_FLOOR with negative target is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: -1, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r.includes("target floor outside allowed range")));
});

// -----------------------------------------------------------------------------
// 6. System mode gating
// -----------------------------------------------------------------------------
test("movement during LOCKDOWN is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin({ attributes: { system_mode: "LOCKDOWN" } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r === "REJECTED: system in LOCKDOWN"));
  assert.deepEqual(decision.ditto_writes, []);
});

test("movement during MAINTENANCE is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin({ attributes: { system_mode: "MAINTENANCE" } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r === "REJECTED: system in MAINTENANCE"));
});

// -----------------------------------------------------------------------------
// 7. Physical guards
// -----------------------------------------------------------------------------
test("movement while emergency stop active is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin({ cabin: { emergency_stop: true } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r === "REJECTED: emergency stop active"));
});

test("movement while overload active is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin({ cabin: { load_kg: 950 } }),
    { ...freshGateContext(), max_load_kg: 800 },
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r === "REJECTED: overload detected"));
});

test("movement while door forced-entry active is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "test" },
    freshTwin({ door: { door_forced_entry: true } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r === "REJECTED: door forced-entry active"));
});

// -----------------------------------------------------------------------------
// 8. EMERGENCY_STOP — always-allowed semantics
// -----------------------------------------------------------------------------
test("EMERGENCY_STOP is accepted even in high-risk mode", () => {
  const decision = validateCommand(
    { command: "EMERGENCY_STOP", source: "dashboard",
      source_agent: "operator-1", confirmation: true },
    freshTwin({ attributes: { system_mode: "DEGRADED", risk_score: 99 } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, true, decision.rejection_reasons.join(", "));
  assert.equal(decision.decision, "ACCEPTED");
  assert.ok(decision.ditto_writes.some((w) => w.path === "features/cabin/properties/emergency_stop" && w.value === true));
});

test("EMERGENCY_STOP from autonomous source still accepted", () => {
  const decision = validateCommand(
    { command: "EMERGENCY_STOP", source: "n8n",
      source_agent: "03_control_agent", confirmation: true },
    freshTwin({ attributes: { system_mode: "DEGRADED", risk_score: 95 } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, true);
});

test("EMERGENCY_STOP without confirmation is rejected", () => {
  const decision = validateCommand(
    { command: "EMERGENCY_STOP", source: "dashboard",
      source_agent: "operator-1" }, // no confirmation:true
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r.includes("requires human confirmation")));
});

// -----------------------------------------------------------------------------
// 9. RESET_EMERGENCY — human-only, requires reason, blocked by critical incident
// -----------------------------------------------------------------------------
test("RESET_EMERGENCY from autonomous source is rejected", () => {
  const decision = validateCommand(
    { command: "RESET_EMERGENCY", source: "n8n",
      source_agent: "03_control_agent", reason: "auto", confirmation: true },
    freshTwin({ attributes: { system_mode: "MAINTENANCE" } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /human|recovery/i.test(r)));
});

test("RESET_EMERGENCY without reason is rejected", () => {
  const decision = validateCommand(
    { command: "RESET_EMERGENCY", source: "dashboard",
      source_agent: "operator-1", confirmation: true },
    freshTwin({ attributes: { system_mode: "MAINTENANCE" } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => r === "REJECTED: missing operator reason"));
});

test("RESET_EMERGENCY blocked by active critical security incident", () => {
  const decision = validateCommand(
    { command: "RESET_EMERGENCY", source: "dashboard",
      source_agent: "operator-1", reason: "investigated", confirmation: true },
    freshTwin({
      attributes: { system_mode: "LOCKDOWN", risk_score: 20 },
      security: { active_security_incident: true, alert_level: "CRITICAL" },
    }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /critical incident/i.test(r)));
});

// -----------------------------------------------------------------------------
// 10. Risk thresholds — autonomous vs operator
// -----------------------------------------------------------------------------
test("autonomous movement above MAX_RISK_AUTO_CONTROL is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "n8n",
      source_agent: "control", reason: "test" },
    freshTwin({ attributes: { risk_score: 80 } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /risk/i.test(r)));
});

test("operator movement just under MAX_RISK_OPERATOR_CONTROL is still subject to per-command cap", () => {
  // MOVE_TO_FLOOR max_risk_score is 70; risk_score 75 > 70.
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "dashboard",
      source_agent: "op", reason: "x" },
    freshTwin({ attributes: { risk_score: 75 } }),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /risk/i.test(r)));
});

// -----------------------------------------------------------------------------
// 11. Stale twin
// -----------------------------------------------------------------------------
test("stale twin rejects non-emergency commands", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "dashboard",
      source_agent: "op", reason: "x" },
    { ...freshTwin(), last_telemetry_at: STALE_TS },
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /stale/i.test(r)));
});

test("stale twin still allows EMERGENCY_STOP", () => {
  const decision = validateCommand(
    { command: "EMERGENCY_STOP", source: "dashboard",
      source_agent: "op", confirmation: true },
    { ...freshTwin(), last_telemetry_at: STALE_TS },
    freshGateContext(),
  );
  assert.equal(decision.accepted, true);
});

// -----------------------------------------------------------------------------
// 12. Source admission
// -----------------------------------------------------------------------------
test("unknown source is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "rogue",
      source_agent: "?", reason: "x" },
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /unauthorized command source/i.test(r)));
});

test("missing source_agent is rejected", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "dashboard", reason: "x" },
    freshTwin(),
    freshGateContext(),
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /source_agent/i.test(r)));
});

// -----------------------------------------------------------------------------
// 13. Cooldown
// -----------------------------------------------------------------------------
test("duplicate command within cooldown window is rejected", () => {
  _resetCooldownLedgerForTests();
  const first = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "x", thing_id: THING },
    freshTwin(),
    { now: NOW_MS },
  );
  assert.equal(first.accepted, true);

  const second = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "x", thing_id: THING },
    freshTwin(),
    { now: NOW_MS + 500 },  // 0.5 s later, inside 3 s cooldown
  );
  assert.equal(second.accepted, false);
  assert.ok(second.rejection_reasons.some((r) => /cooldown/i.test(r)));
});

test("same command after cooldown elapsed is accepted again", () => {
  _resetCooldownLedgerForTests();
  validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "x", thing_id: THING },
    freshTwin(),
    { now: NOW_MS },
  );
  const third = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 2, source: "dashboard",
      source_agent: "op", reason: "x", thing_id: THING },
    freshTwin(),
    { now: NOW_MS + 5000 }, // > 3 s cooldown
  );
  assert.equal(third.accepted, true);
});

// -----------------------------------------------------------------------------
// 14. Ditto unreachable
// -----------------------------------------------------------------------------
test("commands rejected when Ditto is unreachable", () => {
  const decision = validateCommand(
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "dashboard",
      source_agent: "op", reason: "x" },
    freshTwin(),
    { ...freshGateContext(), ditto_reachable: false },
  );
  assert.equal(decision.accepted, false);
  assert.ok(decision.rejection_reasons.some((r) => /ditto unavailable/i.test(r)));
});

// -----------------------------------------------------------------------------
// 15. Universal "rejected => no Ditto write" invariant
// -----------------------------------------------------------------------------
test("INVARIANT: rejected decisions NEVER carry Ditto writes", () => {
  const cases = [
    { command: "DROP_CABIN", source: "dashboard", source_agent: "op", reason: "x" },
    { command: "MOVE_TO_FLOOR", target_floor: 999, source: "dashboard", source_agent: "op", reason: "x" },
    { command: "MOVE_TO_FLOOR", target_floor: 1, source: "rogue", source_agent: "?", reason: "x" },
    { command: "RESET_EMERGENCY", source: "n8n", source_agent: "a", reason: "x", confirmation: true },
    { command: "EMERGENCY_STOP", source: "dashboard", source_agent: "op" }, // no confirmation
  ];
  _resetCooldownLedgerForTests();
  for (const cmd of cases) {
    const decision = validateCommand(cmd, freshTwin(), ctx());
    if (decision.accepted) continue;
    assert.deepEqual(decision.ditto_writes, [],
      `${cmd.command} rejected but produced writes: ${JSON.stringify(decision.ditto_writes)}`);
    assert.equal(decision.ditto_write_allowed, false);
  }
});

// -----------------------------------------------------------------------------
// 16. extractSafetySnapshot
// -----------------------------------------------------------------------------
test("extractSafetySnapshot pulls the canonical safety slice", () => {
  const snap = extractSafetySnapshot(freshTwin({
    attributes: { system_mode: "DEGRADED", risk_score: 42 },
    cabin: { load_kg: 250 },
    door: { state: "OPEN" },
    security: { alert_level: "WARNING" },
  }));
  assert.equal(snap.system_mode, "DEGRADED");
  assert.equal(snap.risk_score, 42);
  assert.equal(snap.load_kg, 250);
  assert.equal(snap.door_state, "OPEN");
  assert.equal(snap.alert_level, "WARNING");
  assert.equal(snap.current_floor, 0);
});
