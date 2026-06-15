// ElevatorOS SCADA dashboard shell.
// Authoritative state comes from Eclipse Ditto through useDitto; operator
// commands are submitted through /api/commands and the deterministic safety gate.

import {
  useState, useEffect, useRef, useCallback,
  createContext, useContext, useMemo,
} from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  Ban,
  Cpu,
  Database,
  DoorClosed,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListX,
  Loader2,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Power,
  RadioTower,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sun,
  Terminal,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import { env } from "../src/config/env";
import { useDitto } from "../src/hooks/useDitto";
import { submitCommand } from "../src/services/commandClient";
import { useAccessControl } from "../src/hooks/useAccessControl";
import { recordAccessEvent } from "../src/services/accessControlClient";
import { createSpeedEstimator } from "../src/lib/speedEstimator";
import { ROLES, normalizeUid } from "../src/lib/accessControl";
import CommandSafetyGatePanel from "./scada/CommandSafetyGatePanel";
import DispatchPolicyPanel from "./scada/DispatchPolicyPanel";

// Design tokens
const T = {
  bg:        "#050a12",
  surface:   "#ffffff",   // Pure white - panel background
  surfaceHi: "#f0f4f9",   // Light blue-gray - elevated panel
  border:    "#d1dce6",   // Soft gray border
  borderHi:  "#b8c5d6",   // Darker border for hover
  text:      "#0f1419",   // Dark text - primary
  textSub:   "#4a5568",   // Medium gray - secondary
  textMute:  "#8a92a2",   // Light gray - muted
  green:     "#059669",   // Emerald for success
  greenDim:  "#d1fae5",   // Light emerald background
  yellow:    "#d97706",   // Amber for warning
  yellowDim: "#fef3c7",   // Light amber background
  red:       "#dc2626",   // Red for critical
  redDim:    "#fee2e2",   // Light red background
  blue:      "#2563eb",   // Blue for info
  blueDim:   "#dbeafe",   // Light blue background
  cyan:      "#0891b2",   // Cyan accent
  purple:    "#7c3aed",   // Purple accent
};

// Constants
Object.assign(T, {
  bg: "#050a12",
  bg2: "#08111f",
  surface: "#0d1626",
  surfaceHi: "#111f33",
  surfaceLo: "#07101d",
  border: "#1f334a",
  borderHi: "#2f526f",
  text: "#e6edf7",
  textSub: "#aab7c7",
  textMute: "#65758a",
  green: "#34d399",
  greenDim: "rgba(16, 185, 129, 0.13)",
  yellow: "#f59e0b",
  yellowDim: "rgba(245, 158, 11, 0.14)",
  red: "#f87171",
  redDim: "rgba(248, 113, 113, 0.15)",
  blue: "#60a5fa",
  blueDim: "rgba(96, 165, 250, 0.14)",
  cyan: "#22d3ee",
  cyanDim: "rgba(34, 211, 238, 0.13)",
  purple: "#c084fc",
  purpleDim: "rgba(192, 132, 252, 0.14)",
  orange: "#fb923c",
});

const DARK_TOKENS = { ...T };
const LIGHT_TOKENS = {
  bg: "#f5f8fb",
  bg2: "#eaf1f8",
  surface: "#ffffff",
  surfaceHi: "#eef4fa",
  surfaceLo: "#f8fbfe",
  border: "#d6e1ec",
  borderHi: "#b9c8d8",
  text: "#0f172a",
  textSub: "#334155",
  textMute: "#64748b",
  green: "#047857",
  greenDim: "rgba(4, 120, 87, 0.10)",
  yellow: "#b45309",
  yellowDim: "rgba(180, 83, 9, 0.12)",
  red: "#b91c1c",
  redDim: "rgba(185, 28, 28, 0.10)",
  blue: "#1d4ed8",
  blueDim: "rgba(29, 78, 216, 0.10)",
  cyan: "#0e7490",
  cyanDim: "rgba(14, 116, 144, 0.10)",
  purple: "#7c3aed",
  purpleDim: "rgba(124, 58, 237, 0.10)",
  orange: "#c2410c",
};

function applyThemeTokens(theme) {
  Object.assign(T, theme === "light" ? LIGHT_TOKENS : DARK_TOKENS);
}

const NUM_FLOORS    = 4;
const FLOOR_LABELS  = ["0", "1", "2", "3"];
const FLOOR_H       = 84;
const MAX_LOAD      = 800;
const MOTOR_LIFE_H  = 10000;

const PAGES = [
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

const PAGE_GROUPS = ["Core", "Intelligence", "Operations", "Infrastructure", "System"];

const SCENARIO_DEFS = {
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

const FIRMWARE_DIAGNOSTIC_COMMANDS = [
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
const INIT_STATE = {
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
    control: { properties: { pending_command: null, last_forwarded_command: null }},
    microcontroller: { properties: { board: "ESP32-S3", connected: false, status: "OFFLINE", source: "mqtt_status", transport: "MQTT", mqtt_id: env.MQTT_ID, mqtt_topic: env.MQTT_STATUS_TOPIC, telemetry_topic: env.MQTT_TELEMETRY_TOPIC, last_seen_at: null, last_telemetry_at: null, last_status_at: null, last_disconnected_at: null }},
    incident_log: { properties: { entries: [], open_incidents: 0 }},
    energy:   { properties: { kwh_today: 0, kwh_month: 0, kwh_baseline: 0, co2_kg: 0, regen_kwh: 0 }},
    performance: { properties: { avg_wait_s: 0, avg_trip_s: 0, availability_pct: 100, door_cycle_efficiency: 100 }},
    predicted_failures: { properties: { motor_rul_hours: 10000, bearing_health_pct: 100, door_mechanism_pct: 100, rope_tension_pct: 100, next_service_date: "" }},
  },
};

INIT_STATE.attributes.location = "Building A / Shaft 1";

// HELPERS
function addIncident(state, type, description) {
  const entries = [
    { incident_id: `INC-${String(Date.now()).slice(-5)}`, ts: new Date().toISOString(), type, description, resolved: false },
    ...(state.features.incident_log.properties.entries || []),
  ].slice(0, 50);
  return {
    ...state,
    features: { ...state.features, incident_log: { properties: { entries, open_incidents: entries.filter(e => !e.resolved).length }}},
  };
}

function applyScenario(state, key) {
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

const riskColor  = s  => s >= 76 ? T.red    : s >= 41 ? T.yellow : T.green;
const riskLabel  = s  => s >= 76 ? "CRITICAL" : s >= 41 ? "WARNING" : "NOMINAL";
const healthColor = h => h >= 80 ? T.green   : h >= 50 ? T.yellow  : T.red;
const fmtTime    = ts => { try { return new Date(ts).toLocaleTimeString("en-GB", { hour12: false }); } catch { return ""; }};
const relTime    = ts => {
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d < 5)   return "just now";
  if (d < 60)  return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  return `${Math.floor(d/3600)}h ago`;
};

const HISTORY_LIMIT = 60;
const TIMELINE_LIMIT = 200;

// Cooling automation
// Drives the electronics-bay fan that cools the power supply, drivers and
// motor. Hysteresis on motor temperature avoids relay chatter; an activity
// preempt keeps the fan running during travel; a critical safety override
// forces the fan ON regardless of operator mode when the motor approaches
// thermal limit.
const FAN_THERMAL = {
  ON_MOTOR_C: 55,        // turn fan ON when motor crosses this
  OFF_MOTOR_C: 45,       // turn fan OFF only when motor drops below this
  ON_CABIN_C: 30,        // also turn ON if cabin air is uncomfortable
  CRITICAL_MOTOR_C: 75,  // force-ON override, regardless of operator mode
  POST_RUN_S: 8,         // keep blowing for this many seconds after motion stops
};

function decideFanState({ motorTempC, cabinTempC, moving, mode, currentState, lastActivityMs, nowMs = Date.now() }) {
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

const isPlainObject = value => value != null && typeof value === "object" && !Array.isArray(value);
const clamp = (value, min, max, fallback = min) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};
const normalizeFloor = (value, fallback = 0) => clamp(Math.round(Number(value)), 0, NUM_FLOORS - 1, fallback);
const normalizeRequestFlags = (value) => {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: NUM_FLOORS }, (_, index) => Boolean(source[index]));
};

