/**
 * Dispatch engine constants — shared identifiers, geometry and tunable config.
 *
 * Pure data only. No logic, no side effects. Imported by the feature builder,
 * the policies, the scorer and the tests so every layer agrees on names and
 * thresholds. Tunables read from process.env in Node, with safe defaults in the
 * browser (same pattern as commandSafetyGate.js).
 */

// -----------------------------------------------------------------------------
// Building geometry — matches the digital twin (4 floors, ground = 0).
// -----------------------------------------------------------------------------
export const NUM_FLOORS = 4;
export const GROUND_FLOOR = 0;
export const TOP_FLOOR = NUM_FLOORS - 1;

// -----------------------------------------------------------------------------
// Policy identifiers — the selectable dispatch "logics". Both brains choose
// from exactly this set. Order is the deterministic tie-break order.
// -----------------------------------------------------------------------------
export const POLICY_IDS = Object.freeze([
  "SCAN_COLLECTIVE",       // balanced default sweep
  "UP_PEAK",               // morning arrival / ascending priority
  "DOWN_PEAK",             // evening egress / descending priority
  "ECO_ENERGY",            // energy / tariff saving
  "NEAREST_GREEDY",        // shortest-seek, sparse traffic
  "HEALTH_LIMP",           // protective / predictive-maintenance mode
  "BALANCED_INTERFLOOR",   // midday two-way collective
  "SECURITY_RESTRICTED",   // restricted-floor service
]);

export const DEFAULT_POLICY = "SCAN_COLLECTIVE";

// -----------------------------------------------------------------------------
// Hard safety overrides — NOT selectable by any brain. They pre-empt scoring.
// Listed in precedence order (first match wins).
// -----------------------------------------------------------------------------
export const OVERRIDE_IDS = Object.freeze([
  "FIRE_RECALL",      // recall to ground, doors open, out of service
  "EMERGENCY_STOP",   // halt all motion
  "FULL_LOCKDOWN",    // no service
  "OVERLOAD_HOLD",    // block dispatch while overloaded
]);

// -----------------------------------------------------------------------------
// Env helpers (Node) with browser-safe fallbacks.
// -----------------------------------------------------------------------------
function readNumberEnv(name, fallback) {
  if (typeof process !== "undefined" && process.env && process.env[name] != null && process.env[name] !== "") {
    const n = Number(process.env[name]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// -----------------------------------------------------------------------------
// Feature-builder config.
// -----------------------------------------------------------------------------
export const DEFAULT_CONTEXT_CONFIG = Object.freeze({
  MAX_LOAD_KG: readNumberEnv("MAX_LOAD_KG", 800),
  MOTOR_DESIGN_LIFE_HOURS: readNumberEnv("MOTOR_DESIGN_LIFE_HOURS", 10000),
  DEFAULT_DAILY_KWH_BUDGET: readNumberEnv("DISPATCH_DAILY_KWH_BUDGET", 12),
  // Tariff buckets by hour-of-day. FLAT RATE configured (both empty): every hour
  // resolves to SHOULDER, so time-of-day price never influences the brain — the
  // user's utility is a single flat price. ECO_ENERGY is then driven by ACTUAL
  // consumption (power-vs-baseline + kWh budget), not the clock. To switch to a
  // time-of-use tariff later, list the hours, e.g.
  //   TARIFF_PEAK_HOURS: [18, 19, 20, 21], TARIFF_OFFPEAK_HOURS: [22, 23, 0, 1, 2, 3, 4, 5]
  TARIFF_PEAK_HOURS: Object.freeze([]),
  TARIFF_OFFPEAK_HOURS: Object.freeze([]),
});

// -----------------------------------------------------------------------------
// Scorer config — weights, guardrails and stability tuning for Brain A.
// All explainable and adjustable; nothing hidden.
// -----------------------------------------------------------------------------
export const DEFAULT_SCORER_CONFIG = Object.freeze({
  // Stability — prevents flip-flopping.
  MIN_DWELL_SECONDS: readNumberEnv("DISPATCH_MIN_DWELL_SECONDS", 180),
  SWITCH_MARGIN: readNumberEnv("DISPATCH_SWITCH_MARGIN", 0.08),
  CONFIDENCE_FLOOR: readNumberEnv("DISPATCH_CONFIDENCE_FLOOR", 0.15),

  // Fairness / SLA — once breached, energy-saving policies are disqualified.
  MAX_WAIT_SLA_SECONDS: readNumberEnv("DISPATCH_MAX_WAIT_SLA_SECONDS", 90),

  // Health thresholds that pull toward HEALTH_LIMP.
  MOTOR_TEMP_WARN_C: readNumberEnv("DISPATCH_MOTOR_TEMP_WARN_C", 70),
  MOTOR_TEMP_CRIT_C: readNumberEnv("DISPATCH_MOTOR_TEMP_CRIT_C", 85),
  VIBRATION_WARN_G: readNumberEnv("DISPATCH_VIBRATION_WARN_G", 0.12),
  VIBRATION_CRIT_G: readNumberEnv("DISPATCH_VIBRATION_CRIT_G", 0.25),
  RUL_WARN_FRACTION: readNumberEnv("DISPATCH_RUL_WARN_FRACTION", 0.25),

  // Energy thresholds that pull toward ECO_ENERGY.
  POWER_RATIO_ELEVATED: readNumberEnv("DISPATCH_POWER_RATIO_ELEVATED", 1.2),
  BUDGET_USED_ELEVATED: readNumberEnv("DISPATCH_BUDGET_USED_ELEVATED", 0.8),

  // Traffic thresholds.
  SPARSE_PENDING_MAX: readNumberEnv("DISPATCH_SPARSE_PENDING_MAX", 2),
  BUSY_PENDING_MIN: readNumberEnv("DISPATCH_BUSY_PENDING_MIN", 4),
});

export const SCORER_BRAIN_ID = "scorer_v1";
export const DISPATCH_ENGINE_VERSION = "1.0.0";
