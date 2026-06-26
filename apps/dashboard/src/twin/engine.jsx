'use client';

// ── Digital-twin engine ──────────────────────────────────────────────────────
// State model + INIT_STATE, telemetry normalization (Ditto path/feature
// envelopes), incident/risk/latch logic, command lifecycle, the TwinContext +
// useTwin, and the useDigitalTwinEngine hook. Also the page registry (PAGES) and
// scenario/diagnostic catalogs. Extracted verbatim from the ElevatorOS monolith
// (stage c); top-level declarations are exported for the shell + pages.

import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import {
  LayoutDashboard, Monitor, SlidersHorizontal, BarChart3, Shield, KeyRound,
  Wrench, AlertTriangle, Cpu, FileText, Settings, CircleHelp,
} from "lucide-react";
import { env } from "../config/env";
import { useDitto } from "../hooks/useDitto";
import { reconcileCommandResult, submitCommand } from "../services/commandClient";
import {
  activeCommandFromThing, commandOutcomeMessage, commandResultForId, normalizeCommandStatus,
} from "@smart-elevator/shared/commandLifecycle.js";
import { useAccessControl } from "../hooks/useAccessControl";
import { recordAccessEvent } from "../services/accessControlClient";
import { createSpeedEstimator } from "../lib/speedEstimator";
import { ROLES, normalizeUid } from "../lib/accessControl";
import { T } from "../theme/tokens";
import {
  NUM_FLOORS, FLOOR_LABELS, FLOOR_H, MAX_LOAD, MOTOR_LIFE_H, HISTORY_LIMIT, TIMELINE_LIMIT,
  riskColor, riskLabel, healthColor, fmtTime, relTime, FAN_THERMAL, decideFanState,
} from "../lib/twinConstants";

export const PAGES = [
  { id: "twin", label: "Digital Twin", icon: LayoutDashboard, short: "DT", group: "Core" },
  { id: "monitoring", label: "Monitoring", icon: Monitor, short: "MON", group: "Core" },
  { id: "control", label: "Command Center", icon: SlidersHorizontal, short: "CMD", group: "Core" },
  { id: "ai", label: "AI Insights", icon: BarChart3, short: "AI", group: "Intelligence" },
  { id: "security", label: "Security", icon: Shield, short: "SEC", group: "Operations" },
  { id: "access", label: "Access Control", icon: KeyRound, short: "ACL", group: "Operations" },
  { id: "maintenance", label: "Maintenance", icon: Wrench, short: "MX", group: "Operations" },
  { id: "alerts", label: "Alerts & Logs", icon: AlertTriangle, short: "LOG", group: "Operations" },
  { id: "devices", label: "Devices / Sensors", icon: Cpu, short: "DEV", group: "Infrastructure" },
  { id: "reports", label: "Reports", icon: FileText, short: "RPT", group: "Infrastructure" },
  { id: "settings", label: "Settings", icon: Settings, short: "SET", group: "System" },
  { id: "help", label: "Help / About", icon: CircleHelp, short: "HLP", group: "System" },
];

export const PAGE_GROUPS = ["Core", "Intelligence", "Operations", "Infrastructure", "System"];

export const SCENARIO_DEFS = {
  motor_failure:  { label: "Motor Failure Cascade",  color: T.red,    severity: "CRITICAL" },
  overload:       { label: "Passenger Overload",      color: T.yellow, severity: "WARNING"  },
  security_breach:{ label: "Security Breach",         color: T.red,    severity: "CRITICAL" },
  fire_emergency: { label: "Fire Emergency",          color: "#dc2626",severity: "CRITICAL" },
  peak_traffic:   { label: "Peak Hour Traffic",       color: T.blue,   severity: "INFO"     },
};

Object.assign(SCENARIO_DEFS, {
  motor_failure: {
    ...SCENARIO_DEFS.motor_failure,
    color: T.red,
    affects: "Motor, cabin motion, risk engine",
    response: "Emergency stop, maintenance escalation",
  },
  overload: {
    ...SCENARIO_DEFS.overload,
    color: T.yellow,
    affects: "Cabin load and dispatch safety",
    response: "Restrict movement and raise warning",
  },
  security_breach: {
    ...SCENARIO_DEFS.security_breach,
    color: T.red,
    affects: "Door, RFID, security state",
    response: "Lockdown and SOC review",
  },
  fire_emergency: {
    ...SCENARIO_DEFS.fire_emergency,
    color: T.red,
    affects: "Recall, access, operator alarms",
    response: "Recall to ground and lockdown",
  },
  peak_traffic: {
    ...SCENARIO_DEFS.peak_traffic,
    color: T.blue,
    affects: "Routing and load profile",
    response: "Optimize dispatch and observe",
  },
});

export const FIRMWARE_DIAGNOSTIC_COMMANDS = [
  { key: "LCD_I2C_SCAN", serial: "I", label: "Scan I2C bus", variant: "info" },
  { key: "LCD_SAFE_PIN_SCAN", serial: "J", label: "Scan LCD pin pairs", variant: "info" },
  { key: "LCD_REINIT", serial: "K", label: "Reinitialize LCD", variant: "warning" },
  { key: "LCD_CLEAR", serial: "C", label: "Clear LCD", variant: "ghost" },
  { key: "LCD_PRINT_CONFIG", serial: "D", label: "Print LCD config", variant: "ghost" },
  { key: "LCD_TEST", serial: "L", label: "Test LCD screens", variant: "info" },
  { key: "RFID_TEST_GRANTED", serial: "G", label: "RFID granted test", variant: "success" },
  { key: "RFID_TEST_DENIED", serial: "g", label: "RFID denied test", variant: "warning" },
  { key: "BUZZER_TEST", serial: "B", label: "Buzzer normal beep", variant: "info" },
  { key: "BUZZER_GPIO_HIGH", serial: "T", label: "Buzzer GPIO HIGH", variant: "warning" },
  { key: "BUZZER_GPIO_LOW", serial: "t", label: "Buzzer GPIO LOW", variant: "warning" },
  { key: "BUZZER_RELEASE", serial: "N", label: "Release buzzer GPIO", variant: "ghost" },
  { key: "BUZZER_WARNING", serial: "W", label: "Warning beep", variant: "warning" },
  { key: "FAN_GPIO_HIGH", serial: "U", label: "Fan GPIO HIGH", variant: "warning" },
  { key: "FAN_GPIO_LOW", serial: "u", label: "Fan GPIO LOW", variant: "warning" },
  { key: "FAN_GPIO_INPUT", serial: "Z", label: "Fan GPIO input", variant: "ghost" },
  { key: "FAN_GPIO_PULLUP", serial: "z", label: "Fan GPIO pull-up", variant: "ghost" },
];

// INITIAL STATE  (Eclipse Ditto extended schema)
export const INIT_STATE = {
  attributes: {
    location: "Building A - Shaft 1",
    thing_id: "building:floor1:elevator",
    system_mode: "NORMAL",
    risk_score: 0,
    maintenance_priority: "LOW",
    system_health_index: 100,
    energy_efficiency: 100,
    uptime_pct: 100,
  },
  features: {
    cabin:    { properties: { current_floor: 0, target_floor: 0, direction: "IDLE", load_kg: 0, temperature_c: 0, speed_ms: 0, emergency_stop: false, trips_today: 0 }},
    door:     { properties: { state: "OPEN", door_forced_entry: false, cycle_count: 0, obstruction_events: 0 }},
    motor:    { properties: { vibration_level: 0, hours_operated: 0, health_status: "GOOD", temperature_c: 0, current_draw_a: 0, power_kw: 0 }},
    security: { properties: { audio_distress_active: false, unauthorized_access_attempts: 0, rfid_last_card: "", rfid_access_granted: true, alert_level: "NORMAL" }},
    fan: { properties: { state: "OFF", mode: "AUTO", reason: "IDLE", duty_cycle_pct: 0, runtime_today_min: 0, last_changed_at: null }},
    request_queue: { properties: { pending_count: 0, dispatch_direction: "IDLE", current_floor: 0, target_floor: 0, cabin: [false, false, false, false], hall_up: [false, false, false, false], hall_down: [false, false, false, false], priority_active: false, priority_floor: -1, priority_source: "NONE", updated_ms: 0 }},
    control: { properties: { pending_command: null, last_forwarded_command: null, last_command_result: null, last_ignored_command_result: null }},
    microcontroller: { properties: { board: "ESP32-S3", connected: false, status: "OFFLINE", source: "mqtt_status", transport: "MQTT", mqtt_id: env.MQTT_ID, mqtt_topic: env.MQTT_STATUS_TOPIC, telemetry_topic: env.MQTT_TELEMETRY_TOPIC, last_seen_at: null, last_telemetry_at: null, last_status_at: null, last_disconnected_at: null }},
    incident_log: { properties: { entries: [], open_incidents: 0 }},
    energy:   { properties: { kwh_today: 0, kwh_month: 0, kwh_baseline: 0, co2_kg: 0, regen_kwh: 0 }},
    performance: { properties: { avg_wait_s: 0, avg_trip_s: 0, availability_pct: 100, door_cycle_efficiency: 100 }},
    predicted_failures: { properties: { motor_rul_hours: 10000, bearing_health_pct: 100, door_mechanism_pct: 100, rope_tension_pct: 100, next_service_date: "" }},
  },
};

INIT_STATE.attributes.location = "Building A / Shaft 1";

// HELPERS
export function addIncident(state, type, description) {
  const entries = [
    { incident_id: `INC-${String(Date.now()).slice(-5)}`, ts: new Date().toISOString(), type, description, resolved: false },
    ...(state.features.incident_log.properties.entries || []),
  ].slice(0, 50);
  return {
    ...state,
    features: { ...state.features, incident_log: { properties: { entries, open_incidents: entries.filter(e => !e.resolved).length }}},
  };
}

