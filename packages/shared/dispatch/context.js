/**
 * Dispatch Context Builder — the single, shared feature builder.
 *
 * SINGLE SOURCE OF TRUTH for the "context vector" that every dispatch brain
 * (the deterministic scorer = Brain A, and later the ML model = Brain B) and
 * the training pipeline consume. Features are computed here exactly once so the
 * brains can never disagree about what the world looked like.
 *
 * Design principles (mirrors commandSafetyGate.js):
 *   1. Pure JS, no Node-only or browser-only globals. Importable from Next.js
 *      API routes, React components, n8n nodes and the Python-free test runner.
 *   2. Deterministic. Same (twinState, signals, options) -> same context.
 *   3. No network, no DB, no LLM. This module only reads and normalises.
 *   4. Tolerant of partial twins. Missing features degrade to safe defaults,
 *      never throw.
 *
 * The twin (Eclipse Ditto Thing `building:floor1:elevator`) is the source of
 * truth for machine/cabin/energy/health/security state. Live hall-call tables
 * are not (yet) part of the twin schema, so traffic signals may be supplied via
 * `signals` (from the simulator, n8n, or a future twin feature) and otherwise
 * fall back to what the twin does expose (direction, performance.avg_wait_s).
 *
 * Academic prototype note: research-grade feature engineering for thesis
 * demonstration; not a certified building-management input.
 */

import { NUM_FLOORS, GROUND_FLOOR, TOP_FLOOR, DEFAULT_CONTEXT_CONFIG } from "./constants.js";

// -----------------------------------------------------------------------------
// Small numeric helpers — kept local so this module has zero dependencies.
// -----------------------------------------------------------------------------
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function featureProps(twin, featureId) {
  return twin?.features?.[featureId]?.properties || {};
}

// -----------------------------------------------------------------------------
// Tariff window — derive PEAK / SHOULDER / OFFPEAK from a configurable schedule.
//
// This is intentionally a simple, explainable schedule (hour-of-day buckets).
// A real utility price feed can be injected later via `options.tariffWindow`
// or `signals.tariff_window`; that always wins over the schedule so the rest of
// the system does not change when the data source improves.
// -----------------------------------------------------------------------------
export function resolveTariffWindow(hour, config = DEFAULT_CONTEXT_CONFIG, override = null) {
  const explicit = override == null ? null : String(override).toUpperCase();
  if (explicit && ["PEAK", "SHOULDER", "OFFPEAK"].includes(explicit)) return explicit;
  const h = ((Math.floor(num(hour)) % 24) + 24) % 24;
  if (config.TARIFF_PEAK_HOURS.includes(h)) return "PEAK";
  if (config.TARIFF_OFFPEAK_HOURS.includes(h)) return "OFFPEAK";
  return "SHOULDER";
}

// -----------------------------------------------------------------------------
// Traffic block — detect up/down peak EMPIRICALLY from call origins, not the
// clock. If a caller has live hall-call tables it passes them in `signals`;
// otherwise we fall back to the twin's coarse direction/performance hints so
// the engine still produces a sane (low-confidence) reading.
// -----------------------------------------------------------------------------
function buildTraffic(twin, signals, cabin, performance) {
  const upCalls = Array.isArray(signals.up_calls) ? signals.up_calls.slice()
    : numOrNull(signals.up_call_count);
  const downCalls = Array.isArray(signals.down_calls) ? signals.down_calls.slice()
    : numOrNull(signals.down_call_count);

  const upCount = Array.isArray(upCalls) ? upCalls.length : num(upCalls, 0);
  const downCount = Array.isArray(downCalls) ? downCalls.length : num(downCalls, 0);
  const totalCalls = upCount + downCount;

  // up/down ratio in [0,1]: 1 = all up, 0 = all down, 0.5 = balanced/unknown.
  let upDownRatio = 0.5;
  if (totalCalls > 0) upDownRatio = upCount / totalCalls;
  else if (cabin.direction === "UP") upDownRatio = 0.65;       // weak twin hint
  else if (cabin.direction === "DOWN") upDownRatio = 0.35;

  const pendingCount = numOrNull(signals.pending_count) ?? totalCalls;
  const longestWaitS = num(signals.longest_wait_s ?? signals.longest_wait_seconds, 0);
  const avgWaitS = num(signals.avg_wait_s ?? performance.avg_wait_s, 0);

  // Demand floor: prefer the optimization engine's prediction, then an explicit
  // signal, then the current floor as a neutral default.
  const demandFloor = clamp(
    Math.round(num(
      signals.predicted_demand_floor ?? signals.demand_floor ?? cabin.current_floor,
      cabin.current_floor,
    )),
    GROUND_FLOOR, TOP_FLOOR,
  );

  // Fraction of calls originating at the lobby — a strong up-peak tell.
  let lobbyOriginFraction = num(signals.lobby_origin_fraction, NaN);
  if (!Number.isFinite(lobbyOriginFraction) && Array.isArray(upCalls)) {
    lobbyOriginFraction = upCount > 0
      ? upCalls.filter((f) => Number(f) === GROUND_FLOOR).length / upCount
      : 0;
  }
  if (!Number.isFinite(lobbyOriginFraction)) lobbyOriginFraction = 0;

  return {
    up_count: upCount,
    down_count: downCount,
    total_calls: totalCalls,
    up_down_ratio: +upDownRatio.toFixed(3),
    pending_count: pendingCount,
    longest_wait_s: longestWaitS,
    avg_wait_s: avgWaitS,
    demand_floor: demandFloor,
    lobby_origin_fraction: +clamp(lobbyOriginFraction, 0, 1).toFixed(3),
    has_live_calls: totalCalls > 0 || Array.isArray(upCalls) || Array.isArray(downCalls),
  };
}

