/**
 * Command Safety Gate — deterministic command admission layer.
 *
 * SINGLE SOURCE OF TRUTH for which elevator commands are allowed to reach
 * Eclipse Ditto (or, in future, the elevator controller).
 *
 * Design principles:
 *   1. Pure JS, no Node-only or browser-only globals. Importable from both
 *      Next.js API routes and React components without polyfills.
 *   2. Deterministic. Same (command, twinState, context) -> same decision.
 *   3. No network calls, no DB access, no LLM. This module ONLY decides.
 *      Side effects (Ditto write, DB persist, audit POST) belong to the caller.
 *   4. Reject by default. An unknown command, missing required field, or
 *      unrecognised system mode always yields REJECTED with explicit reasons.
 *   5. LLM-non-authoritative: this module does not consult any LLM. The LLM
 *      is permitted to suggest a command (the `source_agent` field), but the
 *      decision below is rule-based.
 *
 * Academic prototype note: This is a software-level research safety gate
 * intended for thesis demonstration. It does NOT replace certified
 * elevator safety hardware or controllers required for real deployment.
 */

import { POLICY_IDS } from "./dispatch/constants.js";

// Single source of truth for which dispatch policies the gate will admit.
const KNOWN_DISPATCH_POLICIES = new Set(POLICY_IDS);

// -----------------------------------------------------------------------------
// Tunable thresholds — sourced from env in Node, sensible defaults in browser.
// -----------------------------------------------------------------------------
function readEnv(name, fallback) {
  if (typeof process !== "undefined" && process.env && process.env[name] != null && process.env[name] !== "") {
    return process.env[name];
  }
  return fallback;
}

