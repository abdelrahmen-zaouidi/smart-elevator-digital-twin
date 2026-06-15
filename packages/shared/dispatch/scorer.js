/**
 * Brain A — deterministic dispatch policy scorer (the ACTIVE / champion brain).
 *
 * `selectDispatchPolicy(context, options)` is the BINDING decision-maker:
 *   1. Safety overrides pre-empt everything (fire, e-stop, lockdown, overload).
 *   2. Otherwise score every eligible policy (POLICY_CATALOG) transparently.
 *   3. Apply the fairness/SLA guardrail (energy-saving policies are disqualified
 *      once a call has waited past the SLA — Eco must never starve a floor).
 *   4. Apply hysteresis + a switch margin so the choice does not flip-flop.
 *   5. Emit a confidence and a fully reconstructable trace (score table + terms).
 *
 * The returned `reason` is a deterministic, templated sentence. Brain A's
 * optional Stage B (Ollama) rewrites this into prose downstream; the decision is
 * identical with or without the LLM, so the LLM is never on the binding path.
 *
 * Pure, deterministic, dependency-free (besides the local catalog/constants).
 */

import {
  POLICY_IDS, DEFAULT_POLICY, DEFAULT_SCORER_CONFIG,
  SCORER_BRAIN_ID, DISPATCH_ENGINE_VERSION,
} from "./constants.js";
import {
  POLICY_CATALOG, detectOverride, scorePolicy,
} from "./policies.js";

// -----------------------------------------------------------------------------
// Brain A factory — wraps the deterministic scorer in the DispatchBrain shape.
// Lives here (not index.js) so the orchestrator can import it without a cycle.
// -----------------------------------------------------------------------------
export function createScorerBrain(brainConfig = {}) {
  return Object.freeze({
    id: SCORER_BRAIN_ID,
    version: DISPATCH_ENGINE_VERSION,
    kind: "deterministic",
    decide(context, options = {}) {
      return selectDispatchPolicy(context, { config: brainConfig, ...options });
    },
  });
}

// Energy-saving policies disqualified when the fairness SLA is breached.
const ENERGY_SAVING_POLICIES = new Set(["ECO_ENERGY", "NEAREST_GREEDY"]);

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// -----------------------------------------------------------------------------
// Override decision — short-circuits scoring. The chosen "policy" is the
// override itself; `overridden_by` records which safety mode fired.
// -----------------------------------------------------------------------------
function overrideDecision(ctx, override, previous, nowMs) {
  return {
    policy_id: override.id,
    params: override.params,
    confidence: 1,
    reason: override.description,
    overridden_by: override.id,
    previous_policy: previous?.policy_id ?? null,
    selected_at: new Date(nowMs).toISOString(),
    min_dwell_until: null,            // overrides are re-evaluated every tick
    eligible_policies: [],
    score_table: [],
    guardrails: ["SAFETY_OVERRIDE"],
    factors: ctx,
    brain_id: SCORER_BRAIN_ID,
    brain_version: DISPATCH_ENGINE_VERSION,
  };
}

