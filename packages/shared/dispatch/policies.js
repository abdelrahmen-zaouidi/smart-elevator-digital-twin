/**
 * Dispatch Policy Catalog — the selectable "logics" and the hard safety
 * overrides, shared by EVERY brain.
 *
 * Two catalogs live here:
 *
 *   POLICY_CATALOG   — the 8 dispatch algorithms a brain may choose. Each entry
 *                      declares: motion `params` (handed to the firmware /
 *                      simulator), an `isEligible(ctx)` gate, and a transparent
 *                      `score(ctx)` returning { score, terms } where `score` is
 *                      the sum of the named `terms`. The scorer simply picks the
 *                      eligible policy with the highest score and keeps the term
 *                      breakdown for the explainable trace.
 *
 *   OVERRIDE_CATALOG — the 4 safety modes that pre-empt all scoring. A brain can
 *                      never select or suppress them; `detectOverride(ctx)`
 *                      reports the first active one in precedence order.
 *
 * The numbers are deliberately simple and interpretable — every contribution is
 * a named term you can show in a thesis figure or a dashboard tooltip. This is
 * the whole point of Brain A: defensible, auditable decisions.
 *
 * Pure functions only. No side effects, no I/O.
 */

import {
  GROUND_FLOOR, TOP_FLOOR, DEFAULT_SCORER_CONFIG,
} from "./constants.js";

// -----------------------------------------------------------------------------
// Scoring primitives — tiny, named ramps so each term is readable.
// -----------------------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Linear ramp: lo -> 0, hi -> 1, clamped. Handles hi < lo (descending). */
function ramp(value, lo, hi) {
  if (hi === lo) return value >= hi ? 1 : 0;
  return clamp01((value - lo) / (hi - lo));
}

/** Sum a terms object into a single score. */
function total(terms) {
  let s = 0;
  for (const k in terms) s += terms[k];
  return +s.toFixed(4);
}

// -----------------------------------------------------------------------------
// Default motion params; each policy overrides the parts it cares about. These
// are what the bridge serialises into the MQTT DISPATCH_POLICY command and what
// the firmware / esp32_simulator honour. They tune the EXISTING dispatcher —
// they never weaken a safety path.
// -----------------------------------------------------------------------------
export const DEFAULT_PARAMS = Object.freeze({
  park_floor: null,          // null = no parking preference
  direction_bias: 0,         // -1 down, 0 none, +1 up
  accel_profile: "NORMAL",   // GENTLE | NORMAL
  speed_cap_ms: 1.6,
  dwell_ms: 5000,
  grace_ms: 1200,
  deep_idle: false,
  force_fan: false,
  restrict_floors: false,
});

function params(overrides) {
  return Object.freeze({ ...DEFAULT_PARAMS, ...overrides });
}