export function applyScenario(state, key) {
  const scenarios = {
    motor_failure: s => ({
      ...s,
      features: { ...s.features,
        motor: { properties: { ...s.features.motor.properties, vibration_level: 0.72, temperature_c: 91, health_status: "CRITICAL" }},
        cabin: { properties: { ...s.features.cabin.properties, emergency_stop: true, speed_ms: 0, direction: "IDLE" }},
      },
      attributes: { ...s.attributes, system_mode: "MAINTENANCE", risk_score: 94 },
    }),
    overload: s => ({
      ...s,
      features: { ...s.features, cabin: { properties: { ...s.features.cabin.properties, load_kg: 920, emergency_stop: true, speed_ms: 0 }}},
      attributes: { ...s.attributes, risk_score: 88 },
    }),
    security_breach: s => ({
      ...s,
      features: { ...s.features,
        door: { properties: { state: "BLOCKED", door_forced_entry: true, cycle_count: s.features.door.properties.cycle_count, obstruction_events: s.features.door.properties.obstruction_events }},
        security: { properties: { ...s.features.security.properties, audio_distress_active: true, alert_level: "CRITICAL", unauthorized_access_attempts: s.features.security.properties.unauthorized_access_attempts + 3 }},
      },
      attributes: { ...s.attributes, system_mode: "LOCKDOWN", risk_score: 96 },
    }),
    fire_emergency: s => ({
      ...s,
      features: { ...s.features,
        cabin: { properties: { ...s.features.cabin.properties, temperature_c: 42, target_floor: 0 }},
        security: { properties: { ...s.features.security.properties, alert_level: "CRITICAL" }},
      },
      attributes: { ...s.attributes, system_mode: "LOCKDOWN", risk_score: 99 },
    }),
    peak_traffic: s => ({
      ...s,
      features: { ...s.features, cabin: { properties: { ...s.features.cabin.properties, load_kg: 680, speed_ms: 1.8, direction: "UP" }}},
      attributes: { ...s.attributes, risk_score: 28 },
    }),
  };
  const fn = scenarios[key];
  if (!fn) return state;
  const scenarioIncidents = {
    motor_failure:   ["MOTOR_FAILURE",  "Cascading motor failure - vibration 0.72g, thermal runaway 91degC"],
    overload:        ["OVERLOAD",       "Cabin overloaded: 920 kg - 115% of rated capacity"],
    security_breach: ["FORCED_ENTRY",   "Simultaneous forced entry + audio distress - LOCKDOWN initiated"],
    fire_emergency:  ["FIRE_EMERGENCY", "Fire alarm triggered - auto-recall to ground floor"],
    peak_traffic:    ["PEAK_TRAFFIC",   "Peak hour mode: load 680 kg, continuous service active"],
  };
  const inc = scenarioIncidents[key] || ["SCENARIO", key];
  return addIncident(fn(state), inc[0], inc[1]);
}


export const isPlainObject = value => value != null && typeof value === "object" && !Array.isArray(value);
export const clamp = (value, min, max, fallback = min) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};
export const normalizeFloor = (value, fallback = 0) => clamp(Math.round(Number(value)), 0, NUM_FLOORS - 1, fallback);
export const normalizeRequestFlags = (value) => {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: NUM_FLOORS }, (_, index) => Boolean(source[index]));
};

export function deepMergeState(base, patch) {
  if (!isPlainObject(patch)) return patch;

  const result = { ...(isPlainObject(base) ? base : {}) };
  Object.entries(patch).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      result[key] = value;
      return;
    }

    if (isPlainObject(value)) {
      result[key] = deepMergeState(base?.[key], value);
      return;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
}

export function pickDefined(source, keys) {
  return keys.reduce((accumulator, key) => {
    if (source?.[key] !== undefined) {
      accumulator[key] = source[key];
    }
    return accumulator;
  }, {});
}

export function getFeatureProperties(state, featureId) {
  return state?.features?.[featureId]?.properties || {};
}

export function hasFeatureDataBeyondSeed(state, featureId, keys = []) {
  const props = getFeatureProperties(state, featureId);
  const seed = INIT_STATE.features?.[featureId]?.properties || {};
  if (props.updated_at || props.last_updated || props.analysis_ts || props.generated_at || props.source === "n8n") {
    return true;
  }

  return keys.some((key) => {
    const value = props[key];
    if (value === undefined || value === null || value === "") return false;
    return JSON.stringify(value) !== JSON.stringify(seed[key]);
  });
}

export function normalizeMicrocontrollerStatus(props = {}) {
  const rawStatus = String(props.status || (props.connected ? "ONLINE" : "OFFLINE")).toUpperCase();
  const lastSeenMs = Math.max(
    Date.parse(props.last_seen_at || "") || 0,
    Date.parse(props.last_telemetry_at || "") || 0,
  );
  const lastDisconnectedMs = Date.parse(props.last_disconnected_at || "") || 0;

  if (lastSeenMs > 0 && lastSeenMs > lastDisconnectedMs) {
    return "ONLINE";
  }
  if (props.connected === true || ["ONLINE", "CONNECTED", "UP", "READY"].includes(rawStatus)) {
    return "ONLINE";
  }
  if (["OFFLINE", "DISCONNECTED", "DOWN", "LOST"].includes(rawStatus)) {
    return "OFFLINE";
  }
  return "UNKNOWN";
}

export function getMicrocontrollerStatus(state) {
  const seed = INIT_STATE.features.microcontroller.properties;
  const props = getFeatureProperties(state, "microcontroller");
  const status = normalizeMicrocontrollerStatus(props);
  const connected = status === "ONLINE";

  return {
    ...seed,
    ...props,
    status,
    connected,
    color: connected ? T.green : status === "UNKNOWN" ? T.yellow : T.red,
    board: props.board || seed.board,
    mqtt_id: props.mqtt_id || env.MQTT_ID,
    mqtt_topic: props.mqtt_topic || seed.mqtt_topic,
    telemetry_topic: props.telemetry_topic || env.MQTT_TELEMETRY_TOPIC,
    last_telemetry_at: props.last_telemetry_at || seed.last_telemetry_at,
  };
}

export function buildRequestQueueRows(queue = {}) {
  const cabin = normalizeRequestFlags(queue.cabin);
  const hallUp = normalizeRequestFlags(queue.hall_up);
  const hallDown = normalizeRequestFlags(queue.hall_down);
  return Array.from({ length: NUM_FLOORS }, (_, floor) => ({
    floor,
    cabin: cabin[floor],
    hallUp: hallUp[floor],
    hallDown: hallDown[floor],
    pending: cabin[floor] || hallUp[floor] || hallDown[floor],
  }));
}

export function getAiAnalysis(state) {
  const featureAnalysis = getFeatureProperties(state, "ai_analysis");
  const attributeAnalysis = state?.attributes?.ai_analysis;
  if (isPlainObject(featureAnalysis) && Object.keys(featureAnalysis).length > 0) return featureAnalysis;
  if (isPlainObject(attributeAnalysis) && Object.keys(attributeAnalysis).length > 0) return attributeAnalysis;
  return null;
}

export function getSeverityFromRisk(score) {
  if (score >= 76) return "CRITICAL";
  if (score >= 41) return "WARNING";
  return "NORMAL";
}