// -----------------------------------------------------------------------------
// selectDispatchPolicy — the binding scorer.
//
//   context : output of buildContext().
//   options : { previous, config, now }
//             previous = the last DispatchDecision (for hysteresis), or null.
// -----------------------------------------------------------------------------
export function selectDispatchPolicy(context, options = {}) {
  const ctx = context;
  const cfg = { ...DEFAULT_SCORER_CONFIG, ...(options.config || {}) };
  const nowMs = options.now ?? ctx?.now_ms ?? Date.now();
  const previous = options.previous || null;

  // 1. Safety overrides win, always.
  const override = detectOverride(ctx);
  if (override) return overrideDecision(ctx, override, previous, nowMs);

  // 2. Fairness guardrail: has any call waited past the SLA?
  const slaBreached = ctx.traffic.longest_wait_s > cfg.MAX_WAIT_SLA_SECONDS;
  const guardrails = [];
  if (slaBreached) guardrails.push("FAIRNESS_SLA");

  // 3. Score every policy; build the score table.
  const scoreTable = POLICY_IDS
    .map((id) => scorePolicy(id, ctx, cfg))
    .filter(Boolean)
    .map((row) => {
      // Disqualify energy-saving policies under an SLA breach.
      if (slaBreached && ENERGY_SAVING_POLICIES.has(row.policy) && row.eligible) {
        return { ...row, eligible: false, score: -Infinity, terms: { ...row.terms, sla_disqualified: 0 } };
      }
      return row;
    })
    .sort((a, b) => b.score - a.score);

  const eligible = scoreTable.filter((r) => r.eligible);
  const eligiblePolicies = eligible.map((r) => r.policy);

  // 4. Pick the top eligible policy; fall back to the safe default.
  let top = eligible[0] || scorePolicy(DEFAULT_POLICY, ctx, cfg);
  const runnerUp = eligible[1] || null;

  // 5. Confidence: blend the absolute top score with the margin over runner-up.
  const margin = runnerUp ? top.score - runnerUp.score : top.score;
  const confidence = clamp01(0.5 * clamp01(top.score) + 0.5 * clamp01(margin / 0.4));

  // 6. Low-confidence safety net: prefer the balanced default.
  let chosen = top;
  let lowConfidence = false;
  if (confidence < cfg.CONFIDENCE_FLOOR && top.policy !== DEFAULT_POLICY) {
    chosen = scorePolicy(DEFAULT_POLICY, ctx, cfg);
    lowConfidence = true;
    guardrails.push("CONFIDENCE_FLOOR");
  }

  // 7. Hysteresis: respect minimum dwell + switch margin against `previous`.
  let selectedAt = new Date(nowMs).toISOString();
  let heldByDwell = false;
  if (previous && previous.policy_id && !previous.overridden_by) {
    const stillEligible = eligiblePolicies.includes(previous.policy_id)
      || previous.policy_id === DEFAULT_POLICY;
    const dwellActive = previous.min_dwell_until
      && nowMs < Date.parse(previous.min_dwell_until);
    const prevRow = scoreTable.find((r) => r.policy === previous.policy_id);
    const prevScore = prevRow ? prevRow.score : -Infinity;
    const beatsByMargin = chosen.score - prevScore >= cfg.SWITCH_MARGIN;

    if (stillEligible && previous.policy_id !== chosen.policy && (dwellActive || !beatsByMargin)) {
      // Keep the incumbent: either still within its dwell window, or the
      // challenger did not beat it by enough to justify a switch.
      chosen = prevRow || scorePolicy(previous.policy_id, ctx, cfg);
      selectedAt = previous.selected_at || selectedAt;
      heldByDwell = true;
      guardrails.push(dwellActive ? "MIN_DWELL" : "SWITCH_MARGIN");
    }
  }

  const minDwellUntil = heldByDwell
    ? (previous.min_dwell_until || new Date(nowMs + cfg.MIN_DWELL_SECONDS * 1000).toISOString())
    : new Date(nowMs + cfg.MIN_DWELL_SECONDS * 1000).toISOString();

  return {
    policy_id: chosen.policy,
    params: chosen.params,
    confidence: +confidence.toFixed(3),
    reason: buildReason(chosen, ctx, { slaBreached, lowConfidence, heldByDwell }),
    overridden_by: null,
    previous_policy: previous?.policy_id ?? null,
    selected_at: selectedAt,
    min_dwell_until: minDwellUntil,
    eligible_policies: eligiblePolicies,
    score_table: scoreTable.map((r) => ({
      policy: r.policy, score: r.score === -Infinity ? null : r.score,
      eligible: r.eligible, terms: r.terms,
    })),
    guardrails,
    factors: ctx,
    brain_id: SCORER_BRAIN_ID,
    brain_version: DISPATCH_ENGINE_VERSION,
  };
}

// -----------------------------------------------------------------------------
// buildReason — deterministic templated rationale (Ollama-free fallback).
// Surfaces the top contributing terms so the sentence is always defensible.
// -----------------------------------------------------------------------------
function buildReason(chosen, ctx, flags) {
  const name = POLICY_CATALOG[chosen.policy]?.name || chosen.policy;
  const topTerms = Object.entries(chosen.terms || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k.replace(/_/g, " "));

  const parts = [`Selected ${name}`];
  if (topTerms.length) parts.push(`driven by ${topTerms.join(" and ")}`);
  parts.push(`(tariff ${ctx.temporal.tariff_window.toLowerCase()}, ${ctx.traffic.pending_count} pending, demand floor ${ctx.traffic.demand_floor})`);
  if (flags.slaBreached) parts.push("— fairness SLA active, energy-saving disqualified");
  if (flags.heldByDwell) parts.push("— held by stability window");
  if (flags.lowConfidence) parts.push("— low confidence, reverted to safe default");
  return parts.join(" ");
}