// -----------------------------------------------------------------------------
// buildContext — the public entry point.
//
//   twinState : Ditto Thing snapshot (attributes + features).
//   options   : { now, signals, config, tariffWindow }
//
// `signals` carries anything the twin does not yet hold (hall-call tables,
// energy budget, tariff feed, calendar flags). All of it is optional.
// -----------------------------------------------------------------------------
export function buildContext(twinState, options = {}) {
  const twin = twinState || {};
  const signals = options.signals || {};
  const config = { ...DEFAULT_CONTEXT_CONFIG, ...(options.config || {}) };
  const nowMs = options.now ?? Date.now();
  const now = new Date(nowMs);

  const attrs = twin.attributes || {};
  const cabin = featureProps(twin, "cabin");
  const door = featureProps(twin, "door");
  const motor = featureProps(twin, "motor");
  const energy = featureProps(twin, "energy");
  const security = featureProps(twin, "security");
  const performance = featureProps(twin, "performance");
  const predicted = featureProps(twin, "predicted_failures");

  // Temporal (one input among many — never the whole brain).
  const hour = Number.isFinite(signals.hour) ? Math.floor(signals.hour) : now.getHours();
  const dayOfWeek = Number.isFinite(signals.day_of_week) ? signals.day_of_week : now.getDay();
  const isWeekend = signals.is_weekend != null ? !!signals.is_weekend : (dayOfWeek === 0 || dayOfWeek === 6);
  const isHoliday = !!signals.is_holiday;
  const tariffWindow = resolveTariffWindow(hour, config, options.tariffWindow ?? signals.tariff_window);

  // Energy economics.
  const powerKw = num(energy.power_kw ?? motor.power_kw, 0);
  const baselinePowerKw = num(signals.baseline_power_kw ?? energy.kwh_baseline, 0);
  const powerRatio = baselinePowerKw > 0 ? powerKw / baselinePowerKw : 1;
  const kwhToday = num(energy.kwh_today, 0);
  const kwhBudget = num(signals.kwh_budget ?? config.DEFAULT_DAILY_KWH_BUDGET, config.DEFAULT_DAILY_KWH_BUDGET);
  const budgetUsedFraction = kwhBudget > 0 ? clamp(kwhToday / kwhBudget, 0, 2) : 0;

  // Machine health (predictive-maintenance-aware).
  const motorTempC = num(motor.temperature_c, 0);
  const vibration = num(motor.vibration_level, 0);
  const hoursOperated = num(motor.hours_operated, 0);
  const motorRulHours = num(predicted.motor_rul_hours ?? config.MOTOR_DESIGN_LIFE_HOURS, config.MOTOR_DESIGN_LIFE_HOURS);
  const bearingHealthPct = num(predicted.bearing_health_pct, 100);
  const ropeTensionPct = num(predicted.rope_tension_pct, 100);
  const healthIndex = num(attrs.system_health_index, 100);

  // Load & occupancy.
  const loadKg = num(cabin.load_kg ?? cabin.payload_weight_kg, 0);
  const maxLoadKg = num(signals.max_load_kg ?? config.MAX_LOAD_KG, config.MAX_LOAD_KG);
  const capacityPct = maxLoadKg > 0 ? clamp((loadKg / maxLoadKg) * 100, 0, 200) : 0;
  const overload = loadKg > maxLoadKg;

  // Safety & security.
  const systemMode = String(attrs.system_mode || "NORMAL").toUpperCase();
  const alertLevel = String(security.alert_level || "NORMAL").toUpperCase();
  const unauthorizedAttempts = num(security.unauthorized_access_attempts, 0);
  const emergencyStop = cabin.emergency_stop === true;
  const forcedEntry = door.door_forced_entry === true || door.forced_entry === true;
  const audioDistress = security.audio_distress_active === true;
  const lockdown = systemMode === "LOCKDOWN";
  // Fire is not yet a first-class twin feature; accept it via signal or attribute.
  const fireAlarm = signals.fire_alarm === true || attrs.fire_alarm === true
    || String(signals.incident_type || "").toUpperCase() === "FIRE_EMERGENCY";

  const traffic = buildTraffic(twin, signals, cabin, performance);

  return {
    // meta
    now_ms: nowMs,
    iso: now.toISOString(),
    config,

    temporal: {
      hour,
      day_of_week: dayOfWeek,
      is_weekend: isWeekend,
      is_holiday: isHoliday,
      tariff_window: tariffWindow,
    },

    traffic,

    energy: {
      power_kw: +powerKw.toFixed(3),
      baseline_power_kw: +baselinePowerKw.toFixed(3),
      power_ratio: +powerRatio.toFixed(3),
      current_draw_a: num(motor.current_draw_a, 0),
      kwh_today: +kwhToday.toFixed(3),
      kwh_budget: kwhBudget,
      budget_used_fraction: +budgetUsedFraction.toFixed(3),
      energy_mode: String(signals.energy_mode || "NORMAL").toUpperCase(),
    },

    health: {
      motor_temp_c: +motorTempC.toFixed(1),
      vibration: +vibration.toFixed(4),
      hours_operated: +hoursOperated.toFixed(2),
      motor_rul_hours: Math.round(motorRulHours),
      rul_fraction: +clamp(motorRulHours / config.MOTOR_DESIGN_LIFE_HOURS, 0, 1).toFixed(3),
      bearing_health_pct: bearingHealthPct,
      rope_tension_pct: ropeTensionPct,
      health_index: healthIndex,
    },

    load: {
      load_kg: +loadKg.toFixed(1),
      max_load_kg: maxLoadKg,
      capacity_pct: +capacityPct.toFixed(1),
      overload,
    },

    safety: {
      system_mode: systemMode,
      alert_level: alertLevel,
      unauthorized_attempts: unauthorizedAttempts,
      emergency_stop: emergencyStop,
      forced_entry: forcedEntry,
      audio_distress: audioDistress,
      lockdown,
      fire_alarm: fireAlarm,
      risk_score: num(attrs.risk_score, 0),
    },

    cabin: {
      current_floor: clamp(Math.round(num(cabin.current_floor, GROUND_FLOOR)), GROUND_FLOOR, TOP_FLOOR),
      target_floor: clamp(Math.round(num(cabin.target_floor, GROUND_FLOOR)), GROUND_FLOOR, TOP_FLOOR),
      direction: String(cabin.direction || "IDLE").toUpperCase(),
      num_floors: NUM_FLOORS,
    },
  };
}