export function getAnalysisText(analysis, keys) {
  if (!analysis) return "";
  for (const key of keys) {
    const value = analysis[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function publicConfigValue(value) {
  if (!value) return "Not configured";
  const text = String(value);
  return text.includes("@") || text.toLowerCase().includes("password") || text.toLowerCase().includes("token")
    ? "Configured"
    : text;
}

export function deriveThresholdRisk({ attributes = {}, cabin = {}, door = {}, motor = {}, security = {} }, { clearLatchedConditions = false } = {}) {
  let risk = 0;

  if (motor.vibration_level > 0.25) risk = Math.max(risk, 90);
  else if (motor.vibration_level > 0.12) risk = Math.max(risk, 58);
  else if (motor.vibration_level > 0.06) risk = Math.max(risk, 35);

  if (motor.temperature_c > 85) risk = Math.max(risk, 90);
  else if (motor.temperature_c > 70) risk = Math.max(risk, 58);
  else if (motor.temperature_c > 55) risk = Math.max(risk, 32);

  if (cabin.load_kg > MAX_LOAD) risk = Math.max(risk, 88);
  else if (cabin.load_kg > MAX_LOAD * 0.8) risk = Math.max(risk, 48);
  else if (cabin.load_kg > MAX_LOAD * 0.65) risk = Math.max(risk, 30);

  if (!clearLatchedConditions) {
    const mode = String(attributes.system_mode || "").toUpperCase();
    const alertLevel = String(security.alert_level || "").toUpperCase();
    if (cabin.emergency_stop || mode === "LOCKDOWN" || mode === "MAINTENANCE") risk = Math.max(risk, 82);
    if (door.door_forced_entry || security.audio_distress_active || alertLevel === "CRITICAL") risk = Math.max(risk, 92);
    else if (alertLevel === "HIGH" || security.unauthorized_access_attempts > 0) risk = Math.max(risk, 45);
  }

  return Math.min(100, Math.max(0, Math.round(risk)));
}

export function sanitizeTwinState(rawThing) {
  const merged = deepMergeState(INIT_STATE, rawThing || {});
  const cabin = merged.features.cabin.properties;
  const door = merged.features.door.properties;
  const motor = merged.features.motor.properties;
  const security = merged.features.security.properties;
  const energy = merged.features.energy.properties;
  const performance = merged.features.performance.properties;
  const predicted = merged.features.predicted_failures.properties;
  const incidentEntries = Array.isArray(merged.features.incident_log.properties.entries)
    ? merged.features.incident_log.properties.entries
    : [];
  const fanSeed = INIT_STATE.features.fan.properties;
  const fanProps = (merged.features.fan && merged.features.fan.properties) || fanSeed;
  const microcontrollerSeed = INIT_STATE.features.microcontroller.properties;
  const microcontrollerProps = (merged.features.microcontroller && merged.features.microcontroller.properties) || microcontrollerSeed;
  const requestQueueSeed = INIT_STATE.features.request_queue.properties;
  const requestQueueProps = (merged.features.request_queue && merged.features.request_queue.properties) || requestQueueSeed;
  const microcontrollerStatus = normalizeMicrocontrollerStatus(microcontrollerProps);

  const fallbackRisk = deriveThresholdRisk({ attributes: merged.attributes, cabin, door, motor, security });
  const riskScore = clamp(merged.attributes.risk_score, 0, 100, fallbackRisk);
  const healthIndex = clamp(
    merged.attributes.system_health_index,
    0,
    100,
    Math.max(10, 100 - riskScore * 0.65 - Math.max(0, motor.temperature_c - 45) * 0.45),
  );
  const healthStatus = motor.health_status || (
    motor.temperature_c > 85 || motor.vibration_level > 0.25
      ? "CRITICAL"
      : motor.temperature_c > 70 || motor.vibration_level > 0.12
        ? "WARNING"
        : "GOOD"
  );

  return {
    ...merged,
    attributes: {
      ...merged.attributes,
      thing_id: merged.attributes.thing_id || env.THING_ID,
      system_mode: merged.attributes.system_mode || "NORMAL",
      risk_score: +riskScore.toFixed(1),
      system_health_index: +healthIndex.toFixed(1),
    },
    features: {
      ...merged.features,
      cabin: {
        properties: {
          ...cabin,
          current_floor: normalizeFloor(cabin.current_floor, INIT_STATE.features.cabin.properties.current_floor),
          target_floor: normalizeFloor(cabin.target_floor, cabin.current_floor),
          load_kg: +clamp(cabin.load_kg, 0, MAX_LOAD + 200, INIT_STATE.features.cabin.properties.load_kg).toFixed(1),
          temperature_c: +clamp(cabin.temperature_c, 0, 80, INIT_STATE.features.cabin.properties.temperature_c).toFixed(1),
          speed_ms: +clamp(cabin.speed_ms, 0, 4, INIT_STATE.features.cabin.properties.speed_ms).toFixed(2),
          trips_today: Math.max(0, Math.round(Number(cabin.trips_today) || 0)),
          emergency_stop: Boolean(cabin.emergency_stop),
        },
      },
      door: {
        properties: {
          ...door,
          cycle_count: Math.max(0, Math.round(Number(door.cycle_count) || 0)),
          obstruction_events: Math.max(0, Math.round(Number(door.obstruction_events) || 0)),
          door_forced_entry: Boolean(door.door_forced_entry),
        },
      },
      motor: {
        properties: {
          ...motor,
          vibration_level: +clamp(motor.vibration_level, 0, 1.2, INIT_STATE.features.motor.properties.vibration_level).toFixed(4),
          hours_operated: +(Number(motor.hours_operated) || 0).toFixed(3),
          temperature_c: +clamp(motor.temperature_c, 0, 140, INIT_STATE.features.motor.properties.temperature_c).toFixed(1),
          current_draw_a: +clamp(motor.current_draw_a, 0, 50, INIT_STATE.features.motor.properties.current_draw_a).toFixed(1),
          power_kw: +clamp(motor.power_kw, 0, 50, INIT_STATE.features.motor.properties.power_kw).toFixed(2),
          health_status: healthStatus,
        },
      },
      security: {
        properties: {
          ...security,
          audio_distress_active: Boolean(security.audio_distress_active),
          unauthorized_access_attempts: Math.max(0, Math.round(Number(security.unauthorized_access_attempts) || 0)),
          rfid_access_granted: Boolean(security.rfid_access_granted),
          alert_level: security.alert_level || (merged.attributes.system_mode === "LOCKDOWN" ? "CRITICAL" : "NORMAL"),
        },
      },
      fan: {
        properties: {
          ...fanSeed,
          ...fanProps,
          state: ["ON", "OFF"].includes(String(fanProps.state || "").toUpperCase())
            ? String(fanProps.state).toUpperCase()
            : fanSeed.state,
          mode: ["AUTO", "MANUAL"].includes(String(fanProps.mode || "").toUpperCase())
            ? String(fanProps.mode).toUpperCase()
            : fanSeed.mode,
          reason: fanProps.reason || fanSeed.reason,
          duty_cycle_pct: +clamp(fanProps.duty_cycle_pct, 0, 100, fanSeed.duty_cycle_pct).toFixed(1),
          runtime_today_min: +(Number(fanProps.runtime_today_min) || 0).toFixed(2),
          last_changed_at: fanProps.last_changed_at || fanSeed.last_changed_at,
        },
      },
      request_queue: {
        properties: {
          ...requestQueueSeed,
          ...requestQueueProps,
          pending_count: Math.max(0, Math.round(Number(requestQueueProps.pending_count) || 0)),
          dispatch_direction: ["UP", "DOWN", "IDLE"].includes(String(requestQueueProps.dispatch_direction || "").toUpperCase())
            ? String(requestQueueProps.dispatch_direction).toUpperCase()
            : requestQueueSeed.dispatch_direction,
          current_floor: normalizeFloor(requestQueueProps.current_floor, requestQueueSeed.current_floor),
          target_floor: normalizeFloor(requestQueueProps.target_floor, requestQueueProps.current_floor),
          cabin: normalizeRequestFlags(requestQueueProps.cabin),
          hall_up: normalizeRequestFlags(requestQueueProps.hall_up),
          hall_down: normalizeRequestFlags(requestQueueProps.hall_down),
          priority_active: Boolean(requestQueueProps.priority_active),
          priority_floor: Number.isFinite(Number(requestQueueProps.priority_floor)) ? Math.round(Number(requestQueueProps.priority_floor)) : -1,
          priority_source: requestQueueProps.priority_source || requestQueueSeed.priority_source,
          updated_ms: Math.max(0, Math.round(Number(requestQueueProps.updated_ms) || 0)),
        },
      },
      microcontroller: {
        properties: {
          ...microcontrollerSeed,
          ...microcontrollerProps,
          status: microcontrollerStatus,
          connected: microcontrollerStatus === "ONLINE",
          board: microcontrollerProps.board || microcontrollerSeed.board,
          source: microcontrollerProps.source || microcontrollerSeed.source,
          transport: microcontrollerProps.transport || microcontrollerSeed.transport,
          mqtt_id: microcontrollerProps.mqtt_id || env.MQTT_ID,
          mqtt_topic: microcontrollerProps.mqtt_topic || microcontrollerSeed.mqtt_topic,
          telemetry_topic: microcontrollerProps.telemetry_topic || env.MQTT_TELEMETRY_TOPIC,
          last_seen_at: microcontrollerProps.last_seen_at || microcontrollerSeed.last_seen_at,
          last_telemetry_at: microcontrollerProps.last_telemetry_at || microcontrollerSeed.last_telemetry_at,
          last_status_at: microcontrollerProps.last_status_at || microcontrollerSeed.last_status_at,
          last_disconnected_at: microcontrollerProps.last_disconnected_at || microcontrollerSeed.last_disconnected_at,
        },
      },
      incident_log: {
        properties: {
          ...merged.features.incident_log.properties,
          entries: incidentEntries,
          open_incidents: incidentEntries.filter(entry => !entry?.resolved).length,
        },
      },
      energy: {
        properties: {
          ...energy,
          kwh_today: +(Number(energy.kwh_today) || 0).toFixed(3),
          kwh_month: +(Number(energy.kwh_month) || 0).toFixed(1),
          kwh_baseline: +(Number(energy.kwh_baseline) || 0).toFixed(1),
          co2_kg: +(Number(energy.co2_kg) || 0).toFixed(2),
          regen_kwh: +(Number(energy.regen_kwh) || 0).toFixed(2),
        },
      },
      performance: {
        properties: {
          ...performance,
          avg_wait_s: +(Number(performance.avg_wait_s) || 0).toFixed(1),
          avg_trip_s: +(Number(performance.avg_trip_s) || 0).toFixed(1),
          availability_pct: +(Number(performance.availability_pct) || 0).toFixed(1),
          door_cycle_efficiency: +(Number(performance.door_cycle_efficiency) || 0).toFixed(1),
        },
      },
      predicted_failures: {
        properties: {
          ...predicted,
          motor_rul_hours: Math.max(0, Math.round(Number(predicted.motor_rul_hours) || 0)),
          bearing_health_pct: clamp(predicted.bearing_health_pct, 0, 100, INIT_STATE.features.predicted_failures.properties.bearing_health_pct),
          door_mechanism_pct: clamp(predicted.door_mechanism_pct, 0, 100, INIT_STATE.features.predicted_failures.properties.door_mechanism_pct),
          rope_tension_pct: clamp(predicted.rope_tension_pct, 0, 100, INIT_STATE.features.predicted_failures.properties.rope_tension_pct),
        },
      },
    },
  };
}

export function incidentIdentifier(entry, index = 0) {
  return entry?.incident_id ?? entry?.incidentId ?? entry?.id ?? `incident-${index}`;
}

export function countOpenIncidents(entries) {
  return entries.filter(entry => entry?.resolved !== true).length;
}

export function updateIncidentLogState(state, entries, extra = {}) {
  return {
    ...state,
    features: {
      ...state.features,
      incident_log: {
        properties: {
          ...state.features.incident_log.properties,
          ...extra,
          entries,
          open_incidents: countOpenIncidents(entries),
        },
      },
    },
  };
}

export function markIncidentResolvedState(state, incidentId, actor = "dashboard-operator") {
  const targetId = String(incidentId);
  const now = new Date().toISOString();
  const entries = (state.features.incident_log.properties.entries || []).map((entry, index) => {
    if (String(incidentIdentifier(entry, index)) !== targetId || entry?.resolved === true) return entry;
    return {
      ...entry,
      resolved: true,
      status: "RESOLVED",
      resolved_at: now,
      resolved_by: actor,
    };
  });
  return updateIncidentLogState(state, entries, { last_resolved_id: targetId, last_resolved_at: now });
}

export function markAllIncidentsResolvedState(state, actor = "dashboard-operator") {
  const now = new Date().toISOString();
  const entries = (state.features.incident_log.properties.entries || []).map((entry) => (
    entry?.resolved === true
      ? entry
      : { ...entry, resolved: true, status: "RESOLVED", resolved_at: now, resolved_by: actor }
  ));
  return updateIncidentLogState(state, entries, { last_resolved_at: now, last_reset_at: now });
}

export function estimateRecoveredRisk(state, { clearLatchedConditions = false } = {}) {
  return deriveThresholdRisk({
    attributes: state.attributes,
    cabin: state.features.cabin.properties,
    door: state.features.door.properties,
    motor: state.features.motor.properties,
    security: state.features.security.properties,
  }, { clearLatchedConditions });
}

// Healthy idle values used when clearing all problem latches. These mirror
// what the firmware reports at rest, so the dashboard stops showing CRITICAL
// motor telemetry once the operator confirms the physical fault is gone.
export const MOTOR_RESET_VIBRATION_G = 0.02;
export const MOTOR_RESET_TEMPERATURE_C = 35.0;

export function clearProblemLatchesState(state) {
  const incidentState = markAllIncidentsResolvedState(state);
  const nextRisk = estimateRecoveredRisk(incidentState, { clearLatchedConditions: true });
  const previousMotor = incidentState.features.motor.properties;
  // Bring any anomaly-injected motor readings back to a healthy baseline so
  // health_status computes as GOOD on the next render. The device's next
  // telemetry tick will overwrite these with the true sensor values.
  const nextVibration = Math.min(previousMotor.vibration_level, MOTOR_RESET_VIBRATION_G);
  const nextMotorTemp = Math.min(previousMotor.temperature_c, MOTOR_RESET_TEMPERATURE_C);

  return {
    ...incidentState,
    attributes: {
      ...incidentState.attributes,
      system_mode: "NORMAL",
      risk_score: nextRisk,
      maintenance_priority: nextRisk >= 76 ? "CRITICAL" : nextRisk >= 41 ? "MEDIUM" : "LOW",
    },
    features: {
      ...incidentState.features,
      cabin: {
        properties: {
          ...incidentState.features.cabin.properties,
          emergency_stop: false,
          speed_ms: 0,
          direction: "IDLE",
        },
      },
      door: {
        properties: {
          ...incidentState.features.door.properties,
          door_forced_entry: false,
        },
      },
      motor: {
        properties: {
          ...incidentState.features.motor.properties,
          vibration_level: nextVibration,
          temperature_c: nextMotorTemp,
          health_status: "GOOD",
        },
      },
      security: {
        properties: {
          ...incidentState.features.security.properties,
          audio_distress_active: false,
          active_security_incident: false,
          human_review_required: false,
          rfid_access_granted: true,
          unauthorized_access_attempts: 0,
          alert_level: "NORMAL",
          last_review_at: new Date().toISOString(),
        },
      },
    },
  };
}

export function buildStateDiff(previousState, nextState) {
  return {
    vibration: (nextState.features.motor.properties.vibration_level - previousState.features.motor.properties.vibration_level).toFixed(4),
    temperature: (nextState.features.motor.properties.temperature_c - previousState.features.motor.properties.temperature_c).toFixed(1),
    load: (nextState.features.cabin.properties.load_kg - previousState.features.cabin.properties.load_kg).toFixed(0),
    floor: nextState.features.cabin.properties.current_floor !== previousState.features.cabin.properties.current_floor,
  };
}

export const TELEMETRY_ALIASES = {
  cabin: {
    payload_weight_kg: "load_kg",
    payloadWeightKg: "load_kg",
    weight_kg: "load_kg",
    currentFloor: "current_floor",
    targetFloor: "target_floor",
    speedMs: "speed_ms",
    emergencyStop: "emergency_stop",
  },
  door: {
    door_state: "state",
    doorState: "state",
    forced_entry: "door_forced_entry",
    forcedEntry: "door_forced_entry",
  },
  motor: {
    vibration_g: "vibration_level",
    vibrationG: "vibration_level",
    vibration: "vibration_level",
    motor_temperature_c: "temperature_c",
    motorTemperatureC: "temperature_c",
    hoursOperated: "hours_operated",
    healthStatus: "health_status",
  },
  security: {
    audio_distress_detected: "audio_distress_active",
    audioDistressDetected: "audio_distress_active",
    unauthorized_access_count: "unauthorized_access_attempts",
    unauthorizedAccessCount: "unauthorized_access_attempts",
    rfidLastCard: "rfid_last_card",
    rfidAccessGranted: "rfid_access_granted",
    alertLevel: "alert_level",
  },
  fan: {
    fan_state: "state",
    fanState: "state",
    fan_mode: "mode",
    fanMode: "mode",
    on: "state",
    enabled: "state",
  },
};
export const TELEMETRY_PROPERTY_KEYS = {
  cabin: [
    "current_floor",
    "target_floor",
    "direction",
    "load_kg",
    "temperature_c",
    "speed_ms",
    "emergency_stop",
    "trips_today",
  ],
  door: ["state", "door_forced_entry", "cycle_count", "obstruction_events"],
  motor: [
    "vibration_level",
    "hours_operated",
    "health_status",
    "temperature_c",
    "current_draw_a",
    "power_kw",
  ],
  security: [
    "audio_distress_active",
    "unauthorized_access_attempts",
    "rfid_last_card",
    "rfid_access_granted",
    "alert_level",
  ],
  fan: [
    "state",
    "mode",
    "reason",
    "duty_cycle_pct",
    "runtime_today_min",
    "last_changed_at",
  ],
};

export function decodeTelemetryPathSegment(segment) {
  try {
    return decodeURIComponent(String(segment).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return String(segment);
  }
}

export function applyTelemetryAliases(featureId, properties) {
  if (!isPlainObject(properties)) return properties;

  const aliases = TELEMETRY_ALIASES[featureId] || {};
  const normalized = { ...properties };

  Object.entries(aliases).forEach(([sourceKey, targetKey]) => {
    if (normalized[sourceKey] !== undefined && normalized[targetKey] === undefined) {
      normalized[targetKey] = normalized[sourceKey];
    }

    if (sourceKey !== targetKey && normalized[sourceKey] !== undefined) {
      delete normalized[sourceKey];
    }
  });

  return normalized;
}

export function normalizeTelemetryFeature(featureId, featurePayload) {
  if (!isPlainObject(featurePayload)) return featurePayload;

  if (isPlainObject(featurePayload.properties)) {
    return {
      ...featurePayload,
      properties: applyTelemetryAliases(featureId, featurePayload.properties),
    };
  }

  const knownKeys = [
    ...(TELEMETRY_PROPERTY_KEYS[featureId] || []),
    ...Object.keys(TELEMETRY_ALIASES[featureId] || {}),
  ];
  if (knownKeys.some(key => featurePayload[key] !== undefined)) {
    return {
      properties: applyTelemetryAliases(featureId, featurePayload),
    };
  }

  return featurePayload;
}

export function normalizeTelemetryFeatures(features) {
  if (!isPlainObject(features)) return {};

  return Object.entries(features).reduce((accumulator, [featureId, featurePayload]) => {
    accumulator[featureId] = normalizeTelemetryFeature(featureId, featurePayload);
    return accumulator;
  }, {});
}

export function buildNestedTelemetryPatch(segments, value) {
  const root = {};
  let cursor = root;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }

    cursor[segment] = {};
    cursor = cursor[segment];
  });

  return root;
}

export function mapDittoPathEnvelopeToPatch(telemetry) {
  const rawPath = telemetry.path || telemetry.resource;
  if (typeof rawPath !== "string" || !Object.prototype.hasOwnProperty.call(telemetry, "value")) {
    return null;
  }

  const segments = rawPath
    .split("/")
    .filter(Boolean)
    .map(decodeTelemetryPathSegment);
  const value = telemetry.value;

  if (segments[0] === "features") {
    if (segments.length === 1) {
      return isPlainObject(value) ? { features: normalizeTelemetryFeatures(value) } : null;
    }

    const featureId = segments[1];
    if (!featureId) return null;

    if (segments.length === 2) {
      return isPlainObject(value)
        ? { features: { [featureId]: normalizeTelemetryFeature(featureId, value) } }
        : null;
    }

    if (segments[2] === "properties") {
      if (segments.length === 3) {
        return isPlainObject(value)
          ? { features: { [featureId]: { properties: applyTelemetryAliases(featureId, value) } } }
          : null;
      }

      const propertiesPatch = buildNestedTelemetryPatch(segments.slice(3), value);
      return {
        features: {
          [featureId]: { properties: applyTelemetryAliases(featureId, propertiesPatch) },
        },
      };
    }
  }

  if (segments[0] === "attributes") {
    if (segments.length === 1) {
      return isPlainObject(value) ? { attributes: value } : null;
    }

    return { attributes: buildNestedTelemetryPatch(segments.slice(1), value) };
  }

  return null;
}

export function unwrapTelemetryPayload(telemetry) {
  if (!isPlainObject(telemetry)) return telemetry;
  if (isPlainObject(telemetry.payload)) return telemetry.payload;
  if (isPlainObject(telemetry.data)) return telemetry.data;
  return telemetry;
}

export function mapTelemetryToTwinPatch(telemetry) {
  if (!isPlainObject(telemetry)) return null;
  const message = unwrapTelemetryPayload(telemetry);
  const dittoPathPatch = mapDittoPathEnvelopeToPatch(message);
  if (dittoPathPatch) return dittoPathPatch;

  if (isPlainObject(message.value) && (message.value.features || message.value.attributes)) {
    return {
      attributes: message.value.attributes,
      features: normalizeTelemetryFeatures(message.value.features),
    };
  }
  if (message.features || message.attributes) {
    return {
      attributes: message.attributes,
      features: normalizeTelemetryFeatures(message.features),
    };
  }

  const cabinSource = applyTelemetryAliases("cabin", isPlainObject(message.cabin?.properties)
    ? message.cabin.properties
    : isPlainObject(message.cabin)
      ? message.cabin
      : message);
  const doorSource = applyTelemetryAliases("door", isPlainObject(message.door?.properties)
    ? message.door.properties
    : isPlainObject(message.door)
      ? message.door
      : message);
  const motorSource = applyTelemetryAliases("motor", isPlainObject(message.motor?.properties)
    ? message.motor.properties
    : isPlainObject(message.motor)
      ? message.motor
      : message);
  const securitySource = applyTelemetryAliases("security", isPlainObject(message.security?.properties)
    ? message.security.properties
    : isPlainObject(message.security)
      ? message.security
      : message);
  const energySource = isPlainObject(message.energy?.properties)
    ? message.energy.properties
    : isPlainObject(message.energy)
      ? message.energy
      : message;
  const performanceSource = isPlainObject(message.performance?.properties)
    ? message.performance.properties
    : isPlainObject(message.performance)
      ? message.performance
      : message;

  const features = {};
  const attributes = pickDefined(message, [
    "system_mode",
    "risk_score",
    "maintenance_priority",
    "system_health_index",
    "energy_efficiency",
    "uptime_pct",
    "location",
  ]);

  const cabinProperties = pickDefined(cabinSource, [
    "current_floor",
    "target_floor",
    "direction",
    "load_kg",
    "temperature_c",
    "speed_ms",
    "emergency_stop",
    "trips_today",
  ]);
  if (Object.keys(cabinProperties).length > 0) features.cabin = { properties: cabinProperties };

  const doorProperties = pickDefined(doorSource, [
    "state",
    "door_forced_entry",
    "cycle_count",
    "obstruction_events",
  ]);
  if (Object.keys(doorProperties).length > 0) features.door = { properties: doorProperties };

  const motorProperties = pickDefined(motorSource, [
    "vibration_level",
    "hours_operated",
    "health_status",
    "temperature_c",
    "current_draw_a",
    "power_kw",
  ]);
  if (Object.keys(motorProperties).length > 0) features.motor = { properties: motorProperties };

  const securityProperties = pickDefined(securitySource, [
    "audio_distress_active",
    "unauthorized_access_attempts",
    "rfid_last_card",
    "rfid_access_granted",
    "alert_level",
  ]);
  if (Object.keys(securityProperties).length > 0) features.security = { properties: securityProperties };

  const energyProperties = pickDefined(energySource, [
    "kwh_today",
    "kwh_month",
    "kwh_baseline",
    "co2_kg",
    "regen_kwh",
  ]);
  if (Object.keys(energyProperties).length > 0) features.energy = { properties: energyProperties };

  const performanceProperties = pickDefined(performanceSource, [
    "avg_wait_s",
    "avg_trip_s",
    "availability_pct",
    "door_cycle_efficiency",
  ]);
  if (Object.keys(performanceProperties).length > 0) features.performance = { properties: performanceProperties };

  if (Object.keys(features).length === 0 && Object.keys(attributes).length === 0) {
    return null;
  }

  return { attributes, features };
}

// CONTEXT
export const TwinContext = createContext(null);
export const useTwin = () => useContext(TwinContext);

export const DEFAULT_PROFILE = {
  username: "operator",
  fullName: "Elevator Operator",
  email: "operator@elevator.local",
  role: "SCADA Supervisor",
  accountStatus: "Active",
  lastLogin: "Frontend session",
};

export const DEFAULT_PREFERENCES = {
  theme: "dark",
  accentColor: "#5e9cc0",
  compactMode: false,
  sidebarCollapsed: false,
  density: "comfortable",
  refreshInterval: 5,
  notificationsEnabled: true,
  alertSound: false,
  autoRefresh: true,
  defaultView: "twin",
  language: "English",
  criticalNotifications: true,
  emailNotifications: false,
  browserNotifications: false,
  systemHealthNotifications: true,
  developerMode: false,
};

export function readStoredJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch {
    return fallback;
  }
}

