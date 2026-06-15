/**
 * Brain B — the Machine-Learning challenger (STANDBY / shadow).
 *
 * Implements the SAME DispatchBrain interface as Brain A, driven by a trained
 * model spec instead of hand-written rules. The model is a transparent per-policy
 * linear scorer over the shared feature vector:
 *
 *     score(policy) = bias[policy] + Σ_f  weight[policy][f] · feature[f]
 *
 * Linear-by-design so it stays EXPLAINABLE — the per-feature contributions are
 * the attributions shown in the trace, as defensible as Brain A's score table.
 * The training pipeline (scripts/dispatch/train-brain-b.mjs) fits these weights
 * from logged decisions/outcomes; a seed model that imitates Brain A ships here
 * so Brain B can run in shadow from day one.
 *
 * Parity with Brain A on the non-negotiables:
 *   - safety overrides pre-empt scoring (identical detectOverride);
 *   - the fairness SLA disqualifies energy-saving policies;
 *   - only eligible policies are considered.
 *
 * Pure and deterministic. Shadow-only until it passes the promotion gates.
 */

import { POLICY_IDS, DEFAULT_SCORER_CONFIG } from "./constants.js";
import { POLICY_CATALOG, detectOverride } from "./policies.js";
import { contextToFeatureVector } from "./context.js";

const ENERGY_SAVING_POLICIES = new Set(["ECO_ENERGY", "NEAREST_GREEDY"]);

function clamp01(x) { return Math.min(1, Math.max(0, x)); }

function resolveParams(policy, ctx) {
  return typeof policy.params === "function" ? policy.params(ctx) : policy.params;
}

// -----------------------------------------------------------------------------
// Seed model — a linear re-encoding of Brain A's affinities so the challenger
// largely agrees out of the box, then diverges/improves as it is retrained on
// real outcomes. Weights act on the [0,1]-ish features from contextToFeatureVector.
// -----------------------------------------------------------------------------
export const SEED_ML_MODEL = Object.freeze({
  id: "ml_v1",
  version: "seed-0.1.0",
  trained_at: null,
  policies: {
    SCAN_COLLECTIVE: { bias: 0.40, weights: {} },
    UP_PEAK: { bias: 0.0, weights: {
      up_down_ratio: 0.6, lobby_origin_fraction: 0.3, pending_norm: 0.2 } },
    DOWN_PEAK: { bias: 0.55, weights: {
      up_down_ratio: -0.6, demand_floor_norm: -0.25, pending_norm: 0.2 } },
    ECO_ENERGY: { bias: 0.0, weights: {
      tariff_peak: 0.35, power_ratio_excess: 0.3, budget_used: 0.25,
      pending_norm: -0.3, tariff_offpeak: -0.1 } },
    NEAREST_GREEDY: { bias: 0.45, weights: {
      pending_norm: -0.6, tariff_offpeak: 0.15 } },
    HEALTH_LIMP: { bias: 0.0, weights: {
      motor_temp_norm: 0.5, vibration_norm: 0.45, rul_low: 0.4, bearing_wear: 0.2 } },
    BALANCED_INTERFLOOR: { bias: 0.30, weights: { pending_norm: 0.1 } },
    SECURITY_RESTRICTED: { bias: 0.7, weights: {} },  // eligibility gates this one
  },
});

function overrideDecision(model, ctx, override, now) {
  return {
    policy_id: override.id,
    params: override.params,
    confidence: 1,
    reason: override.description,
    overridden_by: override.id,
    previous_policy: null,
    selected_at: new Date(now).toISOString(),
    min_dwell_until: null,
    eligible_policies: [],
    score_table: [],
    guardrails: ["SAFETY_OVERRIDE"],
    factors: ctx,
    brain_id: model.id,
    brain_version: model.version,
  };
}

// -----------------------------------------------------------------------------
// createMlBrain — wrap a model spec in the DispatchBrain interface.
// -----------------------------------------------------------------------------
export function createMlBrain(model = SEED_ML_MODEL, brainConfig = {}) {
  const cfg = { ...DEFAULT_SCORER_CONFIG, ...brainConfig };

  return Object.freeze({
    id: model.id,
    version: model.version,
    kind: "ml",
    decide(context, options = {}) {
      const ctx = context;
      const now = options.now ?? ctx?.now_ms ?? Date.now();

      const override = detectOverride(ctx);
      if (override) return overrideDecision(model, ctx, override, now);

      const fv = contextToFeatureVector(ctx);
      const slaBreached = ctx.traffic.longest_wait_s > cfg.MAX_WAIT_SLA_SECONDS;
      const guardrails = slaBreached ? ["FAIRNESS_SLA"] : [];

      const rows = [];
      for (const id of POLICY_IDS) {
        const policy = POLICY_CATALOG[id];
        const eligible = policy.isEligible(ctx, cfg)
          && !(slaBreached && ENERGY_SAVING_POLICIES.has(id));
        if (!eligible) {
          rows.push({ policy: id, eligible: false, score: null, terms: {} });
          continue;
        }
        const spec = model.policies[id] || { bias: 0, weights: {} };
        let score = spec.bias || 0;
        const terms = {};
        for (const f in spec.weights) {
          const term = spec.weights[f] * (fv[f] || 0);
          terms[f] = +term.toFixed(4);
          score += term;
        }
        rows.push({ policy: id, eligible: true, score: +score.toFixed(4), terms, params: resolveParams(policy, ctx) });
      }

      const eligible = rows.filter((r) => r.eligible).sort((a, b) => b.score - a.score);
      const top = eligible[0] || { policy: "SCAN_COLLECTIVE", score: 0, terms: {}, params: POLICY_CATALOG.SCAN_COLLECTIVE.params };
      const runnerUp = eligible[1];

      // Softmax-margin confidence over the eligible scores.
      const margin = runnerUp ? top.score - runnerUp.score : top.score;
      const confidence = clamp01(0.5 * clamp01(top.score) + 0.5 * clamp01(margin / 0.4));

      const topTerms = Object.entries(top.terms || {})
        .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k.replace(/_/g, " "));

      return {
        policy_id: top.policy,
        params: top.params,
        confidence: +confidence.toFixed(3),
        reason: `[${model.id}] ${POLICY_CATALOG[top.policy]?.name || top.policy}`
          + (topTerms.length ? ` driven by ${topTerms.join(" and ")}` : ""),
        overridden_by: null,
        previous_policy: options.previous?.policy_id ?? null,
        selected_at: new Date(now).toISOString(),
        min_dwell_until: null,        // hysteresis is applied by the orchestrator/active path
        eligible_policies: eligible.map((r) => r.policy),
        score_table: rows.map((r) => ({ policy: r.policy, score: r.score, eligible: r.eligible, terms: r.terms })),
        guardrails,
        factors: ctx,
        brain_id: model.id,
        brain_version: model.version,
      };
    },
  });
}

// Convenience: build from a JSON spec object (e.g. loaded from the registry).
export function createMlBrainFromSpec(spec) {
  if (!spec || !spec.policies) throw new Error("invalid ML model spec");
  return createMlBrain(spec);
}