function readNumberEnv(name, fallback) {
  const v = readEnv(name, fallback);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readBoolEnv(name, fallback) {
  const v = readEnv(name, null);
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

export const SAFETY_GATE_CONFIG = Object.freeze({
  MIN_FLOOR: readNumberEnv("MIN_FLOOR", 0),
  MAX_FLOOR: readNumberEnv("MAX_FLOOR", 3),
  GROUND_FLOOR: readNumberEnv("GROUND_FLOOR", 0),
  MAX_RISK_AUTO_CONTROL: readNumberEnv("MAX_RISK_AUTO_CONTROL", 70),
  MAX_RISK_OPERATOR_CONTROL: readNumberEnv("MAX_RISK_OPERATOR_CONTROL", 85),
  MAX_LOAD_KG: readNumberEnv("MAX_LOAD_KG", 800),
  MAX_TWIN_AGE_SECONDS: readNumberEnv("MAX_TWIN_AGE_SECONDS", 10),
  COMMAND_COOLDOWN_SECONDS: readNumberEnv("COMMAND_COOLDOWN_SECONDS", 3),
  COMMAND_REQUIRE_REASON: readBoolEnv("COMMAND_REQUIRE_REASON", true),
  COMMAND_AUDIT_ENABLED: readBoolEnv("COMMAND_AUDIT_ENABLED", true),
});

// -----------------------------------------------------------------------------
// Allowed sources & operator roles.
// -----------------------------------------------------------------------------
export const ALLOWED_SOURCES = Object.freeze([
  "dashboard",   // human operator clicking SCADA buttons
  "n8n",         // workflow engine (control_agent / maintenance / security)
  "operator",    // explicit operator API call
  "system",      // internal scheduled task (cooldown sweep, etc.)
]);

export const HUMAN_SOURCES = Object.freeze(["dashboard", "operator"]);
export const AUTONOMOUS_SOURCES = Object.freeze(["n8n", "system"]);

// -----------------------------------------------------------------------------
// System mode catalogue — the closed set of states the elevator can be in.
// -----------------------------------------------------------------------------
export const SYSTEM_MODES = Object.freeze([
  "NORMAL", "MAINTENANCE", "LOCKDOWN", "DEGRADED",
]);

export const DEVICE_DIAGNOSTIC_ACTIONS = Object.freeze([
  "LCD_I2C_SCAN",
  "LCD_SAFE_PIN_SCAN",
  "LCD_REINIT",
  "LCD_CLEAR",
  "LCD_PRINT_CONFIG",
  "LCD_TEST",
  "RFID_TEST_GRANTED",
  "RFID_TEST_DENIED",
  "BUZZER_TEST",
  "BUZZER_GPIO_HIGH",
  "BUZZER_GPIO_LOW",
  "BUZZER_RELEASE",
  "BUZZER_WARNING",
  "FAN_GPIO_HIGH",
  "FAN_GPIO_LOW",
  "FAN_GPIO_INPUT",
  "FAN_GPIO_PULLUP",
]);

const KNOWN_DEVICE_DIAGNOSTICS = new Set(DEVICE_DIAGNOSTIC_ACTIONS);

function featureProperties(twinState, featureId) {
  return twinState?.features?.[featureId]?.properties || {};
}

function incidentEntries(twinState) {
  const entries = featureProperties(twinState, "incident_log").entries;
  return Array.isArray(entries) ? entries : [];
}

function incidentIdentity(entry, index) {
  return entry?.incident_id ?? entry?.incidentId ?? entry?.id ?? `incident-${index}`;
}

function resolveIncidentEntries(twinState, incidentId, now, actor, resolveAll = false) {
  const targetId = incidentId == null ? null : String(incidentId);
  return incidentEntries(twinState).map((entry, index) => {
    const matches = resolveAll || String(incidentIdentity(entry, index)) === targetId;
    if (!matches || entry?.resolved === true) return entry;
    return {
      ...entry,
      resolved: true,
      status: "RESOLVED",
      resolved_at: now,
      resolved_by: actor || "dashboard-operator",
    };
  });
}

function openIncidentCount(entries) {
  return entries.filter((entry) => entry?.resolved !== true).length;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function recoveredRiskScore(twinState, { clearLatchedConditions = false } = {}) {
  const attrs = twinState?.attributes || {};
  const cabin = featureProperties(twinState, "cabin");
  const door = featureProperties(twinState, "door");
  const motor = featureProperties(twinState, "motor");
  const security = featureProperties(twinState, "security");

  const vibration = numberOrNull(motor.vibration_level);
  const motorTemp = numberOrNull(motor.temperature_c);
  const loadKg = numberOrNull(cabin.load_kg ?? cabin.payload_weight_kg);
  const maxLoadKg = SAFETY_GATE_CONFIG.MAX_LOAD_KG;

  let risk = 0;

  if (vibration != null) {
    if (vibration > 0.25) risk = Math.max(risk, 90);
    else if (vibration > 0.12) risk = Math.max(risk, 58);
    else if (vibration > 0.06) risk = Math.max(risk, 35);
  }

  if (motorTemp != null) {
    if (motorTemp > 85) risk = Math.max(risk, 90);
    else if (motorTemp > 70) risk = Math.max(risk, 58);
    else if (motorTemp > 55) risk = Math.max(risk, 32);
  }

  if (loadKg != null) {
    if (loadKg > maxLoadKg) risk = Math.max(risk, 88);
    else if (loadKg > maxLoadKg * 0.8) risk = Math.max(risk, 48);
    else if (loadKg > maxLoadKg * 0.65) risk = Math.max(risk, 30);
  }

  if (!clearLatchedConditions) {
    const mode = String(attrs.system_mode || "").toUpperCase();
    const alertLevel = String(security.alert_level || "").toUpperCase();
    if (cabin.emergency_stop === true || mode === "LOCKDOWN" || mode === "MAINTENANCE") {
      risk = Math.max(risk, 82);
    }
    if (door.door_forced_entry === true || security.audio_distress_active === true || alertLevel === "CRITICAL") {
      risk = Math.max(risk, 92);
    } else if (alertLevel === "HIGH" || Number(security.unauthorized_access_attempts || 0) > 0) {
      risk = Math.max(risk, 45);
    }
  }

  return Math.min(100, Math.max(0, Math.round(risk)));
}

// -----------------------------------------------------------------------------
// Canonical command catalogue. Single source of truth.
//
// Each entry declares the rules that the validator enforces. Adding a command
// without an entry here means it is implicitly REJECTED.
//
// Aliases let legacy / n8n names (REPOSITION, RESUME_NORMAL, ...) resolve to
// the canonical name. Use the canonical name everywhere in new code.
// -----------------------------------------------------------------------------
export const COMMAND_CATALOG = Object.freeze({
  MOVE_TO_FLOOR: {
    description: "Dispatch the cabin to a specific floor.",
    aliases: ["REPOSITION", "SEND_TO_FLOOR"],
    required_fields: ["target_floor"],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 70,
    requires_reason: true,
    requires_confirmation: false,
    allowed_modes: ["NORMAL", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN", "MAINTENANCE"],
    allowed_when_emergency_stop: false,
    allowed_when_door_open: false,
    allowed_when_overload: false,
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,
    ditto_writes: (cmd /*, twin */) => [
      { path: `features/cabin/properties/target_floor`, value: Number(cmd.target_floor) },
    ],
    audit_severity: "INFO",
  },
  OPEN_DOOR: {
    description: "Hold the door open.",
    aliases: ["DOOR_HOLD_OPEN"],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 80,
    requires_reason: true,
    requires_confirmation: false,
    allowed_modes: ["NORMAL", "MAINTENANCE", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN"],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,
    ditto_writes: () => [
      { path: "features/door/properties/hold_open", value: true },
    ],
    audit_severity: "INFO",
  },
  CLOSE_DOOR: {
    description: "Request safe door close.",
    aliases: ["DOOR_CLOSE_SAFE"],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 80,
    requires_reason: true,
    requires_confirmation: false,
    allowed_modes: ["NORMAL", "MAINTENANCE", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN"],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,
    ditto_writes: () => [
      { path: "features/door/properties/close_requested", value: true },
      { path: "features/door/properties/hold_open", value: false },
    ],
    audit_severity: "INFO",
  },
  CLEAR_QUEUE: {
    description: "Clear all pending floor requests from the dispatch queue.",
    aliases: ["FLUSH_QUEUE", "CLEAR_REQUESTS"],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 85,
    requires_reason: true,
    requires_confirmation: false,
    allowed_modes: ["NORMAL", "MAINTENANCE", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN"],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: false,
    requires_fresh_twin: false,
    // No twin mutation: clearing is a device action delivered via the bridge as
    // the CLEAR_QUEUE MQTT command. The firmware re-publishes request_queue next
    // telemetry tick, so Ditto self-heals to the true post-clear state.
    ditto_writes: () => [],
    audit_severity: "WARNING",
  },
  EMERGENCY_STOP: {
    description: "Immediate halt — always admissible.",
    aliases: [],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator", "system"],
    minimum_role: "operator",
    max_risk_score: 100,           // always allowed regardless of risk
    requires_reason: false,        // safety priority over paperwork
    requires_confirmation: true,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,    // emergency commands must work on stale state
    ditto_writes: () => [
      { path: "features/cabin/properties/emergency_stop", value: true },
      { path: "attributes/system_mode", value: "MAINTENANCE" },
    ],
    audit_severity: "CRITICAL",
  },
  RESET_EMERGENCY: {
    description: "Clear emergency stop. Requires human authority.",
    aliases: ["RESUME_NORMAL", "RESET_NORMAL", "RESUME_NORMAL_MODE"],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],   // autonomous sources blocked
    minimum_role: "operator",
    max_risk_score: 50,                            // strict
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: ["MAINTENANCE", "LOCKDOWN", "DEGRADED"],
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: false,
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,
    forbidden_when_critical_incident: true,
    ditto_writes: () => [
      { path: "features/cabin/properties/emergency_stop", value: false },
      { path: "attributes/system_mode", value: "NORMAL" },
    ],
    audit_severity: "WARNING",
  },
  LOCKDOWN: {
    description: "Engage security lockdown — restrict all access.",
    aliases: [],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: ["NORMAL", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN"],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: () => [
      { path: "features/cabin/properties/emergency_stop", value: true },
      { path: "features/security/properties/alert_level", value: "CRITICAL" },
      { path: "attributes/system_mode", value: "LOCKDOWN" },
    ],
    audit_severity: "CRITICAL",
  },
  RELEASE_LOCKDOWN: {
    description: "Release security lockdown. Human-only.",
    aliases: ["CLEAR_SECURITY_ALERT"],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],   // autonomous blocked
    minimum_role: "operator",
    max_risk_score: 70,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: ["LOCKDOWN"],
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: false,
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,
    forbidden_when_critical_incident: true,
    ditto_writes: () => [
      { path: "features/security/properties/active_security_incident", value: false },
      { path: "features/security/properties/alert_level", value: "NORMAL" },
      { path: "attributes/system_mode", value: "NORMAL" },
    ],
    audit_severity: "WARNING",
  },
  SET_MAINTENANCE_MODE: {
    description: "Place elevator into maintenance mode.",
    aliases: ["MAINTENANCE_MODE"],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: ["NORMAL", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN", "MAINTENANCE"],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: () => [
      { path: "features/cabin/properties/emergency_stop", value: true },
      { path: "attributes/system_mode", value: "MAINTENANCE" },
    ],
    audit_severity: "WARNING",
  },
  RESUME_NORMAL_MODE: {
    description: "Exit maintenance back to NORMAL operation. Human-only.",
    aliases: [],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],   // autonomous blocked
    minimum_role: "operator",
    max_risk_score: 50,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: ["MAINTENANCE"],
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: false,
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,
    forbidden_when_critical_incident: true,
    ditto_writes: () => [
      { path: "features/cabin/properties/emergency_stop", value: false },
      { path: "attributes/system_mode", value: "NORMAL" },
    ],
    audit_severity: "WARNING",
  },
  ACKNOWLEDGE_ALERT: {
    description: "Acknowledge an active alert without changing system mode.",
    aliases: ["ACKNOWLEDGE_INCIDENT"],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: false,
    requires_confirmation: false,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: (cmd) => {
      const now = new Date().toISOString();
      const alertId = cmd.incident_id || cmd.metadata?.alert_id || cmd.command_id;
      return [
        { path: "features/security/properties/last_review_at", value: now },
        { path: "features/security/properties/human_review_required", value: false },
        { path: "features/incident_log/properties/last_acknowledged_id", value: String(alertId) },
        { path: "features/incident_log/properties/last_acknowledged_at", value: now },
      ];
    },
    audit_severity: "INFO",
  },
  RESET_ACTIVE_PROBLEMS: {
    description: "Clear resolved problem latches and recalculate operator-facing risk.",
    aliases: ["RESET_PROBLEMS", "CLEAR_PROBLEMS", "RESET_RISK"],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: (cmd, twin) => {
      const now = new Date().toISOString();
      const actor = cmd.source_agent || cmd.requested_by || "dashboard-operator";
      const entries = resolveIncidentEntries(twin, null, now, actor, true);
      // Also clamp any anomaly-injected motor readings back to healthy idle
      // values so the dashboard's motor health gauge stops reporting CRITICAL
      // after the operator confirms the physical fault is resolved. The
      // device's next telemetry tick will overwrite these if they differ.
      const motorProps = (twin && twin.features && twin.features.motor && twin.features.motor.properties) || {};
      const motorVibration = Math.min(Number(motorProps.vibration_level) || 0, 0.02);
      const motorTemperature = Math.min(Number(motorProps.temperature_c) || 35, 35);
      const writes = [
        { path: "attributes/system_mode", value: "NORMAL" },
        { path: "attributes/risk_score", value: recoveredRiskScore(twin, { clearLatchedConditions: true }) },
        { path: "attributes/maintenance_priority", value: "LOW" },
        { path: "features/cabin/properties/emergency_stop", value: false },
        { path: "features/cabin/properties/speed_ms", value: 0 },
        { path: "features/cabin/properties/direction", value: "IDLE" },
        { path: "features/door/properties/door_forced_entry", value: false },
        { path: "features/motor/properties/vibration_level", value: motorVibration },
        { path: "features/motor/properties/temperature_c", value: motorTemperature },
        { path: "features/motor/properties/health_status", value: "GOOD" },
        { path: "features/security/properties/audio_distress_active", value: false },
        { path: "features/security/properties/active_security_incident", value: false },
        { path: "features/security/properties/human_review_required", value: false },
        { path: "features/security/properties/rfid_access_granted", value: true },
        { path: "features/security/properties/unauthorized_access_attempts", value: 0 },
        { path: "features/security/properties/alert_level", value: "NORMAL" },
        { path: "features/security/properties/last_review_at", value: now },
        { path: "features/incident_log/properties/open_incidents", value: 0 },
        { path: "features/incident_log/properties/last_reset_at", value: now },
        { path: "features/incident_log/properties/last_resolved_at", value: now },
      ];

      if (entries.length > 0) {
        writes.push({ path: "features/incident_log/properties/entries", value: entries });
      }

      return writes;
    },
    audit_severity: "WARNING",
  },
  CLEAR_RESOLVED_INCIDENT: {
    description: "Mark an incident as resolved after operator review.",
    aliases: [],
    required_fields: ["incident_id"],
    allowed_sources: ["dashboard", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: false,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: (cmd, twin) => {
      const now = new Date().toISOString();
      const entries = resolveIncidentEntries(
        twin,
        cmd.incident_id,
        now,
        cmd.source_agent || cmd.requested_by || "dashboard-operator",
      );
      const openCount = openIncidentCount(entries);
      const writes = [
        { path: "features/incident_log/properties/last_resolved_id", value: String(cmd.incident_id) },
        { path: "features/incident_log/properties/last_resolved_at", value: now },
        { path: "features/incident_log/properties/open_incidents", value: openCount },
      ];

      if (entries.length > 0) {
        writes.push({ path: "features/incident_log/properties/entries", value: entries });
      }

      if (openCount === 0) {
        writes.push({ path: "attributes/risk_score", value: recoveredRiskScore(twin) });
      }

      return writes;
    },
    audit_severity: "INFO",
  },
  SET_FAN: {
    description: "Operate the cooling fan that protects the power supply, drivers and motor.",
    aliases: ["FAN_ON", "FAN_OFF", "FAN_AUTO", "COOLING_OVERRIDE"],
    required_fields: ["fan_state"],
    allowed_sources: ["dashboard", "n8n", "operator", "system"],
    minimum_role: "operator",
    max_risk_score: 100,            // cooling is always admissible
    requires_reason: false,
    requires_confirmation: false,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: (cmd) => {
      const requested = String(cmd.fan_state || "").toUpperCase();
      const state = ["ON", "OFF"].includes(requested) ? requested : "OFF";
      const explicitMode = String(cmd.fan_mode || cmd.mode || "").toUpperCase();
      const mode = ["AUTO", "MANUAL"].includes(explicitMode)
        ? explicitMode
        : (state === "ON" || state === "OFF" ? "MANUAL" : "AUTO");
      const now = new Date().toISOString();
      return [
        { path: "features/fan/properties/state", value: state },
        { path: "features/fan/properties/mode", value: mode },
        { path: "features/fan/properties/reason", value: mode === "AUTO" ? "AUTO_RESUME" : "OPERATOR_OVERRIDE" },
        { path: "features/fan/properties/last_changed_at", value: now },
      ];
    },
    audit_severity: "INFO",
  },
  SOFT_STOP: {
    description: "Request a controlled firmware error stop.",
    aliases: ["ERROR_STOP"],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: () => [],
    audit_severity: "WARNING",
  },
  HOME: {
    description: "Set the device current floor to the configured start floor.",
    aliases: ["SET_HOME", "CALIBRATE_HOME"],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: false,
    requires_fresh_twin: false,
    ditto_writes: () => [],
    audit_severity: "WARNING",
  },
  FRESH_START_RESET: {
    description: "Clear runtime requests, counters and timers on the device.",
    aliases: ["FRESH_START", "RESET_ALL", "FACTORY_RESET"],
    required_fields: [],
    allowed_sources: ["dashboard", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: false,
    requires_fresh_twin: false,
    ditto_writes: () => [],
    audit_severity: "WARNING",
  },
  DEVICE_DIAGNOSTIC: {
    description: "Run a firmware maintenance diagnostic mapped from the serial service menu.",
    aliases: ["RUN_DEVICE_DIAGNOSTIC"],
    required_fields: ["device_action"],
    allowed_sources: ["dashboard", "operator"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: true,
    requires_confirmation: true,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: () => [],
    audit_severity: "WARNING",
  },
  REQUEST_STATUS_REFRESH: {
    description: "Request the device to publish a fresh status message.",
    aliases: [],
    required_fields: [],
    allowed_sources: ["dashboard", "n8n", "operator", "system"],
    minimum_role: "operator",
    max_risk_score: 100,
    requires_reason: false,
    requires_confirmation: false,
    allowed_modes: SYSTEM_MODES.slice(),
    forbidden_modes: [],
    allowed_when_emergency_stop: true,
    allowed_when_door_open: true,
    allowed_when_overload: true,
    allowed_when_forced_entry: true,
    requires_fresh_twin: false,
    ditto_writes: () => [],         // pure ping; no twin mutation
    audit_severity: "INFO",
  },
  SET_DISPATCH_POLICY: {
    description: "Set the active adaptive dispatch policy (which logic the cabin runs).",
    aliases: ["DISPATCH_POLICY"],
    required_fields: ["policy_id"],
    // n8n = Brain A engine; system = orchestrator; dashboard/operator = manual override.
    allowed_sources: ["dashboard", "n8n", "operator", "system"],
    minimum_role: "operator",
    // A policy change tunes dispatch only; the firmware safety paths are never
    // weakened. But we still respect risk caps so an autonomous brain cannot
    // churn the policy during a high-risk state.
    max_risk_score: 85,
    requires_reason: true,
    requires_confirmation: false,
    // Only meaningful in service modes. The hard safety OVERRIDES (fire,
    // e-stop, lockdown, overload) are handled by the firmware/engine, not by a
    // policy command, so we forbid policy changes in those modes outright.
    allowed_modes: ["NORMAL", "DEGRADED"],
    forbidden_modes: ["LOCKDOWN", "MAINTENANCE"],
    allowed_when_emergency_stop: false,
    allowed_when_door_open: true,    // a policy change moves nothing immediately
    allowed_when_overload: false,    // OVERLOAD_HOLD owns this state
    allowed_when_forced_entry: false,
    requires_fresh_twin: true,       // decide against current twin state
    ditto_writes: (cmd) => {
      const now = new Date().toISOString();
      const meta = cmd.metadata || {};
      const base = "features/control/properties/dispatch_policy";
      const writes = [
        { path: `${base}/active_policy`, value: cmd.policy_id },
        { path: `${base}/params`, value: cmd.dispatch_params || {} },
        // selected_at comes from the brain decision so the dwell timer does not
        // reset on every write; fall back to now if the engine omitted it.
        { path: `${base}/selected_at`, value: meta.selected_at || now },
        { path: `${base}/source`, value: cmd.source_agent || cmd.source },
        { path: `${base}/active_brain`, value: meta.brain_id || "scorer_v1" },
      ];
      // Persist the hysteresis fields so the next decision tick can reconstruct
      // `previous` straight from the twin (Ditto stays the source of truth).
      if (meta.min_dwell_until != null) {
        writes.push({ path: `${base}/min_dwell_until`, value: meta.min_dwell_until });
      }
      if (meta.previous_policy != null) {
        writes.push({ path: `${base}/previous_policy`, value: meta.previous_policy });
      }
      if (meta.confidence != null) {
        writes.push({ path: `${base}/confidence`, value: Number(meta.confidence) });
      }
      if (cmd.reason && cmd.reason.length > 0) {
        writes.push({ path: `${base}/reason`, value: cmd.reason.join("; ") });
      }
      return writes;
    },
    audit_severity: "INFO",
  },
});

// -----------------------------------------------------------------------------
// Command priority tiers. Ordering (1 = highest) determines which command wins
// when several contend for the cabin:
//   1. emergency / security   2. admin   3. technician   4. agent   5. normal
// Emergency/security COMMANDS are always tier 1 regardless of who issued them.
// Every other command's tier is derived from the requester role.
// -----------------------------------------------------------------------------
export const COMMAND_PRIORITY = Object.freeze({
  EMERGENCY: 1,
  ADMIN: 2,
  TECHNICIAN: 3,
  AGENT: 4,
  NORMAL: 5,
});

const PRIORITY_LABEL = Object.freeze({
  1: "EMERGENCY/SECURITY",
  2: "ADMIN",
  3: "TECHNICIAN",
  4: "AGENT",
  5: "NORMAL",
});

const EMERGENCY_SECURITY_COMMANDS = new Set([
  "EMERGENCY_STOP",
  "RESET_EMERGENCY",
  "LOCKDOWN",
  "RELEASE_LOCKDOWN",
  "SOFT_STOP",
]);

const ROLE_TO_TIER = Object.freeze({
  ADMIN: COMMAND_PRIORITY.ADMIN,
  ADMINISTRATOR: COMMAND_PRIORITY.ADMIN,
  TECHNICIAN: COMMAND_PRIORITY.TECHNICIAN,
  TECH: COMMAND_PRIORITY.TECHNICIAN,
  AGENT: COMMAND_PRIORITY.AGENT,
  OPERATOR: COMMAND_PRIORITY.AGENT,
});

/**
 * Resolve the priority tier (1..5) for a normalised command. Emergency/security
 * commands are tier 1; otherwise the requester role (command.role, then a hint
 * parsed from source_agent) maps to the tier, defaulting to NORMAL.
 */
export function resolveCommandPriority(command) {
  const canonical = command?.canonical_command;
  if (canonical && EMERGENCY_SECURITY_COMMANDS.has(canonical)) {
    return COMMAND_PRIORITY.EMERGENCY;
  }
  const roleHint = String(command?.role || command?.source_agent || "").toUpperCase();
  for (const [role, tier] of Object.entries(ROLE_TO_TIER)) {
    if (roleHint.includes(role)) return tier;
  }
  return COMMAND_PRIORITY.NORMAL;
}

export function commandPriorityLabel(tier) {
  return PRIORITY_LABEL[tier] || "NORMAL";
}

// Reverse alias map for normalisation.
const _ALIAS_TO_CANONICAL = (() => {
  const map = new Map();
  for (const [canonical, spec] of Object.entries(COMMAND_CATALOG)) {
    map.set(canonical, canonical);
    for (const alias of spec.aliases || []) {
      map.set(alias, canonical);
    }
  }
  return map;
})();

// -----------------------------------------------------------------------------
// ID generators — short, monotonic, easy to grep for in logs.
// -----------------------------------------------------------------------------
let _idCounter = 0;
function shortRand() {
  // 6 alphanumeric chars; not crypto-secure, only for log grepping.
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function createCommandId(prefix = "CMD") {
  _idCounter = (_idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${_idCounter.toString().padStart(4, "0")}-${shortRand()}`;
}

export function createCorrelationId(prefix = "CID") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${shortRand()}`;
}

// -----------------------------------------------------------------------------
// Public helpers.
// -----------------------------------------------------------------------------
export function isCommandAllowed(name) {
  return _ALIAS_TO_CANONICAL.has(String(name || "").toUpperCase());
}

export function canonicalCommandName(name) {
  return _ALIAS_TO_CANONICAL.get(String(name || "").toUpperCase()) || null;
}

export function getCommandSpec(name) {
  const canonical = canonicalCommandName(name);
  return canonical ? COMMAND_CATALOG[canonical] : null;
}

// -----------------------------------------------------------------------------
// Cooldown ledger — in-memory per-process. Reset by a process restart.
// Production deployment would back this with Redis or the database;
// for a research prototype this is sufficient and intentional.
// -----------------------------------------------------------------------------
const _cooldownLedger = new Map();      // key -> last accepted timestamp (ms)

function cooldownKey(cmd) {
  return [
    cmd.command,
    cmd.thing_id || "default",
    cmd.target_floor != null ? `f${cmd.target_floor}` : "_",
    cmd.incident_id != null ? `i${cmd.incident_id}` : (cmd.metadata?.alert_id ? `a${cmd.metadata.alert_id}` : "_"),
    cmd.source || "_",
  ].join("|");
}

function violatesCooldown(cmd, nowMs, cooldownSeconds) {
  if (cooldownSeconds <= 0) return false;
  const key = cooldownKey(cmd);
  const lastAt = _cooldownLedger.get(key);
  if (lastAt == null) return false;
  return nowMs - lastAt < cooldownSeconds * 1000;
}

function recordCooldown(cmd, nowMs) {
  _cooldownLedger.set(cooldownKey(cmd), nowMs);
}

export function _resetCooldownLedgerForTests() {
  _cooldownLedger.clear();
}

// -----------------------------------------------------------------------------
// Snapshot extraction — pulls the safety-relevant slice out of a Ditto twin.
// -----------------------------------------------------------------------------
function pick(obj, path, fallback) {
  let cursor = obj;
  for (const segment of path) {
    if (cursor == null) return fallback;
    cursor = cursor[segment];
  }
  return cursor == null ? fallback : cursor;
}

export function extractSafetySnapshot(twinState) {
  if (!twinState || typeof twinState !== "object") {
    return {
      current_floor: null, target_floor: null, door_state: null,
      emergency_stop: null, load_kg: null, alert_level: null,
      system_mode: null, risk_score: null, forced_entry: null,
      active_security_incident: null, last_telemetry_at: null,
    };
  }
  const attrs = twinState.attributes || {};
  const features = twinState.features || {};
  const cabin = (features.cabin || {}).properties || {};
  const door = (features.door || {}).properties || {};
  const security = (features.security || {}).properties || {};
  return {
    current_floor: cabin.current_floor ?? null,
    target_floor: cabin.target_floor ?? null,
    door_state: door.state ?? null,
    emergency_stop: cabin.emergency_stop ?? null,
    load_kg: cabin.load_kg ?? cabin.payload_weight_kg ?? null,
    alert_level: security.alert_level ?? null,
    system_mode: attrs.system_mode ?? null,
    risk_score: attrs.risk_score ?? null,
    forced_entry: door.door_forced_entry ?? door.forced_entry ?? null,
    active_security_incident: security.active_security_incident ?? null,
    last_telemetry_at: twinState.last_telemetry_at ?? attrs.last_telemetry_at ?? null,
  };
}

// -----------------------------------------------------------------------------
// normaliseCommand — coerce raw HTTP body into a canonical shape.
// -----------------------------------------------------------------------------
export function normalizeCommand(rawCommand) {
  const r = rawCommand || {};
  const requestedAt = r.requested_at || new Date().toISOString();
  const commandName = String(r.command || "").toUpperCase();
  const canonical = canonicalCommandName(commandName);

  // Reason — accept either string or array, always store as array.
  let reason = r.reason;
  if (reason == null) reason = [];
  else if (!Array.isArray(reason)) reason = [reason];
  reason = reason
    .filter((entry) => entry != null)
    .map((entry) => String(entry).trim())
    .filter(Boolean);

  // Fan-control fields. Tolerate the aliases the dashboard / firmware will
  // send so legacy callers keep working: FAN_ON / FAN_OFF / FAN_AUTO collapse
  // into SET_FAN with fan_state/fan_mode normalised here.
  let fanState = r.fan_state != null ? String(r.fan_state).toUpperCase() : null;
  let fanMode  = (r.fan_mode || r.mode) != null ? String(r.fan_mode || r.mode).toUpperCase() : null;
  if (canonical === "SET_FAN") {
    if (commandName === "FAN_ON")   { fanState = fanState || "ON";  fanMode = fanMode || "MANUAL"; }
    if (commandName === "FAN_OFF")  { fanState = fanState || "OFF"; fanMode = fanMode || "MANUAL"; }
    if (commandName === "FAN_AUTO") { fanMode  = "AUTO"; if (!fanState) fanState = "OFF"; }
  }

  return {
    command_id: r.command_id || createCommandId(),
    correlation_id: r.correlation_id || createCorrelationId(),
    command: canonical || commandName,         // keep raw name for rejection trace
    raw_command_name: commandName,
    canonical_command: canonical,              // null if unknown
    thing_id: r.thing_id || null,
    source: String(r.source || "unknown").toLowerCase(),
    // Source agent is REQUIRED. Do not silently fall back to source — the
    // explicit agent identity is part of the audit contract.
    source_agent: r.source_agent || null,
    requested_by: r.requested_by || r.source_agent || null,
    // Requester role drives command-priority arbitration (admin/technician/agent).
    role: r.role != null ? String(r.role).toUpperCase()
      : (r.metadata && r.metadata.role != null ? String(r.metadata.role).toUpperCase() : null),
    requested_at: requestedAt,
    target_floor: r.target_floor != null ? Number(r.target_floor) : null,
    incident_id: r.incident_id ?? null,
    fan_state: fanState,
    fan_mode: fanMode,
    // Adaptive dispatch policy fields. policy_id is normalised to upper-case so
    // the catalog membership check is case-insensitive at the boundary.
    policy_id: r.policy_id != null ? String(r.policy_id).toUpperCase() : null,
    dispatch_params: (r.dispatch_params && typeof r.dispatch_params === "object") ? r.dispatch_params
      : (r.params && typeof r.params === "object" ? r.params : null),
    device_action: r.device_action != null ? String(r.device_action).toUpperCase()
      : r.action != null ? String(r.action).toUpperCase()
        : null,
    reason,
    human_approved: r.human_approved === true,
    confirmation: r.confirmation === true,
    metadata: r.metadata || {},
  };
}

// -----------------------------------------------------------------------------
// getRejectionReasons — pure function returning the list of REJECTED:* strings
// for a given (normalised command, twin snapshot, context). Empty array means
// the command is admissible.
// -----------------------------------------------------------------------------
export function getRejectionReasons(command, twinState, context = {}) {
  const cfg = { ...SAFETY_GATE_CONFIG, ...(context.config || {}) };
  const now = context.now ?? Date.now();
  const reasons = [];
  const snapshot = extractSafetySnapshot(twinState);

  // 1. Command allow-list ----------------------------------------------------
  if (!command.canonical_command) {
    reasons.push("REJECTED: command not in allow-list");
    // Without a known command, no further checks are meaningful.
    return { reasons, snapshot, spec: null };
  }
  const spec = COMMAND_CATALOG[command.canonical_command];

  // 2. Required fields -------------------------------------------------------
  for (const field of spec.required_fields) {
    const value = command[field];
    if (value == null || value === "") {
      reasons.push(`REJECTED: missing required field '${field}'`);
    }
  }

  // 3. Source admission ------------------------------------------------------
  if (!ALLOWED_SOURCES.includes(command.source)) {
    reasons.push("REJECTED: unauthorized command source");
  } else if (!spec.allowed_sources.includes(command.source)) {
    reasons.push(`REJECTED: source '${command.source}' not permitted for ${command.canonical_command}`);
  }
  if (!command.source_agent || command.source_agent === "unknown" || command.source_agent === "") {
    reasons.push("REJECTED: missing source_agent");
  }

  // 4. Reason requirement ----------------------------------------------------
  if ((spec.requires_reason || cfg.COMMAND_REQUIRE_REASON) && command.reason.length === 0) {
    // EMERGENCY_STOP explicitly opts out via requires_reason:false above.
    if (spec.requires_reason !== false) {
      reasons.push("REJECTED: missing operator reason");
    }
  }

  // 5. Confirmation requirement ---------------------------------------------
  if (spec.requires_confirmation && !command.confirmation) {
    reasons.push("REJECTED: command requires human confirmation");
  }

  // 6. System mode -----------------------------------------------------------
  const mode = snapshot.system_mode;
  if (mode && spec.forbidden_modes.includes(mode)) {
    if (mode === "LOCKDOWN") reasons.push("REJECTED: system in LOCKDOWN");
    else if (mode === "MAINTENANCE") reasons.push("REJECTED: system in MAINTENANCE");
    else reasons.push(`REJECTED: command forbidden in system mode ${mode}`);
  } else if (mode && spec.allowed_modes.length > 0 && !spec.allowed_modes.includes(mode)) {
    reasons.push(`REJECTED: command not permitted in mode ${mode}`);
  }

  // 7. Emergency / door / overload / forced-entry physical guards -----------
  if (snapshot.emergency_stop === true && !spec.allowed_when_emergency_stop) {
    reasons.push("REJECTED: emergency stop active");
  }
  if (snapshot.door_state && /^OPEN/i.test(String(snapshot.door_state)) && !spec.allowed_when_door_open) {
    reasons.push("REJECTED: door is open");
  }
  if (snapshot.forced_entry === true && !spec.allowed_when_forced_entry) {
    reasons.push("REJECTED: door forced-entry active");
  }
  if (typeof snapshot.load_kg === "number" && typeof context.max_load_kg === "number"
      && snapshot.load_kg > context.max_load_kg
      && !spec.allowed_when_overload) {
    reasons.push("REJECTED: overload detected");
  }

  // 8. Risk threshold --------------------------------------------------------
  // A command with max_risk_score >= 100 opts out of all risk caps. This is
  // reserved for safety-critical commands (EMERGENCY_STOP, LOCKDOWN,
  // SET_MAINTENANCE_MODE, ACKNOWLEDGE_ALERT, RESET_ACTIVE_PROBLEMS,
  // REQUEST_STATUS_REFRESH, CLEAR_RESOLVED_INCIDENT) that must remain admissible even when the
  // elevator is in a high-risk state — otherwise the gate would lock out
  // the operator at exactly the moment they need to intervene.
  const risk = typeof snapshot.risk_score === "number" ? snapshot.risk_score : 0;
  const isHuman = HUMAN_SOURCES.includes(command.source);
  const isAutonomous = AUTONOMOUS_SOURCES.includes(command.source);
  const riskCapsApply = spec.max_risk_score < 100;

  if (riskCapsApply) {
    if (isAutonomous && risk > cfg.MAX_RISK_AUTO_CONTROL && !command.human_approved) {
      reasons.push("REJECTED: risk score above autonomous-control threshold");
    } else if (isHuman && risk > cfg.MAX_RISK_OPERATOR_CONTROL) {
      reasons.push("REJECTED: risk score above allowed threshold");
    } else if (risk > spec.max_risk_score && !command.human_approved) {
      reasons.push(`REJECTED: risk score above allowed threshold for ${command.canonical_command}`);
    }
  }

  // 9. Target floor (MOVE_TO_FLOOR specifically) -----------------------------
  if (command.canonical_command === "MOVE_TO_FLOOR") {
    const tf = command.target_floor;
    if (!Number.isInteger(tf) || tf < cfg.MIN_FLOOR || tf > cfg.MAX_FLOOR) {
      reasons.push("REJECTED: target floor outside allowed range");
    }
  }

  // 9b. Fan command payload validation ---------------------------------------
  if (command.canonical_command === "SET_FAN") {
    if (!["ON", "OFF"].includes(command.fan_state)) {
      reasons.push("REJECTED: fan_state must be ON or OFF");
    }
    if (command.fan_mode != null && !["AUTO", "MANUAL"].includes(command.fan_mode)) {
      reasons.push("REJECTED: fan_mode must be AUTO or MANUAL");
    }
  }

  // 9c. Firmware maintenance diagnostic payload validation -------------------
  if (command.canonical_command === "DEVICE_DIAGNOSTIC") {
    if (!KNOWN_DEVICE_DIAGNOSTICS.has(command.device_action)) {
      reasons.push("REJECTED: unknown device diagnostic action");
    }
  }

  // 9d. Dispatch-policy payload validation -----------------------------------
  if (command.canonical_command === "SET_DISPATCH_POLICY") {
    if (!command.policy_id) {
      // required_fields already flags a missing policy_id; guard the membership
      // check so we do not double-report on null.
    } else if (!KNOWN_DISPATCH_POLICIES.has(command.policy_id)) {
      reasons.push(`REJECTED: unknown dispatch policy '${command.policy_id}'`);
    }
    if (command.dispatch_params != null && typeof command.dispatch_params !== "object") {
      reasons.push("REJECTED: dispatch params must be an object");
    }
  }

  // 10. Recovery commands forbidden while critical incident open -------------
  if (spec.forbidden_when_critical_incident) {
    const critical = snapshot.active_security_incident === true
      || String(snapshot.alert_level || "").toUpperCase() === "CRITICAL";
    if (critical && !command.human_approved) {
      reasons.push("REJECTED: recovery requires human review of active critical incident");
    }
  }

  // 11. Stale twin -----------------------------------------------------------
  if (spec.requires_fresh_twin) {
    const lastTs = snapshot.last_telemetry_at;
    if (lastTs == null) {
      reasons.push("REJECTED: stale Digital Twin state");
    } else {
      const ageS = (now - Date.parse(lastTs)) / 1000;
      if (!Number.isFinite(ageS) || ageS > cfg.MAX_TWIN_AGE_SECONDS) {
        reasons.push("REJECTED: stale Digital Twin state");
      }
    }
  }

  // 12. Autonomous-only hard bans --------------------------------------------
  if (isAutonomous) {
    const autonomousForbidden = new Set([
      "RESET_EMERGENCY", "RELEASE_LOCKDOWN", "RESUME_NORMAL_MODE",
    ]);
    if (autonomousForbidden.has(command.canonical_command) && !command.human_approved) {
      reasons.push("REJECTED: recovery requires human/operator source");
    }
  }

  // 13. Cooldown / duplicate -------------------------------------------------
  if (violatesCooldown(command, now, cfg.COMMAND_COOLDOWN_SECONDS)) {
    reasons.push("REJECTED: command cooldown active");
  }

  // 14. Ditto reachability (caller-supplied) --------------------------------
  if (context.ditto_reachable === false) {
    reasons.push("REJECTED: Ditto unavailable");
  }

  return { reasons, snapshot, spec };
}

// -----------------------------------------------------------------------------
// buildCommandDecision — orchestrates normalise + reasons + side-effect plan.
// Returns the canonical decision envelope persisted to control_command_log.
// -----------------------------------------------------------------------------
export function buildCommandDecision(rawCommand, twinState, context = {}) {
  const cmd = normalizeCommand(rawCommand);
  const { reasons, snapshot, spec } = getRejectionReasons(cmd, twinState, context);
  const accepted = reasons.length === 0;
  const dittoWrites = accepted && spec ? spec.ditto_writes(cmd, twinState) : [];

  if (accepted) {
    recordCooldown(cmd, context.now ?? Date.now());
  }

  const priority = resolveCommandPriority(cmd);

  return {
    command_id: cmd.command_id,
    correlation_id: cmd.correlation_id,
    command: cmd.canonical_command || cmd.raw_command_name,
    command_label: spec?.description || null,
    source: cmd.source,
    source_agent: cmd.source_agent,
    requested_by: cmd.requested_by,
    role: cmd.role,
    priority,
    priority_label: commandPriorityLabel(priority),
    requested_at: cmd.requested_at,
    accepted,
    decision: accepted ? "ACCEPTED" : "REJECTED",
    risk_score: snapshot.risk_score,
    system_mode: snapshot.system_mode,
    rejection_reasons: reasons,
    safety_snapshot: snapshot,
    ditto_writes: dittoWrites,
    ditto_write_allowed: accepted && dittoWrites.length > 0,
    requires_human_review: accepted ? false : reasons.some((r) =>
      /human|confirmation|review/i.test(r)
    ),
    audit_required: SAFETY_GATE_CONFIG.COMMAND_AUDIT_ENABLED,
    audit_severity: spec?.audit_severity || "INFO",
    raw_command: rawCommand,
    target_floor: cmd.target_floor,
  };
}

// Top-level convenience: synchronous deterministic validator.
export function validateCommand(rawCommand, twinState, context = {}) {
  return buildCommandDecision(rawCommand, twinState, context);
}

// Useful constants re-exported for the panel / API route.
export const SAFETY_GATE_VERSION = "1.0.0";
