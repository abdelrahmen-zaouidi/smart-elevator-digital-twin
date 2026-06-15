/**
 * Dispatch Orchestrator — turns a twin snapshot into an actionable decision.
 *
 * This is the engine's testable heart. It does NOT perform I/O: no Ditto fetch,
 * no DB, no MQTT, no HTTP. Given a twin (and optional injected signals) it:
 *
 *   1. reconstructs `previous` straight from the twin (Ditto is the source of
 *      truth — hysteresis state lives in features/control/properties);
 *   2. builds the shared context vector;
 *   3. runs the ACTIVE brain (Brain A scorer) for the binding decision;
 *   4. runs any STANDBY brains in shadow (recorded, never applied);
 *   5. when the policy actually changed, builds the SET_DISPATCH_POLICY command
 *      and previews it through the safety gate (read-only — no cooldown record);
 *   6. returns a plan the live runner / API route can act on.
 *
 * The authoritative gate (with cooldown recording + Ditto write) still runs once
 * in /api/commands; this module uses getRejectionReasons() for a side-effect-
 * free preview so previewing can never block the real command.
 *
 * Safety overrides (fire / e-stop / lockdown / overload) are actuated by the
 * firmware and dedicated safety commands — NOT by SET_DISPATCH_POLICY — so when
 * one is active the orchestrator surfaces it but emits no policy command.
 */

import { buildContext } from "./context.js";
import { createScorerBrain } from "./scorer.js";
import { normalizeCommand, getRejectionReasons } from "../commandSafetyGate.js";

// -----------------------------------------------------------------------------
// extractPreviousDecision — read the last decision back from the twin so the
// scorer's hysteresis works across ticks without any external state store.
// -----------------------------------------------------------------------------
export function extractPreviousDecision(twin) {
  const dp = twin?.features?.control?.properties?.dispatch_policy;
  if (!dp || !dp.active_policy) return null;
  return {
    policy_id: dp.active_policy,
    selected_at: dp.selected_at || null,
    min_dwell_until: dp.min_dwell_until || null,
    overridden_by: dp.overridden_by || null,
  };
}

function thingIdOf(twin, options) {
  return options.thing_id || twin?.thingId || twin?.thing_id || null;
}

// -----------------------------------------------------------------------------
// previewGate — non-recording admissibility check. Uses getRejectionReasons,
// which never records cooldown, so it cannot interfere with the authoritative
// gate run in /api/commands.
// -----------------------------------------------------------------------------
function previewGate(command, twin, context, options, now) {
  const norm = normalizeCommand(command);
  const { reasons } = getRejectionReasons(norm, twin, {
    now,
    max_load_kg: context.load.max_load_kg,
    ditto_reachable: options.ditto_reachable !== false,
    ...(options.gateContext || {}),
  });
  return { accepted: reasons.length === 0, rejection_reasons: reasons };
}

// -----------------------------------------------------------------------------
// planDispatchUpdate — the public entry point.
//
//   twin    : Ditto Thing snapshot.
//   options : { now, signals, previous, brain, shadowBrains, scorerConfig,
//               contextConfig, source, source_agent, thing_id, human_approved,
//               ditto_reachable, gateContext }
//
// Returns:
//   { decision, shadow, context, previous, changed, command,
//     gate_preview, should_dispatch, skip_reason }
// -----------------------------------------------------------------------------
export function planDispatchUpdate(twin, options = {}) {
  const now = options.now ?? Date.now();
  const signals = options.signals || {};
  const previous = options.previous !== undefined
    ? options.previous
    : extractPreviousDecision(twin);

  const context = buildContext(twin, { now, signals, config: options.contextConfig });
  const brain = options.brain || createScorerBrain(options.scorerConfig);
  const decision = brain.decide(context, { previous, now, config: options.scorerConfig });

  // Standby brains (Brain B later) — observed, never applied. Fail-safe: a
  // broken shadow brain must never affect the active decision.
  const shadow = (options.shadowBrains || []).map((b) => {
    try {
      return { brain: b.id, decision: b.decide(context, { previous, now }) };
    } catch (error) {
      return { brain: b.id, error: String(error?.message || error) };
    }
  });

  // Safety override active → no policy command (the override id is not a
  // selectable policy and the firmware owns the actuation).
  if (decision.overridden_by) {
    return {
      decision, shadow, context, previous,
      changed: previous?.overridden_by !== decision.overridden_by,
      command: null,
      gate_preview: null,
      should_dispatch: false,
      skip_reason: `safety override active: ${decision.overridden_by}`,
    };
  }

  // Emit a command only when the policy actually changes — otherwise we would
  // rewrite the twin every tick and spam the audit log.
  const changed = !previous || previous.policy_id !== decision.policy_id;

  const command = {
    command: "SET_DISPATCH_POLICY",
    source: options.source || "n8n",
    source_agent: options.source_agent || "dispatch_policy_engine",
    thing_id: thingIdOf(twin, options),
    policy_id: decision.policy_id,
    dispatch_params: decision.params,
    reason: [decision.reason],
    human_approved: options.human_approved === true,
    metadata: {
      brain_id: decision.brain_id,
      confidence: decision.confidence,
      selected_at: decision.selected_at,
      min_dwell_until: decision.min_dwell_until,
      previous_policy: decision.previous_policy,
    },
  };

  if (!changed) {
    return {
      decision, shadow, context, previous, changed: false, command,
      gate_preview: null,
      should_dispatch: false,
      skip_reason: "policy unchanged within stability window",
    };
  }

  const gate_preview = previewGate(command, twin, context, options, now);

  return {
    decision, shadow, context, previous, changed: true, command,
    gate_preview,
    should_dispatch: gate_preview.accepted,
    skip_reason: gate_preview.accepted ? null : "rejected by safety gate",
  };
}
