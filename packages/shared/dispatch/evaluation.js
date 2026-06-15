/**
 * Brain evaluation & promotion gates (pure, deterministic).
 *
 * The champion–challenger decision in one place:
 *   - simulateOutcome(context, policyId) — a transparent OFFLINE proxy for the
 *     KPIs a policy would realise in a given context. (For demos/tests; the live
 *     system uses real dispatch_outcome rows. The sim-to-real gap is a
 *     documented thesis limitation.)
 *   - evaluateBrains(scenarios, active, challenger) — replays both brains over
 *     scenarios, scores each with the shared reward function, and reports
 *     agreement, mean reward, fairness regressions and safety violations.
 *   - evaluatePromotion(summary, gates) — checks the promotion gates and returns
 *     a PASS/FAIL report. A human still flips DISPATCH_ACTIVE_BRAIN; this only
 *     advises.
 *
 * No I/O. The runner script (scripts/dispatch/evaluate-brains.mjs) provides the
 * scenarios and prints the report.
 */

import { computeReward, machineStressProxy } from "./reward.js";

const ENERGY_SAVING = new Set(["ECO_ENERGY", "NEAREST_GREEDY"]);
const GENTLE = new Set(["ECO_ENERGY", "HEALTH_LIMP"]);

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/**
 * simulateOutcome — transparent proxy outcome for (context, policy).
 * Rewards picking the regime-appropriate policy: matching demand cuts wait,
 * eco/gentle policies cut energy & stress, but energy-saving under a starving
 * call incurs a fairness penalty, and aggressive policies stress a hot machine.
 */
export function simulateOutcome(ctx, policyId) {
  const t = ctx.traffic, e = ctx.energy, h = ctx.health;
  const pending = t.pending_count;
  const degraded = h.motor_temp_c > 70 || h.vibration > 0.12 || h.rul_fraction < 0.25;
  const peak = ctx.temporal.tariff_window === "PEAK";

  // Base wait grows with queue + how long the oldest call already waited.
  let wait = 6 + pending * 6 + t.longest_wait_s * 0.4;
  // Direction-matching peak policies clear queues faster.
  if (policyId === "UP_PEAK" && t.up_down_ratio > 0.6) wait *= 0.7;
  if (policyId === "DOWN_PEAK" && t.up_down_ratio < 0.4) wait *= 0.7;
  if (policyId === "NEAREST_GREEDY" && pending <= 2) wait *= 0.8;
  if (policyId === "BALANCED_INTERFLOOR" && Math.abs(t.up_down_ratio - 0.5) < 0.15) wait *= 0.85;
  // Energy-saving policies trade wait for energy when demand is high.
  if (ENERGY_SAVING.has(policyId) && pending >= 4) wait *= 1.4;

  // Energy: gentle/eco save; fast policies cost more, worse under peak tariff.
  let energy = e.power_kw * 0.05 * (1 + pending * 0.15);
  if (GENTLE.has(policyId)) energy *= 0.7;
  if (peak && !GENTLE.has(policyId)) energy *= 1.2;

  // Machine stress: gentle policies protect a degrading machine; aggressive
  // policies make it worse.
  const dutyStress = machineStressProxy({
    motor_temp_c: h.motor_temp_c, vibration: h.vibration, duty_fraction: clamp(pending / 8, 0, 1),
  });
  let stress = dutyStress;
  if (policyId === "HEALTH_LIMP") stress *= 0.6;
  else if (GENTLE.has(policyId)) stress *= 0.8;
  else if (degraded) stress *= 1.25;

  // Fairness: energy-saving while a call starves past the SLA is penalised.
  let fairness = Math.max(0, (t.longest_wait_s - 90) / 90);
  if (ENERGY_SAVING.has(policyId) && t.longest_wait_s > 90) fairness += 0.5;

  return {
    avg_wait_s: +wait.toFixed(2),
    energy_kwh: +energy.toFixed(4),
    machine_stress: +stress.toFixed(4),
    trips: pending,
    fairness_penalty: +fairness.toFixed(4),
    safety_violation: false,
  };
}