export function useStoredObject(key, fallback) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    setValue(readStoredJson(key, fallback));
  }, [key]);

  const updateValue = useCallback((patch) => {
    setValue((current) => {
      const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Preferences are non-critical. Ignore storage failures and keep runtime state.
      }
      return next;
    });
  }, [key]);

  return [value, updateValue];
}

// Historical data API hook
export function useHistoryApi(endpoint, queryParams, refreshMs) {
  const [apiState, setApiState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    let timer;
    const doFetch = () => {
      const url = new URL(endpoint, window.location.origin);
      if (queryParams) Object.entries(queryParams).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, String(v)); });
      fetch(url.toString())
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(json => { if (!cancelled) setApiState({ data: json, loading: false, error: null }); })
        .catch(err => { if (!cancelled) setApiState(prev => ({ data: prev.data, loading: false, error: err.message })); });
    };
    doFetch();
    if (refreshMs > 0) timer = setInterval(doFetch, refreshMs);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  return apiState;
}

// MASTER HOOK
export function isCommandDecision(value) {
  return value && typeof value === "object" && typeof value.accepted === "boolean";
}

export function commandDecisionDetail(decision, fallback = "Command rejected by safety gate") {
  const rejectionReasons = Array.isArray(decision?.rejection_reasons)
    ? decision.rejection_reasons.filter(Boolean)
    : [];
  if (rejectionReasons.length > 0) return rejectionReasons.join("; ");

  const dittoErrors = Array.isArray(decision?.ditto_write_errors)
    ? decision.ditto_write_errors.filter(Boolean)
    : [];
  if (dittoErrors.length > 0) return dittoErrors.join("; ");

  if (decision?.error) return String(decision.error);
  return fallback;
}

