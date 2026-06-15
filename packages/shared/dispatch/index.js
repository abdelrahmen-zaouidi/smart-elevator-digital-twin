/**
 * Dispatch engine — public surface (the swappable "socket").
 *
 * Every decision brain implements the same shape so the ACTIVE brain is a
 * single config flip (`DISPATCH_ACTIVE_BRAIN`). Brain A (the deterministic
 * scorer) is provided here; Brain B (the ML challenger) will implement the same
 * `DispatchBrain` interface and slot in beside it, in shadow, later.
 *
 *   DispatchBrain := {
 *     id: string,
 *     version: string,
 *     decide(context, options) -> DispatchDecision
 *   }
 *
 * `decide` MUST be pure w.r.t. its inputs and MUST NOT actuate anything. The
 * orchestrator (separate) calls the active brain's decision the binding one
 * (after the command safety gate) and every standby brain in shadow.
 *
 * This module stays free of transport/DB/LLM so it is reusable from Next.js API
 * routes, React, n8n nodes, the simulator and tests.
 */

import { buildContext } from "./context.js";
import { createScorerBrain } from "./scorer.js";

// -----------------------------------------------------------------------------
// decideFromTwin — convenience: build context + decide in one call. This is the
// shape n8n / the API route will use most often.
// -----------------------------------------------------------------------------
export function decideFromTwin(twinState, options = {}) {
  const context = buildContext(twinState, options);
  const brain = options.brain || createScorerBrain(options.brainConfig);
  return brain.decide(context, {
    previous: options.previous,
    config: options.scorerConfig,
    now: options.now ?? context.now_ms,
  });
}

// -----------------------------------------------------------------------------
// Re-exports — the full toolkit for consumers and tests.
// -----------------------------------------------------------------------------
export { buildContext, resolveTariffWindow, contextToFeatureVector, FEATURE_NAMES } from "./context.js";
export { selectDispatchPolicy, createScorerBrain } from "./scorer.js";
export { createMlBrain, createMlBrainFromSpec, SEED_ML_MODEL } from "./brainML.js";
export { computeReward, machineStressProxy, DEFAULT_REWARD_WEIGHTS } from "./reward.js";
export {
  simulateOutcome, evaluateBrains, evaluatePromotion, DEFAULT_PROMOTION_GATES,
} from "./evaluation.js";
export { planDispatchUpdate, extractPreviousDecision } from "./orchestrator.js";
export {
  POLICY_CATALOG, OVERRIDE_CATALOG, detectOverride, scorePolicy, DEFAULT_PARAMS,
} from "./policies.js";
export {
  POLICY_IDS, OVERRIDE_IDS, DEFAULT_POLICY,
  SCORER_BRAIN_ID, DISPATCH_ENGINE_VERSION,
  DEFAULT_SCORER_CONFIG, DEFAULT_CONTEXT_CONFIG,
  NUM_FLOORS, GROUND_FLOOR, TOP_FLOOR,
} from "./constants.js";