function rewardForDecision(ctx, decision, weights) {
  // Overrides are not policy choices — neutral reward so they don't skew A/B.
  if (decision.overridden_by) return 0;
  const kpis = simulateOutcome(ctx, decision.policy_id);
  return computeReward(kpis, weights).reward;
}

/**
 * evaluateBrains — replay both brains over scenarios (array of context vectors).
 * Returns a summary the promotion gates consume.
 */
export function evaluateBrains(scenarios, activeBrain, challengerBrain, options = {}) {
  const weights = options.weights;
  let agree = 0, sumA = 0, sumB = 0, fairnessRegress = 0, safetyB = 0, n = 0;

  for (const ctx of scenarios) {
    const a = activeBrain.decide(ctx, { now: ctx.now_ms });
    const b = challengerBrain.decide(ctx, { now: ctx.now_ms });
    if (a.overridden_by) continue;   // skip override states — not policy decisions
    n++;
    if (a.policy_id === b.policy_id) agree++;

    const rA = rewardForDecision(ctx, a, weights);
    const rB = rewardForDecision(ctx, b, weights);
    sumA += rA; sumB += rB;

    const oB = b.overridden_by ? null : simulateOutcome(ctx, b.policy_id);
    const oA = simulateOutcome(ctx, a.policy_id);
    if (oB && oB.fairness_penalty > oA.fairness_penalty + 1e-9) fairnessRegress++;
    if (oB && oB.safety_violation) safetyB++;
  }

  const meanA = n ? sumA / n : 0;
  const meanB = n ? sumB / n : 0;
  return {
    n,
    agreement: n ? +(agree / n).toFixed(4) : 0,
    mean_reward_active: +meanA.toFixed(4),
    mean_reward_challenger: +meanB.toFixed(4),
    reward_delta: +(meanB - meanA).toFixed(4),
    fairness_regressions: fairnessRegress,
    safety_violations_challenger: safetyB,
  };
}

// -----------------------------------------------------------------------------
// Promotion gates — ALL must pass (plus human approval) before flipping the flag.
// -----------------------------------------------------------------------------
export const DEFAULT_PROMOTION_GATES = Object.freeze({
  MIN_SCENARIOS: 500,
  MIN_REWARD_MARGIN: 0.02,      // challenger reward must exceed active by this
  MAX_FAIRNESS_REGRESSION_RATE: 0.05,
  ZERO_SAFETY_VIOLATIONS: true,
});

export function evaluatePromotion(summary, gates = DEFAULT_PROMOTION_GATES) {
  const g = { ...DEFAULT_PROMOTION_GATES, ...gates };
  const fairnessRate = summary.n ? summary.fairness_regressions / summary.n : 1;
  const results = [
    {
      gate: "MIN_SCENARIOS",
      pass: summary.n >= g.MIN_SCENARIOS,
      detail: `${summary.n} >= ${g.MIN_SCENARIOS}`,
    },
    {
      gate: "REWARD_MARGIN",
      pass: summary.reward_delta >= g.MIN_REWARD_MARGIN,
      detail: `delta ${summary.reward_delta} >= ${g.MIN_REWARD_MARGIN}`,
    },
    {
      gate: "FAIRNESS_NO_REGRESSION",
      pass: fairnessRate <= g.MAX_FAIRNESS_REGRESSION_RATE,
      detail: `regression rate ${fairnessRate.toFixed(4)} <= ${g.MAX_FAIRNESS_REGRESSION_RATE}`,
    },
    {
      gate: "ZERO_SAFETY_VIOLATIONS",
      pass: !g.ZERO_SAFETY_VIOLATIONS || summary.safety_violations_challenger === 0,
      detail: `${summary.safety_violations_challenger} safety violations`,
    },
  ];
  return { pass: results.every((r) => r.pass), results, summary };
}