// -----------------------------------------------------------------------------
// contextToFeatureVector — flatten the context into a fixed, ordered numeric
// vector. The SINGLE feature extractor shared by Brain B (ML) serving and the
// training pipeline, so the model can never see different features than it was
// trained on. All values are roughly normalised to [0,1] or [-1,1].
// -----------------------------------------------------------------------------
export const FEATURE_NAMES = Object.freeze([
  "up_down_ratio",
  "lobby_origin_fraction",
  "pending_norm",
  "longest_wait_norm",
  "avg_wait_norm",
  "demand_floor_norm",
  "tariff_peak",
  "tariff_offpeak",
  "power_ratio_excess",
  "budget_used",
  "motor_temp_norm",
  "vibration_norm",
  "rul_low",
  "bearing_wear",
  "capacity",
  "hour_sin",
  "hour_cos",
  "is_weekend",
]);

export function contextToFeatureVector(ctx) {
  const c = (x) => Math.min(1, Math.max(0, x));
  const t = ctx.traffic, e = ctx.energy, h = ctx.health, l = ctx.load, tm = ctx.temporal;
  const topFloor = Math.max(1, (ctx.cabin?.num_floors ?? NUM_FLOORS) - 1);
  const hourAngle = (2 * Math.PI * (tm.hour % 24)) / 24;
  return {
    up_down_ratio: c(t.up_down_ratio),
    lobby_origin_fraction: c(t.lobby_origin_fraction),
    pending_norm: c(t.pending_count / 8),
    longest_wait_norm: c(t.longest_wait_s / 120),
    avg_wait_norm: c(t.avg_wait_s / 60),
    demand_floor_norm: c(t.demand_floor / topFloor),
    tariff_peak: tm.tariff_window === "PEAK" ? 1 : 0,
    tariff_offpeak: tm.tariff_window === "OFFPEAK" ? 1 : 0,
    power_ratio_excess: c((e.power_ratio - 1) / 0.5),
    budget_used: c(e.budget_used_fraction),
    motor_temp_norm: c((h.motor_temp_c - 25) / 70),
    vibration_norm: c(h.vibration / 0.5),
    rul_low: c(1 - h.rul_fraction),
    bearing_wear: c((100 - h.bearing_health_pct) / 100),
    capacity: c(l.capacity_pct / 100),
    hour_sin: (Math.sin(hourAngle) + 1) / 2,
    hour_cos: (Math.cos(hourAngle) + 1) / 2,
    is_weekend: tm.is_weekend ? 1 : 0,
  };
}