// =============================================================================
// POLICY CATALOG
// =============================================================================
export const POLICY_CATALOG = Object.freeze({
  // ---------------------------------------------------------------------------
  SCAN_COLLECTIVE: {
    id: "SCAN_COLLECTIVE",
    name: "Collective Sweep",
    description: "Balanced up-then-down collective control. The safe default.",
    params: params({}),
    isEligible: () => true,
    score: () => ({
      // A constant baseline so there is always an eligible, sensible choice.
      // It wins by default whenever nothing else makes a strong case.
      terms: { baseline: 0.4 },
    }),
  },

  // ---------------------------------------------------------------------------
  UP_PEAK: {
    id: "UP_PEAK",
    name: "Up-Peak / Ascending Priority",
    description: "Park at the lobby and prioritise upward calls.",
    params: params({ park_floor: GROUND_FLOOR, direction_bias: 1 }),
    isEligible: () => true,
    score: (ctx, cfg) => {
      const t = ctx.traffic;
      // Peak modes are HIGH-VOLUME strategies — a lone call must not trip them.
      const volume = ramp(t.pending_count, cfg.SPARSE_PENDING_MAX, cfg.BUSY_PENDING_MIN);
      const terms = {
        // Empirical up-bias: more up-calls than down-calls, scaled by volume.
        up_bias: ramp(t.up_down_ratio, 0.5, 0.85) * 0.6 * volume,
        // Calls clustering at the lobby is the classic arrival-rush tell.
        lobby_origin: t.lobby_origin_fraction * 0.3 * volume,
        // Time-of-day is a *supporting* hint only, weighted small.
        morning_hint: (ctx.temporal.hour >= 7 && ctx.temporal.hour <= 10 && !ctx.temporal.is_weekend) ? 0.15 : 0,
      };
      return { terms };
    },
  },

  // ---------------------------------------------------------------------------
  DOWN_PEAK: {
    id: "DOWN_PEAK",
    name: "Down-Peak / Descending Priority",
    description: "Collect downward calls and sweep toward the ground floor.",
    params: params({ park_floor: TOP_FLOOR, direction_bias: -1 }),
    isEligible: () => true,
    score: (ctx, cfg) => {
      const t = ctx.traffic;
      const volume = ramp(t.pending_count, cfg.SPARSE_PENDING_MAX, cfg.BUSY_PENDING_MIN);
      const terms = {
        down_bias: ramp(1 - t.up_down_ratio, 0.5, 0.85) * 0.6 * volume,
        // Demand pulling toward the ground floor reinforces egress.
        ground_demand: ramp(TOP_FLOOR - t.demand_floor, 0, TOP_FLOOR) * 0.25 * volume,
        evening_hint: (ctx.temporal.hour >= 16 && ctx.temporal.hour <= 19 && !ctx.temporal.is_weekend) ? 0.15 : 0,
      };
      return { terms };
    },
  },

  // ---------------------------------------------------------------------------
  ECO_ENERGY: {
    id: "ECO_ENERGY",
    name: "Energy-Saving / Eco",
    description: "Batch calls, move gently, park at predicted demand, deep-idle.",
    params: (ctx) => params({
      park_floor: ctx?.traffic?.demand_floor ?? GROUND_FLOOR,
      accel_profile: "GENTLE",
      speed_cap_ms: 1.2,
      dwell_ms: 7000,
      grace_ms: 2500,
      deep_idle: true,
    }),
    // Disqualified by the fairness guardrail in the scorer when a call has
    // waited past the SLA; eligibility here stays simple and the scorer gates.
    isEligible: () => true,
    score: (ctx, cfg) => {
      const e = ctx.energy;
      const t = ctx.traffic;
      const peak = ctx.temporal.tariff_window === "PEAK";
      const terms = {
        tariff_peak: peak ? 0.35 : (ctx.temporal.tariff_window === "OFFPEAK" ? -0.1 : 0),
        power_elevated: ramp(e.power_ratio, 1.0, cfg.POWER_RATIO_ELEVATED + 0.3) * 0.3,
        budget_pressure: ramp(e.budget_used_fraction, cfg.BUDGET_USED_ELEVATED, 1.2) * 0.25,
        // Eco shines when demand is low; busy traffic should NOT pick it.
        low_demand: ramp(cfg.BUSY_PENDING_MIN - t.pending_count, 0, cfg.BUSY_PENDING_MIN) * 0.2,
        engine_saving_hint: e.energy_mode === "SAVING" ? 0.1 : 0,
      };
      return { terms };
    },
  },

  // ---------------------------------------------------------------------------
  NEAREST_GREEDY: {
    id: "NEAREST_GREEDY",
    name: "Nearest-Car (SSTF)",
    description: "Serve the closest pending call first; deep-idle between calls.",
    params: params({ deep_idle: true }),
    isEligible: () => true,
    score: (ctx, cfg) => {
      const t = ctx.traffic;
      const sparse = t.pending_count > 0 && t.pending_count <= cfg.SPARSE_PENDING_MAX;
      const terms = {
        // Strong when traffic is genuinely sparse (1-2 calls).
        sparse_traffic: sparse ? 0.45 : 0,
        // Quiet off-peak hours reinforce it.
        offpeak_hint: ctx.temporal.tariff_window === "OFFPEAK" ? 0.15 : 0,
        // Penalise when busy — greedy starves far calls under load.
        busy_penalty: -ramp(t.pending_count, cfg.SPARSE_PENDING_MAX, cfg.BUSY_PENDING_MIN) * 0.25,
      };
      return { terms };
    },
  },

  // ---------------------------------------------------------------------------
  HEALTH_LIMP: {
    id: "HEALTH_LIMP",
    name: "Protective / Limp Mode",
    description: "Gentle, low-duty operation to protect a degrading machine.",
    params: (ctx) => params({
      park_floor: ctx?.traffic?.demand_floor ?? GROUND_FLOOR,
      accel_profile: "GENTLE",
      speed_cap_ms: 1.0,
      dwell_ms: 6000,
      grace_ms: 2000,
      force_fan: true,
    }),
    isEligible: () => true,
    score: (ctx, cfg) => {
      const h = ctx.health;
      const terms = {
        // Thermal stress.
        motor_temp: ramp(h.motor_temp_c, cfg.MOTOR_TEMP_WARN_C, cfg.MOTOR_TEMP_CRIT_C) * 0.45,
        // Mechanical / bearing fatigue.
        vibration: ramp(h.vibration, cfg.VIBRATION_WARN_G, cfg.VIBRATION_CRIT_G) * 0.4,
        // Connect dispatch to remaining useful life — the novel angle.
        rul_low: ramp(cfg.RUL_WARN_FRACTION - h.rul_fraction, 0, cfg.RUL_WARN_FRACTION) * 0.35,
        bearing_wear: ramp(100 - h.bearing_health_pct, 0, 60) * 0.2,
      };
      return { terms };
    },
  },

  // ---------------------------------------------------------------------------
  BALANCED_INTERFLOOR: {
    id: "BALANCED_INTERFLOOR",
    name: "Balanced Interfloor",
    description: "Two-way collective tuned for random midday floor-to-floor traffic.",
    params: params({}),
    isEligible: () => true,
    score: (ctx) => {
      const t = ctx.traffic;
      // Peaks at a balanced up/down ratio (~0.5) and moderate, present demand.
      const balance = 1 - Math.abs(t.up_down_ratio - 0.5) * 2;  // 1 at 0.5, 0 at extremes
      const midday = (ctx.temporal.hour >= 11 && ctx.temporal.hour <= 15) ? 0.1 : 0;
      const terms = {
        balanced_traffic: clamp01(balance) * 0.4 * (t.total_calls > 0 ? 1 : 0.5),
        midday_hint: midday,
      };
      return { terms };
    },
  },

  // ---------------------------------------------------------------------------
  SECURITY_RESTRICTED: {
    id: "SECURITY_RESTRICTED",
    name: "Security-Restricted",
    description: "Serve only authorised floors; bias toward recall.",
    params: params({ restrict_floors: true, park_floor: GROUND_FLOOR }),
    // Only meaningful under elevated security; otherwise ineligible entirely.
    isEligible: (ctx) => {
      const s = ctx.safety;
      return s.alert_level === "HIGH" || s.alert_level === "CRITICAL"
        || s.unauthorized_attempts > 0 || s.forced_entry;
    },
    score: (ctx) => {
      const s = ctx.safety;
      const terms = {
        alert_high: s.alert_level === "HIGH" ? 0.5 : 0,
        alert_critical: s.alert_level === "CRITICAL" ? 0.8 : 0,
        unauthorized: ramp(s.unauthorized_attempts, 1, 3) * 0.3,
        forced_entry: s.forced_entry ? 0.4 : 0,
      };
      return { terms };
    },
  },
});

