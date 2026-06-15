#!/usr/bin/env node
/**
 * SET_DISPATCH_POLICY — command-safety-gate test suite.
 *
 * Uses node:test (built into Node >=18). Run from repo root:
 *     node scripts/validation/test-dispatch-safety-gate.mjs
 *
 * Verifies that the adaptive dispatch policy command is admitted ONLY when it
 * is well-formed and the elevator is in a service mode, that unknown policies
 * are rejected, that safety states (e-stop / lockdown / overload / forced
 * entry) block it, and that an accepted command carries the Ditto write plan
 * for features/control/properties/dispatch_policy — while a rejected one
 * carries zero writes (the gate cannot fail open).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateCommand,
  normalizeCommand,
  getCommandSpec,
  canonicalCommandName,
  _resetCooldownLedgerForTests,
} from "../../packages/shared/commandSafetyGate.js";

const NOW_MS = Date.parse("2026-05-31T20:00:00Z");
const FRESH_TS = "2026-05-31T19:59:55Z";   // 5s old, within MAX_TWIN_AGE
const THING = "building:floor1:elevator";

function freshTwin(overrides = {}) {
  return {
    last_telemetry_at: FRESH_TS,
    attributes: { system_mode: "NORMAL", risk_score: 10, ...(overrides.attributes || {}) },
    features: {
      cabin: { properties: { current_floor: 0, target_floor: 0, emergency_stop: false, load_kg: 120, ...(overrides.cabin || {}) } },
      door: { properties: { state: "CLOSED", door_forced_entry: false, ...(overrides.door || {}) } },
      security: { properties: { alert_level: "NORMAL", ...(overrides.security || {}) } },
    },
  };
}

function policyCommand(overrides = {}) {
  return {
    command: "SET_DISPATCH_POLICY",
    source: "n8n",
    source_agent: "dispatch_policy_engine",
    policy_id: "UP_PEAK",
    dispatch_params: { park_floor: 0, direction_bias: 1 },
    reason: ["morning up-peak detected"],
    ...overrides,
  };
}

function ctx(extra = {}) {
  return { now: NOW_MS, max_load_kg: 800, ditto_reachable: true, ...extra };
}

test("setup: command resolves and alias works", () => {
  assert.equal(canonicalCommandName("SET_DISPATCH_POLICY"), "SET_DISPATCH_POLICY");
  assert.equal(canonicalCommandName("DISPATCH_POLICY"), "SET_DISPATCH_POLICY");
  assert.ok(getCommandSpec("SET_DISPATCH_POLICY"));
});

test("accepts a well-formed policy from the Brain A engine", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand(), freshTwin(), ctx());
  assert.equal(d.decision, "ACCEPTED");
  assert.ok(d.ditto_writes.length >= 4);
  const active = d.ditto_writes.find((w) => w.path.endsWith("dispatch_policy/active_policy"));
  assert.equal(active.value, "UP_PEAK");
  const params = d.ditto_writes.find((w) => w.path.endsWith("dispatch_policy/params"));
  assert.deepEqual(params.value, { park_floor: 0, direction_bias: 1 });
});

test("normalises policy_id to upper-case at the boundary", () => {
  const n = normalizeCommand(policyCommand({ policy_id: "eco_energy" }));
  assert.equal(n.policy_id, "ECO_ENERGY");
});

test("rejects an unknown dispatch policy with zero writes", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand({ policy_id: "TELEPORT" }), freshTwin(), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.ok(d.rejection_reasons.some((r) => /unknown dispatch policy/i.test(r)));
  assert.equal(d.ditto_writes.length, 0);
});

test("rejects a missing policy_id", () => {
  _resetCooldownLedgerForTests();
  const cmd = policyCommand();
  delete cmd.policy_id;
  const d = validateCommand(cmd, freshTwin(), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.ok(d.rejection_reasons.some((r) => /missing required field 'policy_id'/i.test(r)));
});

test("rejects when system is in LOCKDOWN", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand(), freshTwin({ attributes: { system_mode: "LOCKDOWN" } }), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.equal(d.ditto_writes.length, 0);
});

test("rejects when system is in MAINTENANCE", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand(), freshTwin({ attributes: { system_mode: "MAINTENANCE" } }), ctx());
  assert.equal(d.decision, "REJECTED");
});

test("rejects while emergency stop is active", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand(), freshTwin({ cabin: { emergency_stop: true } }), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.ok(d.rejection_reasons.some((r) => /emergency stop active/i.test(r)));
});

test("rejects under overload", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand(), freshTwin({ cabin: { load_kg: 920 } }), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.ok(d.rejection_reasons.some((r) => /overload/i.test(r)));
});

test("rejects under forced entry", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand(), freshTwin({ door: { door_forced_entry: true } }), ctx());
  assert.equal(d.decision, "REJECTED");
});

test("blocks autonomous policy churn in a high-risk state", () => {
  _resetCooldownLedgerForTests();
  // n8n is autonomous; risk above MAX_RISK_AUTO_CONTROL (70) must block it.
  const d = validateCommand(policyCommand(), freshTwin({ attributes: { risk_score: 80 } }), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.ok(d.rejection_reasons.some((r) => /risk/i.test(r)));
});

test("an operator override carries confidence + reason into the write plan", () => {
  _resetCooldownLedgerForTests();
  const d = validateCommand(policyCommand({
    source: "operator",
    source_agent: "operator-console",
    metadata: { confidence: 0.82, brain_id: "scorer_v1" },
  }), freshTwin(), ctx());
  assert.equal(d.decision, "ACCEPTED");
  const conf = d.ditto_writes.find((w) => w.path.endsWith("dispatch_policy/confidence"));
  assert.equal(conf.value, 0.82);
  const reason = d.ditto_writes.find((w) => w.path.endsWith("dispatch_policy/reason"));
  assert.ok(/up-peak/i.test(reason.value));
});

test("requires an operator reason (audit contract)", () => {
  _resetCooldownLedgerForTests();
  const cmd = policyCommand();
  delete cmd.reason;
  const d = validateCommand(cmd, freshTwin(), ctx());
  assert.equal(d.decision, "REJECTED");
  assert.ok(d.rejection_reasons.some((r) => /reason/i.test(r)));
});