function deepMergeState(base, patch) {
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

function pickDefined(source, keys) {
  return keys.reduce((accumulator, key) => {
    if (source?.[key] !== undefined) {
      accumulator[key] = source[key];
    }
    return accumulator;
  }, {});
}

function getFeatureProperties(state, featureId) {
  return state?.features?.[featureId]?.properties || {};
}

function hasFeatureDataBeyondSeed(state, featureId, keys = []) {
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

function normalizeMicrocontrollerStatus(props = {}) {
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

function getMicrocontrollerStatus(state) {
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

function buildRequestQueueRows(queue = {}) {
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

function getAiAnalysis(state) {
  const featureAnalysis = getFeatureProperties(state, "ai_analysis");
  const attributeAnalysis = state?.attributes?.ai_analysis;
  if (isPlainObject(featureAnalysis) && Object.keys(featureAnalysis).length > 0) return featureAnalysis;
  if (isPlainObject(attributeAnalysis) && Object.keys(attributeAnalysis).length > 0) return attributeAnalysis;
  return null;
}

function getSeverityFromRisk(score) {
  if (score >= 76) return "CRITICAL";
  if (score >= 41) return "WARNING";
  return "NORMAL";
}

function getAnalysisText(analysis, keys) {
  if (!analysis) return "";
  for (const key of keys) {
    const value = analysis[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function publicConfigValue(value) {
  if (!value) return "Not configured";
  const text = String(value);
  return text.includes("@") || text.toLowerCase().includes("password") || text.toLowerCase().includes("token")
    ? "Configured"
    : text;
}

function deriveThresholdRisk({ attributes = {}, cabin = {}, door = {}, motor = {}, security = {} }, { clearLatchedConditions = false } = {}) {
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

function sanitizeTwinState(rawThing) {
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

function incidentIdentifier(entry, index = 0) {
  return entry?.incident_id ?? entry?.incidentId ?? entry?.id ?? `incident-${index}`;
}

function countOpenIncidents(entries) {
  return entries.filter(entry => entry?.resolved !== true).length;
}

function updateIncidentLogState(state, entries, extra = {}) {
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

function markIncidentResolvedState(state, incidentId, actor = "dashboard-operator") {
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

function markAllIncidentsResolvedState(state, actor = "dashboard-operator") {
  const now = new Date().toISOString();
  const entries = (state.features.incident_log.properties.entries || []).map((entry) => (
    entry?.resolved === true
      ? entry
      : { ...entry, resolved: true, status: "RESOLVED", resolved_at: now, resolved_by: actor }
  ));
  return updateIncidentLogState(state, entries, { last_resolved_at: now, last_reset_at: now });
}

function estimateRecoveredRisk(state, { clearLatchedConditions = false } = {}) {
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
const MOTOR_RESET_VIBRATION_G = 0.02;
const MOTOR_RESET_TEMPERATURE_C = 35.0;

function clearProblemLatchesState(state) {
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

function buildStateDiff(previousState, nextState) {
  return {
    vibration: (nextState.features.motor.properties.vibration_level - previousState.features.motor.properties.vibration_level).toFixed(4),
    temperature: (nextState.features.motor.properties.temperature_c - previousState.features.motor.properties.temperature_c).toFixed(1),
    load: (nextState.features.cabin.properties.load_kg - previousState.features.cabin.properties.load_kg).toFixed(0),
    floor: nextState.features.cabin.properties.current_floor !== previousState.features.cabin.properties.current_floor,
  };
}

const TELEMETRY_ALIASES = {
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
const TELEMETRY_PROPERTY_KEYS = {
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

function decodeTelemetryPathSegment(segment) {
  try {
    return decodeURIComponent(String(segment).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return String(segment);
  }
}

function applyTelemetryAliases(featureId, properties) {
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

function normalizeTelemetryFeature(featureId, featurePayload) {
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

function normalizeTelemetryFeatures(features) {
  if (!isPlainObject(features)) return {};

  return Object.entries(features).reduce((accumulator, [featureId, featurePayload]) => {
    accumulator[featureId] = normalizeTelemetryFeature(featureId, featurePayload);
    return accumulator;
  }, {});
}

function buildNestedTelemetryPatch(segments, value) {
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

function mapDittoPathEnvelopeToPatch(telemetry) {
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

function unwrapTelemetryPayload(telemetry) {
  if (!isPlainObject(telemetry)) return telemetry;
  if (isPlainObject(telemetry.payload)) return telemetry.payload;
  if (isPlainObject(telemetry.data)) return telemetry.data;
  return telemetry;
}

function mapTelemetryToTwinPatch(telemetry) {
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
const TwinContext = createContext(null);
const useTwin = () => useContext(TwinContext);

const DEFAULT_PROFILE = {
  username: "operator",
  fullName: "Elevator Operator",
  email: "operator@elevator.local",
  role: "SCADA Supervisor",
  accountStatus: "Active",
  lastLogin: "Frontend session",
};

const DEFAULT_PREFERENCES = {
  theme: "dark",
  accentColor: "#22d3ee",
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

function readStoredJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch {
    return fallback;
  }
}

function useStoredObject(key, fallback) {
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
function useHistoryApi(endpoint, queryParams, refreshMs) {
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
function isCommandDecision(value) {
  return value && typeof value === "object" && typeof value.accepted === "boolean";
}

function commandDecisionDetail(decision, fallback = "Command rejected by safety gate") {
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

function commandResultSeverity(result) {
  if (result === "FAILED") return "CRITICAL";
  if (result === "IGNORED" || result === "REJECTED") return "WARNING";
  return "INFO";
}

function useDigitalTwinEngine() {
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
  }, [commitState]);

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

// Design system components

/** Panel card with optional header accent */
function Card({ title, accent, children, className = "", noPad = false }) {
  return (
    <div
      className={`rounded-2xl flex flex-col overflow-hidden transition-all ${className}`}
      style={{
        background: `linear-gradient(180deg, ${T.surface} 0%, ${T.surfaceLo || T.surface} 100%)`,
        border: `1px solid ${T.border}`,
        boxShadow: "0 16px 36px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      {title && (
        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{
            borderBottom: `1px solid ${T.border}`,
            borderLeft: accent ? `4px solid ${accent}` : "4px solid transparent",
            background: accent ? `linear-gradient(90deg, ${accent}22, rgba(255,255,255,0.015))` : T.surface,
            transition: "all 0.2s ease",
          }}
        >
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: accent || T.textSub, letterSpacing: "0.1em" }}>
            {title}
          </span>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: accent || T.border, boxShadow: accent ? `0 0 14px ${accent}` : undefined }} />
        </div>
      )}
      <div className={`flex-1 ${noPad ? "" : "p-5"}`}>{children}</div>
    </div>
  );
}

/** KPI metric tile */
function KpiTile({ label, value, unit, color, sub }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2 transition-all"
      style={{
        background: `linear-gradient(160deg, ${T.surfaceHi}, ${T.surface})`,
        border: `1px solid ${T.border}`,
        boxShadow: "0 14px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: T.textMute, letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tabular-nums" style={{ color: color || T.text }}>
          {value}
        </span>
        {unit && <span className="text-xs font-mono" style={{ color: T.textMute }}>
          {unit}
        </span>}
      </div>
      {sub && <div className="text-xs font-mono" style={{ color: T.textMute }}>
        {sub}
      </div>}
    </div>
  );
}

/** Pill badge for system modes and statuses */
function StatusPill({ label, color, pulse = false }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide uppercase transition-all"
      style={{
        color,
        background: color === T.green ? T.greenDim : color === T.yellow ? T.yellowDim : color === T.red ? T.redDim : T.blueDim,
        border: `1px solid ${color}40`,
        boxShadow: pulse ? `0 0 8px ${color}30` : undefined,
      }}
    >
      <span
        className="w-2 h-2 rounded-full inline-block"
        style={{
          background: color,
          animation: pulse ? "pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      {label}
    </span>
  );
}

/** Severity badge */
function SevBadge({ sev }) {
  const cfg = { CRITICAL: T.red, WARNING: T.yellow, INFO: T.blue, NORMAL: T.green };
  const c = cfg[sev] || T.textSub;
  const bgCfg = { CRITICAL: T.redDim, WARNING: T.yellowDim, INFO: T.blueDim, NORMAL: T.greenDim };
  const bg = bgCfg[sev] || T.surfaceHi;
  return (
    <span
      className="px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide uppercase"
      style={{ color: c, background: bg, border: `1px solid ${c}30` }}
    >
      {sev}
    </span>
  );
}

/** Command button - enterprise style */
function EmptyState({ title = "No data", detail = "Waiting for telemetry or operator action." }) {
  return (
    <div style={{
      padding: "22px 16px",
      borderRadius: 14,
      border: `1px dashed ${T.borderHi}`,
      background: "rgba(255,255,255,0.018)",
      textAlign: "center",
    }}>
      <div style={{ color: T.textSub, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</div>
      <div style={{ color: T.textMute, fontSize: 11, marginTop: 6 }}>{detail}</div>
    </div>
  );
}

function FieldTile({ label, value, color = T.textSub, sub }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 12, background: T.surfaceHi, border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 10, color: T.textMute, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 15, color, fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>{value}</div>
      {sub && <div style={{ color: T.textMute, fontSize: 10, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function ConnectionIndicator({ label, active, detail }) {
  const color = active ? T.green : T.red;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 10px",
      borderRadius: 999,
      border: `1px solid ${active ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.35)"}`,
      background: active ? T.greenDim : T.redDim,
      color,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: "0.06em",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, boxShadow: active ? `0 0 14px ${color}` : undefined }} />
      <span>{label}</span>
      {detail && <span style={{ color: T.textMute, fontWeight: 600, letterSpacing: 0 }}>{detail}</span>}
    </div>
  );
}

function CmdBtn({ label, icon, onClick, variant = "default", disabled = false, confirm = false, reason }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const styles = {
    danger:   { bg: "#1c0a0a", border: "#7f1d1d", text: "#fca5a5", hover: "#2d0f0f" },
    warning:  { bg: "#1c1200", border: "#92400e", text: "#fcd34d", hover: "#2a1a00" },
    success:  { bg: "#071c0e", border: "#15803d", text: "#86efac", hover: "#0a2914" },
    info:     { bg: "#080f1e", border: "#1d4ed8", text: "#93c5fd", hover: "#0c1730" },
    ghost:    { bg: "transparent", border: T.border, text: T.textSub, hover: T.surfaceHi },
    default:  { bg: T.surfaceHi, border: T.border, text: T.textSub, hover: "#1f2937" },
  };
  const s = styles[variant] || styles.default;

  // Await the handler so the button shows a real loading state while the
  // command round-trips through the safety gate -> Ditto -> bridge.
  const run = async () => {
    if (busy) return;
    try {
      setBusy(true);
      await onClick?.();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleClick = () => {
    if (confirm) {
      setConfirming(true);
      return;
    }
    void run();
  };

  const isDisabled = disabled || busy;

  return (
    <>
      <button
        disabled={isDisabled}
        onClick={handleClick}
        className="w-full flex items-center gap-2.5 rounded-lg text-left transition-all font-semibold"
        style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          color: s.text,
          padding: "10px 12px",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          letterSpacing: "0.05em",
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled ? 0.5 : 1,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
        onMouseEnter={e => {
          if (!isDisabled) {
            e.currentTarget.style.background = s.hover;
            e.currentTarget.style.borderColor = s.borderHover || s.border;
            e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.08)";
          }
        }}
        onMouseLeave={e => {
          if (!isDisabled) {
            e.currentTarget.style.background = s.bg;
            e.currentTarget.style.borderColor = s.border;
            e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
          }
        }}
      >
        {busy ? <Loader2 size={14} className="eos-spin" /> : (icon && <span style={{ fontSize: 13 }}>{icon}</span>)}
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>{busy ? "Working…" : label}</span>
          {isDisabled && reason && !busy && <span style={{ color: T.textMute, fontSize: 10, fontWeight: 500, letterSpacing: 0 }}>{reason}</span>}
        </span>
      </button>
      <ConfirmModal
        open={confirming}
        title={`Confirm command: ${label}`}
        detail={`This command writes a control state to Eclipse Ditto and may affect the live elevator twin. Confirm only when the current operating state is safe.`}
        confirmLabel={`Run ${label}`}
        danger={variant === "danger"}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run();
        }}
      />
    </>
  );
}

/** Semi-circular risk gauge */
function RiskGauge({ score, size = 130 }) {
  const col = riskColor(score);
  const pct = Math.min(1, Math.max(0, score / 100));
  const r   = size * 0.37;
  const arc = Math.PI * r;
  const cx = size / 2, cy = size * 0.58;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size * 0.67} viewBox={`0 0 ${size} ${size * 0.67}`}>
        {/* Track */}
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={T.surfaceHi} strokeWidth={size * 0.09} strokeLinecap="round" />
        {/* Fill */}
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={col} strokeWidth={size * 0.075} strokeLinecap="round"
          strokeDasharray={`${(pct * arc).toFixed(1)} ${arc}`} style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.4s ease" }} />
        {/* Score */}
        <text x={cx} y={cy - r * 0.22} textAnchor="middle" fill={col} fontSize={size * 0.19} fontWeight="700" fontFamily="'JetBrains Mono', monospace">{Math.round(score)}</text>
        <text x={cx} y={cy + 1} textAnchor="middle" fill={T.textMute} fontSize={size * 0.08} fontFamily="monospace">/ 100</text>
      </svg>
      <SevBadge sev={score >= 76 ? "CRITICAL" : score >= 41 ? "WARNING" : "NORMAL"} />
    </div>
  );
}

/** Live area chart */
function TelemetryChart({ data, color, yDomain, height = 72, unit = "" }) {
  const last = data[data.length - 1]?.v;
  const Tip = ({ active, payload }) =>
    active && payload?.length
      ? <div style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 11,
          color: T.text,
          fontFamily: "monospace",
          fontWeight: 600,
          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
        }}>
          {payload[0]?.value?.toFixed(4)}{unit}
        </div>
      : null;
  return (
    <div>
      <div className="flex justify-end mb-2">
        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color }}>
          {last?.toFixed(4)}{unit}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`grad${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
              <stop offset="95%" stopColor={color} stopOpacity={0}   />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis domain={yDomain} hide />
          <CartesianGrid strokeDasharray="3 4" stroke={T.border} opacity={0.25} />
          <Tooltip content={<Tip />} cursor={{ stroke: T.border, opacity: 0.3 }} />
          <Area
            type="natural"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad${color.replace("#", "")})`}
            dot={false}
            isAnimationActive={false}
            animationDuration={300}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Elevator shaft SVG */
function ElevatorShaft({ state, compact = false }) {
  const c    = state.features.cabin.properties;
  const door = state.features.door.properties;
  const fIdx = Math.max(0, Math.min(NUM_FLOORS - 1, c.current_floor));
  const SH   = NUM_FLOORS * FLOOR_H;
  const cabY = SH - (fIdx + 1) * FLOOR_H + 3;
  const open = door.state === "OPEN" || door.state === "OPENING";
  const isE  = c.emergency_stop;
  const lPct = Math.min(1, c.load_kg / MAX_LOAD);
  const lCol = lPct > 0.95 ? T.red : lPct > 0.7 ? T.yellow : T.green;
  const W    = compact ? 110 : 148;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={W + 52} height={SH + 12} viewBox={`0 0 ${W + 52} ${SH + 12}`}>
        {/* Floor markers */}
        {Array.from({ length: NUM_FLOORS }, (_, i) => {
          const y = SH - (i + 1) * FLOOR_H;
          return (
            <g key={i}>
              <line x1="38" y1={y + FLOOR_H} x2={W + 38} y2={y + FLOOR_H} stroke={T.border} strokeWidth="1" opacity="0.5" />
              <text x="30" y={y + FLOOR_H - 5} textAnchor="end" fill={T.textMute} fontSize="10" fontFamily="monospace" fontWeight="600">{FLOOR_LABELS[i]}</text>
              {c.target_floor === i && c.current_floor !== i && (
                <g>
                  <circle cx={W + 46} cy={y + FLOOR_H / 2} r="4" fill={T.blue} opacity="0.8">
                    <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.2s" repeatCount="indefinite" />
                  </circle>
                  <text x={W + 46} y={y + FLOOR_H / 2 + 3} textAnchor="middle" fill={T.blue} fontSize="6" fontFamily="monospace">DOWN</text>
                </g>
              )}
            </g>
          );
        })}
        {/* Shaft */}
        <rect x="38" y="0" width={W} height={SH} fill={T.surfaceHi} stroke={T.border} strokeWidth="1.5" rx="4" />
        {/* Guide rails */}
        <line x1="47" y1="0" x2="47" y2={SH} stroke={T.border} strokeWidth="1.5" opacity="0.5" />
        <line x1={W + 29} y1="0" x2={W + 29} y2={SH} stroke={T.border} strokeWidth="1.5" opacity="0.5" />
        {/* Cabin - animated */}
        <g style={{ transform: `translateY(${cabY}px)`, transition: "transform 0.9s cubic-bezier(0.4,0,0.2,1)" }}>
          {/* Cabin body */}
          <rect
            x="42"
            y="3"
            width={W - 8}
            height={FLOOR_H - 8}
            fill={isE ? T.redDim : T.blueDim}
            stroke={isE ? T.red : T.blue}
            strokeWidth="2"
            rx="4"
          />
          {/* Door panels */}
          {!open && (
            <>
              <rect x="42" y="3" width={(W - 8) / 2} height={FLOOR_H - 8} fill={isE ? "#200000" : "#0c2346"} rx="4" opacity="0.9" />
              <rect x={42 + (W - 8) / 2} y="3" width={(W - 8) / 2} height={FLOOR_H - 8} fill={isE ? "#200000" : "#0c2346"} rx="4" opacity="0.9" />
              <line x1={42 + (W - 8) / 2} y1="5" x2={42 + (W - 8) / 2} y2={FLOOR_H - 10} stroke={isE ? T.red : T.blue} strokeWidth="1.5" opacity="0.6" />
            </>
          )}
          {/* Load bar */}
          <rect x="46" y={FLOOR_H - 14} width={W - 16} height="5" fill={T.border} rx="2.5" />
          <rect x="46" y={FLOOR_H - 14} width={(W - 16) * lPct} height="5" fill={lCol} rx="2.5" style={{ transition: "width 0.5s ease, fill 0.4s" }} />
          {/* Floor number */}
          <text x={42 + (W - 8) / 2} y={FLOOR_H / 2 - 2} textAnchor="middle" fill={isE ? "#fca5a5" : "#60a5fa"} fontSize={compact ? 17 : 21} fontFamily="monospace" fontWeight="700">{FLOOR_LABELS[fIdx]}</text>
          {/* Load kg */}
          <text x={42 + (W - 8) / 2} y={FLOOR_H / 2 + 14} textAnchor="middle" fill={lCol} fontSize="9" fontFamily="monospace">{Math.round(c.load_kg)} kg</text>
          {/* E-stop overlay */}
          {isE && <text x={42 + (W - 8) / 2} y={FLOOR_H - 22} textAnchor="middle" fill={T.red} fontSize="8" fontFamily="monospace" fontWeight="700">E-STOP</text>}
        </g>
        {/* Speed readout */}
        <text x={W + 40} y="14" fill={T.textMute} fontSize="9" fontFamily="monospace">{c.speed_ms.toFixed(1)} m/s</text>
      </svg>

      {/* Direction badge */}
      <StatusPill
        label={c.direction === "UP" ? "UP / ASCENDING" : c.direction === "DOWN" ? "DOWN / DESCENDING" : "IDLE"}
        color={c.direction === "UP" ? T.green : c.direction === "DOWN" ? T.yellow : T.textMute}
      />
    </div>
  );
}

/** Health bar */
function HealthBar({ label, pct, color }) {
  return (
    <div>
      <div className="flex justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: T.textSub }}>
          {label}
        </span>
        <span className="text-xs font-bold font-mono" style={{ color }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 5, background: T.border }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: color,
            transition: "width 0.6s ease-out",
          }}
        />
      </div>
    </div>
  );
}

/** Cooling fan control card.
 * Displays the current fan state and exposes manual ON/OFF + AUTO buttons.
 * Reads the temperature thresholds from FAN_THERMAL so the UI tooltip stays
 * in sync with the cooling algorithm. */
function FanControlCard({ fan, motorTempC, cabinTempC, setFan }) {
  const state = String(fan?.state || "OFF").toUpperCase();
  const mode  = String(fan?.mode || "AUTO").toUpperCase();
  const accent = state === "ON" ? T.cyan : T.textMute;
  const overrideActive = motorTempC >= FAN_THERMAL.CRITICAL_MOTOR_C;
  const runtimeMin = Number(fan?.runtime_today_min) || 0;
  return (
    <Card title="Cooling Fan" accent={accent}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <FieldTile label="State" value={state} color={state === "ON" ? T.cyan : T.textSub} sub={fan?.reason || ""} />
          <FieldTile label="Mode"  value={mode}  color={mode === "AUTO" ? T.green : T.yellow} sub={overrideActive ? "SAFETY OVERRIDE" : (mode === "AUTO" ? "Algorithmic" : "Manual")} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <FieldTile label="Motor temp" value={`${Number(motorTempC).toFixed(1)} degC`} color={motorTempC >= FAN_THERMAL.CRITICAL_MOTOR_C ? T.red : motorTempC >= FAN_THERMAL.ON_MOTOR_C ? T.yellow : T.textSub}
            sub={`ON >= ${FAN_THERMAL.ON_MOTOR_C} / OFF <= ${FAN_THERMAL.OFF_MOTOR_C} degC`} />
          <FieldTile label="Runtime today" value={`${runtimeMin.toFixed(1)} min`} color={T.textSub} sub={`Cabin ${Number(cabinTempC).toFixed(1)} degC`} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <CmdBtn label="Fan ON"   icon="ON"   onClick={() => setFan({ state: "ON",  mode: "MANUAL" })} variant="info"    disabled={state === "ON"  && mode === "MANUAL"} />
          <CmdBtn label="Fan OFF"  icon="OFF"  onClick={() => setFan({ state: "OFF", mode: "MANUAL" })} variant="default" disabled={overrideActive || (state === "OFF" && mode === "MANUAL")} reason={overrideActive ? "Safety override locked ON" : undefined} />
          <CmdBtn label="AUTO"     icon="A"    onClick={() => setFan({ state, mode: "AUTO"   })} variant="success" disabled={mode === "AUTO"} />
        </div>
      </div>
    </Card>
  );
}

/** Toast notification stack */
function ToastStack({ toasts, dismiss }) {
  if (!toasts.length) return null;
  const sevConfig = {
    CRITICAL: { bg: T.redDim, border: T.red, text: T.red, icon: "LOCK" },
    WARNING:  { bg: T.yellowDim, border: T.yellow, text: T.yellow, icon: "⚡" },
    INFO:     { bg: T.blueDim, border: T.blue, text: T.blue, icon: "◎" },
  };
  Object.assign(sevConfig, {
    CRITICAL: { ...sevConfig.CRITICAL, icon: "!" },
    WARNING: { ...sevConfig.WARNING, icon: "WARN" },
    INFO: { ...sevConfig.INFO, icon: "INFO" },
  });
  return (
    <div style={{
      position: "fixed",
      top: 70,
      right: 20,
      zIndex: 1000,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      minWidth: 320,
      maxWidth: 400,
      pointerEvents: "none",
    }}>
      {toasts.map(t => {
        const cfg = sevConfig[t.severity] || sevConfig.INFO;
        return (
          <div
            key={t.id}
            style={{
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              borderRadius: 8,
              padding: "12px 14px",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              pointerEvents: "auto",
              animation: "slideIn 0.3s ease-out",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)",
            }}
          >
            <span style={{ color: cfg.border, fontSize: 14, flexShrink: 0, marginTop: 1 }}>
              {cfg.icon}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cfg.border, letterSpacing: "0.08em", marginBottom: 2 }}>
                {t.severity}
              </div>
              <div style={{ fontSize: 13, color: T.text, lineHeight: 1.4 }}>
                {t.message}
              </div>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              style={{
                color: T.textMute,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                flexShrink: 0,
                transition: "color 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = cfg.border)}
              onMouseLeave={e => (e.currentTarget.style.color = T.textMute)}
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Global lockdown / alert banner */
function GlobalAlertBanner({ state }) {
  const { system_mode } = state.attributes;
  const { alert_level } = state.features.security.properties;
  const active = system_mode === "LOCKDOWN" || alert_level === "CRITICAL";
  if (!active) return null;
  return (
    <div
      style={{
        background: T.redDim,
        borderBottom: `2px solid ${T.red}`,
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        animation: "criticalPulse 1s ease-in-out infinite alternate",
      }}
    >
      <span style={{ color: T.red, fontSize: 13, fontWeight: 900 }}>ALERT</span>
      <span
        style={{
          color: T.red,
          fontSize: 11,
          fontFamily: "monospace",
          fontWeight: 700,
          letterSpacing: "0.15em",
        }}
      >
        SYSTEM ALERT - {system_mode === "LOCKDOWN" ? "FULL LOCKDOWN ACTIVE" : `SECURITY LEVEL: ${alert_level}`}
      </span>
      <span style={{ color: T.red, fontSize: 13, fontWeight: 900 }}>ALERT</span>
    </div>
  );
}

// SIDEBAR
function Sidebar({ page, setPage, state, connected }) {
  const { system_mode } = state.attributes;
  const modeDot = system_mode === "NORMAL" ? T.green : system_mode === "MAINTENANCE" ? T.yellow : T.red;

  return (
    <div style={{
      width: 84,
      background: `linear-gradient(180deg, ${T.surfaceLo || T.surface}, ${T.surface})`,
      borderRight: `1px solid ${T.border}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      flexShrink: 0,
      boxShadow: "1px 0 2px rgba(0,0,0,0.04)",
    }}>
      {/* Logo */}
      <div style={{
        padding: "14px 0",
        borderBottom: `1px solid ${T.border}`,
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}>
        <div style={{
          width: 42,
          height: 42,
          background: `linear-gradient(135deg, ${T.blueDim}, ${T.cyanDim || T.blueDim})`,
          border: `1px solid ${T.borderHi}`,
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 0,
          color: T.cyan,
          fontWeight: 900,
          transition: "all 0.2s",
        }}>
          <span style={{ fontSize: 12 }}>EOS</span>
          ⬡
        </div>
      </div>
      {/* Live indicator */}
      <div style={{
        padding: "10px 0",
        borderBottom: `1px solid ${T.border}`,
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: connected ? T.green : T.red,
            animation: connected ? "pulse 2s infinite" : "none",
          }}
          title={connected ? "Live" : "Offline"}
        />
      </div>
      {/* Nav */}
      {PAGES.map(p => (
        <button
          key={p.id}
          onClick={() => setPage(p.id)}
          title={p.label}
          style={{
            width: "100%",
            padding: "12px 0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            background: page === p.id ? T.surfaceHi : "transparent",
            border: "none",
            borderLeft: page === p.id ? `3px solid ${T.blue}` : "3px solid transparent",
            fontSize: 11,
            color: page === p.id ? T.blue : T.textMute,
            transition: "all 0.2s",
          }}
        >
          <span style={{ fontWeight: 900 }}>{p.icon}</span>
          <span style={{ fontSize: 9, letterSpacing: "0.08em" }}>{p.short}</span>
        </button>
      ))}
      {/* Mode dot */}
      <div style={{
        marginTop: "auto",
        padding: "12px 0",
        borderTop: `1px solid ${T.border}`,
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: modeDot,
          }}
          title={system_mode}
        />
      </div>
    </div>
  );
}

// TOPBAR
function Topbar({ page, state, connected, dittoConnected, dittoMode, isSimulationMode }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    // Set initial time on client to prevent hydration mismatch
    setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    const iv = setInterval(() => setClock(new Date().toLocaleTimeString("en-GB", { hour12: false })), 1000);
    return () => clearInterval(iv);
  }, []);

  const { location, thing_id, system_mode } = state.attributes;
  const cabin = state.features.cabin.properties;
  const incidents = state.features.incident_log.properties;
  const pi = PAGES.find(p => p.id === page);
  const modeColor = system_mode === "NORMAL" ? T.green : system_mode === "MAINTENANCE" ? T.yellow : T.red;
  const sourceLabel = dittoConnected ? `DITTO/${String(dittoMode || "polling").toUpperCase()}` : isSimulationMode ? "SIMULATION" : "OFFLINE";

  return (
    <div style={{
      background: `linear-gradient(90deg, ${T.surfaceLo || T.surface}, ${T.surface})`,
      borderBottom: `1px solid ${T.border}`,
      padding: "12px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 72,
      flexShrink: 0,
      boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
      gap: 16,
      flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 260 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: T.cyan, fontSize: 11, fontWeight: 900, border: `1px solid ${T.borderHi}`, borderRadius: 8, padding: "4px 6px", background: T.cyanDim || T.blueDim }}>
            {pi?.icon}
          </span>
          <span style={{ color: T.text, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em" }}>
            {pi?.label}
          </span>
          <StatusPill label={system_mode} color={modeColor} pulse={system_mode === "LOCKDOWN"} />
        </div>
        <div style={{ color: T.textMute, fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>
          {location} / {thing_id}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <ConnectionIndicator label="DITTO" active={dittoConnected} detail={dittoMode || ""} />
        <StatusPill label={sourceLabel} color={connected ? T.cyan : isSimulationMode ? T.yellow : T.red} pulse={connected} />
        <div style={{ display: "flex", gap: 8 }}>
          <FieldTile label="Risk" value={Math.round(state.attributes.risk_score)} color={riskColor(state.attributes.risk_score)} />
          <FieldTile label="Alerts" value={incidents.open_incidents || 0} color={(incidents.open_incidents || 0) > 0 ? T.red : T.green} />
          <FieldTile label="Floor" value={`${FLOOR_LABELS[cabin.current_floor]} > ${FLOOR_LABELS[cabin.target_floor]}`} color={T.blue} />
        </div>
        <div style={{
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontWeight: 600,
          color: T.textSub,
          minWidth: 60,
          textAlign: "right",
        }}>
          {clock}
        </div>
      </div>
    </div>
  );
}

// Page: Command center
function PageCommand() {
  const { state, vibH, tmpH, cmdLog, toasts, emergencyStop, lockdown, maintenance, reset, resolveIncident, sendFloor, optimizeRouting, reduceEnergy, setFan, dismissToast } = useTwin();
  const c   = state.features.cabin.properties;
  const m   = state.features.motor.properties;
  const sec = state.features.security.properties;
  const inc = state.features.incident_log.properties;
  const en  = state.features.energy.properties;
  const attr= state.attributes;

  const hCol = m.health_status === "GOOD" ? T.green : m.health_status === "WARNING" ? T.yellow : T.red;
  const movementBlocked = attr.system_mode === "LOCKDOWN" || c.emergency_stop;
  const movementReason = attr.system_mode === "LOCKDOWN"
    ? "Blocked: lockdown active"
    : c.emergency_stop
      ? "Blocked: emergency stop active"
      : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <KpiTile label="Current Floor"  value={FLOOR_LABELS[c.current_floor]}        color={T.blue}                                        sub={`→ Floor ${FLOOR_LABELS[c.target_floor]}`} />
        <KpiTile label="Speed"          value={c.speed_ms.toFixed(1)}   unit="m/s"  color={T.cyan} />
        <KpiTile label="Cabin Load"     value={Math.round(c.load_kg)}   unit="kg"   color={c.load_kg > 760 ? T.red : c.load_kg > 640 ? T.yellow : T.green} sub={`${Math.round(c.load_kg / MAX_LOAD * 100)}% capacity`} />
        <KpiTile label="AI Risk Score"  value={Math.round(attr.risk_score)}          color={riskColor(attr.risk_score)} />
        <KpiTile label="Motor Temp"     value={m.temperature_c.toFixed(1)} unit="degC" color={m.temperature_c > 85 ? T.red : m.temperature_c > 70 ? T.yellow : T.textSub} />
        <KpiTile label="Vibration"      value={m.vibration_level.toFixed(3)} unit="g" color={m.vibration_level > 0.25 ? T.red : m.vibration_level > 0.12 ? T.yellow : T.green} />
        <KpiTile label="System Health"  value={Math.round(attr.system_health_index)} unit="%" color={healthColor(attr.system_health_index)} />
      </div>

      {/* Main 3-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {/* Col A: Telemetry + Risk */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card title="Motor Vibration - Live Stream" accent={T.red}>
            <TelemetryChart data={vibH} color={T.red} yDomain={[0, 0.5]} unit="g" />
          </Card>
          <Card title="Motor Temperature - Live Stream" accent={T.yellow}>
            <TelemetryChart data={tmpH} color={T.yellow} yDomain={[20, 100]} unit="degC" />
          </Card>
          <Card title="AI Risk Score" accent={riskColor(attr.risk_score)}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <RiskGauge score={attr.risk_score} size={110} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {[["Motor Health", m.health_status, hCol], ["Hours Operated", `${Math.round(m.hours_operated)} h`, m.hours_operated > 8000 ? T.red : T.textSub], ["Power Draw", `${m.power_kw.toFixed(1)} kW`, T.cyan], ["Current", `${m.current_draw_a.toFixed(1)} A`, T.textSub]].map(([l, v, col]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace" }}>
                    <span style={{ color: T.textMute }}>{l}</span>
                    <span style={{ color: col, fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Col B: Incidents + Security + Floor + Energy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card title={`Incident Log${inc.open_incidents > 0 ? ` - ${inc.open_incidents} open` : ""}`} accent={inc.open_incidents > 0 ? T.red : T.border}>
            <div style={{ maxHeight: 140, overflowY: "auto" }}>
              {inc.entries.length === 0
                ? <EmptyState title="No incidents" detail="The digital twin has no active incident records." />
                : inc.entries.slice(0, 10).map((e, i) => {
                    const isCrit = e.type.includes("ENTRY") || e.type.includes("DISTRESS") || e.type.includes("STOP") || e.type.includes("FIRE");
                    const incidentId = incidentIdentifier(e, i);
                    return (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>
                        <span style={{ color: T.textMute, flexShrink: 0, fontFamily: "monospace" }}>{fmtTime(e.ts)}</span>
                        <span style={{ color: isCrit ? T.red : T.yellow, fontWeight: 700, flexShrink: 0, fontFamily: "monospace" }}>{e.type}</span>
                        <span style={{ color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</span>
                        {!e.resolved && (
                          <button type="button" onClick={() => resolveIncident(incidentId)} style={{ border: `1px solid ${T.green}55`, background: T.greenDim, color: T.green, borderRadius: 8, padding: "2px 6px", fontSize: 10, fontWeight: 800 }}>
                            Resolve
                          </button>
                        )}
                        <span style={{ color: T.textMute, flexShrink: 0, fontSize: 10, marginLeft: "auto" }}>{relTime(e.ts)}</span>
                      </div>
                    );
                  })}
            </div>
          </Card>

          <Card title="Security Status" accent={sec.alert_level !== "NORMAL" ? T.red : T.green}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["Alert Level", sec.alert_level, sec.alert_level !== "NORMAL" ? T.red : T.green],
                ["RFID Access", sec.rfid_access_granted ? "GRANTED" : "DENIED", sec.rfid_access_granted ? T.green : T.red],
                ["Distress Signal", sec.audio_distress_active ? "ACTIVE" : "CLEAR", sec.audio_distress_active ? T.red : T.green],
                ["Unauth Attempts", `${sec.unauthorized_access_attempts}x`, sec.unauthorized_access_attempts > 0 ? T.yellow : T.textMute],
              ].map(([l, v, col]) => (
                <div key={l} style={{ fontSize: 11 }}>
                  <div style={{ color: T.textMute, marginBottom: 2, fontSize: 10 }}>{l}</div>
                  <div style={{ color: col, fontWeight: 700, fontFamily: "monospace" }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Floor Control" accent={T.blue}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
              {Array.from({ length: NUM_FLOORS }, (_, i) => (
                <button key={i} onClick={() => sendFloor(i)} disabled={movementBlocked} title={movementReason || `Dispatch to floor ${FLOOR_LABELS[i]}`} style={{
                  padding: "8px 0", borderRadius: 8, fontFamily: "monospace", fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all 0.15s",
                  background: c.current_floor === i ? "#0d1f3c" : T.surfaceHi,
                  border: `1px solid ${c.current_floor === i ? T.blue : c.target_floor === i ? T.textMute : T.border}`,
                  color: c.current_floor === i ? T.blue : c.target_floor === i ? T.cyan : T.textMute,
                  opacity: movementBlocked ? 0.45 : 1,
                }}>
                  {FLOOR_LABELS[i]}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Energy Overview" accent={T.cyan}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[["Today", `${en.kwh_today.toFixed(2)} kWh`, T.cyan], ["Month", `${en.kwh_month} kWh`, T.textSub], ["Baseline", `${en.kwh_baseline} kWh`, T.textMute], ["Regen", `${en.regen_kwh} kWh`, T.green]].map(([l, v, col]) => (
                <div key={l} style={{ fontSize: 11 }}>
                  <div style={{ color: T.textMute, fontSize: 10, marginBottom: 1 }}>{l}</div>
                  <div style={{ color: col, fontWeight: 700, fontFamily: "monospace" }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Col C: Command Console */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card title="System Commands" accent={T.red}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <CmdBtn label="Emergency Stop"   icon="STOP" onClick={emergencyStop}  variant="danger"  confirm disabled={c.emergency_stop} reason="Already active" />
              <CmdBtn label="Lockdown"          icon="LOCK" onClick={lockdown}       variant="danger"  confirm disabled={attr.system_mode === "LOCKDOWN"} reason="Already locked" />
              <CmdBtn label="Maintenance Mode" icon="MX" onClick={maintenance}    variant="warning" confirm disabled={attr.system_mode === "MAINTENANCE"} reason="Already in maintenance" />
              <CmdBtn label="Reset / Clear Problems"  icon="RST" onClick={reset}          variant="success" confirm />
            </div>
          </Card>

          <Card title="Smart Automation" accent={T.green}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <CmdBtn label="Optimize Routing" icon="◎" onClick={optimizeRouting} variant="info" />
              <CmdBtn label="Reduce Energy"    icon="~" onClick={reduceEnergy}    variant="info" />
            </div>
          </Card>

          <FanControlCard fan={state.features.fan.properties} motorTempC={m.temperature_c} cabinTempC={c.temperature_c} setFan={setFan} />

          <Card title="Command History" accent={T.border}>
            <div style={{ maxHeight: 160, overflowY: "auto" }}>
              {cmdLog.length === 0
                ? <EmptyState title="No commands" detail="Operator command audit entries will appear here." />
                : cmdLog.slice(0, 12).map(l => (
                    <div key={l.id} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "monospace" }}>
                      <span style={{ color: T.textMute, flexShrink: 0 }}>{fmtTime(l.ts)}</span>
                      <span style={{ color: l.result === "EXECUTED" || l.result === "OK" ? T.green : l.result === "INJECTED" ? T.yellow : T.textSub, fontWeight: 700 }}>{l.cmd}</span>
                    </div>
                  ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Page: Digital twin
function PageTwin() {
  const { state, stateDiff, sendFloor, dittoConnected, dittoMode, connected, isSimulationMode, timeline, speedH, speedEstH, computedSpeedMs, lastTripSpeedMs, riskH } = useTwin();
  const fan = state.features.fan.properties;
  const c   = state.features.cabin.properties;
  const door= state.features.door.properties;
  const m   = state.features.motor.properties;
  const sec = state.features.security.properties;
  const pf  = state.features.predicted_failures.properties;
  const attr= state.attributes;
  const inc = state.features.incident_log.properties;
  const lastSample = timeline[timeline.length - 1];
  const loadPct = Math.round((c.load_kg / MAX_LOAD) * 100);
  const sourceLabel = isSimulationMode ? "SIMULATION" : dittoConnected ? `DITTO ${String(dittoMode || "sse").toUpperCase()}` : "OFFLINE";
  const sourceColor = isSimulationMode ? T.yellow : connected ? T.cyan : T.red;
  const modeColor = attr.system_mode === "NORMAL" ? T.green : attr.system_mode === "MAINTENANCE" ? T.yellow : T.red;
  const warnings = [
    c.emergency_stop && "Emergency stop active",
    door.door_forced_entry && "Forced entry detected",
    c.load_kg > MAX_LOAD && "Overload",
    attr.system_mode === "LOCKDOWN" && "Lockdown active",
    sec.audio_distress_active && "Audio distress active",
  ].filter(Boolean);
  const movementBlocked = attr.system_mode === "LOCKDOWN" || c.emergency_stop;

  return (
    <div className="eos-page-stack">
      <Card title="Digital Twin Operational Picture" accent={warnings.length > 0 ? T.red : T.cyan}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ElevatorShaft state={state} compact />
          </div>
          <div className="eos-status-list">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill label={sourceLabel} color={sourceColor} pulse={connected || isSimulationMode} />
              <StatusPill label={attr.system_mode} color={modeColor} pulse={attr.system_mode === "LOCKDOWN"} />
              <ConnectionIndicator label="DITTO" active={dittoConnected} detail={dittoMode || "sse"} />
            </div>
            <div className="eos-kpi-grid">
              <KpiTile label="Current Floor" value={FLOOR_LABELS[c.current_floor]} color={T.blue} sub={`Target ${FLOOR_LABELS[c.target_floor]}`} />
              <KpiTile label="Direction" value={c.direction} color={c.direction === "UP" ? T.green : c.direction === "DOWN" ? T.yellow : T.textSub} />
              <KpiTile label="Speed" value={computedSpeedMs.toFixed(2)} unit="m/s" color={T.cyan} sub={`telemetry ${c.speed_ms.toFixed(2)} m/s`} />
              <KpiTile label="Load" value={loadPct} unit="%" color={loadPct > 95 ? T.red : loadPct > 80 ? T.yellow : T.green} sub={`${Math.round(c.load_kg)} kg`} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {warnings.length === 0
                ? <StatusPill label="Safety envelope clear" color={T.green} />
                : warnings.map((warning) => <StatusPill key={warning} label={warning} color={T.red} pulse />)}
            </div>
          </div>
          <div className="eos-status-list">
            <RiskGauge score={attr.risk_score} size={118} />
            <FieldTile label="Health index" value={`${Math.round(attr.system_health_index)}%`} color={healthColor(attr.system_health_index)} />
            <FieldTile label="Last update" value={lastSample ? relTime(lastSample.ts) : "Waiting"} color={lastSample ? T.cyan : T.textMute} sub={lastSample?.source || "No live sample"} />
          </div>
        </div>
      </Card>

      <div className="eos-responsive-grid three">
        <Card title="Cabin & Door State" accent={door.state === "BLOCKED" || c.emergency_stop ? T.red : T.blue}>
          <div className="eos-status-list">
            <div className="eos-kpi-grid">
              <FieldTile label="Door state" value={door.state} color={door.state === "BLOCKED" ? T.red : door.state === "OPEN" ? T.green : T.textSub} />
              <FieldTile label="Emergency stop" value={c.emergency_stop ? "ACTIVE" : "CLEAR"} color={c.emergency_stop ? T.red : T.green} />
              <FieldTile label="Cabin temp" value={`${c.temperature_c.toFixed(1)} degC`} color={c.temperature_c > 45 ? T.yellow : T.textSub} />
              <FieldTile label="Forced entry" value={door.door_forced_entry ? "DETECTED" : "CLEAR"} color={door.door_forced_entry ? T.red : T.green} />
              <FieldTile label={`Cooling fan (${fan.mode})`} value={fan.state} color={fan.state === "ON" ? T.cyan : T.textSub} sub={fan.reason || ""} />
            </div>
            <div className="eos-floor-grid">
              {Array.from({ length: NUM_FLOORS }, (_, i) => (
                <button key={i} type="button" onClick={() => sendFloor(i)} disabled={movementBlocked} className={c.current_floor === i ? "is-active" : c.target_floor === i ? "is-target" : ""} title={movementBlocked ? "Movement blocked by active safety state" : `Dispatch to floor ${FLOOR_LABELS[i]}`}>
                  {FLOOR_LABELS[i]}
                </button>
              ))}
            </div>
            {movementBlocked && <div className="eos-warning-strip">Movement commands are disabled until emergency or lockdown state is cleared.</div>}
          </div>
        </Card>

        <Card title="Motor Telemetry" accent={m.health_status === "GOOD" ? T.green : m.health_status === "WARNING" ? T.yellow : T.red}>
          <div className="eos-status-list">
            <div className="eos-kpi-grid">
              <FieldTile label="Motor temp" value={`${m.temperature_c.toFixed(1)} degC`} color={m.temperature_c > 85 ? T.red : m.temperature_c > 70 ? T.yellow : T.textSub} />
              <FieldTile label="Vibration" value={`${m.vibration_level.toFixed(4)} g`} color={m.vibration_level > 0.25 ? T.red : m.vibration_level > 0.12 ? T.yellow : T.green} />
              <FieldTile label="Health" value={m.health_status} color={m.health_status === "GOOD" ? T.green : m.health_status === "WARNING" ? T.yellow : T.red} />
              <FieldTile label="Hours" value={`${Math.round(m.hours_operated)} h`} color={m.hours_operated > 8000 ? T.red : T.textSub} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 10, color: T.textMute, fontFamily: "monospace" }}>
              <span>Cabin speed — deterministic (3.0 m/floor)</span>
              <span>last trip avg {lastTripSpeedMs.toFixed(2)} m/s</span>
            </div>
            <TelemetryChart data={speedEstH} color={T.cyan} yDomain={[0, 4]} height={88} unit=" m/s" />
          </div>
        </Card>

        <Card title="Risk, Incidents & Health" accent={riskColor(attr.risk_score)}>
          <div className="eos-status-list">
            <TelemetryChart data={riskH} color={riskColor(attr.risk_score)} yDomain={[0, 100]} height={88} unit="" />
            <HealthBar label="System Health Index" pct={attr.system_health_index} color={healthColor(attr.system_health_index)} />
            <HealthBar label="Bearing Health" pct={pf.bearing_health_pct} color={healthColor(pf.bearing_health_pct)} />
            <FieldTile label="Open incidents" value={inc.open_incidents || 0} color={(inc.open_incidents || 0) > 0 ? T.red : T.green} />
          </div>
        </Card>
      </div>

      <div className="eos-responsive-grid three">
        <Card title="Security State" accent={sec.alert_level !== "NORMAL" || attr.system_mode === "LOCKDOWN" ? T.red : T.green}>
          <div className="eos-status-list">
            {[["Alert level", sec.alert_level, sec.alert_level !== "NORMAL" ? T.red : T.green], ["RFID card", sec.rfid_last_card, T.textSub], ["Access", sec.rfid_access_granted ? "GRANTED" : "DENIED", sec.rfid_access_granted ? T.green : T.red], ["Unauthorized attempts", sec.unauthorized_access_attempts, sec.unauthorized_access_attempts > 0 ? T.yellow : T.green], ["Audio distress", sec.audio_distress_active ? "ACTIVE" : "CLEAR", sec.audio_distress_active ? T.red : T.green]].map(([label, value, color]) => <FieldTile key={label} label={label} value={value} color={color} />)}
          </div>
        </Card>

        <Card title="State Delta - Last Tick" accent={T.purple}>
          <div className="eos-status-list">
            {Object.entries(stateDiff).map(([key, value]) => {
              const changed = key === "floor" ? value : parseFloat(value) !== 0;
              return <FieldTile key={key} label={key} value={key === "floor" ? (value ? "CHANGED" : "STABLE") : value > 0 ? `+${value}` : value} color={changed ? T.purple : T.textMute} />;
            })}
          </div>
        </Card>

        <Card title="Twin Metadata" accent={T.borderHi}>
          <div className="eos-status-list">
            <FieldTile label="Thing ID" value={attr.thing_id} color={T.textSub} />
            <FieldTile label="Location" value={attr.location} color={T.textSub} />
            <FieldTile label="Maintenance priority" value={attr.maintenance_priority || "LOW"} color={attr.maintenance_priority === "HIGH" ? T.red : attr.maintenance_priority === "MEDIUM" ? T.yellow : T.green} />
            <FieldTile label="Next service" value={pf.next_service_date || "Waiting for n8n data"} color={pf.next_service_date ? T.textSub : T.textMute} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// Page: AI analytics
function PageAIInsights() {
  const { state, vibH, tmpH, ldH, riskH, timeline } = useTwin();
  const m  = state.features.motor.properties;
  const pf = state.features.predicted_failures.properties;
  const sec= state.features.security.properties;
  const attr= state.attributes;
  const analysis = getAiAnalysis(state);
  const severity = String(analysis?.severity || analysis?.level || getSeverityFromRisk(attr.risk_score)).toUpperCase();
  const confidence = Number(analysis?.confidence ?? analysis?.confidence_score ?? 0);
  const confidencePct = confidence > 1 ? Math.round(confidence) : Math.round(confidence * 100);
  const reasoning = getAnalysisText(analysis, ["reasoning", "analysis", "explanation", "summary"]);
  const recommendation = getAnalysisText(analysis, ["recommended_action", "recommendation", "action", "next_action"]);
  const predictedAvailable = hasFeatureDataBeyondSeed(state, "predicted_failures", ["motor_rul_hours", "bearing_health_pct", "door_mechanism_pct", "rope_tension_pct", "next_service_date"]);
  const workOrder = state.features.maintenance_schedule?.properties;
  const humanReviewRequired = Boolean(analysis?.human_review_required || analysis?.requires_human_review || attr.risk_score >= 85);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="AI Decision State" accent={riskColor(attr.risk_score)}>
        <div className="eos-responsive-grid three">
          <div className="eos-status-list">
            <RiskGauge score={attr.risk_score} size={110} />
            <FieldTile label="Severity" value={severity} color={severity === "CRITICAL" ? T.red : severity === "WARNING" ? T.yellow : T.green} />
            <FieldTile label="Maintenance priority" value={attr.maintenance_priority || "LOW"} color={attr.maintenance_priority === "HIGH" ? T.red : attr.maintenance_priority === "MEDIUM" ? T.yellow : T.green} />
            <FieldTile label="Human review" value={humanReviewRequired ? "REQUIRED" : "NOT REQUIRED"} color={humanReviewRequired ? T.red : T.green} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            {analysis
              ? <div className="eos-status-list">
                  <FieldTile label="AI reasoning" value={reasoning || "No reasoning text provided"} color={reasoning ? T.textSub : T.textMute} />
                  <FieldTile label="Recommended action" value={recommendation || "Continue deterministic monitoring"} color={recommendation ? T.cyan : T.textMute} />
                  <FieldTile label="Confidence" value={confidence > 0 ? `${confidencePct}%` : "Not provided"} color={confidence > 0 ? T.purple : T.textMute} />
                </div>
              : <EmptyState title="AI analysis will appear after n8n workflows are activated." detail="The dashboard is reading Ditto state; no live ai_analysis payload has been written yet." />}
          </div>
        </div>
      </Card>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Card title="Motor Vibration - 60-tick Trend" accent={T.red}>
          <TelemetryChart data={vibH} color={T.red} yDomain={[0, 0.5]} height={100} unit="g" />
        </Card>
        <Card title="Motor Temperature - Trend" accent={T.yellow}>
          <TelemetryChart data={tmpH} color={T.yellow} yDomain={[20, 100]} height={100} unit="degC" />
        </Card>
        <Card title="Cabin Load - Trend" accent={T.green}>
          <TelemetryChart data={ldH} color={T.green} yDomain={[0, MAX_LOAD]} height={100} unit=" kg" />
        </Card>
      </div>

      {/* Risk + RUL + Energy row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Card title="Risk Score Breakdown" accent={riskColor(attr.risk_score)}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <RiskGauge score={attr.risk_score} size={95} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
              {[["Vibration deviation", m.vibration_level > 0.1 ? "HIGH" : "OK", m.vibration_level > 0.1 ? T.red : T.green], ["Motor thermal", m.temperature_c > 70 ? "WARM" : "OK", m.temperature_c > 70 ? T.yellow : T.green], ["Service interval", m.hours_operated > 1800 ? "OVERDUE" : "OK", m.hours_operated > 1800 ? T.yellow : T.green], ["Security events", sec.unauthorized_access_attempts > 0 ? "DETECTED" : "CLEAR", sec.unauthorized_access_attempts > 0 ? T.yellow : T.green]].map(([l, v, col]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace" }}>
                  <span style={{ color: T.textMute }}>{l}</span>
                  <span style={{ color: col, fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Predicted Failures" accent={predictedAvailable ? T.purple : T.borderHi}>
          {predictedAvailable
            ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[["Motor RUL", pf.motor_rul_hours, "h", Math.min(100, (pf.motor_rul_hours / MOTOR_LIFE_H) * 100)], ["Bearing Health", pf.bearing_health_pct, "%", pf.bearing_health_pct], ["Door Mechanism", pf.door_mechanism_pct, "%", pf.door_mechanism_pct], ["Rope Tension", pf.rope_tension_pct, "%", pf.rope_tension_pct]].map(([l, v, u, p]) => (
                  <div key={l}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 10 }}>
                      <span style={{ color: T.textMute }}>{l}</span>
                      <span style={{ color: healthColor(p), fontWeight: 700, fontFamily: "monospace" }}>{v}{u}</span>
                    </div>
                    <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: 5, width: `${Math.min(100, p)}%`, background: healthColor(p), transition: "width 0.6s" }} />
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontFamily: "monospace" }}>
                  Next service: <span style={{ color: T.purple }}>{pf.next_service_date || "not scheduled"}</span>
                </div>
              </div>
            : <EmptyState title="Waiting for n8n data" detail="Predicted failure metrics will appear after the maintenance workflow writes to Ditto." />}
        </Card>

        <Card title="Maintenance Work Order" accent={workOrder?.work_order_id ? T.yellow : T.borderHi}>
          {workOrder?.work_order_id
            ? <div className="eos-status-list">
                <FieldTile label="Work order" value={workOrder.work_order_id} color={T.yellow} />
                <FieldTile label="Priority" value={workOrder.priority || "Not provided"} color={workOrder.priority === "CRITICAL" ? T.red : workOrder.priority === "HIGH" ? T.yellow : T.textSub} />
                <FieldTile label="Next service" value={workOrder.next_service_date || "Not scheduled"} color={T.textSub} />
              </div>
            : <EmptyState title="Waiting for n8n data" detail="Maintenance schedule and work orders will appear after workflow 04 is active." />}
        </Card>
      </div>

      {/* Timeline playback */}
      <Card title="Timeline Playback - Time-Travel Debugger" accent={T.border}>
        <div style={{ maxHeight: 120, overflowY: "auto" }}>
          <table style={{ width: "100%", fontSize: 10, fontFamily: "monospace", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Tick", "Timestamp", "Floor", "Risk", "Vibration", "Temp degC"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "3px 8px", color: T.textMute, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {timeline.slice(-20).reverse().map((row, i) => (
                <tr key={row.tick} style={{ background: i === 0 ? T.surfaceHi : "transparent" }}>
                  {[row.tick, fmtTime(row.ts), FLOOR_LABELS[row.floor], row.risk, row.vib.toFixed(4), row.temp].map((v, j) => (
                    <td key={j} style={{ padding: "3px 8px", color: j === 3 ? riskColor(parseFloat(row.risk)) : T.textSub, borderBottom: `1px solid ${T.border}` }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Page: Security operations
function PageSOC() {
  const { state, injectForcedEntry, injectAudioDistress, injectInvalidRFID, lockdown, reset, resolveIncident, isSimulationMode } = useTwin();
  const sec  = state.features.security.properties;
  const inc  = state.features.incident_log.properties;
  const door = state.features.door.properties;
  const attr = state.attributes;

  const [incidentFilter, setIncidentFilter] = useState("all");
  const [incidentSearch, setIncidentSearch] = useState("");

  const threatLevel = attr.system_mode === "LOCKDOWN" ? "CRITICAL" : sec.alert_level === "CRITICAL" ? "HIGH" : sec.alert_level === "HIGH" ? "ELEVATED" : "NORMAL";
  const threatConfig = { CRITICAL: T.red, HIGH: T.red, ELEVATED: T.yellow, NORMAL: T.green };
  const threatColor = threatConfig[threatLevel];
  const filteredIncidents = inc.entries.map((entry, index) => ({ ...entry, __incidentIndex: index })).filter((entry) => {
    const text = `${entry.type || ""} ${entry.description || ""}`.toLowerCase();
    const matchesSearch = !incidentSearch || text.includes(incidentSearch.toLowerCase());
    const unresolved = !entry.resolved;
    const type = String(entry.type || "").toUpperCase();
    const matchesFilter =
      incidentFilter === "all" ||
      (incidentFilter === "critical" && (type.includes("ENTRY") || type.includes("DISTRESS") || type.includes("FIRE") || type.includes("STOP"))) ||
      (incidentFilter === "warning" && !type.includes("ENTRY") && !type.includes("DISTRESS")) ||
      (incidentFilter === "security" && (type.includes("RFID") || type.includes("ENTRY") || type.includes("DISTRESS"))) ||
      (incidentFilter === "maintenance" && (type.includes("MOTOR") || type.includes("VIBRATION") || type.includes("MAINTENANCE"))) ||
      (incidentFilter === "unresolved" && unresolved);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="eos-page-stack">
      {/* Threat banner */}
      <div style={{ padding: "10px 16px", borderRadius: 10, background: threatColor + "10", border: `1px solid ${threatColor}40`, display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        {["NORMAL", "ELEVATED", "HIGH", "CRITICAL"].map(l => {
          const active = l === threatLevel;
          const col = { NORMAL: T.green, ELEVATED: T.yellow, HIGH: "#f97316", CRITICAL: T.red }[l];
          return (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 11, height: 11, borderRadius: 3, background: active ? col : T.surfaceHi, border: `1px solid ${col}50`, animation: active && l !== "NORMAL" ? "pulse 1s infinite" : undefined }} />
              <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: active ? col : T.textMute }}>{l}</span>
            </div>
          );
        })}
        <div style={{ marginLeft: "auto", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: threatColor }}>THREAT LEVEL: {threatLevel}</div>
      </div>

      {/* Security state */}
      <Card title="Security State" accent={sec.alert_level !== "NORMAL" ? T.red : T.green}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[["Alert Level", sec.alert_level, sec.alert_level !== "NORMAL" ? T.red : T.green], ["Audio Distress", sec.audio_distress_active ? "ACTIVE" : "CLEAR", sec.audio_distress_active ? T.red : T.green], ["Last RFID Card", sec.rfid_last_card, T.textSub], ["Access Status", sec.rfid_access_granted ? "GRANTED" : "DENIED", sec.rfid_access_granted ? T.green : T.red], ["Forced Entry", door.door_forced_entry ? "DETECTED" : "CLEAR", door.door_forced_entry ? T.red : T.green], ["Unauth Attempts", `${sec.unauthorized_access_attempts} total`, sec.unauthorized_access_attempts > 2 ? T.red : sec.unauthorized_access_attempts > 0 ? T.yellow : T.green]].map(([l, v, col]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace" }}>
              <span style={{ color: T.textMute }}>{l}</span>
              <span style={{ color: col, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* RFID state */}
      <Card title="RFID Access State" accent={sec.rfid_access_granted ? T.green : T.red}>
        <div className="eos-status-list">
          <FieldTile label="Last card" value={sec.rfid_last_card || "No scan yet"} color={sec.rfid_last_card ? T.textSub : T.textMute} />
          <FieldTile label="Access result" value={sec.rfid_access_granted ? "GRANTED" : "DENIED"} color={sec.rfid_access_granted ? T.green : T.red} />
          <FieldTile label="Unauthorized attempts" value={`${sec.unauthorized_access_attempts} total`} color={sec.unauthorized_access_attempts > 2 ? T.red : sec.unauthorized_access_attempts > 0 ? T.yellow : T.green} />
          <p className="eos-body-copy">RFID history is displayed from Ditto incident and security fields only; no synthetic access log is generated.</p>
        </div>
      </Card>

      {/* Incident timeline */}
      <Card title="Incident Timeline" accent={inc.open_incidents > 0 ? T.red : T.border}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {["all", "critical", "warning", "security", "maintenance", "unresolved"].map((filter) => (
            <button
              key={filter}
              onClick={() => setIncidentFilter(filter)}
              style={{
                padding: "5px 8px",
                borderRadius: 999,
                border: `1px solid ${incidentFilter === filter ? T.cyan : T.border}`,
                background: incidentFilter === filter ? T.cyanDim || T.blueDim : T.surfaceHi,
                color: incidentFilter === filter ? T.cyan : T.textMute,
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
              }}
            >
              {filter}
            </button>
          ))}
          <input
            value={incidentSearch}
            onChange={(event) => setIncidentSearch(event.target.value)}
            placeholder="Search incidents"
            style={{ flex: "1 1 150px", minWidth: 150, padding: "6px 9px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.surfaceHi, color: T.text, fontSize: 11 }}
          />
        </div>
        <div style={{ maxHeight: 210, overflowY: "auto" }}>
          {filteredIncidents.length === 0
            ? <EmptyState title="No matching incidents" detail="Adjust filters or wait for new security events." />
            : filteredIncidents.map((e, i) => {
                const incidentId = incidentIdentifier(e, e.__incidentIndex ?? i);
                return (
                <div key={incidentId} style={{ borderBottom: `1px solid ${T.border}`, padding: "6px 0" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 2, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: T.textMute, fontFamily: "monospace" }}>{fmtTime(e.ts)}</span>
                    <SevBadge sev={e.resolved ? "NORMAL" : "CRITICAL"} />
                    {!e.resolved && (
                      <button type="button" onClick={() => resolveIncident(incidentId)} style={{ marginLeft: "auto", border: `1px solid ${T.green}55`, background: T.greenDim, color: T.green, borderRadius: 8, padding: "3px 7px", fontSize: 10, fontWeight: 800 }}>
                        Resolve
                      </button>
                    )}
                    <span style={{ fontSize: 10, color: T.textMute, marginLeft: e.resolved ? "auto" : 0 }}>{relTime(e.ts)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.yellow, fontWeight: 700, fontFamily: "monospace", marginBottom: 1 }}>{e.type}</div>
                  <div style={{ fontSize: 10, color: T.textSub }}>{e.description}</div>
                </div>
              );
            })}
        </div>
      </Card>

      {/* SOC actions */}
      <Card title="SOC Quick Actions" accent={T.red}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CmdBtn label="Inject Forced Entry"    icon="LOCK" onClick={injectForcedEntry}   variant="danger"  confirm />
          <CmdBtn label="Inject Audio Distress"  icon="AUD" onClick={injectAudioDistress} variant="danger"  confirm />
          <CmdBtn label="Inject Unauthorized RFID"    icon="RFID" onClick={injectInvalidRFID}   variant="warning" />
          <CmdBtn label="Initiate Lockdown"      icon="LOCK" onClick={lockdown}            variant="danger"  confirm disabled={attr.system_mode === "LOCKDOWN"} reason="Already locked" />
          <CmdBtn label="Reset / Clear Problems"   icon="RST" onClick={reset}              variant="success" confirm />
        </div>
      </Card>

      {/* Security metrics */}
      <Card title="Security Metrics" accent={T.yellow}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[["Open Incidents", inc.open_incidents, inc.open_incidents > 0 ? T.red : T.green], ["Total Logged", inc.entries.length, T.textSub], ["Unauth Access", sec.unauthorized_access_attempts, sec.unauthorized_access_attempts > 0 ? T.yellow : T.green], ["System Mode", attr.system_mode, attr.system_mode === "NORMAL" ? T.green : T.red]].map(([l, v, col]) => (
            <div key={l} style={{ padding: "10px", borderRadius: 8, background: T.surfaceHi, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 9, color: T.textMute, marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 20, color: col, fontWeight: 700, fontFamily: "monospace" }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Door security */}
      <Card title="Door & Access Control" accent={T.yellow}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[["Door State", door.state, door.state === "BLOCKED" ? T.red : T.green], ["Forced Entry", door.door_forced_entry ? "DETECTED" : "CLEAR", door.door_forced_entry ? T.red : T.green], ["Cycle Count", (door.cycle_count || 0).toLocaleString(), T.textSub], ["Obstruction Events", door.obstruction_events || 0, T.textMute]].map(([l, v, col]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace" }}>
              <span style={{ color: T.textMute }}>{l}</span>
              <span style={{ color: col, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Access-control helpers ------------------------------------------------------
const ACCESS_DECISION_COLOR = (decision) => {
  switch (String(decision || "").toUpperCase()) {
    case "GRANTED": return T.green;
    case "DENIED": return T.red;
    case "REVOKED": return T.orange || T.yellow;
    default: return T.textMute;
  }
};

const ROLE_COLOR = (role) => {
  switch (String(role || "").toUpperCase()) {
    case "ADMIN": return T.purple;
    case "TECHNICIAN": return T.blue;
    case "AGENT": return T.cyan;
    case "RESIDENT": return T.green;
    default: return T.textMute;
  }
};

function AccessDecisionBadge({ decision }) {
  const color = ACCESS_DECISION_COLOR(decision);
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800, fontFamily: "monospace", color, background: `${color}1f`, border: `1px solid ${color}55` }}>
      {String(decision || "UNKNOWN").toUpperCase()}
    </span>
  );
}

const EMPTY_TAG_DRAFT = { uid: "", label: "", role: "VISITOR", note: "", enabled: true, floors: [0, 1, 2, 3] };

// Page: Access Control (RFID tag registry + access log) — all state is real,
// sourced from the Ditto `accessControl` feature and the access_log store.
function PageAccessControl() {
  const { tags, logs, logSource, loadingTags, loadingLogs, error, refreshTags, refreshLogs, createTag, updateTag, toggleTag, deleteTag } = useAccessControl();
  const [draft, setDraft] = useState(EMPTY_TAG_DRAFT);
  const [editingUid, setEditingUid] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [busyUid, setBusyUid] = useState(null);
  const [logFilter, setLogFilter] = useState("ALL");

  const enabledCount = tags.filter((t) => t.enabled).length;
  const grantedCount = logs.filter((l) => String(l.decision).toUpperCase() === "GRANTED").length;
  const deniedCount = logs.filter((l) => ["DENIED", "REVOKED", "UNKNOWN"].includes(String(l.decision).toUpperCase())).length;
  const filteredLogs = logFilter === "ALL" ? logs : logs.filter((l) => String(l.decision).toUpperCase() === logFilter);

  const startCreate = () => { setEditingUid(null); setDraft(EMPTY_TAG_DRAFT); setFormError(null); };
  const startEdit = (tag) => {
    setEditingUid(tag.uid);
    setDraft({
      uid: tag.uid,
      label: tag.label || "",
      role: tag.role || "VISITOR",
      note: tag.note || "",
      enabled: tag.enabled !== false,
      floors: tag.floors === "ALL" || tag.floors == null ? [0, 1, 2, 3] : tag.floors,
    });
    setFormError(null);
  };

  const toggleDraftFloor = (floor) => {
    setDraft((d) => {
      const set = new Set(d.floors);
      if (set.has(floor)) set.delete(floor); else set.add(floor);
      return { ...d, floors: Array.from(set).sort((a, b) => a - b) };
    });
  };

  const submitDraft = async () => {
    setFormBusy(true);
    setFormError(null);
    const payload = {
      uid: normalizeUid(draft.uid),
      label: draft.label,
      role: draft.role,
      note: draft.note,
      enabled: draft.enabled,
      floors: draft.floors.length === NUM_FLOORS ? "ALL" : draft.floors,
    };
    const result = editingUid ? await updateTag(payload) : await createTag(payload);
    setFormBusy(false);
    if (result.ok) {
      setDraft(EMPTY_TAG_DRAFT);
      setEditingUid(null);
    } else {
      setFormError(result.error || "Save failed");
    }
  };

  const onToggle = async (tag) => {
    setBusyUid(tag.uid);
    await toggleTag(tag.uid, !tag.enabled);
    setBusyUid(null);
  };

  const onDelete = async (tag) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete tag ${tag.uid} (${tag.label})?`)) return;
    setBusyUid(tag.uid);
    await deleteTag(tag.uid);
    setBusyUid(null);
  };

  const inputStyle = { padding: "7px 9px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surfaceHi, color: T.text, fontSize: 12, width: "100%" };

  return (
    <div className="eos-page-stack">
      {/* Summary */}
      <div className="eos-responsive-grid four">
        <KpiTile label="Authorized Tags" value={tags.length} color={T.blue} sub={`${enabledCount} enabled`} />
        <KpiTile label="Granted (recent)" value={grantedCount} color={T.green} sub="from access log" />
        <KpiTile label="Denied (recent)" value={deniedCount} color={deniedCount > 0 ? T.red : T.textMute} sub="denied/unknown/revoked" />
        <KpiTile label="Log Source" value={logSource ? logSource.toUpperCase() : "—"} color={T.cyan} sub={loadingLogs ? "refreshing…" : "live"} />
      </div>

      {error && <div className="eos-inline-error">Tag registry: {error}</div>}

      {/* Tag editor */}
      <Card title={editingUid ? `Edit Tag ${editingUid}` : "Add Authorized Tag"} accent={T.blue}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: T.textMute }}>
            UID (hex)
            <input value={draft.uid} disabled={!!editingUid} onChange={(e) => setDraft((d) => ({ ...d, uid: e.target.value }))} placeholder="A1B2C3D4" style={{ ...inputStyle, opacity: editingUid ? 0.6 : 1, fontFamily: "monospace" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: T.textMute }}>
            Label
            <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Building Admin" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: T.textMute }}>
            Role
            <select value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} style={inputStyle}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: T.textMute }}>
            Note
            <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="optional" style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: T.textMute }}>Allowed floors:</span>
          {FLOOR_LABELS.map((label, floor) => {
            const active = draft.floors.includes(floor);
            return (
              <button key={floor} type="button" onClick={() => toggleDraftFloor(floor)} style={{ padding: "4px 11px", borderRadius: 8, fontSize: 11, fontWeight: 800, border: `1px solid ${active ? T.blue : T.border}`, background: active ? T.blueDim : T.surfaceHi, color: active ? T.blue : T.textMute }}>
                F{label}
              </button>
            );
          })}
          <span style={{ fontSize: 10, color: T.textMute }}>{draft.floors.length === NUM_FLOORS ? "(= ALL)" : draft.floors.length === 0 ? "(none → ALL on save)" : ""}</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.textSub, marginLeft: "auto" }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} /> Enabled
          </label>
        </div>
        {formError && <div className="eos-inline-error" style={{ marginTop: 10 }}>{formError}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={submitDraft} disabled={formBusy} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.blue}`, background: T.blueDim, color: T.blue, fontWeight: 800, fontSize: 12, opacity: formBusy ? 0.6 : 1 }}>
            {formBusy ? <Loader2 size={14} className="eos-spin" /> : (editingUid ? <Save size={14} /> : <Plus size={14} />)}
            {editingUid ? "Save changes" : "Create tag"}
          </button>
          {editingUid && <button type="button" onClick={startCreate} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surfaceHi, color: T.textSub, fontWeight: 700, fontSize: 12 }}>Cancel</button>}
          <button type="button" onClick={refreshTags} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surfaceHi, color: T.textSub, fontWeight: 700, fontSize: 12 }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </Card>

      {/* Tag registry */}
      <Card title="Authorized Tag Registry" accent={T.cyan}>
        {loadingTags && tags.length === 0
          ? <EmptyState title="Loading tags" detail="Reading authorizedTags from the Ditto accessControl feature." />
          : tags.length === 0
            ? <EmptyState title="No authorized tags" detail="Add a tag above to populate the Ditto accessControl registry." />
            : <TableShell><table className="eos-table"><thead><tr><th>UID</th><th>Label</th><th>Role</th><th>Floors</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead><tbody>
                {tags.map((tag) => (
                  <tr key={tag.uid}>
                    <td style={{ fontFamily: "monospace" }}>{tag.uid}</td>
                    <td>{tag.label}</td>
                    <td><span style={{ color: ROLE_COLOR(tag.role), fontWeight: 700, fontFamily: "monospace" }}>{tag.role}</span></td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{tag.floors === "ALL" || tag.floors == null ? "ALL" : (Array.isArray(tag.floors) ? tag.floors.map((f) => `F${f}`).join(" ") : "ALL")}</td>
                    <td><span style={{ color: tag.enabled ? T.green : T.textMute, fontWeight: 700 }}>{tag.enabled ? "ENABLED" : "DISABLED"}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <MiniIconButton title="Edit" onClick={() => startEdit(tag)}><Pencil size={13} /></MiniIconButton>
                        <MiniIconButton title={tag.enabled ? "Disable" : "Enable"} onClick={() => onToggle(tag)} active={!tag.enabled}>{busyUid === tag.uid ? <Loader2 size={13} className="eos-spin" /> : (tag.enabled ? <Ban size={13} /> : <Power size={13} />)}</MiniIconButton>
                        <MiniIconButton title="Delete" onClick={() => onDelete(tag)}><Trash2 size={13} /></MiniIconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody></table></TableShell>}
      </Card>

      {/* Access log */}
      <Card title="Access Log" accent={T.yellow}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          {["ALL", "GRANTED", "DENIED", "UNKNOWN", "REVOKED"].map((filter) => (
            <button key={filter} type="button" onClick={() => setLogFilter(filter)} style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${logFilter === filter ? T.cyan : T.border}`, background: logFilter === filter ? T.cyanDim : T.surfaceHi, color: logFilter === filter ? T.cyan : T.textMute, fontSize: 10, fontWeight: 800 }}>{filter}</button>
          ))}
          <button type="button" onClick={refreshLogs} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surfaceHi, color: T.textSub, fontWeight: 700, fontSize: 11 }}><RefreshCw size={12} /> Refresh</button>
        </div>
        {filteredLogs.length === 0
          ? <EmptyState title="No access events" detail="RFID scans recorded by the device or dashboard will appear here." />
          : <TableShell><table className="eos-table"><thead><tr><th>Time</th><th>Decision</th><th>UID</th><th>User</th><th>Role</th><th>Reason</th><th>Source</th></tr></thead><tbody>
              {filteredLogs.slice(0, 50).map((row, i) => (
                <tr key={`${row.time}-${row.tag_uid}-${i}`}>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{fmtTime(row.time)}</td>
                  <td><AccessDecisionBadge decision={row.decision} /></td>
                  <td style={{ fontFamily: "monospace" }}>{row.tag_uid}</td>
                  <td>{row.tag_label || "—"}</td>
                  <td style={{ color: ROLE_COLOR(row.role), fontFamily: "monospace", fontSize: 11 }}>{row.role || "—"}</td>
                  <td style={{ fontSize: 11, color: T.textSub }}>{row.reason || "—"}</td>
                  <td style={{ fontSize: 11, color: T.textMute }}>{row.source || "—"}</td>
                </tr>
              ))}
            </tbody></table></TableShell>}
      </Card>
    </div>
  );
}

// Page: Maintenance
function PageMaintenance() {
  const { state, vibH, tmpH, maintenance, reset } = useTwin();
  const m   = state.features.motor.properties;
  const pf  = state.features.predicted_failures.properties;
  const perf= state.features.performance.properties;
  const cab = state.features.cabin.properties;
  const workOrder = state.features.maintenance_schedule?.properties;
  const thingId = state.attributes.thing_id || env.THING_ID;
  const { data: woResp, loading: woLoading } = useHistoryApi("/api/history/maintenance", { thing_id: thingId, limit: 20 }, 60000);
  const { data: healthResp } = useHistoryApi("/api/history/system-health", { thing_id: thingId, limit: 10 }, 60000);
  const dbWorkOrders = woResp?.data || [];
  const healthRows = healthResp?.data || [];
  const predictedAvailable = hasFeatureDataBeyondSeed(state, "predicted_failures", ["motor_rul_hours", "bearing_health_pct", "door_mechanism_pct", "rope_tension_pct", "next_service_date"]);
  const performanceAvailable = hasFeatureDataBeyondSeed(state, "performance", ["avg_wait_s", "avg_trip_s", "availability_pct", "door_cycle_efficiency"]);

  const HEALTH = [
    ["Motor Health", m.health_status, "", m.health_status === "GOOD" ? 92 : m.health_status === "WARNING" ? 58 : 22],
    ["Motor Hours", Math.round(m.hours_operated), "h", Math.max(0, 100 - (m.hours_operated / MOTOR_LIFE_H) * 100)],
    ["Motor Temp", m.temperature_c.toFixed(1), "degC", m.temperature_c > 85 ? 20 : m.temperature_c > 70 ? 55 : 88],
    ["Vibration Level", (m.vibration_level*100).toFixed(1), "% of threshold", m.vibration_level > 0.2 ? 20 : 80],
  ];

  if (predictedAvailable) {
    HEALTH.push(
      ["Motor RUL", pf.motor_rul_hours, "h", Math.min(100, (pf.motor_rul_hours / MOTOR_LIFE_H) * 100)],
      ["Bearing Health", pf.bearing_health_pct, "%", pf.bearing_health_pct],
      ["Door Mechanism", pf.door_mechanism_pct, "%", pf.door_mechanism_pct],
      ["Rope Tension", pf.rope_tension_pct, "%", pf.rope_tension_pct],
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Component health */}
      <Card title="Component Health Overview" accent={T.green}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
          {HEALTH.map(([l, v, u, p]) => (
            <div key={l} style={{ padding: "12px 10px", borderRadius: 10, background: T.surfaceHi, border: `1px solid ${healthColor(p > 100 ? 70 : p)}30`, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: T.textMute, marginBottom: 6 }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: healthColor(p > 100 ? 70 : p) }}>{typeof v === "number" ? Math.round(v) : v}</div>
              <div style={{ fontSize: 9, color: T.textMute, marginTop: 2 }}>{u}</div>
              <div style={{ marginTop: 6, height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: 4, width: `${Math.min(100, p > 100 ? 70 : p)}%`, background: healthColor(p > 100 ? 70 : p) }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card title="Vibration Analysis" accent={T.red}>
          <TelemetryChart data={vibH} color={T.red} yDomain={[0, 0.5]} height={90} unit="g" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            {[["Current", `${m.vibration_level.toFixed(4)} g`, T.red], ["Threshold", "0.25 g", T.textMute], ["Status", m.vibration_level > 0.25 ? "EXCEEDED" : "NORMAL", m.vibration_level > 0.25 ? T.red : T.green], ["Trend", "↑ +2%/h", T.yellow]].map(([l, v, col]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace" }}>
                <span style={{ color: T.textMute }}>{l}</span>
                <span style={{ color: col, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Thermal Analysis" accent={T.yellow}>
          <TelemetryChart data={tmpH} color={T.yellow} yDomain={[20, 100]} height={90} unit="degC" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            {[["Current", `${m.temperature_c.toFixed(1)} degC`, T.yellow], ["Critical", "85 degC", T.textMute], ["Health", m.health_status, m.health_status === "GOOD" ? T.green : m.health_status === "WARNING" ? T.yellow : T.red], ["Hours", `${Math.round(m.hours_operated)} h`, T.textSub]].map(([l, v, col]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace" }}>
                <span style={{ color: T.textMute }}>{l}</span>
                <span style={{ color: col, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <Card title="Performance KPIs" accent={T.blue}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {performanceAvailable
              ? [["Avg Wait Time", `${perf.avg_wait_s} s`, T.cyan], ["Avg Trip Time", `${perf.avg_trip_s} s`, T.cyan], ["Availability", `${perf.availability_pct}%`, perf.availability_pct > 99 ? T.green : T.yellow], ["Door Efficiency", `${perf.door_cycle_efficiency}%`, T.green], ["Trips Today", Math.round(cab.trips_today), T.textSub]].map(([l, v, col]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace" }}>
                    <span style={{ color: T.textMute }}>{l}</span>
                    <span style={{ color: col, fontWeight: 700 }}>{v}</span>
                  </div>
                ))
              : <EmptyState title="Waiting for n8n data" detail="Performance KPIs will appear after workflow aggregation writes to Ditto." />}
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
              <CmdBtn label="Activate Maintenance Mode" icon="MX" onClick={maintenance} variant="warning" confirm />
              <CmdBtn label="Reset / Clear Problems"      icon="RST" onClick={reset}       variant="success" confirm />
            </div>
          </div>
        </Card>

        <Card title="Maintenance Schedule - Work Orders" accent={T.purple}>
          {workOrder?.work_order_id
            ? <div className="eos-status-list">
                <div style={{ padding: "10px 12px", borderRadius: 12, background: workOrder.priority === "CRITICAL" ? T.redDim : workOrder.priority === "HIGH" ? T.yellowDim : T.blueDim, border: `1px solid ${workOrder.priority === "CRITICAL" ? T.red : workOrder.priority === "HIGH" ? T.yellow : T.blue}55` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <span style={{ color: T.text, fontSize: 12, fontWeight: 800 }}>{workOrder.work_order_id}</span>
                    <SevBadge sev={workOrder.priority === "CRITICAL" || workOrder.priority === "HIGH" ? "WARNING" : "INFO"} />
                  </div>
                  <div style={{ color: T.textSub, fontSize: 11, lineHeight: 1.5 }}>
                    Wear index {workOrder.wear_index ?? "N/A"} / RUL estimate {workOrder.estimated_failure_days ?? "N/A"} days / next service {workOrder.next_service_date || "not scheduled"}
                  </div>
                </div>
                <div className="eos-kpi-grid">
                  <FieldTile label="Priority" value={workOrder.priority || "Not provided"} color={workOrder.priority === "CRITICAL" ? T.red : workOrder.priority === "HIGH" ? T.yellow : T.textSub} />
                  <FieldTile label="Status" value={workOrder.status || "OPEN"} color={workOrder.status === "CLOSED" ? T.green : T.yellow} />
                  <FieldTile label="Issue" value={workOrder.issue_key || "Predictive maintenance"} color={T.textSub} />
                </div>
              </div>
            : <EmptyState title="Waiting for n8n data" detail="Maintenance schedules and work orders will appear after workflow 04 writes maintenance_schedule to Ditto." />}
        </Card>
      </div>

      <Card title="Work Orders — PostgreSQL Database" accent={T.cyan}>
        {woLoading
          ? <EmptyState title="Loading work orders…" detail="Querying maintenance_work_orders table." />
          : dbWorkOrders.length === 0
            ? <EmptyState title="No work orders in database" detail="Work orders are created by n8n workflow 04 when wear thresholds are exceeded." />
            : <TableShell><table className="eos-table">
                <thead><tr><th>Work Order</th><th>Priority</th><th>Issue</th><th>Wear</th><th>Est. Failure</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>{dbWorkOrders.map(wo => (
                  <tr key={wo.work_order_id}>
                    <td style={{ fontFamily: "monospace", fontSize: 10 }}>{wo.work_order_id}</td>
                    <td><SevBadge sev={wo.priority === "CRITICAL" ? "CRITICAL" : wo.priority === "HIGH" ? "WARNING" : "INFO"} /></td>
                    <td>{wo.issue_key}</td>
                    <td>{wo.wear_index != null ? Number(wo.wear_index).toFixed(2) : "—"}</td>
                    <td>{wo.estimated_failure_days != null ? `${wo.estimated_failure_days} days` : "—"}</td>
                    <td style={{ color: wo.status === "CLOSED" ? T.green : wo.status === "IN_PROGRESS" ? T.yellow : T.textSub }}>{wo.status}</td>
                    <td style={{ fontSize: 10, color: T.textMute }}>{wo.created_at ? new Date(wo.created_at).toLocaleDateString("en-GB") : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></TableShell>}
      </Card>

      {healthRows.length > 0 && (
        <Card title="System Health History" accent={T.borderHi}>
          <TableShell><table className="eos-table">
            <thead><tr><th>Component</th><th>Status</th><th>Latency</th><th>Checked</th></tr></thead>
            <tbody>{healthRows.map(h => (
              <tr key={h.id}>
                <td>{h.component}</td>
                <td><SevBadge sev={h.status === "UP" ? "INFO" : h.status === "DEGRADED" ? "WARNING" : "CRITICAL"} /></td>
                <td>{h.latency_ms != null ? `${h.latency_ms} ms` : "—"}</td>
                <td style={{ fontSize: 10, color: T.textMute }}>{h.checked_at ? new Date(h.checked_at).toLocaleString("en-GB", { hour12: false }) : "—"}</td>
              </tr>
            ))}</tbody>
          </table></TableShell>
        </Card>
      )}
    </div>
  );
}

// Page: Simulation lab
function PageSimulation() {
  const { state, vibH, tmpH, ldH, injectHighVib, injectForcedEntry, injectAudioDistress, injectInvalidRFID, emergencyStop, reset, runScenario, setVibration, setLoad, setMotorTemp, connected } = useTwin();
  const [vibSlider,  setVibSlider]  = useState(0.02);
  const [loadSlider, setLoadSlider] = useState(0);
  const [tempSlider, setTempSlider] = useState(0);
  // Local-only preview: writes mutate dashboard state but Ditto's next refresh
  // overwrites them. Use the container simulator for true injection.
  const simulationDisabled = false;

  const Slider = ({ label, min, max, step, value, onChange, warnAt, critAt, unit }) => {
    const pct   = (value - min) / (max - min) * 100;
    const color = critAt && value > critAt ? T.red : warnAt && value > warnAt ? T.yellow : T.green;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span style={{ color: T.textMute, fontFamily: "monospace" }}>{label}</span>
          <span style={{ color, fontWeight: 700, fontFamily: "monospace" }}>{typeof value === "number" && step < 1 ? value.toFixed(3) : Math.round(value)} {unit}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} disabled={simulationDisabled} onChange={e => onChange(+e.target.value)} style={{ width: "100%", accentColor: color, opacity: simulationDisabled ? 0.45 : 1, cursor: simulationDisabled ? "not-allowed" : "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.textMute, fontFamily: "monospace" }}>
          <span>{min}{unit}</span>
          {warnAt && <span style={{ color: T.yellow }}>warn {warnAt}{unit}</span>}
          {critAt && <span style={{ color: T.red }}>crit {critAt}{unit}</span>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {simulationDisabled && (
        <div style={{ padding: "12px 14px", borderRadius: 14, border: `1px solid ${T.yellow}55`, background: T.yellowDim, color: T.yellow, fontSize: 12, fontWeight: 700 }}>
          Simulation controls are guarded until the integrated simulator is started. Live Ditto telemetry takes priority when connected.
        </div>
      )}
      {/* Scenario presets */}
      <Card title="Scenario Injection - Presets" accent={T.red}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {Object.entries(SCENARIO_DEFS).map(([key, sc]) => (
            <button key={key} onClick={() => runScenario(key)} disabled={simulationDisabled}
              style={{ padding: "12px 10px", borderRadius: 10, textAlign: "left", cursor: simulationDisabled ? "not-allowed" : "pointer", opacity: simulationDisabled ? 0.55 : 1, background: sc.color + "0f", border: `1px solid ${sc.color}40`, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = sc.color + "20"; e.currentTarget.style.borderColor = sc.color + "80"; }}
              onMouseLeave={e => { e.currentTarget.style.background = sc.color + "0f"; e.currentTarget.style.borderColor = sc.color + "40"; }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: sc.color, letterSpacing: "0.1em", marginBottom: 4 }}>INJECT ↗</div>
              <div style={{ fontSize: 11, color: T.textSub, lineHeight: 1.4, fontWeight: 800 }}>{sc.label}</div>
              <div style={{ marginTop: 6, fontSize: 10, color: T.textMute, lineHeight: 1.35 }}>Affects: {sc.affects}</div>
              <div style={{ marginTop: 4, fontSize: 10, color: T.textMute, lineHeight: 1.35 }}>Expected: {sc.response}</div>
            </button>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {/* Injectors */}
        <Card title="Anomaly Injectors" accent={T.yellow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <CmdBtn label="Vibration Spike 0.41g"    icon="VIB" onClick={injectHighVib}      variant="warning" disabled={simulationDisabled} reason="Start simulator first" />
            <CmdBtn label="Forced Door Entry"         icon="LOCK" onClick={injectForcedEntry}  variant="danger"  confirm disabled={simulationDisabled} reason="Start simulator first" />
            <CmdBtn label="Audio Distress Signal"     icon="AUD" onClick={injectAudioDistress} variant="danger" confirm disabled={simulationDisabled} reason="Start simulator first" />
            <CmdBtn label="Invalid RFID Scan"         icon="RFID" onClick={injectInvalidRFID}  variant="warning" disabled={simulationDisabled} reason="Start simulator first" />
            <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <CmdBtn label="Emergency Stop"    icon="STOP" onClick={emergencyStop} variant="danger"  confirm />
              <CmdBtn label="Reset / Clear Problems" icon="RST" onClick={reset}       variant="success" confirm />
            </div>
          </div>
        </Card>

        {/* Sliders */}
        <Card title="Parameter Override" accent={T.purple}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Slider label="Vibration Level" min={0} max={0.9} step={0.001} value={vibSlider} warnAt={0.12} critAt={0.25} unit="g"
              onChange={v => { setVibSlider(v); setVibration(v); }} />
            <Slider label="Cabin Load" min={0} max={1000} step={10} value={loadSlider} warnAt={640} critAt={760} unit=" kg"
              onChange={v => { setLoadSlider(v); setLoad(v); }} />
            <Slider label="Motor Temperature" min={20} max={95} step={1} value={tempSlider} warnAt={70} critAt={85} unit="degC"
              onChange={v => { setTempSlider(v); setMotorTemp(v); }} />
          </div>
        </Card>

        {/* Live feedback */}
        <Card title="Live State Feedback" accent={T.blue}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              ["Vibration", `${state.features.motor.properties.vibration_level.toFixed(4)} g`, state.features.motor.properties.vibration_level > 0.25 ? T.red : T.green],
              ["Load", `${Math.round(state.features.cabin.properties.load_kg)} kg`, state.features.cabin.properties.load_kg > 760 ? T.red : T.green],
              ["Motor Temp", `${state.features.motor.properties.temperature_c.toFixed(1)} degC`, state.features.motor.properties.temperature_c > 85 ? T.red : T.textSub],
              ["Risk Score", Math.round(state.attributes.risk_score), riskColor(state.attributes.risk_score)],
              ["System Mode", state.attributes.system_mode, state.attributes.system_mode !== "NORMAL" ? T.red : T.green],
              ["Motor Health", state.features.motor.properties.health_status, state.features.motor.properties.health_status === "GOOD" ? T.green : T.red],
            ].map(([l, v, col]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: T.surfaceHi, fontSize: 11, fontFamily: "monospace" }}>
                <span style={{ color: T.textMute }}>{l}</span>
                <span style={{ color: col, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Response charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Card title="Vibration Response" accent={T.red}><TelemetryChart data={vibH} color={T.red} yDomain={[0, 1]} height={85} unit="g" /></Card>
        <Card title="Temperature Response" accent={T.yellow}><TelemetryChart data={tmpH} color={T.yellow} yDomain={[20, 100]} height={85} unit="degC" /></Card>
        <Card title="Load Response" accent={T.green}><TelemetryChart data={ldH} color={T.green} yDomain={[0, MAX_LOAD + 200]} height={85} unit=" kg" /></Card>
      </div>
    </div>
  );
}

function TableShell({ children }) {
  return <div style={{ overflowX: "auto", width: "100%" }}>{children}</div>;
}

function MiniIconButton({ title, onClick, children, active = false }) {
  return (
    <button type="button" title={title} onClick={onClick} className="eos-icon-button" data-active={active ? "true" : "false"}>
      {children}
    </button>
  );
}

function ToggleSwitch({ checked, onChange, label, detail }) {
  return (
    <label className="eos-toggle-row">
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="eos-toggle" data-on={checked ? "true" : "false"}>
        <span />
      </button>
    </label>
  );
}

function SettingsSection({ title, accent = T.cyan, children }) {
  return <Card title={title} accent={accent}>{children}</Card>;
}

function ConfirmModal({ open, title, detail, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false }) {
  if (!open) return null;
  return (
    <div className="eos-modal-backdrop" role="presentation">
      <div className="eos-modal" role="dialog" aria-modal="true">
        <div className="eos-modal-head">
          <div>
            <h2>{title}</h2>
            <p>{detail}</p>
          </div>
          <MiniIconButton title="Close dialog" onClick={onCancel}><X size={16} /></MiniIconButton>
        </div>
        <div className="eos-card-actions">
          <button type="button" onClick={onCancel} className="eos-soft-button">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className={danger ? "eos-danger-button" : "eos-primary-button"}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function AppSidebar({ page, setPage, collapsed, setCollapsed, mobileOpen, setMobileOpen, state, connected }) {
  const mode = state.attributes.system_mode;
  const modeColor = mode === "NORMAL" ? T.green : mode === "MAINTENANCE" ? T.yellow : T.red;
  const navigate = (id) => {
    setPage(id);
    setMobileOpen(false);
  };

  return (
    <>
      {mobileOpen && <button type="button" className="eos-mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`eos-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-open" : ""}`}>
        <div className="eos-sidebar-brand">
          <div className="eos-brand-mark"><img src="/elevatoros-mark.svg" alt="" aria-hidden="true" /></div>
          {!collapsed && <div><strong>ElevatorOS</strong><span>Digital Twin Command</span></div>}
          <button type="button" className="eos-sidebar-close" onClick={() => setMobileOpen(false)}><X size={16} /></button>
        </div>
        <div className="eos-sidebar-status">
          <ConnectionIndicator label="LIVE" active={connected} detail={connected ? "sync" : "standby"} />
          {!collapsed && <StatusPill label={mode} color={modeColor} pulse={mode === "LOCKDOWN"} />}
        </div>
        <nav className="eos-nav" aria-label="Dashboard navigation">
          {PAGE_GROUPS.map((group) => (
            <div key={group} className="eos-nav-group">
              {!collapsed && <div className="eos-nav-group-label">{group}</div>}
              {PAGES.filter(item => item.group === group).map((item) => {
                const Icon = item.icon;
                const active = page === item.id;
                return (
                  <button key={item.id} type="button" onClick={() => navigate(item.id)} title={item.label} className={`eos-nav-item ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}>
                    <Icon size={18} />
                    {!collapsed ? <span>{item.label}</span> : <span className="eos-nav-short">{item.short}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="eos-sidebar-footer">
          <button type="button" className="eos-nav-item" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>{collapsed ? "Expand" : "Collapse"}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

function AppTopbar({ page, setPage, state, connected, dittoConnected, dittoMode, openMobileNav, preferences, updatePreferences, profile, onLogoutRequest }) {
  const [clock, setClock] = useState("");
  const [search, setSearch] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    const updateClock = () => setClock(new Date().toLocaleString("en-GB", { hour12: false }));
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const info = PAGES.find(item => item.id === page) || PAGES[0];
  const PageIcon = info.icon;
  const incidents = state.features.incident_log.properties.open_incidents || 0;
  const risk = state.attributes.risk_score;
  const microcontroller = getMicrocontrollerStatus(state);
  const source = dittoConnected ? `DITTO/${String(dittoMode || "sse").toUpperCase()}` : "OFFLINE";
  const notifications = [
    incidents > 0 && { sev: "CRITICAL", text: `${incidents} open incident${incidents > 1 ? "s" : ""}` },
    risk >= 41 && { sev: risk >= 76 ? "CRITICAL" : "WARNING", text: `AI risk score ${Math.round(risk)}` },
    !microcontroller.connected && { sev: "WARNING", text: `${microcontroller.board} ${microcontroller.status.toLowerCase()} on ${microcontroller.mqtt_id}` },
    !connected && { sev: "WARNING", text: "Live Ditto telemetry unavailable; start the simulator container or check the bridge" },
  ].filter(Boolean);
  const runSearch = () => {
    const match = PAGES.find(item => item.label.toLowerCase().includes(search.trim().toLowerCase()));
    if (match) setPage(match.id);
  };

  return (
    <header className="eos-topbar">
      <div className="eos-topbar-left">
        <MiniIconButton title="Open navigation" onClick={openMobileNav}><Menu size={18} /></MiniIconButton>
        <div className="eos-page-title">
          <span><PageIcon size={18} /></span>
          <div><h1>{info.label}</h1><p>{state.attributes.location} / {state.attributes.thing_id}</p></div>
        </div>
      </div>
      <div className="eos-search">
        <Search size={15} />
        <input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") runSearch(); }} placeholder="Search pages" aria-label="Search pages" />
      </div>
      <div className="eos-topbar-right">
        <ConnectionIndicator label={source} active={connected} />
        <ConnectionIndicator label="ESP32-S3" active={microcontroller.connected} detail={microcontroller.status.toLowerCase()} />
        <div className="eos-clock"><Clock size={14} />{clock}</div>
        <MiniIconButton title="Toggle theme" active={preferences.theme === "light"} onClick={() => updatePreferences({ theme: preferences.theme === "dark" ? "light" : "dark" })}>{preferences.theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}</MiniIconButton>
        <div className="eos-menu-anchor">
          <MiniIconButton title="Notifications" active={showNotifications} onClick={() => setShowNotifications(v => !v)}><Bell size={17} />{notifications.length > 0 && <span className="eos-badge-dot" />}</MiniIconButton>
          {showNotifications && <div className="eos-dropdown">{notifications.length === 0 ? <EmptyState title="No active notifications" detail="Alert and sync notifications will appear here." /> : notifications.map((item, index) => <div key={index} className="eos-dropdown-row"><SevBadge sev={item.sev} /><span>{item.text}</span></div>)}</div>}
        </div>
        <div className="eos-menu-anchor">
          <button type="button" className="eos-user-button" onClick={() => setShowUserMenu(v => !v)}><span><User size={16} /></span><strong>{profile.fullName}</strong></button>
          {showUserMenu && (
            <div className="eos-dropdown eos-user-menu">
              <div className="eos-user-summary"><strong>{profile.fullName}</strong><span>{profile.role}</span></div>
              <button type="button" onClick={() => { setPage("settings"); setShowUserMenu(false); }}><Settings size={15} />Settings</button>
              <button type="button" onClick={() => { setPage("help"); setShowUserMenu(false); }}><BookOpen size={15} />Help / About</button>
              <button type="button" className="danger" onClick={onLogoutRequest}><LogOut size={15} />Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function PageMonitoring() {
  const { state, vibH, tmpH, ldH, speedH, riskH, enH, timeline, connected, dittoConnected, dittoMode, dittoError, isSimulationMode } = useTwin();
  const cabin = state.features.cabin.properties;
  const door = state.features.door.properties;
  const motor = state.features.motor.properties;
  const energy = state.features.energy.properties;
  const performance = state.features.performance.properties;
  const microcontroller = getMicrocontrollerStatus(state);
  const lastSample = timeline[timeline.length - 1];
  const energyAvailable = isSimulationMode || hasFeatureDataBeyondSeed(state, "energy", ["kwh_today", "kwh_month", "co2_kg", "regen_kwh"]);
  const performanceAvailable = hasFeatureDataBeyondSeed(state, "performance", ["avg_wait_s", "avg_trip_s", "availability_pct", "door_cycle_efficiency"]);
  const thingId = state.attributes.thing_id || env.THING_ID;
  const { data: riskHistResp, loading: riskHistLoading } = useHistoryApi("/api/history/risk", { thing_id: thingId, limit: 48 }, 60000);
  const { data: energyHistResp } = useHistoryApi("/api/history/energy", { thing_id: thingId, limit: 48 }, 60000);
  const riskHistRows = riskHistResp?.data || [];
  const energyHistRows = energyHistResp?.data || [];
  const fmtHour = (v) => { try { return new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; } };
  const rows = [
    ["Cabin load cell", `${Math.round(cabin.load_kg)} kg`, cabin.load_kg > MAX_LOAD ? "CRITICAL" : cabin.load_kg > MAX_LOAD * 0.8 ? "WARNING" : "NORMAL"],
    ["Cabin temperature", `${cabin.temperature_c.toFixed(1)} degC`, cabin.temperature_c > 45 ? "WARNING" : "NORMAL"],
    ["Motor vibration", `${motor.vibration_level.toFixed(4)} g`, motor.vibration_level > 0.25 ? "CRITICAL" : motor.vibration_level > 0.12 ? "WARNING" : "NORMAL"],
    ["Motor thermal probe", `${motor.temperature_c.toFixed(1)} degC`, motor.temperature_c > 85 ? "CRITICAL" : motor.temperature_c > 70 ? "WARNING" : "NORMAL"],
    ["Door reed switch", door.state, door.state === "BLOCKED" ? "CRITICAL" : "NORMAL"],
    ["Current draw", `${motor.current_draw_a.toFixed(1)} A`, motor.current_draw_a > 12 ? "WARNING" : "NORMAL"],
  ];

  return (
    <div className="eos-page-stack">
      <div className="eos-kpi-grid">
        <KpiTile label="ESP32-S3" value={microcontroller.status} color={microcontroller.color} sub={microcontroller.last_seen_at ? `Seen ${relTime(microcontroller.last_seen_at)}` : microcontroller.mqtt_id} />
        <KpiTile label="Connection" value={connected ? "ONLINE" : isSimulationMode ? "SIM" : "OFFLINE"} color={connected ? T.green : isSimulationMode ? T.yellow : T.red} sub={dittoConnected ? `Ditto ${dittoMode || "SSE"}` : "No live source"} />
        <KpiTile label="Last Telemetry" value={lastSample ? relTime(lastSample.ts) : "Waiting"} color={lastSample ? T.cyan : T.textMute} sub={lastSample?.source || "No sample"} />
        <KpiTile label="Availability" value={performance.availability_pct.toFixed(1)} unit="%" color={performance.availability_pct >= 99 ? T.green : T.yellow} />
        <KpiTile label="Door Cycles" value={(door.cycle_count || 0).toLocaleString()} color={T.textSub} />
      </div>
      <div className="eos-responsive-grid three">
        <Card title="Sensor Readings" accent={T.cyan}>
          <TableShell><table className="eos-table"><thead><tr><th>Sensor</th><th>Value</th><th>Status</th></tr></thead><tbody>{rows.map(([name, value, status]) => <tr key={name}><td>{name}</td><td>{value}</td><td><SevBadge sev={status} /></td></tr>)}</tbody></table></TableShell>
        </Card>
        <Card title="Connection Monitoring" accent={connected ? T.green : T.yellow}>
          <div className="eos-status-list"><ConnectionIndicator label="ESP32-S3" active={microcontroller.connected} detail={microcontroller.status.toLowerCase()} /><ConnectionIndicator label="DITTO" active={dittoConnected} detail={dittoMode || "sse"} /><ConnectionIndicator label="SIM" active={isSimulationMode} detail="fallback" /><FieldTile label="ESP32 MQTT status topic" value={microcontroller.mqtt_topic} color={microcontroller.color} sub={microcontroller.last_status_at ? `Status ${relTime(microcontroller.last_status_at)}` : "Waiting for retained LWT"} /><FieldTile label="ESP32 telemetry heartbeat" value={microcontroller.last_telemetry_at ? relTime(microcontroller.last_telemetry_at) : "Waiting"} color={microcontroller.connected ? T.green : T.textMute} sub={microcontroller.telemetry_topic} />{dittoError && <div className="eos-inline-error">{dittoError}</div>}</div>
        </Card>
        <Card title="System Performance" accent={T.blue}>
          {performanceAvailable
            ? <div className="eos-status-list">{[["Avg wait", `${performance.avg_wait_s}s`], ["Avg trip", `${performance.avg_trip_s}s`], ["Trips today", cabin.trips_today], ["Power", `${motor.power_kw.toFixed(2)} kW`]].map(([label, value]) => <FieldTile key={label} label={label} value={value} />)}</div>
            : <EmptyState title="Waiting for n8n data" detail="Performance KPIs will appear after the workflow writes performance data to Ditto." />}
        </Card>
      </div>
      <div className="eos-responsive-grid three">
        <Card title="Vibration Live Trend" accent={T.red}><TelemetryChart data={vibH} color={T.red} yDomain={[0, 0.5]} height={110} unit="g" /></Card>
        <Card title="Motor Thermal Trend" accent={T.yellow}><TelemetryChart data={tmpH} color={T.yellow} yDomain={[20, 100]} height={110} unit="degC" /></Card>
        <Card title="Payload Trend" accent={T.green}><TelemetryChart data={ldH} color={T.green} yDomain={[0, MAX_LOAD + 200]} height={110} unit=" kg" /></Card>
      </div>
      <div className="eos-responsive-grid three">
        <Card title="Speed Trend" accent={T.cyan}><TelemetryChart data={speedH} color={T.cyan} yDomain={[0, 4]} height={110} unit=" m/s" /></Card>
        <Card title="Risk Score Trend" accent={riskColor(state.attributes.risk_score)}><TelemetryChart data={riskH} color={riskColor(state.attributes.risk_score)} yDomain={[0, 100]} height={110} /></Card>
        <Card title="Energy Trend" accent={energyAvailable ? T.blue : T.borderHi}>
          {energyAvailable
            ? <>
                <TelemetryChart data={enH.map((point, index) => ({ t: index, v: point.v }))} color={T.blue} yDomain={[0, Math.max(3, energy.kwh_today + 1)]} height={90} unit=" kWh" />
                <div className="eos-command-feedback">Today {energy.kwh_today.toFixed(2)} kWh / Month {energy.kwh_month.toFixed(1)} kWh / Regen {energy.regen_kwh.toFixed(2)} kWh</div>
              </>
            : <EmptyState title="Waiting for n8n data" detail="Energy metrics are reserved for the optimization workflow or simulator fallback." />}
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card title="Risk History — Hourly Aggregates (Database)" accent={T.purple}>
          {riskHistLoading
            ? <EmptyState title="Loading…" detail="Querying PostgreSQL hourly_risk." />
            : riskHistRows.length === 0
              ? <EmptyState title="No historical risk data yet" detail="Activate workflow 01 to populate telemetry_raw. hourly_risk aggregates refresh every 30 min." />
              : <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={[...riskHistRows].reverse()} margin={{ top: 4, right: 8, left: -22, bottom: 2 }}>
                    <CartesianGrid strokeDasharray="2 2" stroke={T.border} />
                    <XAxis dataKey="bucket" tickFormatter={fmtHour} tick={{ fontSize: 8, fill: T.textMute }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: T.textMute }} />
                    <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, fontSize: 10 }} formatter={(v, n) => [Number(v).toFixed(1), n === "avg_risk" ? "Avg Risk" : "Max Risk"]} labelFormatter={fmtHour} />
                    <Line type="monotone" dataKey="avg_risk" stroke={T.yellow} dot={false} strokeWidth={2} name="avg_risk" />
                    <Line type="monotone" dataKey="max_risk" stroke={T.red} dot={false} strokeWidth={1} strokeDasharray="3 2" name="max_risk" />
                  </LineChart>
                </ResponsiveContainer>}
        </Card>
        <Card title="Power & Vibration History — Hourly (Database)" accent={T.blue}>
          {energyHistRows.length === 0
            ? <EmptyState title="No historical energy data yet" detail="Activate workflow 01 to populate telemetry_raw. hourly_energy aggregates refresh every 30 min." />
            : <ResponsiveContainer width="100%" height={150}>
                <LineChart data={[...energyHistRows].reverse()} margin={{ top: 4, right: 8, left: -22, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke={T.border} />
                  <XAxis dataKey="bucket" tickFormatter={fmtHour} tick={{ fontSize: 8, fill: T.textMute }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 8, fill: T.textMute }} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, fontSize: 10 }} labelFormatter={fmtHour} />
                  <Line type="monotone" dataKey="avg_power_kw" stroke={T.blue} dot={false} strokeWidth={2} name="avg_power_kw" />
                  <Line type="monotone" dataKey="avg_vibration_g" stroke={T.red} dot={false} strokeWidth={1.5} name="avg_vibration_g" />
                </LineChart>
              </ResponsiveContainer>}
        </Card>
      </div>
    </div>
  );
}

function PageControlPanel() {
  const { state, sendFloor, emergencyStop, lockdown, maintenance, reset, requestStatusRefresh, softStop, home, freshStart, runDeviceDiagnostic, optimizeRouting, reduceEnergy, setFan, openDoor, closeDoor, clearQueue, injectHighVib, injectForcedEntry, injectAudioDistress, injectInvalidRFID, runScenario, cmdLog, connected, dittoConnected } = useTwin();
  const cabin = state.features.cabin.properties;
  const motor = state.features.motor.properties;
  const fan = state.features.fan.properties;
  const door = state.features.door.properties;
  const attr = state.attributes;
  const requestQueue = state.features.request_queue?.properties || INIT_STATE.features.request_queue.properties;
  const queueRows = buildRequestQueueRows(requestQueue);
  const pendingDeviceCommand = state.features.control?.properties?.pending_command;
  const doorOpen = ["OPEN", "OPENING"].includes(String(door.state || "").toUpperCase());
  // Anomaly inject/scenario buttons are now local-only previews (the
  // in-browser simulator has been retired). Drive real anomalies via the
  // elevator_simulator container with SIM_ANOMALY_PROFILE=demo|critical.
  const simulationDisabled = false;
  const movementBlocked = attr.system_mode === "LOCKDOWN" || cabin.emergency_stop;

  return (
    <div className="eos-page-stack">
      <div className="eos-responsive-grid three">
        <Card title="Telemetry Source" accent={dittoConnected ? T.green : T.red}>
          <div className="eos-status-list">
            <StatusPill
              label={dittoConnected ? "LIVE" : "OFFLINE"}
              color={dittoConnected ? T.green : T.red}
              pulse={dittoConnected}
            />
            <p className="eos-body-copy">
              Telemetry comes from the <code>elevator_simulator</code> container (or a real ESP32 device) via MQTT &rarr; bridge &rarr; Ditto. The in-browser simulator has been retired. To start synthetic telemetry, run:
              <br />
              <code>docker compose --profile simulator up -d simulator</code>
            </p>
          </div>
        </Card>
        <Card title="Elevator Dispatch" accent={T.blue}>
          <div className="eos-floor-grid">{Array.from({ length: NUM_FLOORS }, (_, i) => <button key={i} type="button" onClick={() => sendFloor(i)} disabled={movementBlocked} className={cabin.current_floor === i ? "is-active" : cabin.target_floor === i ? "is-target" : ""}>{FLOOR_LABELS[i]}</button>)}</div>
          <div className="eos-command-feedback">Target floor: {FLOOR_LABELS[cabin.target_floor]} / Direction: {cabin.direction} / Safety gate: {movementBlocked ? "blocked" : "clear"}</div>
        </Card>
        <Card title="Collective Request Queue" accent={requestQueue.pending_count > 0 ? T.cyan : T.borderHi}>
          <div className="eos-kpi-grid" style={{ marginBottom: 12 }}>
            <FieldTile label="Pending" value={requestQueue.pending_count} color={requestQueue.pending_count > 0 ? T.cyan : T.textMute} sub="ESP32 request flags" />
            <FieldTile label="Dispatch" value={requestQueue.dispatch_direction} color={requestQueue.dispatch_direction === "IDLE" ? T.textMute : T.blue} sub={`F${requestQueue.current_floor} > F${requestQueue.target_floor}`} />
            <FieldTile label="Priority" value={requestQueue.priority_active ? `F${requestQueue.priority_floor}` : "NONE"} color={requestQueue.priority_active ? T.purple : T.textMute} sub={requestQueue.priority_active ? (requestQueue.priority_source || "priority service") : "no priority hold"} />
          </div>
          <TableShell>
            <table className="eos-table">
              <thead><tr><th>Floor</th><th>Cabin</th><th>Hall Up</th><th>Hall Down</th></tr></thead>
              <tbody>{queueRows.map(row => <tr key={row.floor}><td>F{FLOOR_LABELS[row.floor]}</td><td><SevBadge sev={row.cabin ? "INFO" : "NORMAL"} /></td><td><SevBadge sev={row.hallUp ? "INFO" : "NORMAL"} /></td><td><SevBadge sev={row.hallDown ? "INFO" : "NORMAL"} /></td></tr>)}</tbody>
            </table>
          </TableShell>
        </Card>
        <Card title="Door & Queue Controls" accent={doorOpen ? T.yellow : T.blue}>
          <div className="eos-kpi-grid" style={{ marginBottom: 12 }}>
            <FieldTile label="Door State" value={door.state || "UNKNOWN"} color={doorOpen ? T.yellow : T.green} sub={`cycles: ${door.cycle_count ?? 0}`} />
            <FieldTile label="Pending Requests" value={requestQueue.pending_count} color={requestQueue.pending_count > 0 ? T.cyan : T.textMute} sub="clear flushes all" />
          </div>
          <div className="eos-command-list">
            <CmdBtn label="Open / Hold Door" icon={<DoorOpen size={14} />} onClick={openDoor} variant="info" disabled={movementBlocked} reason="Blocked by safety state" />
            <CmdBtn label="Close Door" icon={<DoorClosed size={14} />} onClick={closeDoor} variant="default" />
            <CmdBtn label="Clear Request Queue" icon={<ListX size={14} />} onClick={clearQueue} variant="warning" confirm disabled={requestQueue.pending_count === 0} reason="Queue already empty" />
          </div>
        </Card>
        <Card title="Safety Critical Commands" accent={T.red}>
          <div className="eos-command-list"><CmdBtn label="Emergency Stop" icon="E" onClick={emergencyStop} variant="danger" confirm disabled={cabin.emergency_stop} reason="Already active" /><CmdBtn label="Soft Stop / Error Stop" icon="S" onClick={softStop} variant="warning" confirm /><CmdBtn label="Lockdown" icon="LOCK" onClick={lockdown} variant="danger" confirm disabled={attr.system_mode === "LOCKDOWN"} reason="Already locked" /><CmdBtn label="Maintenance Mode" icon="MX" onClick={maintenance} variant="warning" confirm disabled={attr.system_mode === "MAINTENANCE"} reason="Already in maintenance" /><CmdBtn label="Reset / Clear Problems" icon="R" onClick={reset} variant="success" confirm /></div>
        </Card>
        <Card title="Firmware Service Commands" accent={T.yellow}>
          <div className="eos-command-list"><CmdBtn label="Dump Queue / Refresh" icon="Q" onClick={requestStatusRefresh} variant="info" /><CmdBtn label="Home to Start Floor" icon="H" onClick={home} variant="warning" confirm /><CmdBtn label="Fresh Start Reset" icon="x" onClick={freshStart} variant="danger" confirm /></div>
          {pendingDeviceCommand && <div className="eos-command-feedback">Pending device intent: {pendingDeviceCommand.command || "-"} / {pendingDeviceCommand.status || "PENDING"}</div>}
        </Card>
        <Card title="Automation Actions" accent={T.green}>
          <div className="eos-command-list"><CmdBtn label="Optimize Routing" icon="AI" onClick={optimizeRouting} variant="info" /><CmdBtn label="Reduce Energy" icon="ECO" onClick={reduceEnergy} variant="info" /></div>
        </Card>
        <FanControlCard fan={fan} motorTempC={motor.temperature_c} cabinTempC={cabin.temperature_c} setFan={setFan} />
      </div>
      <Card title="Firmware Diagnostics" accent={T.purple}>
        <div className="eos-diagnostic-grid">
          {FIRMWARE_DIAGNOSTIC_COMMANDS.map(command => <CmdBtn key={command.key} label={command.label} icon={command.serial} onClick={() => runDeviceDiagnostic(command.key, command.label)} variant={command.variant} confirm />)}
        </div>
      </Card>
      <Card title="Incident Preview & Scenario Triggers" accent={T.purple}>
        <p className="eos-body-copy" style={{ marginBottom: 8 }}>
          These buttons inject anomalies into the dashboard&apos;s local view only. They are useful for screenshots and walk-throughs; they do not write to Ditto, so the next telemetry refresh overwrites them. For real anomalies, start the container simulator with <code>SIM_ANOMALY_PROFILE=demo</code> or <code>critical</code>.
        </p>
        <div className="eos-scenario-grid">{Object.entries(SCENARIO_DEFS).map(([key, scenario]) => <button key={key} type="button" onClick={() => runScenario(key)} style={{ borderColor: `${scenario.color}55`, background: `${scenario.color}12`, color: scenario.color }}><strong>{scenario.label}</strong><span>{scenario.affects}</span></button>)}</div>
        <div className="eos-responsive-grid four" style={{ marginTop: 12 }}><CmdBtn label="Vibration Spike" icon="VIB" onClick={injectHighVib} variant="warning" /><CmdBtn label="Forced Door Entry" icon="LOCK" onClick={injectForcedEntry} variant="danger" confirm /><CmdBtn label="Audio Distress" icon="AUD" onClick={injectAudioDistress} variant="danger" confirm /><CmdBtn label="Invalid RFID" icon="RFID" onClick={injectInvalidRFID} variant="warning" /></div>
      </Card>
      <Card title="Command Feedback" accent={T.border}>
        {cmdLog.length === 0 ? <EmptyState title="No commands" detail="Operator and simulator command audit entries will appear here." /> : <TableShell><table className="eos-table"><thead><tr><th>Time</th><th>Command</th><th>Status</th><th>Detail</th></tr></thead><tbody>{cmdLog.slice(0, 12).map(row => <tr key={row.id}><td>{fmtTime(row.ts)}</td><td>{row.cmd}</td><td><SevBadge sev={commandResultSeverity(row.result)} /></td><td>{row.detail || "-"}</td></tr>)}</tbody></table></TableShell>}
      </Card>
      {/* Deterministic Command Safety Gate — shows the gate's decision for every
          operator and agent command and is the visible proof that AI/n8n cannot
          execute commands without rule-based admission. */}
      <CommandSafetyGatePanel thingId={state.attributes?.thing_id || env.THING_ID} />
      {/* AI-Adaptive Dispatch: the brain's live policy choice, score table,
          intent-vs-applied, shadow challengers, and the guarded manual override. */}
      <DispatchPolicyPanel />
    </div>
  );
}

function buildAlertRows(state) {
  const cabin = state.features.cabin.properties;
  const door = state.features.door.properties;
  const motor = state.features.motor.properties;
  const sec = state.features.security.properties;
  const inc = state.features.incident_log.properties;
  const analysis = getAiAnalysis(state);
  const aiReasoning = getAnalysisText(analysis, ["reasoning", "analysis", "explanation", "summary"]);
  const aiRecommendation = getAnalysisText(analysis, ["recommended_action", "recommendation", "action", "next_action"]);
  return [
    state.attributes.risk_score >= 76 && { id: "risk-critical", sev: "CRITICAL", title: "AI risk score critical", detail: `Risk score is ${Math.round(state.attributes.risk_score)} / 100`, source: "Analysis Agent" },
    state.attributes.risk_score >= 41 && state.attributes.risk_score < 76 && { id: "risk-warning", sev: "WARNING", title: "AI risk score elevated", detail: `Risk score is ${Math.round(state.attributes.risk_score)} / 100`, source: "Analysis Agent" },
    cabin.emergency_stop && { id: "emergency-stop", sev: "CRITICAL", title: "Emergency stop active", detail: "Cabin motion is halted by safety state", source: "Control Agent" },
    door.door_forced_entry && { id: "forced-entry", sev: "CRITICAL", title: "Forced door entry detected", detail: "Door reed switch or access sensor reports forced entry", source: "Surveillance Agent" },
    motor.vibration_level > 0.12 && { id: "vibration", sev: motor.vibration_level > 0.25 ? "CRITICAL" : "WARNING", title: "Motor vibration anomaly", detail: `${motor.vibration_level.toFixed(4)} g reported by motor sensor`, source: "Analysis Agent" },
    sec.unauthorized_access_attempts > 0 && { id: "rfid", sev: "WARNING", title: "Unauthorized RFID attempts", detail: `${sec.unauthorized_access_attempts} denied access event(s)`, source: "Surveillance Agent" },
    ...inc.entries.slice(0, 8).map((entry, index) => ({
      id: incidentIdentifier(entry, index),
      incidentId: incidentIdentifier(entry, index),
      resolved: entry.resolved === true,
      sev: entry.resolved ? "INFO" : "CRITICAL",
      title: entry.type || "Incident",
      detail: entry.description || "Incident detail unavailable",
      source: "Incident Log",
      ts: entry.ts,
    })),
    analysis && { id: "ai-analysis-live", sev: String(analysis.severity || getSeverityFromRisk(state.attributes.risk_score)).toUpperCase(), title: aiRecommendation || "AI analysis available", detail: aiReasoning || "n8n wrote an ai_analysis payload to Ditto.", source: "AI Brain", ts: analysis.ts || analysis.timestamp || analysis.generated_at },
  ].filter(Boolean);
}

function PageAlerts() {
  const { state, cmdLog, timeline, acknowledgeAlert, resolveIncident, reset } = useTwin();
  const [filter, setFilter] = useState("all");
  const [acknowledged, setAcknowledged] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const thingId = state.attributes.thing_id || env.THING_ID;
  const { data: auditResp } = useHistoryApi("/api/history/audit", { thing_id: thingId, limit: 50 }, 30000);
  const { data: notifResp } = useHistoryApi("/api/history/notifications", { thing_id: thingId, limit: 30 }, 30000);
  const alertRows = buildAlertRows(state).filter(row => !dismissed.includes(row.id));
  const commandRows = cmdLog.map(row => ({ id: `cmd-${row.id}`, sev: commandResultSeverity(row.result), title: row.cmd, detail: row.detail || row.result, source: "Command", ts: row.ts, category: "commands" }));
  const telemetryRows = timeline.slice(-30).map(row => ({ id: `tl-${row.tick}`, sev: row.risk >= 76 ? "CRITICAL" : row.risk >= 41 ? "WARNING" : "INFO", title: `${row.source} telemetry`, detail: `Floor ${FLOOR_LABELS[row.floor]} / risk ${row.risk} / speed ${(row.speed ?? 0).toFixed(2)} m/s / vib ${row.vib.toFixed(4)} g`, source: "Telemetry", ts: row.ts, category: "telemetry" }));
  const dbAuditRows = (auditResp?.data || []).map(r => ({ id: `db-audit-${r.id}`, sev: r.severity || (r.status === "SUCCESS" ? "INFO" : "WARNING"), title: r.event_type || r.action, detail: r.workflow_name ? `${r.workflow_name}${r.node_name ? " / " + r.node_name : ""}` : (r.action || ""), source: r.agent_name || "n8n", ts: r.created_at, category: "audit" }));
  const dbNotifRows = (notifResp?.data || []).map(r => ({ id: `db-notif-${r.id}`, sev: r.severity || "INFO", title: `${r.channel || "notification"} — ${r.status}`, detail: r.message || r.subject || "", source: "Notification Outbox", ts: r.created_at, category: "notifications" }));
  const rows = [...alertRows.map(row => ({
    ...row,
    category: String(row.title || row.source || "").match(/security|rfid|entry|distress/i) ? "security" : String(row.title || "").match(/maintenance|motor|vibration/i) ? "maintenance" : "alerts",
  })), ...commandRows, ...telemetryRows, ...dbAuditRows, ...dbNotifRows]
    .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  const visible = rows.filter(row =>
    filter === "all" ||
    row.sev.toLowerCase() === filter ||
    row.category === filter
  );

  return (
    <div className="eos-page-stack">
      <div className="eos-filter-bar">
        {["all", "critical", "warning", "info", "commands", "security", "maintenance", "audit", "notifications"].map(item => <button key={item} type="button" className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
        <button type="button" onClick={() => {
          const activeIds = alertRows.map(row => row.id);
          setAcknowledged(ids => Array.from(new Set([...ids, ...activeIds])));
          activeIds.forEach((id) => acknowledgeAlert(alertRows.find(row => row.id === id)));
        }} className="eos-soft-button">Acknowledge active</button>
        <button type="button" onClick={() => {
          if (typeof window === "undefined" || window.confirm("Confirm active problem reset after remediation?")) reset();
        }} className="eos-danger-button">Reset problems</button>
        <button type="button" onClick={() => setDismissed(alertRows.map(row => row.id))} className="eos-soft-button">Clear alert cards</button>
      </div>
      <div className="eos-alert-grid">
        {alertRows.length === 0 ? <EmptyState title="No active alert cards" detail="Critical and warning conditions will appear here." /> : alertRows.map(row => {
          const ack = acknowledged.includes(row.id);
          const color = row.sev === "CRITICAL" ? T.red : row.sev === "WARNING" ? T.yellow : T.blue;
          return (
            <div key={row.id} className="eos-alert-card" style={{ borderColor: `${color}55`, background: `${color}10` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><SevBadge sev={row.sev} /><span>{row.source}</span></div>
              <h3>{row.title}</h3>
              <p>{row.detail}</p>
              <div className="eos-card-actions">
                <button type="button" onClick={() => {
                  setAcknowledged(ids => ids.includes(row.id) ? ids : [...ids, row.id]);
                  acknowledgeAlert(row);
                }}>{ack ? "Acknowledged" : "Acknowledge"}</button>
                {row.incidentId && !row.resolved && <button type="button" onClick={() => resolveIncident(row.incidentId)}>Resolve</button>}
                <button type="button" onClick={() => setDismissed(ids => [...ids, row.id])}>Dismiss</button>
              </div>
            </div>
          );
        })}
      </div>
      <Card title="Unified Event Log" accent={T.borderHi}>
        {visible.length === 0
          ? <EmptyState title="No matching events" detail="Change filters or wait for telemetry, command, incident, or AI events." />
          : <TableShell><table className="eos-table"><thead><tr><th>Timestamp</th><th>Category</th><th>Status</th><th>Event</th><th>Detail</th><th>Source</th></tr></thead><tbody>{visible.slice(0, 160).map(row => <tr key={row.id}><td>{row.ts ? new Date(row.ts).toLocaleString("en-GB", { hour12: false }) : "-"}</td><td>{row.category || "alerts"}</td><td><SevBadge sev={row.sev} /></td><td>{row.title}</td><td>{row.detail}</td><td>{row.source}</td></tr>)}</tbody></table></TableShell>}
      </Card>
    </div>
  );
}

function PageLogs() {
  const { cmdLog, timeline, state } = useTwin();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const incidents = state.features.incident_log.properties.entries.map((entry, index) => ({ id: `inc-${index}`, ts: entry.ts, type: "incident", status: entry.resolved ? "INFO" : "CRITICAL", event: entry.type, detail: entry.description }));
  const commands = cmdLog.map(row => ({ id: `cmd-${row.id}`, ts: row.ts, type: "command", status: commandResultSeverity(row.result), event: row.cmd, detail: row.detail || row.result }));
  const telemetry = timeline.slice(-60).map(row => ({ id: `tl-${row.tick}`, ts: row.ts, type: "telemetry", status: row.risk >= 76 ? "CRITICAL" : row.risk >= 41 ? "WARNING" : "INFO", event: row.source, detail: `Floor ${FLOOR_LABELS[row.floor]} / risk ${row.risk} / vib ${row.vib.toFixed(4)}` }));
  const rows = [...commands, ...incidents, ...telemetry]
    .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))
    .filter(row => (type === "all" || row.type === type) && (!query || `${row.event} ${row.detail} ${row.type}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="eos-page-stack">
      <Card title="Log Search & Filters" accent={T.cyan}>
        <div className="eos-filter-bar">
          <div className="eos-search wide"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search logs" /></div>
          {["all", "command", "telemetry", "incident"].map(item => <button key={item} type="button" onClick={() => setType(item)} className={type === item ? "is-active" : ""}>{item}</button>)}
          <button type="button" className="eos-soft-button"><Download size={14} />Export</button>
        </div>
      </Card>
      <Card title="Event Log" accent={T.border}>
        {rows.length === 0 ? <EmptyState title="No logs found" detail="Change the search or filter criteria." /> : <TableShell><table className="eos-table"><thead><tr><th>Timestamp</th><th>Type</th><th>Status</th><th>Event</th><th>Detail</th></tr></thead><tbody>{rows.slice(0, 120).map(row => <tr key={row.id}><td>{row.ts ? new Date(row.ts).toLocaleString("en-GB", { hour12: false }) : "-"}</td><td>{row.type}</td><td><SevBadge sev={row.status} /></td><td>{row.event}</td><td>{row.detail}</td></tr>)}</tbody></table></TableShell>}
      </Card>
    </div>
  );
}

function PageDevices() {
  const { state, dittoConnected, dittoMode } = useTwin();
  const cabin = state.features.cabin.properties;
  const motor = state.features.motor.properties;
  const door = state.features.door.properties;
  const microcontroller = getMicrocontrollerStatus(state);
  const devices = [
    ["ESP32-S3 edge controller", microcontroller.status, `${microcontroller.board} via ${microcontroller.mqtt_topic}`, RadioTower, microcontroller.color],
    ["Eclipse Ditto thing", dittoConnected ? "SYNCED" : "NOT SYNCED", `${state.attributes.thing_id} via ${dittoMode || "SSE"}`, Shield, dittoConnected ? T.green : T.yellow],
    ["Ditto SSE stream", dittoConnected && dittoMode === "sse" ? "STREAMING" : dittoConnected ? "POLLING" : "OFFLINE", "Real-time twin events via Server-Sent Events", Database, dittoConnected ? T.green : T.red],
    ["Cabin sensors", cabin.emergency_stop ? "SAFETY HOLD" : "ACTIVE", `Floor ${FLOOR_LABELS[cabin.current_floor]}, load ${Math.round(cabin.load_kg)} kg`, Activity, cabin.emergency_stop ? T.red : T.green],
    ["Motor subsystem", motor.health_status, `Vibration ${motor.vibration_level.toFixed(4)} g, ${motor.temperature_c.toFixed(1)} degC`, Cpu, motor.health_status === "GOOD" ? T.green : motor.health_status === "WARNING" ? T.yellow : T.red],
    ["Door actuator", door.state, `${door.obstruction_events || 0} obstruction events`, DoorOpen, door.state === "BLOCKED" ? T.red : T.green],
  ];

  return <div className="eos-device-grid">{devices.map(([name, status, detail, Icon, color]) => <Card key={name} title={name} accent={color}><div className="eos-device-card"><Icon size={28} color={color} /><div><StatusPill label={status} color={color} /><p>{detail}</p></div></div></Card>)}</div>;
}

function PageReports() {
  const { state } = useTwin();
  const motor = state.features.motor.properties;
  const perf = state.features.performance.properties;
  const inc = state.features.incident_log.properties;
  const pf = state.features.predicted_failures.properties;
  const thingId = state.attributes.thing_id || env.THING_ID;
  const { data: summaryResp, loading: summaryLoading, error: summaryError } = useHistoryApi("/api/history/summary", { thing_id: thingId }, 60000);
  const summary = summaryResp?.data;
  const dbConnected = summaryResp?.db?.connected;
  const tel = summary?.telemetry || {};
  const maint = summary?.maintenance || {};
  const notif = summary?.notifications || {};
  const audit = summary?.audit || {};

  const reports = [
    ["Maintenance Readiness", "Predictive service package", `Next service ${pf.next_service_date}; motor RUL ${pf.motor_rul_hours}h`, Wrench, T.yellow],
    ["Incident Summary", "Security and safety events", `${inc.open_incidents} open incident(s), ${inc.entries.length} total records`, Shield, inc.open_incidents > 0 ? T.red : T.green],
    ["Performance Summary", "Availability and dispatch", `${perf.availability_pct}% availability, ${perf.avg_wait_s}s avg wait`, Gauge, T.blue],
    ["Motor Health Report", "Mechanical telemetry", `${motor.health_status}, ${motor.temperature_c.toFixed(1)} degC, ${motor.vibration_level.toFixed(4)} g`, FileText, motor.health_status === "GOOD" ? T.green : T.yellow],
  ];

  const fmtTs = (v) => v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "No data yet";
  const statRows = [
    ["Total telemetry rows", tel.total_rows ?? "—", T.cyan],
    ["Anomalies detected", tel.anomalies ?? "—", tel.anomalies > 0 ? T.yellow : T.green],
    ["Security breaches", tel.security_breaches ?? "—", tel.security_breaches > 0 ? T.red : T.green],
    ["Average risk score", tel.avg_risk_score != null ? Number(tel.avg_risk_score).toFixed(1) : "—", T.textSub],
    ["Peak risk score", tel.max_risk_score ?? "—", tel.max_risk_score >= 76 ? T.red : tel.max_risk_score >= 41 ? T.yellow : T.green],
    ["Avg motor temp", tel.avg_motor_temp_c != null ? `${Number(tel.avg_motor_temp_c).toFixed(1)} °C` : "—", T.textSub],
    ["Max vibration", tel.max_vibration_g != null ? `${Number(tel.max_vibration_g).toFixed(4)} g` : "—", T.textSub],
    ["Last telemetry at", fmtTs(tel.last_telemetry_at), T.textMute],
    ["Total notifications", notif.total_rows ?? "—", T.textSub],
    ["Open work orders", maint.open_count ?? "—", maint.open_count > 0 ? T.yellow : T.green],
    ["Total work orders", maint.total_count ?? "—", T.textSub],
    ["Total audit entries", audit.total_rows ?? "—", T.textSub],
  ];

  return (
    <div className="eos-page-stack">
      <Card title="Database Summary — Real-time Stats from PostgreSQL" accent={dbConnected ? T.green : summaryLoading ? T.borderHi : T.red}>
        {summaryLoading
          ? <EmptyState title="Loading database summary…" detail="Querying PostgreSQL for aggregated statistics." />
          : summaryError && !summary
            ? <EmptyState title="Database unavailable" detail={`${summaryError} — Check that PostgreSQL is running and POSTGRES_* vars are set in dashboard/.env.local`} />
            : !summary
              ? <EmptyState title="No database data yet" detail="Activate workflow 01 in n8n and let telemetry accumulate. Stats will appear here." />
              : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))", gap: 8 }}>
                  {statRows.map(([label, value, color]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", borderRadius: 8, background: T.surfaceHi, fontSize: 11, fontFamily: "monospace" }}>
                      <span style={{ color: T.textMute }}>{label}</span>
                      <span style={{ color, fontWeight: 700 }}>{String(value)}</span>
                    </div>
                  ))}
                </div>}
      </Card>
      <div className="eos-responsive-grid four">{reports.map(([title, sub, detail, Icon, color]) => <Card key={title} title={title} accent={color}><div className="eos-report-card"><Icon size={24} color={color} /><strong>{sub}</strong><p>{detail}</p><button type="button" className="eos-soft-button"><Download size={14} />Export placeholder</button></div></Card>)}</div>
      <Card title="Generated Reports" accent={T.cyan}><TableShell><table className="eos-table"><thead><tr><th>Report</th><th>Scope</th><th>Status</th><th>Action</th></tr></thead><tbody>{reports.map(([title, sub]) => <tr key={title}><td>{title}</td><td>{sub}</td><td><SevBadge sev="INFO" /></td><td>Ready for backend export integration</td></tr>)}</tbody></table></TableShell></Card>
    </div>
  );
}

function PageSettings() {
  const { state, preferences, updatePreferences, profile, updateProfile, requestLogout, dittoConnected, dittoMode, connected } = useTwin();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const setPref = (key, value) => updatePreferences({ [key]: value });
  const thingId = state.attributes.thing_id || env.THING_ID;
  const { data: summaryResp, loading: dbLoading } = useHistoryApi("/api/history/summary", { thing_id: thingId }, 30000);
  const dbOk = summaryResp?.db?.connected;
  const tel = summaryResp?.data?.telemetry || {};
  const maint = summaryResp?.data?.maintenance || {};
  const notif = summaryResp?.data?.notifications || {};
  const audit = summaryResp?.data?.audit || {};
  const microcontroller = getMicrocontrollerStatus(state);
  const fmtTs = (v) => v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "No data yet";

  return (
    <div className="eos-settings-grid">
      <SettingsSection title="Data Status (PostgreSQL)" accent={dbLoading ? T.borderHi : dbOk ? T.green : T.red}>
        <FieldTile label="Database connection" value={dbLoading ? "Checking…" : dbOk ? "Connected" : "Unavailable"} color={dbLoading ? T.textMute : dbOk ? T.green : T.red} />
        <FieldTile label="DB latency" value={summaryResp?.db?.latency_ms != null ? `${summaryResp.db.latency_ms} ms` : "—"} color={T.textSub} />
        <FieldTile label="Total telemetry rows" value={tel.total_rows ?? (dbOk ? "0" : "—")} color={T.cyan} />
        <FieldTile label="Last telemetry row" value={fmtTs(tel.last_telemetry_at)} color={T.textMute} />
        <FieldTile label="Total audit entries" value={audit.total_rows ?? (dbOk ? "0" : "—")} color={T.textSub} />
        <FieldTile label="Last audit entry" value={fmtTs(audit.last_at)} color={T.textMute} />
        <FieldTile label="Total notifications" value={notif.total_rows ?? (dbOk ? "0" : "—")} color={T.textSub} />
        <FieldTile label="Open work orders" value={maint.open_count ?? (dbOk ? "0" : "—")} color={maint.open_count > 0 ? T.yellow : T.textSub} />
        <FieldTile label="Data source mode" value="Ditto SSE + Historical PostgreSQL" color={T.purple} />
        <FieldTile label="DB password" value="Configured" color={T.textMute} />
      </SettingsSection>
      <SettingsSection title="Project Runtime" accent={T.green}>
        <FieldTile label="Project name" value="Smart & Secure Elevator Digital Twin" color={T.text} />
        <FieldTile label="Thing ID" value={state.attributes.thing_id || env.THING_ID} color={T.cyan} />
        <FieldTile label="Ditto proxy" value={env.DITTO_PROXY_BASE} color={dittoConnected ? T.green : T.yellow} />
        <FieldTile label="Ditto status" value={dittoConnected ? `Connected (${dittoMode || "sse"})` : "Offline"} color={dittoConnected ? T.green : T.yellow} />
        <FieldTile label="ESP32-S3 status" value={microcontroller.status} color={microcontroller.color} sub={microcontroller.board} />
        <FieldTile label="ESP32 status topic" value={microcontroller.mqtt_topic} color={T.textSub} />
        <FieldTile label="ESP32 last seen" value={fmtTs(microcontroller.last_seen_at)} color={microcontroller.connected ? T.green : T.textMute} />
        <FieldTile label="ESP32 telemetry" value={fmtTs(microcontroller.last_telemetry_at)} color={microcontroller.connected ? T.green : T.textMute} />
        <FieldTile label="Ditto transport" value={dittoMode === "sse" ? "SSE (push)" : "REST polling"} color={dittoMode === "sse" ? T.green : T.yellow} />
        <FieldTile label="Poll heartbeat" value={`${env.DITTO_POLL_INTERVAL_MS} ms`} color={T.blue} />
        <FieldTile label="Telemetry source" value="elevator_simulator container or real ESP32 (opt-in)" color={T.textSub} sub="docker compose --profile simulator up -d simulator" />
        <FieldTile label="Ditto auth" value="Server-side proxy" color={T.textSub} />
        <FieldTile label="Build profile" value="Phase 4 — historical analytics" color={T.purple} />
      </SettingsSection>
      <SettingsSection title="Profile Settings" accent={T.cyan}>
        <div className="eos-profile-block"><div className="eos-profile-avatar"><User size={30} /></div><div><strong>{profile.fullName}</strong><span>{profile.role}</span><StatusPill label={profile.accountStatus} color={T.green} /></div></div>
        {[["username", "Username"], ["fullName", "Full name"], ["email", "Email"]].map(([key, label]) => <label key={key} className="eos-field-label">{label}<input value={profile[key]} onChange={event => updateProfile({ [key]: event.target.value })} /></label>)}
      </SettingsSection>
      <SettingsSection title="Appearance Settings" accent={T.purple}>
        <ToggleSwitch checked={preferences.theme === "dark"} onChange={value => setPref("theme", value ? "dark" : "light")} label="Dark mode" detail="Applies the industrial command center theme." />
        <ToggleSwitch checked={preferences.compactMode} onChange={value => setPref("compactMode", value)} label="Compact mode" detail="Reduces dashboard spacing." />
        <ToggleSwitch checked={preferences.sidebarCollapsed} onChange={value => setPref("sidebarCollapsed", value)} label="Sidebar collapsed" detail="Persist the navigation width preference." />
        <label className="eos-field-label">Accent color<select value={preferences.accentColor} onChange={event => setPref("accentColor", event.target.value)}><option value="#22d3ee">Cyan</option><option value="#60a5fa">Blue</option><option value="#34d399">Green</option><option value="#c084fc">Violet</option></select></label>
        <label className="eos-field-label">Dashboard density<select value={preferences.density} onChange={event => setPref("density", event.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="expanded">Expanded</option></select></label>
      </SettingsSection>
      <SettingsSection title="System Settings" accent={T.blue}>
        <label className="eos-field-label">Refresh interval<input type="number" min="1" max="60" value={preferences.refreshInterval} onChange={event => setPref("refreshInterval", Number(event.target.value))} /></label>
        <ToggleSwitch checked={preferences.autoRefresh} onChange={value => setPref("autoRefresh", value)} label="Auto-refresh" detail="Prepared for future backend scheduling." />
        <ToggleSwitch checked={preferences.alertSound} onChange={value => setPref("alertSound", value)} label="Alert sound" detail="UI-ready critical acoustic alarm setting." />
        <label className="eos-field-label">Default dashboard view<select value={preferences.defaultView} onChange={event => setPref("defaultView", event.target.value)}>{PAGES.map(page => <option key={page.id} value={page.id}>{page.label}</option>)}</select></label>
        <label className="eos-field-label">Language<select value={preferences.language} onChange={event => setPref("language", event.target.value)}><option>English</option><option>French</option><option>Arabic</option></select></label>
      </SettingsSection>
      <SettingsSection title="Security Settings" accent={T.red}>
        <FieldTile label="Session status" value="Active" color={T.green} />
        <FieldTile label="Last login" value={profile.lastLogin} color={T.textSub} />
        <ToggleSwitch checked={passwordOpen} onChange={setPasswordOpen} label="Change password UI" detail="Frontend-ready form placeholder." />
        {passwordOpen && <div className="eos-password-grid"><input type="password" placeholder="Current password" /><input type="password" placeholder="New password" /><input type="password" placeholder="Confirm password" /></div>}
        <button type="button" className="eos-danger-button" onClick={requestLogout}><LogOut size={14} />Logout from current session</button>
        <button type="button" className="eos-soft-button">Logout from all devices placeholder</button>
      </SettingsSection>
      <SettingsSection title="Notification Settings" accent={T.yellow}>
        <ToggleSwitch checked={preferences.notificationsEnabled} onChange={value => setPref("notificationsEnabled", value)} label="Enable alerts" />
        <ToggleSwitch checked={preferences.criticalNotifications} onChange={value => setPref("criticalNotifications", value)} label="Critical alert notifications" />
        <ToggleSwitch checked={preferences.emailNotifications} onChange={value => setPref("emailNotifications", value)} label="Email notifications" detail="Placeholder until notification outbox is connected." />
        <ToggleSwitch checked={preferences.browserNotifications} onChange={value => setPref("browserNotifications", value)} label="Browser notifications" />
        <ToggleSwitch checked={preferences.systemHealthNotifications} onChange={value => setPref("systemHealthNotifications", value)} label="System health notifications" />
      </SettingsSection>
      <SettingsSection title="Advanced Settings" accent={T.green}>
        <ToggleSwitch checked={preferences.developerMode} onChange={value => setPref("developerMode", value)} label="Developer mode" detail="Shows diagnostics and integration placeholders." />
        <FieldTile label="API status" value={connected ? "Available" : "Fallback"} color={connected ? T.green : T.yellow} />
        <FieldTile label="Eclipse Ditto" value={dittoConnected ? `Connected (${dittoMode || "sse"})` : "Offline"} color={dittoConnected ? T.green : T.yellow} />
        <div className="eos-card-actions"><button type="button" className="eos-soft-button"><Download size={14} />Export settings</button><button type="button" className="eos-soft-button" onClick={() => updatePreferences(DEFAULT_PREFERENCES)}><RefreshCw size={14} />Reset settings</button><button type="button" className="eos-danger-button" onClick={() => { try { window.localStorage.removeItem("eos-preferences"); } catch {} updatePreferences(DEFAULT_PREFERENCES); }}><Trash2 size={14} />Clear local cache</button></div>
      </SettingsSection>
    </div>
  );
}

function PageHelp() {
  return (
    <div className="eos-page-stack">
      <Card title="Smart & Secure Elevator Digital Twin Platform" accent={T.cyan}><div className="eos-help-hero"><BookOpen size={30} color={T.cyan} /><div><h2>ElevatorOS SCADA Command Center</h2><p>Production-oriented dashboard for a smart elevator digital twin using Eclipse Ditto SSE for real-time state, n8n agent workflows, PostgreSQL historical analytics, and a Next.js operator interface.</p></div></div></Card>
      <div className="eos-responsive-grid three"><Card title="Version" accent={T.blue}><FieldTile label="Dashboard" value="v4.0 Phase 4 — historical analytics" /><FieldTile label="Runtime" value="Next.js 16" /></Card><Card title="System Architecture" accent={T.green}><p className="eos-body-copy">Simulator / ESP32 -&gt; MQTT -&gt; n8n + Bridge -&gt; Eclipse Ditto -&gt; SSE -&gt; Frontend -&gt; Commands -&gt; Ditto -&gt; Device.</p></Card><Card title="Support" accent={T.yellow}><p className="eos-body-copy">Documentation, contact, runbooks, and escalation links are ready as placeholders for project deployment.</p></Card></div>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = (event) => {
    event.preventDefault();
    setError("");
    if (!identifier.trim() || !password.trim()) {
      setError("Enter any demo username and password to unlock this local dashboard session.");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      onLogin({ identifier: identifier.trim(), remember });
      setLoading(false);
    }, 450);
  };

  return (
    <div className="eos-login-shell">
      <form className="eos-login-card" onSubmit={submit}>
        <div className="eos-login-brand"><div className="eos-brand-mark large"><img src="/elevatoros-mark.svg" alt="" aria-hidden="true" /></div><div><h1>ElevatorOS</h1><p>Local Demo Lock Screen</p></div></div>
        <label>Email or username<input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" /></label>
        <label>Password<div className="eos-password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        <div className="eos-login-row"><label className="eos-checkbox"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />Remember this demo session</label><span className="eos-login-note">No production auth</span></div>
        {error && <div className="eos-inline-error">{error}</div>}
        <button type="submit" className="eos-primary-button" disabled={loading}>{loading ? "Starting session..." : "Login"}</button>
        <p className="eos-login-note">Local-only demo authentication. It stores only a dashboard session flag and does not validate or store real secrets.</p>
      </form>
    </div>
  );
}

const PAGE_MAP = {
  twin: PageTwin,
  monitoring: PageMonitoring,
  control: PageControlPanel,
  ai: PageAIInsights,
  security: PageSOC,
  access: PageAccessControl,
  maintenance: PageMaintenance,
  alerts: PageAlerts,
  devices: PageDevices,
  reports: PageReports,
  settings: PageSettings,
  help: PageHelp,
};

// ROOT APP
function GlobalStyles() {
  return (
    <style>{`
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.58; } }
      @keyframes criticalPulse { 0% { background: ${T.redDim}; } 100% { background: ${T.red}20; } }
      @keyframes slideIn { from { transform: translateX(80px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes eosSpin { to { transform: rotate(360deg); } }
      .eos-spin { animation: eosSpin 0.8s linear infinite; }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; background: ${T.bg}; }
      body { background: ${T.bg}; color: ${T.text}; font-family: 'Bahnschrift', 'Aptos', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; }
      button, input, textarea, select { font-family: inherit; }
      button:disabled { cursor: not-allowed; }
      input, select, textarea { background: ${T.surfaceHi}; color: ${T.text}; border: 1px solid ${T.border}; border-radius: 10px; padding: 9px 10px; width: 100%; }
      input:focus, textarea:focus, select:focus { outline: none; border-color: ${T.cyan}; box-shadow: 0 0 0 3px ${T.cyanDim}; }
      ::-webkit-scrollbar { width: 7px; height: 7px; }
      ::-webkit-scrollbar-track { background: ${T.bg}; }
      ::-webkit-scrollbar-thumb { background: ${T.borderHi}; border-radius: 999px; }
      .eos-app { min-height: 100vh; display: flex; flex-direction: column; background: radial-gradient(circle at top left, ${T.cyanDim}, transparent 34%), linear-gradient(135deg, ${T.bg}, ${T.bg2 || T.bg}); color: ${T.text}; font-size: 13px; }
      .eos-layout { display: flex; flex: 1; overflow: hidden; min-height: 0; }
      .eos-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
      .eos-main { flex: 1; overflow: auto; padding: 18px; background: ${T.bg}; }
      .eos-compact .eos-main { padding: 10px; }
      .eos-sidebar { width: 280px; background: linear-gradient(180deg, ${T.surfaceLo || T.surface}, ${T.surface}); border-right: 1px solid ${T.border}; display: flex; flex-direction: column; flex-shrink: 0; transition: width 0.2s ease, transform 0.2s ease; z-index: 50; box-shadow: 12px 0 36px rgba(0,0,0,0.18); }
      .eos-sidebar.is-collapsed { width: 88px; }
      .eos-sidebar-brand { min-height: 70px; display: flex; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid ${T.border}; }
      .eos-sidebar-brand strong { display: block; color: ${T.text}; font-weight: 950; }
      .eos-sidebar-brand span { display: block; color: ${T.textMute}; font-size: 10px; margin-top: 2px; }
      .eos-brand-mark { width: 42px; height: 42px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; background: ${T.cyanDim}; border: 1px solid ${T.borderHi}; color: ${T.cyan}; flex-shrink: 0; }
      .eos-brand-mark.large { width: 54px; height: 54px; border-radius: 16px; }
      .eos-brand-mark img { width: 32px; height: 32px; display: block; object-fit: contain; }
      .eos-brand-mark.large img { width: 42px; height: 42px; }
      .eos-sidebar-status { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 14px; border-bottom: 1px solid ${T.border}; }
      .eos-sidebar.is-collapsed .eos-sidebar-status { justify-content: center; }
      .eos-nav { padding: 10px; overflow-y: auto; flex: 1; }
      .eos-nav-group { margin-bottom: 12px; }
      .eos-nav-group-label { color: ${T.textMute}; font-size: 10px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 10px; }
      .eos-nav-item { width: 100%; min-height: 42px; display: flex; align-items: center; gap: 10px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: ${T.textSub}; padding: 9px 10px; font-weight: 800; font-size: 12px; transition: all 0.18s ease; text-align: left; }
      .eos-nav-item:hover { background: ${T.surfaceHi}; color: ${T.text}; border-color: ${T.border}; }
      .eos-nav-item.is-active { background: ${T.cyanDim}; color: ${T.cyan}; border-color: ${T.cyan}55; box-shadow: inset 3px 0 0 ${T.cyan}; }
      .eos-sidebar.is-collapsed .eos-nav-item { justify-content: center; flex-direction: column; gap: 2px; padding: 9px 4px; }
      .eos-nav-short { font-size: 9px; letter-spacing: 0.08em; }
      .eos-sidebar-footer { padding: 10px; border-top: 1px solid ${T.border}; }
      .eos-sidebar-close { display: none; margin-left: auto; background: transparent; color: ${T.textSub}; border: 0; }
      .eos-mobile-scrim { display: none; }
      .eos-topbar { min-height: 74px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 18px; background: linear-gradient(90deg, ${T.surfaceLo || T.surface}, ${T.surface}); border-bottom: 1px solid ${T.border}; box-shadow: 0 14px 34px rgba(0,0,0,0.18); z-index: 30; }
      .eos-topbar-left, .eos-topbar-right { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .eos-page-title { display: flex; align-items: center; gap: 10px; min-width: 230px; }
      .eos-page-title > span { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; color: ${T.cyan}; background: ${T.cyanDim}; border: 1px solid ${T.borderHi}; }
      .eos-page-title h1 { margin: 0; color: ${T.text}; font-size: 17px; font-weight: 950; letter-spacing: 0; }
      .eos-page-title p { margin: 3px 0 0; color: ${T.textMute}; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
      .eos-search { display: flex; align-items: center; gap: 8px; border: 1px solid ${T.border}; background: ${T.surfaceHi}; border-radius: 12px; padding: 0 10px; color: ${T.textMute}; min-width: 220px; max-width: 420px; width: 100%; }
      .eos-search.wide { max-width: none; flex: 1 1 260px; }
      .eos-search input { border: 0; background: transparent; padding: 10px 0; box-shadow: none; }
      .eos-clock { display: flex; gap: 6px; align-items: center; color: ${T.textSub}; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
      .eos-icon-button { position: relative; width: 38px; height: 38px; border-radius: 12px; border: 1px solid ${T.border}; background: ${T.surfaceHi}; color: ${T.textSub}; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease; }
      .eos-icon-button:hover, .eos-icon-button[data-active="true"] { border-color: ${T.cyan}; color: ${T.cyan}; background: ${T.cyanDim}; }
      .eos-menu-anchor { position: relative; }
      .eos-badge-dot { position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; background: ${T.red}; border-radius: 999px; box-shadow: 0 0 0 2px ${T.surface}; }
      .eos-dropdown { position: absolute; right: 0; top: calc(100% + 10px); width: 320px; max-width: calc(100vw - 24px); background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 14px; padding: 12px; box-shadow: 0 24px 60px rgba(0,0,0,0.32); z-index: 80; }
      .eos-dropdown-row { display: flex; gap: 8px; align-items: center; padding: 8px 0; color: ${T.textSub}; border-bottom: 1px solid ${T.border}; }
      .eos-user-button { display: flex; align-items: center; gap: 8px; border: 1px solid ${T.border}; background: ${T.surfaceHi}; color: ${T.text}; border-radius: 999px; padding: 5px 10px 5px 5px; }
      .eos-user-button span { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: ${T.cyanDim}; color: ${T.cyan}; }
      .eos-user-summary { display: flex; flex-direction: column; gap: 4px; padding-bottom: 10px; margin-bottom: 8px; border-bottom: 1px solid ${T.border}; }
      .eos-user-summary span { color: ${T.textMute}; font-size: 10px; }
      .eos-user-menu button { width: 100%; display: flex; align-items: center; gap: 8px; background: transparent; border: 0; color: ${T.textSub}; padding: 9px; border-radius: 10px; text-align: left; }
      .eos-user-menu button:hover { background: ${T.surfaceHi}; color: ${T.text}; }
      .eos-user-menu button.danger { color: ${T.red}; }
      .eos-page-stack { display: flex; flex-direction: column; gap: 14px; }
      .eos-kpi-grid, .eos-responsive-grid { display: grid; gap: 12px; }
      .eos-kpi-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .eos-responsive-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .eos-responsive-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .eos-status-list, .eos-command-list { display: flex; flex-direction: column; gap: 8px; }
      .eos-table { width: 100%; border-collapse: collapse; min-width: 680px; font-size: 11px; }
      .eos-table th { color: ${T.textMute}; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 10px; border-bottom: 1px solid ${T.border}; }
      .eos-table td { color: ${T.textSub}; padding: 8px 10px; border-bottom: 1px solid ${T.border}; vertical-align: top; }
      .eos-filter-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .eos-filter-bar button, .eos-soft-button, .eos-primary-button, .eos-danger-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 10px; padding: 9px 12px; border: 1px solid ${T.border}; background: ${T.surfaceHi}; color: ${T.textSub}; font-size: 12px; font-weight: 850; transition: all 0.18s ease; }
      .eos-filter-bar button.is-active, .eos-primary-button { background: ${T.cyanDim}; color: ${T.cyan}; border-color: ${T.cyan}66; }
      .eos-danger-button { background: ${T.redDim}; color: ${T.red}; border-color: ${T.red}66; }
      .eos-warning-strip { padding: 12px 14px; border-radius: 14px; border: 1px solid ${T.yellow}55; background: ${T.yellowDim}; color: ${T.yellow}; font-weight: 850; }
      .eos-floor-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .eos-floor-grid button { min-height: 48px; border-radius: 12px; border: 1px solid ${T.border}; background: ${T.surfaceHi}; color: ${T.textSub}; font-weight: 950; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
      .eos-floor-grid button.is-active { border-color: ${T.blue}; color: ${T.blue}; background: ${T.blueDim}; }
      .eos-floor-grid button.is-target { border-color: ${T.cyan}; color: ${T.cyan}; }
      .eos-command-feedback, .eos-body-copy { color: ${T.textSub}; font-size: 12px; line-height: 1.6; margin-top: 12px; }
      .eos-diagnostic-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
      .eos-scenario-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
      .eos-scenario-grid button { display: flex; flex-direction: column; gap: 7px; min-height: 96px; text-align: left; border-radius: 12px; border: 1px solid; padding: 12px; }
      .eos-scenario-grid span { color: ${T.textMute}; font-size: 11px; line-height: 1.4; }
      .eos-alert-grid, .eos-device-grid, .eos-settings-grid { display: grid; gap: 12px; }
      .eos-alert-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .eos-alert-card { border: 1px solid; border-radius: 16px; padding: 14px; box-shadow: 0 16px 34px rgba(0,0,0,0.18); }
      .eos-alert-card h3 { margin: 12px 0 6px; color: ${T.text}; font-size: 15px; }
      .eos-alert-card p { color: ${T.textSub}; margin: 0; line-height: 1.5; }
      .eos-card-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; justify-content: flex-end; }
      .eos-card-actions button { border: 1px solid ${T.border}; background: ${T.surfaceHi}; color: ${T.textSub}; border-radius: 10px; padding: 8px 10px; font-weight: 800; }
      .eos-device-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .eos-device-card { display: flex; gap: 14px; align-items: flex-start; }
      .eos-device-card p, .eos-report-card p { color: ${T.textSub}; line-height: 1.55; margin: 10px 0 0; }
      .eos-report-card { display: flex; flex-direction: column; gap: 8px; }
      .eos-report-card strong { color: ${T.text}; }
      .eos-settings-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
      .eos-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; color: ${T.textSub}; }
      .eos-toggle-row strong { display: block; font-size: 12px; }
      .eos-toggle-row small { display: block; color: ${T.textMute}; margin-top: 3px; }
      .eos-toggle { width: 48px; height: 26px; border-radius: 999px; border: 1px solid ${T.borderHi}; background: ${T.surfaceHi}; padding: 3px; flex-shrink: 0; }
      .eos-toggle span { display: block; width: 18px; height: 18px; border-radius: 999px; background: ${T.textMute}; transition: transform 0.2s ease; }
      .eos-toggle[data-on="true"] { border-color: ${T.cyan}; background: ${T.cyanDim}; }
      .eos-toggle[data-on="true"] span { background: ${T.cyan}; transform: translateX(20px); }
      .eos-profile-block { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
      .eos-profile-avatar { width: 62px; height: 62px; border-radius: 18px; background: ${T.cyanDim}; color: ${T.cyan}; border: 1px solid ${T.borderHi}; display: flex; align-items: center; justify-content: center; }
      .eos-profile-block strong { display: block; color: ${T.text}; font-size: 16px; }
      .eos-profile-block span { display: block; color: ${T.textMute}; margin: 3px 0 8px; }
      .eos-field-label { display: flex; flex-direction: column; gap: 6px; color: ${T.textMute}; font-size: 11px; font-weight: 850; margin-top: 10px; }
      .eos-password-grid { display: grid; gap: 8px; margin-top: 10px; }
      .eos-help-hero { display: flex; gap: 16px; align-items: flex-start; }
      .eos-help-hero h2 { margin: 0 0 8px; color: ${T.text}; font-size: 20px; }
      .eos-help-hero p { margin: 0; color: ${T.textSub}; line-height: 1.65; }
      .eos-login-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; color: ${T.text}; background: radial-gradient(circle at 20% 10%, ${T.cyanDim}, transparent 32%), linear-gradient(135deg, ${T.bg}, ${T.bg2 || T.bg}); }
      .eos-login-card { width: min(440px, 100%); background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 22px; padding: 26px; box-shadow: 0 28px 80px rgba(0,0,0,0.35); display: flex; flex-direction: column; gap: 14px; }
      .eos-login-brand { display: flex; gap: 14px; align-items: center; margin-bottom: 8px; }
      .eos-login-brand h1 { margin: 0; color: ${T.text}; font-size: 24px; }
      .eos-login-brand p, .eos-login-note { margin: 3px 0 0; color: ${T.textMute}; font-size: 12px; line-height: 1.5; }
      .eos-login-card label { color: ${T.textSub}; font-size: 12px; font-weight: 850; display: flex; flex-direction: column; gap: 6px; }
      .eos-password-field { display: flex; align-items: center; background: ${T.surfaceHi}; border: 1px solid ${T.border}; border-radius: 10px; }
      .eos-password-field input { border: 0; background: transparent; }
      .eos-password-field button { border: 0; background: transparent; color: ${T.textMute}; padding: 8px; }
      .eos-login-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .eos-checkbox { flex-direction: row !important; align-items: center; }
      .eos-checkbox input { width: auto; }
      .eos-link-button { border: 0; background: transparent; color: ${T.cyan}; padding: 0; }
      .eos-inline-error { padding: 10px 12px; border-radius: 12px; background: ${T.redDim}; border: 1px solid ${T.red}55; color: ${T.red}; font-size: 12px; line-height: 1.45; }
      .eos-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.58); z-index: 120; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .eos-modal { width: min(440px, 100%); background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 18px; padding: 18px; box-shadow: 0 28px 80px rgba(0,0,0,0.45); }
      .eos-modal-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .eos-modal h2 { color: ${T.text}; margin: 0; font-size: 17px; }
      .eos-modal p { color: ${T.textSub}; margin: 8px 0 0; line-height: 1.6; }
      @media (max-width: 1200px) { .eos-responsive-grid.three, .eos-responsive-grid.four, .eos-settings-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .eos-topbar { flex-wrap: wrap; } .eos-search { order: 3; flex-basis: 100%; max-width: none; } }
      @media (max-width: 900px) { .eos-sidebar { position: fixed; inset: 0 auto 0 0; transform: translateX(-105%); width: min(310px, 86vw); } .eos-sidebar.is-open { transform: translateX(0); } .eos-sidebar.is-collapsed { width: min(310px, 86vw); } .eos-sidebar.is-collapsed .eos-nav-item { justify-content: flex-start; flex-direction: row; } .eos-sidebar.is-collapsed .eos-nav-short { display: none; } .eos-sidebar-close { display: inline-flex; } .eos-mobile-scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.5); border: 0; z-index: 45; } .eos-main { padding: 12px; } .eos-user-button strong, .eos-clock { display: none; } }
      @media (max-width: 700px) { .eos-responsive-grid.three, .eos-responsive-grid.four, .eos-settings-grid { grid-template-columns: 1fr; } .eos-topbar-right { flex-wrap: wrap; justify-content: flex-end; } .eos-page-title { min-width: 0; } .eos-page-title p { max-width: 190px; } .eos-alert-grid { grid-template-columns: 1fr; } .eos-help-hero { flex-direction: column; } }
    `}</style>
  );
}

function AuthenticatedElevatorApp({ session, preferences, updatePreferences, profile, updateProfile, onLogout }) {
  applyThemeTokens(preferences.theme);
  const engine = useDigitalTwinEngine();
  const [page, setPage] = useState(PAGE_MAP[preferences.defaultView] ? preferences.defaultView : "twin");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  useEffect(() => {
    if (!PAGE_MAP[page]) setPage("twin");
  }, [page]);

  const requestLogout = useCallback(() => setLogoutConfirmOpen(true), []);
  const setSidebarCollapsed = useCallback((value) => updatePreferences({ sidebarCollapsed: value }), [updatePreferences]);
  const ctx = useMemo(() => ({ ...engine, preferences, updatePreferences, profile, updateProfile, requestLogout, session }), [engine, preferences, updatePreferences, profile, updateProfile, requestLogout, session]);
  const PageComponent = PAGE_MAP[page] || PageTwin;

  return (
    <TwinContext.Provider value={ctx}>
      <div className={`eos-app ${preferences.compactMode || preferences.density === "compact" ? "eos-compact" : ""}`}>
        <GlobalAlertBanner state={engine.state} />
        <div className="eos-layout">
          <AppSidebar page={page} setPage={setPage} collapsed={preferences.sidebarCollapsed} setCollapsed={setSidebarCollapsed} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} state={engine.state} connected={engine.connected} />
          <div className="eos-content">
            <AppTopbar
              page={page}
              setPage={setPage}
              state={engine.state}
              connected={engine.connected}
              dittoConnected={engine.dittoConnected}
              dittoMode={engine.dittoMode}
              openMobileNav={() => setMobileNavOpen(true)}
              preferences={preferences}
              updatePreferences={updatePreferences}
              profile={profile}
              onLogoutRequest={requestLogout}
            />
            <main className="eos-main"><PageComponent /></main>
          </div>
        </div>
        <ToastStack toasts={engine.toasts} dismiss={engine.dismissToast} />
        <ConfirmModal open={logoutConfirmOpen} title="End operator session?" detail="This clears the local frontend session and returns to the secure login screen. Ditto and backend services are not modified." confirmLabel="Logout" danger onCancel={() => setLogoutConfirmOpen(false)} onConfirm={() => { setLogoutConfirmOpen(false); onLogout(); }} />
        <GlobalStyles />
      </div>
    </TwinContext.Provider>
  );
}

export default function ElevatorOS() {
  const [preferences, updatePreferences] = useStoredObject("eos-preferences", DEFAULT_PREFERENCES);
  const [profile, updateProfile] = useStoredObject("eos-profile", DEFAULT_PROFILE);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  applyThemeTokens(preferences.theme);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("eos-session") || window.sessionStorage.getItem("eos-session");
      setSession(stored ? JSON.parse(stored) : null);
    } catch {
      setSession(null);
    } finally {
      setAuthReady(true);
    }
  }, []);

  const handleLogin = useCallback(({ identifier, remember }) => {
    const nextSession = { identifier, role: profile.role, startedAt: new Date().toISOString() };
    setSession(nextSession);
    updateProfile({
      ...profile,
      username: identifier.includes("@") ? identifier.split("@")[0] : identifier,
      email: identifier.includes("@") ? identifier : profile.email,
      lastLogin: new Date().toLocaleString("en-GB", { hour12: false }),
    });
    try {
      const target = remember ? window.localStorage : window.sessionStorage;
      target.setItem("eos-session", JSON.stringify(nextSession));
      if (remember) window.sessionStorage.removeItem("eos-session");
      else window.localStorage.removeItem("eos-session");
    } catch {}
  }, [profile, updateProfile]);

  const handleLogout = useCallback(() => {
    try {
      window.localStorage.removeItem("eos-session");
      window.sessionStorage.removeItem("eos-session");
    } catch {}
    setSession(null);
  }, []);

  if (!authReady) {
    return (
      <div className="eos-login-shell">
        <div className="eos-login-card"><EmptyState title="Preparing secure session" detail="Checking local operator session." /></div>
        <GlobalStyles />
      </div>
    );
  }

  if (!session) {
    return <><LoginPage onLogin={handleLogin} /><GlobalStyles /></>;
  }

  return <AuthenticatedElevatorApp session={session} preferences={preferences} updatePreferences={updatePreferences} profile={profile} updateProfile={updateProfile} onLogout={handleLogout} />;
}