// =============================================================================
// OVERRIDE CATALOG — pre-empts all scoring. Precedence: first match wins.
// =============================================================================
export const OVERRIDE_CATALOG = Object.freeze({
  FIRE_RECALL: {
    id: "FIRE_RECALL",
    description: "Fire alarm — recall to ground, doors open, out of service.",
    params: params({ park_floor: GROUND_FLOOR, direction_bias: -1, restrict_floors: true }),
    isActive: (ctx) => ctx.safety.fire_alarm === true,
  },
  EMERGENCY_STOP: {
    id: "EMERGENCY_STOP",
    description: "Emergency stop engaged — all motion halted.",
    params: params({ speed_cap_ms: 0 }),
    isActive: (ctx) => ctx.safety.emergency_stop === true,
  },
  FULL_LOCKDOWN: {
    id: "FULL_LOCKDOWN",
    description: "Security lockdown — no service.",
    params: params({ restrict_floors: true }),
    isActive: (ctx) => ctx.safety.lockdown === true,
  },
  OVERLOAD_HOLD: {
    id: "OVERLOAD_HOLD",
    description: "Cabin overloaded — dispatch blocked until load drops.",
    params: params({ speed_cap_ms: 0 }),
    isActive: (ctx) => ctx.load.overload === true,
  },
});

// Precedence order for override detection (mirrors OVERRIDE_IDS).
const OVERRIDE_ORDER = ["FIRE_RECALL", "EMERGENCY_STOP", "FULL_LOCKDOWN", "OVERLOAD_HOLD"];

/**
 * detectOverride — returns the first active safety override, or null.
 * No brain can suppress this; the scorer calls it before any policy scoring.
 */
export function detectOverride(ctx) {
  for (const id of OVERRIDE_ORDER) {
    const ov = OVERRIDE_CATALOG[id];
    if (ov.isActive(ctx)) return ov;
  }
  return null;
}

/**
 * scorePolicy — evaluate one policy against the context.
 * Returns { policy, eligible, score, terms, params }.
 */
export function scorePolicy(policyId, ctx, cfg = DEFAULT_SCORER_CONFIG) {
  const policy = POLICY_CATALOG[policyId];
  if (!policy) return null;
  const eligible = policy.isEligible(ctx, cfg);
  const { terms } = eligible ? policy.score(ctx, cfg) : { terms: {} };
  const resolvedParams = typeof policy.params === "function" ? policy.params(ctx) : policy.params;
  return {
    policy: policyId,
    eligible,
    score: eligible ? total(terms) : -Infinity,
    terms,
    params: resolvedParams,
  };
}

export { total as _sumTerms, ramp as _ramp };
