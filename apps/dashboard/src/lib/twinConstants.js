// Shared digital-twin constants, status helpers and cooling-fan logic.
// Extracted verbatim from the ElevatorOS monolith (move-then-refactor).
import { T } from "../theme/tokens";

export const NUM_FLOORS   = 4;
export const FLOOR_LABELS = ["0", "1", "2", "3"];
export const FLOOR_H      = 84;
export const MAX_LOAD     = 800;
export const MOTOR_LIFE_H = 10000;

export const HISTORY_LIMIT  = 60;
export const TIMELINE_LIMIT = 200;

// Status colour / label helpers (read the live theme token object).
export const riskColor   = s => (s >= 76 ? T.red : s >= 41 ? T.yellow : T.green);
export const riskLabel   = s => (s >= 76 ? "CRITICAL" : s >= 41 ? "WARNING" : "NOMINAL");
export const healthColor = h => (h >= 80 ? T.green : h >= 50 ? T.yellow : T.red);
export const fmtTime = ts => {
  try { return new Date(ts).toLocaleTimeString("en-GB", { hour12: false }); } catch { return ""; }
};
export const relTime = ts => {
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d < 5)   return "just now";
  if (d < 60)  return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
};

// Cooling automation
// Drives the electronics-bay fan that cools the power supply, drivers and
// motor. Hysteresis on motor temperature avoids relay chatter; an activity
// preempt keeps the fan running during travel; a critical safety override
// forces the fan ON regardless of operator mode when the motor approaches
// thermal limit.
export const FAN_THERMAL = {
  ON_MOTOR_C: 55,        // turn fan ON when motor crosses this
  OFF_MOTOR_C: 45,       // turn fan OFF only when motor drops below this
  ON_CABIN_C: 30,        // also turn ON if cabin air is uncomfortable
  CRITICAL_MOTOR_C: 75,  // force-ON override, regardless of operator mode
  POST_RUN_S: 8,         // keep blowing for this many seconds after motion stops
};

export function decideFanState({ motorTempC, cabinTempC, moving, mode, currentState, lastActivityMs, nowMs = Date.now() }) {
  const m = Number(motorTempC) || 0;
  const c = Number(cabinTempC) || 0;
  const prev = String(currentState || "OFF").toUpperCase();
  const op = String(mode || "AUTO").toUpperCase();

  // Critical override — never let the operator switch the fan off while the
  // motor is approaching thermal limit.
  if (m >= FAN_THERMAL.CRITICAL_MOTOR_C) {
    return { state: "ON", reason: "MOTOR_CRITICAL_TEMP", override: true };
  }

  if (op === "MANUAL") {
    return { state: prev, reason: "MANUAL_OVERRIDE", override: false };
  }

  // AUTO mode -----------------------------------------------------------------
  if (moving) return { state: "ON", reason: "MOTOR_ACTIVE", override: false };

  if (lastActivityMs != null && nowMs - lastActivityMs < FAN_THERMAL.POST_RUN_S * 1000) {
    return { state: "ON", reason: "POST_RUN_PURGE", override: false };
  }

  if (m >= FAN_THERMAL.ON_MOTOR_C) {
    return { state: "ON", reason: "MOTOR_TEMP_HIGH", override: false };
  }

  if (c >= FAN_THERMAL.ON_CABIN_C) {
    return { state: "ON", reason: "CABIN_TEMP_HIGH", override: false };
  }

  // Hysteresis: stay ON until motor drops below OFF threshold.
  if (prev === "ON" && m > FAN_THERMAL.OFF_MOTOR_C) {
    return { state: "ON", reason: "HYSTERESIS_HOLD", override: false };
  }

  return { state: "OFF", reason: "IDLE", override: false };
}