export function commandResultSeverity(result) {
  if (result === "FAILED" || result === "TIMED_OUT") return "CRITICAL";
  if (result === "IGNORED" || result === "REJECTED") return "WARNING";
  return "INFO";
}

export function useDigitalTwinEngine() {
  const [state, setState] = useState(() => sanitizeTwinState(INIT_STATE));
  const [vibH, setVibH] = useState([]);
  const [tmpH, setTmpH] = useState([]);
  const [ldH, setLdH] = useState([]);
  const [speedH, setSpeedH] = useState([]);
  const [riskH, setRiskH] = useState([]);
  const [enH, setEnH] = useState([]);
  const [cmdLog, setCmdLog] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [stateDiff, setStateDiff] = useState({});
  const [activeCommand, setActiveCommand] = useState(null);
  const activeCommandRef = useRef(null);
  const commandWaitersRef = useRef(new Map());
  // Deterministic, movement-based speed (independent of the firmware's constant
  // cruise approximation). Derived from observed floor transitions + timestamps.
  const [speedEstH, setSpeedEstH] = useState([]);
  const [computedSpeedMs, setComputedSpeedMs] = useState(0);
  const [lastTripSpeedMs, setLastTripSpeedMs] = useState(0);
  const speedEstimatorRef = useRef(null);
  if (!speedEstimatorRef.current) {
    speedEstimatorRef.current = createSpeedEstimator({ floorHeightM: 3.0 });
  }

  // Initialize telemetry history on client only to prevent hydration mismatch
  useEffect(() => {
    const seed = sanitizeTwinState(INIT_STATE);
    setVibH(Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ t: i, v: seed.features.motor.properties.vibration_level })));
    setTmpH(Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ t: i, v: seed.features.motor.properties.temperature_c })));
    setLdH(Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ t: i, v: Math.round(seed.features.cabin.properties.load_kg) })));
    setSpeedH(Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ t: i, v: seed.features.cabin.properties.speed_ms })));
    setRiskH(Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ t: i, v: seed.attributes.risk_score })));
    setSpeedEstH(Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ t: i, v: 0 })));
    setEnH(Array.from({ length: 24 }, (_, i) => ({ h: `${i}h`, v: i <= new Date().getHours() ? seed.features.energy.properties.kwh_today : 0 })));
  }, []);
  const tick = useRef(0);
  const sRef = useRef(state);
  sRef.current = state;

  // ── TOAST SYSTEM ──────────────────────────────────────────────
  const toast = useCallback((severity, message) => {
    const id = Date.now() + Math.random();
    setToasts(items => [{ id, severity, message, ts: new Date().toISOString() }, ...items].slice(0, 8));
    setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), severity === "CRITICAL" ? 8000 : 4000);
  }, []);

  const dismissToast = useCallback(id => setToasts(items => items.filter(item => item.id !== id)), []);

  const logCmd = useCallback((cmd, result = "OK", detail = "") => {
    setCmdLog(items => [{ id: Date.now(), ts: new Date().toISOString(), cmd, result, detail }, ...items].slice(0, 100));
  }, []);

  const commitState = useCallback((nextInput, source = "LOCAL") => {
    const previousState = sRef.current;
    const nextRawState = typeof nextInput === "function" ? nextInput(previousState) : nextInput;
    const nextState = sanitizeTwinState(nextRawState);
    const ts = new Date().toISOString();

    tick.current += 1;
    const sampleTick = tick.current;
    const cabin = nextState.features.cabin.properties;
    const motor = nextState.features.motor.properties;
    const energy = nextState.features.energy.properties;

    sRef.current = nextState;
    setState(nextState);
    setStateDiff(buildStateDiff(previousState, nextState));
    setVibH(history => [...history.slice(-(HISTORY_LIMIT - 1)), { t: sampleTick, v: motor.vibration_level }]);
    setTmpH(history => [...history.slice(-(HISTORY_LIMIT - 1)), { t: sampleTick, v: motor.temperature_c }]);
    setLdH(history => [...history.slice(-(HISTORY_LIMIT - 1)), { t: sampleTick, v: Math.round(cabin.load_kg) }]);
    setSpeedH(history => [...history.slice(-(HISTORY_LIMIT - 1)), { t: sampleTick, v: cabin.speed_ms }]);
    // Deterministic movement-based speed from floor transitions + timestamps.
    const speedSample = speedEstimatorRef.current.update({
      currentFloor: cabin.current_floor,
      direction: cabin.direction,
      nowMs: Date.parse(ts),
    });
    setComputedSpeedMs(speedSample.liveSpeedMs);
    if (speedSample.event === "arrive") {
      setLastTripSpeedMs(speedSample.lastSegmentSpeedMs);
    }
    setSpeedEstH(history => [...history.slice(-(HISTORY_LIMIT - 1)), { t: sampleTick, v: +speedSample.liveSpeedMs.toFixed(3) }]);
    setRiskH(history => [...history.slice(-(HISTORY_LIMIT - 1)), { t: sampleTick, v: nextState.attributes.risk_score }]);
    setEnH(history => {
      const hourLabel = `${new Date(ts).getHours()}h`;
      const nextHistory = [...history];
      const nextPoint = { h: hourLabel, v: +energy.kwh_today.toFixed(2) };
      const existingIndex = nextHistory.findIndex(point => point.h === hourLabel);

      if (existingIndex >= 0) {
        nextHistory[existingIndex] = nextPoint;
        return nextHistory.slice(-24);
      }

      return [...nextHistory.slice(-23), nextPoint];
    });
    setTimeline(items => [
      ...items.slice(-(TIMELINE_LIMIT - 1)),
      {
        tick: sampleTick,
        ts,
        floor: cabin.current_floor,
        speed: cabin.speed_ms,
        risk: +nextState.attributes.risk_score.toFixed(1),
        vib: motor.vibration_level,
        temp: motor.temperature_c,
        source,
      },
    ]);
  }, []);

  const runCommand = useCallback(async ({
    cmd,
    action,
    successMessage,
    successSeverity = "INFO",
    detail = "",
    localUpdate,
  }) => {
    if (activeCommandRef.current) {
      const active = activeCommandRef.current;
      const duplicateDetail = `Command ${active.command_id} (${active.command || "UNKNOWN"}) is still ${active.status}`;
      logCmd(cmd, "IGNORED", duplicateDetail);
      toast("WARNING", `${cmd} ignored: ${duplicateDetail}`);
      return {
        ok: false,
        accepted: false,
        decision: "REJECTED",
        rejection_reasons: [duplicateDetail],
      };
    }

    try {
      const decision = await action();

      if (isCommandDecision(decision) && !decision.accepted) {
        const result = decision.ok === false || decision.decision === "FAILED" ? "FAILED" : "REJECTED";
        const rejectionDetail = commandDecisionDetail(decision);
        logCmd(cmd, result, rejectionDetail);
        toast(result === "FAILED" ? "CRITICAL" : "WARNING", `${cmd} ${result.toLowerCase()}: ${rejectionDetail}`);
        return decision;
      }

      if (isCommandDecision(decision) && decision.accepted) {
        const writeStatus = String(decision.ditto_write_status || "").toUpperCase();
        if (writeStatus && !["SUCCEEDED", "SKIPPED", "PENDING"].includes(writeStatus)) {
          const failureDetail = commandDecisionDetail(decision, `Ditto write status: ${writeStatus}`);
          logCmd(cmd, "FAILED", failureDetail);
          toast("CRITICAL", `${cmd} failed: ${failureDetail}`);
          return decision;
        }

        const deviceStatus = String(decision.device_command_status || "SKIPPED").toUpperCase();
        if (deviceStatus === "FAILED") {
          const failureDetail = decision.device_command_error
            ? `Device command publish failed: ${decision.device_command_error}`
            : "Device command publish failed";
          logCmd(cmd, "FAILED", failureDetail);
          toast("CRITICAL", `${cmd} failed: ${failureDetail}`);
          return decision;
        }

        if (deviceStatus === "QUEUED_VIA_DITTO_BRIDGE" && decision.command_id) {
          const pending = {
            command_id: decision.command_id,
            correlation_id: decision.correlation_id,
            command: decision.command,
            status: "PENDING",
          };
          activeCommandRef.current = pending;
          setActiveCommand(pending);
          logCmd(cmd, "QUEUED", `Command ${decision.command_id} accepted by safety gate`);

          const immediate = commandResultForId(sRef.current, decision.command_id);
          const terminalResult = immediate || await new Promise((resolve) => {
            const timeoutId = window.setTimeout(() => {
              commandWaitersRef.current.delete(decision.command_id);
              resolve({
                command_id: decision.command_id,
                correlation_id: decision.correlation_id,
                command: decision.command,
                status: "TIMED_OUT",
                reason: `No terminal device acknowledgement within ${env.COMMAND_TIMEOUT_MS} ms`,
              });
            }, env.COMMAND_TIMEOUT_MS);

            commandWaitersRef.current.set(decision.command_id, {
              resolve,
              timeoutId,
            });
          });

          const terminalStatus = normalizeCommandStatus(terminalResult.status);
          const terminalDetail = commandOutcomeMessage(terminalResult);
          activeCommandRef.current = null;
          setActiveCommand(null);
          void reconcileCommandResult(decision.command_id);

          if (terminalStatus !== "COMPLETED") {
            logCmd(cmd, terminalStatus, terminalDetail);
            toast(terminalStatus === "REJECTED" ? "WARNING" : "CRITICAL", `${cmd} ${terminalStatus.toLowerCase()}: ${terminalDetail}`);
            return { ...decision, device_result: terminalResult };
          }

          logCmd(cmd, "EXECUTED", terminalDetail || detail);
          if (successMessage) toast(successSeverity, successMessage);
          return { ...decision, device_result: terminalResult };
        }
      }

      if (localUpdate) {
        commitState(localUpdate, "CMD");
      }
      logCmd(cmd, "EXECUTED", detail);
      if (successMessage) {
        toast(successSeverity, successMessage);
      }
      return decision;
    } catch (error) {
      console.error(`[SCADA] ${cmd} failed`, error);
      logCmd(cmd, "FAILED", error.message || "Command failed");
      toast("CRITICAL", `${cmd} failed${error?.message ? `: ${error.message}` : ""}`);
      return null;
    }
  }, [commitState, logCmd, toast]);

  const handleDittoThingUpdate = useCallback((thing) => {
    if (!thing) return;
    commitState(thing, "DITTO");
    const nextActive = activeCommandFromThing(thing);
    activeCommandRef.current = nextActive;
    setActiveCommand(nextActive);

    for (const [commandId, waiter] of commandWaitersRef.current.entries()) {
      const result = commandResultForId(thing, commandId);
      if (!result) continue;
      window.clearTimeout(waiter.timeoutId);
      commandWaitersRef.current.delete(commandId);
      waiter.resolve(result);
    }
  }, [commitState]);

  useEffect(() => () => {
    for (const waiter of commandWaitersRef.current.values()) {
      window.clearTimeout(waiter.timeoutId);
    }
    commandWaitersRef.current.clear();
  }, []);

  const {
    isConnected: dittoConnected,
    mode: dittoMode,
    error: dittoError,
  } = useDitto({ onThingUpdate: handleDittoThingUpdate });

  // The in-browser simulator was removed: the dashboard is now a pure
  // consumer of Ditto telemetry produced by the elevator_simulator container
  // (or by real ESP32 devices). The constants below preserve the surface
  // shape for downstream consumers so call sites keep compiling.
  const connected = dittoConnected;
  const isSimulationMode = false;

  const emergencyStopCommand = useCallback(async () => {
    await runCommand({
      cmd: "EMERGENCY_STOP",
      action: async () => {
        return submitCommand({
          command: "EMERGENCY_STOP",
          confirmation: true,
          reason: "Operator triggered emergency stop from SCADA",
        });
      },
      successMessage: "Emergency stop activated - elevator halted",
      successSeverity: "CRITICAL",
      localUpdate: previousState => addIncident({
        ...previousState,
        attributes: { ...previousState.attributes, system_mode: "MAINTENANCE", risk_score: 85 },
        features: {
          ...previousState.features,
          cabin: {
            properties: {
              ...previousState.features.cabin.properties,
              emergency_stop: true,
              speed_ms: 0,
              direction: "IDLE",
            },
          },
        },
      }, "EMERGENCY_STOP", "Emergency stop triggered from SCADA command center"),
    });
  }, [runCommand]);

  const triggerLockdownCommand = useCallback(async () => {
    await runCommand({
      cmd: "LOCKDOWN",
      action: async () => {
        return submitCommand({
          command: "LOCKDOWN",
          confirmation: true,
          reason: "Operator triggered security lockdown from SCADA",
        });
      },
      successMessage: "System lockdown activated - all access restricted",
      successSeverity: "CRITICAL",
      localUpdate: previousState => addIncident({
        ...previousState,
        attributes: { ...previousState.attributes, system_mode: "LOCKDOWN" },
        features: {
          ...previousState.features,
          security: {
            properties: {
              ...previousState.features.security.properties,
              alert_level: "CRITICAL",
            },
          },
        },
      }, "LOCKDOWN", "System lockdown initiated from command center"),
    });
  }, [runCommand]);

  const maintenanceCommand = useCallback(async () => {
    await runCommand({
      cmd: "SET_MAINTENANCE_MODE",
      action: async () => {
        return submitCommand({
          command: "SET_MAINTENANCE_MODE",
          confirmation: true,
          reason: "Operator placed elevator into maintenance mode",
        });
      },
      successMessage: "Maintenance mode active - elevator out of service",
      successSeverity: "WARNING",
      localUpdate: previousState => ({
        ...previousState,
        attributes: { ...previousState.attributes, system_mode: "MAINTENANCE" },
        features: {
          ...previousState.features,
          cabin: {
            properties: {
              ...previousState.features.cabin.properties,
              emergency_stop: true,
              speed_ms: 0,
              direction: "IDLE",
            },
          },
        },
      }),
    });
  }, [runCommand]);

  const resetSystemCommand = useCallback(async () => {
    await runCommand({
      cmd: "RESET_ACTIVE_PROBLEMS",
      action: async () => {
        return submitCommand({
          command: "RESET_ACTIVE_PROBLEMS",
          confirmation: true,
          human_approved: true,
          reason: "Operator confirmed active problems are physically resolved and requested dashboard recovery reset",
        });
      },
      successMessage: "Problems reset - latched alerts cleared and risk recalculated",
      localUpdate: previousState => clearProblemLatchesState(previousState),
    });
  }, [runCommand]);

  const acknowledgeAlertCommand = useCallback(async (alert = {}) => {
    await runCommand({
      cmd: "ACKNOWLEDGE_ALERT",
      action: async () => {
        return submitCommand({
          command: "ACKNOWLEDGE_ALERT",
          incident_id: alert.incidentId,
          metadata: {
            alert_id: alert.id,
            title: alert.title,
            source: alert.source,
          },
        });
      },
      successMessage: "Alert acknowledged - operator review recorded",
      detail: alert.title || alert.id || "Operator acknowledged alert",
    });
  }, [runCommand]);

  const resolveIncidentCommand = useCallback(async (incidentId) => {
    if (!incidentId) {
      logCmd("CLEAR_RESOLVED_INCIDENT", "REJECTED", "Incident id is required");
      toast("WARNING", "Cannot resolve incident without an incident id");
      return;
    }

    await runCommand({
      cmd: "CLEAR_RESOLVED_INCIDENT",
      action: async () => {
        return submitCommand({
          command: "CLEAR_RESOLVED_INCIDENT",
          incident_id: incidentId,
          reason: `Operator marked incident ${incidentId} resolved after remediation`,
        });
      },
      successMessage: `Incident ${incidentId} resolved`,
      detail: `Incident ${incidentId}`,
      localUpdate: previousState => {
        const resolvedState = markIncidentResolvedState(previousState, incidentId);
        if (resolvedState.features.incident_log.properties.open_incidents > 0) return resolvedState;
        return {
          ...resolvedState,
          attributes: {
            ...resolvedState.attributes,
            risk_score: estimateRecoveredRisk(resolvedState),
          },
        };
      },
    });
  }, [logCmd, runCommand, toast]);

  const setFanCommand = useCallback(async ({ state, mode = "MANUAL", reason }) => {
    const desiredState = String(state || "").toUpperCase() === "ON" ? "ON" : "OFF";
    const desiredMode = String(mode || "").toUpperCase() === "AUTO" ? "AUTO" : "MANUAL";
    await runCommand({
      cmd: "SET_FAN",
      detail: `Fan ${desiredState} (${desiredMode})`,
      action: async () => {
        return submitCommand({
          command: "SET_FAN",
          fan_state: desiredState,
          fan_mode: desiredMode,
          reason: reason || `Operator set fan ${desiredState} (${desiredMode})`,
        });
      },
      localUpdate: previousState => ({
        ...previousState,
        features: {
          ...previousState.features,
          fan: {
            properties: {
              ...previousState.features.fan.properties,
              state: desiredState,
              mode: desiredMode,
              reason: desiredMode === "AUTO" ? "AUTO_RESUME" : "OPERATOR_OVERRIDE",
              last_changed_at: new Date().toISOString(),
            },
          },
        },
      }),
    });
  }, [runCommand]);

  const moveToFloorCommand = useCallback(async floor => {
    await runCommand({
      cmd: "MOVE_TO_FLOOR",
      detail: `Target: floor ${FLOOR_LABELS[floor]}`,
      action: async () => {
        return submitCommand({
          command: "MOVE_TO_FLOOR",
          target_floor: floor,
          reason: `Operator dispatched cabin to floor ${FLOOR_LABELS[floor]}`,
        });
      },
      localUpdate: previousState => ({
        ...previousState,
        features: {
          ...previousState.features,
          cabin: {
            properties: {
              ...previousState.features.cabin.properties,
              target_floor: floor,
            },
          },
        },
      }),
    });
  }, [runCommand]);

  const openDoorCommand = useCallback(async () => {
    await runCommand({
      cmd: "OPEN_DOOR",
      detail: "Hold door open",
      action: async () => submitCommand({
        command: "OPEN_DOOR",
        reason: "Operator requested door hold-open from SCADA",
      }),
      successMessage: "Door hold-open requested",
      localUpdate: previousState => ({
        ...previousState,
        features: {
          ...previousState.features,
          door: {
            properties: { ...previousState.features.door.properties, state: "OPENING" },
          },
        },
      }),
    });
  }, [runCommand]);

  const closeDoorCommand = useCallback(async () => {
    await runCommand({
      cmd: "CLOSE_DOOR",
      detail: "Safe door close",
      action: async () => submitCommand({
        command: "CLOSE_DOOR",
        reason: "Operator requested safe door close from SCADA",
      }),
      successMessage: "Door close requested",
      localUpdate: previousState => ({
        ...previousState,
        features: {
          ...previousState.features,
          door: {
            properties: { ...previousState.features.door.properties, state: "CLOSING" },
          },
        },
      }),
    });
  }, [runCommand]);

  const clearQueueCommand = useCallback(async () => {
    await runCommand({
      cmd: "CLEAR_QUEUE",
      detail: "Flush all pending floor requests",
      action: async () => submitCommand({
        command: "CLEAR_QUEUE",
        confirmation: true,
        reason: "Operator cleared the dispatch queue from SCADA",
      }),
      successMessage: "Queue clear requested - device will flush pending requests",
      successSeverity: "WARNING",
      localUpdate: previousState => ({
        ...previousState,
        features: {
          ...previousState.features,
          request_queue: {
            properties: {
              ...previousState.features.request_queue.properties,
              pending_count: 0,
              cabin: [false, false, false, false],
              hall_up: [false, false, false, false],
              hall_down: [false, false, false, false],
            },
          },
        },
      }),
    });
  }, [runCommand]);

  const requestStatusRefreshCommand = useCallback(async () => {
    await runCommand({
      cmd: "REQUEST_STATUS_REFRESH",
      detail: "Request table and telemetry refresh",
      action: async () => submitCommand({
        command: "REQUEST_STATUS_REFRESH",
        reason: "Operator requested an immediate queue/status refresh from SCADA",
      }),
      successMessage: "Status refresh requested - waiting for next device telemetry",
    });
  }, [runCommand]);

  const softStopCommand = useCallback(async () => {
    await runCommand({
      cmd: "SOFT_STOP",
      detail: "Firmware ERROR_STOP request",
      action: async () => submitCommand({
        command: "SOFT_STOP",
        confirmation: true,
        human_approved: true,
        reason: "Operator requested a controlled firmware soft stop from SCADA",
      }),
      successMessage: "Soft stop requested - firmware will enter ERROR_STOP",
      successSeverity: "WARNING",
      localUpdate: previousState => addIncident({
        ...previousState,
        attributes: { ...previousState.attributes, system_mode: "MAINTENANCE", risk_score: Math.max(previousState.attributes.risk_score, 82) },
        features: {
          ...previousState.features,
          cabin: {
            properties: {
              ...previousState.features.cabin.properties,
              emergency_stop: true,
              speed_ms: 0,
              direction: "IDLE",
            },
          },
        },
      }, "SOFT_STOP", "Controlled firmware soft stop requested from SCADA"),
    });
  }, [runCommand]);

  const homeCommand = useCallback(async () => {
    await runCommand({
      cmd: "HOME",
      detail: `Set current floor to ${FLOOR_LABELS[0]}`,
      action: async () => submitCommand({
        command: "HOME",
        confirmation: true,
        human_approved: true,
        reason: "Operator calibrated the prototype home floor from SCADA",
      }),
      successMessage: "Home calibration requested - current floor will be reset on the device",
      successSeverity: "WARNING",
      localUpdate: previousState => ({
        ...previousState,
        features: {
          ...previousState.features,
          cabin: {
            properties: {
              ...previousState.features.cabin.properties,
              current_floor: 0,
              target_floor: 0,
              direction: "IDLE",
              speed_ms: 0,
            },
          },
          request_queue: {
            properties: {
              ...previousState.features.request_queue.properties,
              pending_count: 0,
              dispatch_direction: "IDLE",
              current_floor: 0,
              target_floor: 0,
              cabin: [false, false, false, false],
              hall_up: [false, false, false, false],
              hall_down: [false, false, false, false],
            },
          },
        },
      }),
    });
  }, [runCommand]);

  const freshStartCommand = useCallback(async () => {
    await runCommand({
      cmd: "FRESH_START_RESET",
      detail: "Clear requests, counters and runtime timers",
      action: async () => submitCommand({
        command: "FRESH_START_RESET",
        confirmation: true,
        human_approved: true,
        reason: "Operator requested a fresh-start runtime reset from SCADA",
      }),
      successMessage: "Fresh-start reset requested - firmware runtime state will be cleared",
      successSeverity: "WARNING",
      localUpdate: previousState => clearProblemLatchesState({
        ...previousState,
        features: {
          ...previousState.features,
          cabin: {
            properties: {
              ...previousState.features.cabin.properties,
              current_floor: 0,
              target_floor: 0,
              direction: "IDLE",
              speed_ms: 0,
              trips_today: 0,
            },
          },
          request_queue: {
            properties: {
              ...previousState.features.request_queue.properties,
              pending_count: 0,
              dispatch_direction: "IDLE",
              current_floor: 0,
              target_floor: 0,
              cabin: [false, false, false, false],
              hall_up: [false, false, false, false],
              hall_down: [false, false, false, false],
            },
          },
        },
      }),
    });
  }, [runCommand]);

  const runDeviceDiagnosticCommand = useCallback(async (deviceAction, label) => {
    const action = String(deviceAction || "").toUpperCase();
    await runCommand({
      cmd: `DEVICE_DIAGNOSTIC:${action}`,
      detail: label || action,
      action: async () => submitCommand({
        command: "DEVICE_DIAGNOSTIC",
        device_action: action,
        confirmation: true,
        human_approved: true,
        reason: `Operator requested firmware diagnostic ${label || action} from SCADA`,
      }),
      successMessage: `${label || action} diagnostic requested`,
      successSeverity: "WARNING",
    });
  }, [runCommand]);

  // ── COMMANDS ──────────────────────────────────────────────────
  const emergencyStop = useCallback(() => {
    setState(prev => addIncident({
      ...prev,
      attributes: { ...prev.attributes, system_mode: "MAINTENANCE", risk_score: 85 },
      features:   { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, emergency_stop: true, speed_ms: 0, direction: "IDLE" }}},
    }, "EMERGENCY_STOP", "Emergency stop triggered from SCADA command center"));
    logCmd("EMERGENCY_STOP", "EXECUTED");
    toast("CRITICAL", "Emergency stop activated - elevator halted");
  }, [logCmd, toast]);

  const lockdown = useCallback(() => {
    setState(prev => addIncident({
      ...prev,
      attributes: { ...prev.attributes, system_mode: "LOCKDOWN" },
      features:   { ...prev.features, security: { properties: { ...prev.features.security.properties, alert_level: "CRITICAL" }}},
    }, "LOCKDOWN", "System lockdown initiated from command center"));
    logCmd("LOCKDOWN", "EXECUTED");
    toast("CRITICAL", "System lockdown activated - all access restricted");
  }, [logCmd, toast]);

  const maintenance = useCallback(() => {
    setState(prev => ({ ...prev, attributes: { ...prev.attributes, system_mode: "MAINTENANCE" }, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, emergency_stop: true }}}}));
    logCmd("MAINTENANCE_MODE", "EXECUTED");
    toast("WARNING", "Maintenance mode active - elevator out of service");
  }, [logCmd, toast]);

  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      attributes: { ...prev.attributes, system_mode: "NORMAL", risk_score: 0 },
      features: {
        ...prev.features,
        cabin:    { properties: { ...prev.features.cabin.properties, emergency_stop: false }},
        door:     { properties: { ...prev.features.door.properties, state: "OPEN", door_forced_entry: false }},
        security: { properties: { ...prev.features.security.properties, audio_distress_active: false, rfid_access_granted: true, alert_level: "NORMAL" }},
      },
    }));
    logCmd("RESET_NORMAL", "EXECUTED");
    toast("INFO", "System reset - returning to NORMAL operation");
  }, [logCmd, toast]);

  const sendFloor = useCallback(f => {
    setState(prev => ({ ...prev, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, target_floor: f }}}}));
    logCmd("SEND_TO_FLOOR", "EXECUTED", `Target: floor ${FLOOR_LABELS[f]}`);
  }, [logCmd]);

  const optimizeRouting = useCallback(() => {
    logCmd("OPTIMIZE_ROUTING", "EXECUTED", "SCAN algorithm engaged");
    toast("INFO", "Routing optimized - estimated wait reduction 23%");
  }, [logCmd, toast]);

  const reduceEnergy = useCallback(() => {
    logCmd("REDUCE_ENERGY", "EXECUTED");
    toast("INFO", "Energy reduction mode active - off-peak parking at G");
  }, [logCmd, toast]);

  // Anomaly inject / scenario buttons. With the in-browser simulator removed
  // these write to local state only and will be overwritten by the next Ditto
  // SSE/poll, so they behave like a transient preview of how an incident
  // would render. To actually inject anomalies into the pipeline, run the
  // container simulator with SIM_ANOMALY_PROFILE=demo|critical.
  const injectHighVibCommand = useCallback(() => {
    commitState(previousState => addIncident({
      ...previousState,
      features: { ...previousState.features, motor: { properties: { ...previousState.features.motor.properties, vibration_level: 0.41, health_status: "CRITICAL" }}},
      attributes: { ...previousState.attributes, risk_score: Math.min(100, previousState.attributes.risk_score + 42) },
    }, "VIBRATION_SPIKE", "Preview: bearing fault - vibration spike 0.41g"), "PREVIEW");
    logCmd("INJECT_HIGH_VIB", "PREVIEW");
    toast("WARNING", "Local preview: motor vibration spike 0.41g (will be overwritten by next Ditto update)");
  }, [commitState, logCmd, toast]);

  const injectForcedEntryCommand = useCallback(() => {
    commitState(previousState => addIncident({
      ...previousState,
      attributes: { ...previousState.attributes, system_mode: "LOCKDOWN", risk_score: 95 },
      features: { ...previousState.features, door: { properties: { ...previousState.features.door.properties, state: "BLOCKED", door_forced_entry: true }}, security: { properties: { ...previousState.features.security.properties, alert_level: "CRITICAL" }}},
    }, "FORCED_ENTRY", "Preview: door reed switch tripped - forced entry detected"), "PREVIEW");
    logCmd("INJECT_FORCED_ENTRY", "PREVIEW");
    toast("CRITICAL", "Local preview: forced door entry (will be overwritten by next Ditto update)");
  }, [commitState, logCmd, toast]);

  const injectAudioDistressCommand = useCallback(() => {
    commitState(previousState => addIncident({
      ...previousState,
      attributes: { ...previousState.attributes, system_mode: "LOCKDOWN", risk_score: 93 },
      features: { ...previousState.features, security: { properties: { ...previousState.features.security.properties, audio_distress_active: true, alert_level: "CRITICAL" }}},
    }, "DISTRESS_AUDIO", "Preview: MEMS mic detected passenger distress signal"), "PREVIEW");
    logCmd("INJECT_AUDIO_DISTRESS", "PREVIEW");
    toast("CRITICAL", "Local preview: passenger distress signal (will be overwritten by next Ditto update)");
  }, [commitState, logCmd, toast]);

  const injectInvalidRFIDCommand = useCallback(async () => {
    // Records a REAL denied access event through the backend (durable Postgres
    // + Ditto recentAccessLog ring buffer). No dashboard-only fake state: the
    // next logs refresh surfaces it from the store, exactly like a device scan.
    const uid = `DEAD${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
    const result = await recordAccessEvent({
      uid,
      decision: "DENIED",
      role: "UNKNOWN",
      reason: "Card not in authorized registry",
      source: "dashboard-sim",
    });
    if (result.ok) {
      logCmd("RECORD_DENIED_SCAN", "EXECUTED", uid);
      toast("WARNING", `Recorded denied RFID scan ${uid} (real access-log event)`);
    } else {
      logCmd("RECORD_DENIED_SCAN", "FAILED", result.error || "");
      toast("CRITICAL", `Failed to record denied scan: ${result.error || "unknown error"}`);
    }
  }, [logCmd, toast]);

  const runScenarioCommand = useCallback(key => {
    commitState(previousState => applyScenario(previousState, key), "PREVIEW");
    const def = SCENARIO_DEFS[key];
    logCmd(`SCENARIO_${key.toUpperCase()}`, "PREVIEW", def?.label || key);
    toast(def?.severity || "WARNING", `Local preview scenario: ${def?.label || key} (will be overwritten by next Ditto update)`);
  }, [commitState, logCmd, toast]);

  const setVibrationCommand = useCallback(vibration => {
    commitState(previousState => ({ ...previousState, features: { ...previousState.features, motor: { properties: { ...previousState.features.motor.properties, vibration_level: vibration }}}}), "PREVIEW");
  }, [commitState]);

  const setLoadCommand = useCallback(loadKg => {
    commitState(previousState => ({ ...previousState, features: { ...previousState.features, cabin: { properties: { ...previousState.features.cabin.properties, load_kg: loadKg }}}}), "PREVIEW");
  }, [commitState]);

  const setMotorTempCommand = useCallback(temperature => {
    commitState(previousState => ({ ...previousState, features: { ...previousState.features, motor: { properties: { ...previousState.features.motor.properties, temperature_c: temperature }}}}), "PREVIEW");
  }, [commitState]);

  // Injectors
  const injectHighVib = useCallback(() => {
    setState(prev => addIncident({
      ...prev,
      features: { ...prev.features, motor: { properties: { ...prev.features.motor.properties, vibration_level: 0.41, health_status: "CRITICAL" }}},
      attributes: { ...prev.attributes, risk_score: Math.min(100, prev.attributes.risk_score + 42) },
    }, "VIBRATION_SPIKE", "Injected: bearing fault - vibration spike 0.41g"));
    setVibH(h => [...h.slice(-59), { t: tick.current + 1, v: 0.41 }]);
    logCmd("INJECT_HIGH_VIB", "INJECTED");
    toast("WARNING", "Anomaly injected: motor vibration spike 0.41g");
  }, [logCmd, toast]);

  const injectForcedEntry = useCallback(() => {
    setState(prev => addIncident({
      ...prev,
      attributes: { ...prev.attributes, system_mode: "LOCKDOWN", risk_score: 95 },
      features: { ...prev.features, door: { properties: { ...prev.features.door.properties, state: "BLOCKED", door_forced_entry: true }}, security: { properties: { ...prev.features.security.properties, alert_level: "CRITICAL" }}},
    }, "FORCED_ENTRY", "Injected: door reed switch tripped - forced entry detected"));
    logCmd("INJECT_FORCED_ENTRY", "INJECTED");
    toast("CRITICAL", "Anomaly injected: forced door entry - LOCKDOWN active");
  }, [logCmd, toast]);

  const injectAudioDistress = useCallback(() => {
    setState(prev => addIncident({
      ...prev,
      attributes: { ...prev.attributes, system_mode: "LOCKDOWN", risk_score: 93 },
      features: { ...prev.features, security: { properties: { ...prev.features.security.properties, audio_distress_active: true, alert_level: "CRITICAL" }}},
    }, "DISTRESS_AUDIO", "Injected: MEMS mic detected passenger distress signal"));
    logCmd("INJECT_AUDIO_DISTRESS", "INJECTED");
    toast("CRITICAL", "Anomaly injected: passenger distress signal detected");
  }, [logCmd, toast]);

  const injectInvalidRFID = useCallback(() => {
    const card = `UNKNOWN_${Math.floor(Math.random() * 9000) + 1000}`;
    setState(prev => addIncident({
      ...prev,
      features: { ...prev.features, security: { properties: { ...prev.features.security.properties, rfid_last_card: card, rfid_access_granted: false, unauthorized_access_attempts: prev.features.security.properties.unauthorized_access_attempts + 1, alert_level: "HIGH" }}},
      attributes: { ...prev.attributes, risk_score: Math.min(100, prev.attributes.risk_score + 18) },
    }, "UNAUTHORIZED_RFID", `Injected: card ${card} denied - not in whitelist`));
    logCmd("INJECT_INVALID_RFID", "INJECTED", card);
    toast("WARNING", `Anomaly injected: unauthorized RFID ${card}`);
  }, [logCmd, toast]);

  const runScenario = useCallback(key => {
    setState(prev => applyScenario(prev, key));
    const def = SCENARIO_DEFS[key];
    logCmd(`SCENARIO_${key.toUpperCase()}`, "ACTIVE", def?.label || key);
    toast(def?.severity || "WARNING", `Scenario active: ${def?.label || key}`);
  }, [logCmd, toast]);

  const setVibration = useCallback(v => {
    setState(prev => ({ ...prev, features: { ...prev.features, motor: { properties: { ...prev.features.motor.properties, vibration_level: v }}}}));
    setVibH(h => [...h.slice(-59), { t: tick.current + 1, v }]);
  }, []);

  const setLoad = useCallback(kg => {
    setState(prev => ({ ...prev, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, load_kg: kg }}}}));
  }, []);

  const setMotorTemp = useCallback(t => {
    setState(prev => ({ ...prev, features: { ...prev.features, motor: { properties: { ...prev.features.motor.properties, temperature_c: t }}}}));
    setTmpH(h => [...h.slice(-59), { t: tick.current + 1, v: t }]);
  }, []);

  return {
    state, vibH, tmpH, ldH, speedH, riskH, enH, cmdLog, toasts, timeline, stateDiff, connected,
    activeCommand, commandInFlight: Boolean(activeCommand),
    isSimulationMode, dittoConnected, dittoMode, dittoError,
    speedEstH, computedSpeedMs, lastTripSpeedMs,
    emergencyStop: emergencyStopCommand, lockdown: triggerLockdownCommand, maintenance: maintenanceCommand, reset: resetSystemCommand, sendFloor: moveToFloorCommand,
    openDoor: openDoorCommand, closeDoor: closeDoorCommand, clearQueue: clearQueueCommand,
    requestStatusRefresh: requestStatusRefreshCommand, softStop: softStopCommand, home: homeCommand, freshStart: freshStartCommand, runDeviceDiagnostic: runDeviceDiagnosticCommand,
    optimizeRouting, reduceEnergy, setFan: setFanCommand,
    acknowledgeAlert: acknowledgeAlertCommand, resolveIncident: resolveIncidentCommand,
    injectHighVib: injectHighVibCommand, injectForcedEntry: injectForcedEntryCommand, injectAudioDistress: injectAudioDistressCommand, injectInvalidRFID: injectInvalidRFIDCommand, runScenario: runScenarioCommand,
    setVibration: setVibrationCommand, setLoad: setLoadCommand, setMotorTemp: setMotorTempCommand, dismissToast,
  };
}
