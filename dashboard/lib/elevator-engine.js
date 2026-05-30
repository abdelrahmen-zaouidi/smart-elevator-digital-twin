/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ELEVATOR DIGITAL TWIN OS — SCADA COMMAND CENTER PLATFORM   ║
 * ║  Version 2.0 — Agentic AI Smart Elevator System             ║
 * ║  Architecture: Multi-page React, Event-driven, AI Analytics ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════════
const NUM_FLOORS = 4;
const FLOOR_LABELS = ["0", "1", "2", "3"];
const FLOOR_H = 80;
const MAX_LOAD = 800;
const MOTOR_DESIGN_LIFE = 10000;

const PAGES = [
  { id: "command",     label: "Command Center",   icon: "◈" },
  { id: "twin",        label: "Digital Twin",      icon: "⬡" },
  { id: "analytics",   label: "AI Analytics",      icon: "◎" },
  { id: "soc",         label: "Security Ops",      icon: "⊗" },
  { id: "maintenance", label: "Maintenance",        icon: "⚙" },
  { id: "simulation",  label: "Simulation Lab",    icon: "⚡" },
];

const SCENARIOS = {
  motor_failure: {
    label: "Motor Failure Cascade",
    color: "#ef4444",
    fn: (s) => ({
      ...s,
      features: { ...s.features,
        motor: { properties: { ...s.features.motor.properties, vibration_level: 0.72, temperature_c: 91, health_status: "CRITICAL" }},
        cabin: { properties: { ...s.features.cabin.properties, emergency_stop: true, speed_ms: 0, direction: "IDLE" }}
      },
      attributes: { ...s.attributes, system_mode: "MAINTENANCE", risk_score: 94 }
    }),
    incident: ["MOTOR_FAILURE", "Cascading motor failure — vibration 0.72g, thermal runaway 91°C"]
  },
  overload: {
    label: "Passenger Overload",
    color: "#f59e0b",
    fn: (s) => ({
      ...s,
      features: { ...s.features,
        cabin: { properties: { ...s.features.cabin.properties, load_kg: 920, emergency_stop: true, speed_ms: 0 }}
      },
      attributes: { ...s.attributes, risk_score: 88 }
    }),
    incident: ["OVERLOAD", "Cabin overloaded: 920kg — 115% of rated capacity 800kg"]
  },
  security_breach: {
    label: "Security Breach",
    color: "#ef4444",
    fn: (s) => ({
      ...s,
      features: { ...s.features,
        door: { properties: { state: "BLOCKED", door_forced_entry: true }},
        security: { properties: { ...s.features.security.properties, audio_distress_active: true, alert_level: "CRITICAL", unauthorized_access_attempts: s.features.security.properties.unauthorized_access_attempts + 3 }}
      },
      attributes: { ...s.attributes, system_mode: "LOCKDOWN", risk_score: 96 }
    }),
    incident: ["FORCED_ENTRY", "Simultaneous forced entry + audio distress — LOCKDOWN initiated"]
  },
  fire_emergency: {
    label: "Fire Emergency",
    color: "#dc2626",
    fn: (s) => ({
      ...s,
      features: { ...s.features,
        cabin: { properties: { ...s.features.cabin.properties, temperature_c: 42, target_floor: 0, emergency_stop: false }},
        security: { properties: { ...s.features.security.properties, alert_level: "CRITICAL" }}
      },
      attributes: { ...s.attributes, system_mode: "LOCKDOWN", risk_score: 99 }
    }),
    incident: ["FIRE_EMERGENCY", "Fire alarm triggered — auto-recall to ground floor G initiated"]
  },
  peak_traffic: {
    label: "Peak Hour Traffic",
    color: "#3b82f6",
    fn: (s) => ({
      ...s,
      features: { ...s.features,
        cabin: { properties: { ...s.features.cabin.properties, load_kg: 680, speed_ms: 1.8, direction: "UP" }}
      },
      attributes: { ...s.attributes, risk_score: 28 }
    }),
    incident: ["PEAK_TRAFFIC", "Peak hour mode: elevated load 680kg, continuous service active"]
  }
};

const AI_INSIGHTS = [
  { id: 1, severity: "WARNING",  msg: "Motor vibration trending +18% over last 4h — bearing fatigue likely", eta: "~12h" },
  { id: 2, severity: "INFO",     msg: "Load patterns suggest peak demand floor 3 between 08:00–09:30", eta: null },
  { id: 3, severity: "INFO", msg: "No active maintenance alert after fresh-start reset", eta: null },
  { id: 4, severity: "INFO",     msg: "Energy consumption 7.2% below baseline — routing optimization active", eta: null },
  { id: 5, severity: "WARNING",  msg: "3 unauthorized RFID attempts detected in last 6h — pattern anomaly", eta: "Monitor" },
];

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE (EXTENDED DITTO SCHEMA)
// ═══════════════════════════════════════════════════════════════
const INIT_STATE = {
  attributes: {
    location: "Building A — Shaft 1",
    system_mode: "NORMAL",
    risk_score: 0,
    maintenance_priority: "LOW",
    system_health_index: 100,
    energy_efficiency: 100,
    uptime_pct: 100,
  },
  features: {
    cabin: { properties: { current_floor: 0, target_floor: 0, direction: "IDLE", load_kg: 0, temperature_c: 0, speed_ms: 0, emergency_stop: false, trips_today: 0, passengers_today: 0 }},
    door: { properties: { state: "OPEN", door_forced_entry: false, cycle_count: 0, obstruction_events: 0 }},
    motor: { properties: { vibration_level: 0, hours_operated: 0, health_status: "GOOD", temperature_c: 0, current_draw_a: 0, power_kw: 0 }},
    security: { properties: { audio_distress_active: false, unauthorized_access_attempts: 0, rfid_last_card: "", rfid_access_granted: true, alert_level: "NORMAL", access_log: [] }},
    microcontroller: { properties: { board: "ESP32-S3", connected: false, status: "OFFLINE", source: "mqtt_status", transport: "MQTT", mqtt_id: "building-floor1-elevator", mqtt_topic: "elevator/building-floor1-elevator/status", telemetry_topic: "elevator/building-floor1-elevator/telemetry", last_seen_at: null, last_telemetry_at: null, last_status_at: null, last_disconnected_at: null }},
    incident_log: { properties: { entries: [], open_incidents: 0 }},
    energy: { properties: { kwh_today: 0, kwh_month: 0, kwh_baseline: 0, co2_kg: 0, peak_kw: 0, regen_kwh: 0 }},
    performance: { properties: { avg_wait_s: 0, avg_trip_s: 0, availability_pct: 100, response_time_ms: 0, door_cycle_efficiency: 100 }},
    predicted_failures: { properties: { motor_rul_hours: 10000, bearing_health_pct: 100, door_mechanism_pct: 100, rope_tension_pct: 100, next_service_date: "" }},
  }
};



// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function addIncident(state, type, description) {
  const entries = [
    { incident_id: `INC-${String(Date.now()).slice(-5)}`, ts: new Date().toISOString(), type, description, resolved: false },
    ...(state.features.incident_log.properties.entries || [])
  ].slice(0, 50);
  return { ...state, features: { ...state.features, incident_log: { properties: { entries, open_incidents: entries.filter(e => !e.resolved).length }}}};
}

const riskColor = s => s >= 76 ? "#ef4444" : s >= 41 ? "#f59e0b" : "#22c55e";
const riskLabel = s => s >= 76 ? "CRITICAL" : s >= 41 ? "WARNING" : "NOMINAL";
const healthColor = h => h >= 80 ? "#22c55e" : h >= 50 ? "#f59e0b" : "#ef4444";
const fmtTs = ts => { try { return new Date(ts).toLocaleTimeString("en-GB", { hour12: false }); } catch { return ts; }};
const fmtDate = ts => { try { return new Date(ts).toLocaleDateString("en-GB"); } catch { return ts; }};

// ═══════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════
const TwinContext = createContext(null);
const useTwin = () => useContext(TwinContext);

// ═══════════════════════════════════════════════════════════════
// MASTER HOOK: useDigitalTwin
// ═══════════════════════════════════════════════════════════════
function useDigitalTwinEngine() {
  const [state, setState] = useState(INIT_STATE);
  const [vibHistory, setVibHistory] = useState(() => Array.from({ length: 60 }, (_, i) => ({ t: i, v: +(0.02 + Math.random() * 0.012).toFixed(4) })));
  const [tempHistory, setTempHistory] = useState(() => Array.from({ length: 60 }, (_, i) => ({ t: i, v: +(44 + Math.random() * 2).toFixed(1) })));
  const [loadHistory, setLoadHistory] = useState(() => Array.from({ length: 60 }, (_, i) => ({ t: i, v: Math.round(Math.random() * 300 + 100) })));
  const [energyHistory, setEnergyHistory] = useState(() => Array.from({ length: 24 }, (_, i) => ({ h: `${i}:00`, kwh: +(Math.random() * 2 + 0.5).toFixed(2) })));
  const [commandLog, setCommandLog] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [eventLog, setEventLog] = useState([]);
  const [connected, setConnected] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [prevStateDiff, setPrevStateDiff] = useState(null);
  const tick = useRef(0);
  const sRef = useRef(state);
  sRef.current = state;

  // Log helper
  const logCommand = useCallback((cmd, result = "OK", detail = "") => {
    setCommandLog(l => [{ id: Date.now(), ts: new Date().toISOString(), cmd, result, detail }, ...l].slice(0, 100));
  }, []);

  const pushAlert = useCallback((severity, message) => {
    const id = Date.now();
    setAlerts(a => [{ id, severity, message, ts: new Date().toISOString(), dismissed: false }, ...a].slice(0, 20));
    if (severity === "CRITICAL") setTimeout(() => {}, 0); // future: escalation hook
  }, []);

  const logEvent = useCallback((type, payload = {}) => {
    setEventLog(l => [{ id: Date.now(), ts: new Date().toISOString(), type, payload }, ...l].slice(0, 200));
  }, []);

  // Live telemetry engine
  useEffect(() => {
    setConnected(true);
    const iv = setInterval(() => {
      tick.current++;
      const t = tick.current;
      const s = sRef.current;
      const c = s.features.cabin.properties;
      const m = s.features.motor.properties;

      // Physics
      let nFloor = c.current_floor, nDir = c.direction, nSpd = c.speed_ms, nTgt = c.target_floor;
      if (c.current_floor !== c.target_floor && !c.emergency_stop) {
        nDir = c.target_floor > c.current_floor ? "UP" : "DOWN";
        nSpd = 1.6;
        if (t % 3 === 0) nFloor = c.target_floor > c.current_floor ? Math.min(c.current_floor + 1, c.target_floor) : Math.max(c.current_floor - 1, c.target_floor);
      } else {
        nDir = "IDLE"; nSpd = 0;
        if (t % 18 === 0 && !c.emergency_stop) nTgt = Math.floor(Math.random() * NUM_FLOORS);
      }

      const nMT = parseFloat(Math.min(95, Math.max(25, m.temperature_c + (nSpd > 0 ? 0.28 : -0.12) + (Math.random() - 0.5) * 0.15)).toFixed(1));
      const nVib = parseFloat(Math.max(0, (nSpd > 0 ? 0.038 : 0.009) + (Math.random() - 0.5) * 0.008).toFixed(4));
      const nLoad = parseFloat(Math.max(0, c.load_kg + (Math.random() - 0.5) * 6).toFixed(1));
      const nCT = parseFloat((22 + (nMT - 25) * 0.04 + (Math.random() - 0.5) * 0.15).toFixed(1));
      const nDraw = parseFloat((nSpd > 0 ? 4.5 + (nLoad / MAX_LOAD) * 2.5 : 0.8).toFixed(1));
      const nRisk = Math.min(100, Math.max(0, s.attributes.risk_score + (Math.random() - 0.5) * 1.5));

      // Timeline snapshot every 10 ticks
      if (t % 10 === 0) {
        setTimeline(tl => [...tl, { tick: t, ts: new Date().toISOString(), floor: nFloor, risk: nRisk.toFixed(1), vib: nVib, temp: nMT }].slice(-200));
      }

      setState(prev => {
        const next = {
          ...prev,
          attributes: { ...prev.attributes, risk_score: +nRisk.toFixed(1) },
          features: {
            ...prev.features,
            cabin: { properties: { ...prev.features.cabin.properties, current_floor: nFloor, target_floor: nTgt, direction: nDir, speed_ms: nSpd, load_kg: nLoad, temperature_c: nCT, trips_today: prev.features.cabin.properties.trips_today + (nFloor !== prev.features.cabin.properties.current_floor ? 0.1 : 0) }},
            motor: { properties: { ...prev.features.motor.properties, vibration_level: nVib, temperature_c: nMT, health_status: nMT > 85 ? "CRITICAL" : nMT > 70 ? "WARNING" : "GOOD", hours_operated: +(prev.features.motor.properties.hours_operated + 0.001).toFixed(3), current_draw_a: nDraw, power_kw: +(nDraw * 0.4).toFixed(2) }},
            energy: { properties: { ...prev.features.energy.properties, kwh_today: +(prev.features.energy.properties.kwh_today + 0.0002).toFixed(3) }},
          }
        };
        setPrevStateDiff({ vibration: (nVib - prev.features.motor.properties.vibration_level).toFixed(4), temperature: (nMT - prev.features.motor.properties.temperature_c).toFixed(1), load: (nLoad - prev.features.cabin.properties.load_kg).toFixed(0), floor: nFloor !== prev.features.cabin.properties.current_floor });
        return next;
      });

      setVibHistory(h => [...h.slice(-59), { t, v: nVib }]);
      setTempHistory(h => [...h.slice(-59), { t, v: nMT }]);
      setLoadHistory(h => [...h.slice(-59), { t, v: Math.round(nLoad) }]);
      logEvent("TELEMETRY_UPDATE", { floor: nFloor, vib: nVib, temp: nMT });

    }, 2000);
    return () => clearInterval(iv);
  }, [logEvent]);

  // ── COMMANDS ──
  const cmd = {
    emergencyStop: useCallback(() => {
      setState(prev => addIncident({ ...prev, attributes: { ...prev.attributes, system_mode: "MAINTENANCE", risk_score: 85 }, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, emergency_stop: true, speed_ms: 0, direction: "IDLE" }}}}, "EMERGENCY_STOP", "Emergency stop triggered from dashboard command center"));
      logCommand("EMERGENCY_STOP", "EXECUTED", "All motion halted");
      pushAlert("CRITICAL", "Emergency stop activated — elevator halted");
      logEvent("COMMAND_EXECUTED", { cmd: "EMERGENCY_STOP" });
    }, [logCommand, pushAlert, logEvent]),

    lockdown: useCallback(() => {
      setState(prev => addIncident({ ...prev, attributes: { ...prev.attributes, system_mode: "LOCKDOWN" }, features: { ...prev.features, door: { properties: { state: "CLOSED", door_forced_entry: false }}, security: { properties: { ...prev.features.security.properties, alert_level: "CRITICAL" }}}}, "LOCKDOWN", "System lockdown initiated from command center"));
      logCommand("LOCKDOWN", "EXECUTED", "All access restricted");
      pushAlert("CRITICAL", "System lockdown activated");
      logEvent("SYSTEM_MODE_CHANGED", { mode: "LOCKDOWN" });
    }, [logCommand, pushAlert, logEvent]),

    maintenance: useCallback(() => {
      setState(prev => ({ ...prev, attributes: { ...prev.attributes, system_mode: "MAINTENANCE" }, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, emergency_stop: true }}}}));
      logCommand("MAINTENANCE_MODE", "EXECUTED");
      pushAlert("WARNING", "Maintenance mode active — out of service");
      logEvent("SYSTEM_MODE_CHANGED", { mode: "MAINTENANCE" });
    }, [logCommand, pushAlert, logEvent]),

    reset: useCallback(() => {
      setState(prev => ({ ...prev, attributes: { ...prev.attributes, system_mode: "NORMAL", risk_score: 0 }, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, emergency_stop: false }}, door: { properties: { state: "OPEN", door_forced_entry: false }}, security: { properties: { ...prev.features.security.properties, audio_distress_active: false, rfid_access_granted: true, alert_level: "NORMAL" }}}}));
      logCommand("RESET_NORMAL", "EXECUTED");
      pushAlert("INFO", "System reset to NORMAL operation");
      logEvent("SYSTEM_MODE_CHANGED", { mode: "NORMAL" });
    }, [logCommand, pushAlert, logEvent]),

    sendFloor: useCallback((f) => {
      setState(prev => ({ ...prev, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, target_floor: f }}}}));
      logCommand("SEND_TO_FLOOR", "EXECUTED", `Target: floor ${FLOOR_LABELS[f]}`);
      logEvent("COMMAND_EXECUTED", { cmd: "SEND_TO_FLOOR", floor: f });
    }, [logCommand, logEvent]),

    optimizeRouting: useCallback(() => {
      logCommand("OPTIMIZE_ROUTING", "EXECUTED", "SCAN algorithm engaged");
      pushAlert("INFO", "Routing optimization engaged — estimated wait reduction 23%");
    }, [logCommand, pushAlert]),

    reduceEnergy: useCallback(() => {
      logCommand("REDUCE_ENERGY", "EXECUTED", "Low-power idle mode activated");
      pushAlert("INFO", "Energy reduction mode: off-peak parking at G");
    }, [logCommand, pushAlert]),

    // Injectors
    injectHighVib: useCallback(() => {
      setState(prev => addIncident({ ...prev, features: { ...prev.features, motor: { properties: { ...prev.features.motor.properties, vibration_level: 0.41, health_status: "CRITICAL" }}}, attributes: { ...prev.attributes, risk_score: Math.min(100, prev.attributes.risk_score + 42) }}, "VIBRATION_SPIKE", "Injected: bearing fault — vibration spike 0.41g"));
      setVibHistory(h => [...h.slice(-59), { t: tick.current + 1, v: 0.41 }]);
      logCommand("INJECT_HIGH_VIB", "INJECTED");
      pushAlert("WARNING", "Anomaly injected: motor vibration spike 0.41g");
    }, [logCommand, pushAlert]),

    injectForcedEntry: useCallback(() => {
      setState(prev => addIncident({ ...prev, attributes: { ...prev.attributes, system_mode: "LOCKDOWN", risk_score: 95 }, features: { ...prev.features, door: { properties: { state: "BLOCKED", door_forced_entry: true }}, security: { properties: { ...prev.features.security.properties, alert_level: "CRITICAL" }}}}, "FORCED_ENTRY", "Injected: door reed switch tripped — forced entry detected"));
      logCommand("INJECT_FORCED_ENTRY", "INJECTED");
      pushAlert("CRITICAL", "Anomaly injected: forced door entry — LOCKDOWN");
    }, [logCommand, pushAlert]),

    injectAudioDistress: useCallback(() => {
      setState(prev => addIncident({ ...prev, attributes: { ...prev.attributes, system_mode: "LOCKDOWN", risk_score: 93 }, features: { ...prev.features, security: { properties: { ...prev.features.security.properties, audio_distress_active: true, alert_level: "CRITICAL" }}}}, "DISTRESS_AUDIO", "Injected: MEMS mic detected passenger distress signal"));
      logCommand("INJECT_AUDIO_DISTRESS", "INJECTED");
      pushAlert("CRITICAL", "Anomaly injected: passenger distress detected");
    }, [logCommand, pushAlert]),

    injectInvalidRFID: useCallback(() => {
      const card = `UNKNOWN_${Math.floor(Math.random() * 9000) + 1000}`;
      setState(prev => addIncident({ ...prev, features: { ...prev.features, security: { properties: { ...prev.features.security.properties, rfid_last_card: card, rfid_access_granted: false, unauthorized_access_attempts: prev.features.security.properties.unauthorized_access_attempts + 1, alert_level: "HIGH" }}}, attributes: { ...prev.attributes, risk_score: Math.min(100, prev.attributes.risk_score + 18) }}, "UNAUTHORIZED_RFID", `Injected: card ${card} denied — not in whitelist`));
      logCommand("INJECT_INVALID_RFID", "INJECTED", card);
      pushAlert("WARNING", `Anomaly injected: unauthorized RFID ${card}`);
    }, [logCommand, pushAlert]),

    runScenario: useCallback((key) => {
      const sc = SCENARIOS[key];
      if (!sc) return;
      setState(prev => addIncident(sc.fn(prev), sc.incident[0], sc.incident[1]));
      logCommand(`SCENARIO_${key.toUpperCase()}`, "INJECTED", sc.label);
      pushAlert(sc.color === "#ef4444" || sc.color === "#dc2626" ? "CRITICAL" : "WARNING", `Scenario active: ${sc.label}`);
      logEvent("ANOMALY_DETECTED", { scenario: key });
    }, [logCommand, pushAlert, logEvent]),

    setVibration: useCallback((v) => {
      setState(prev => ({ ...prev, features: { ...prev.features, motor: { properties: { ...prev.features.motor.properties, vibration_level: v }}}}));
      setVibHistory(h => [...h.slice(-59), { t: tick.current + 1, v }]);
    }, []),

    setLoad: useCallback((kg) => {
      setState(prev => ({ ...prev, features: { ...prev.features, cabin: { properties: { ...prev.features.cabin.properties, load_kg: kg }}}}));
    }, []),

    setMotorTemp: useCallback((t) => {
      setState(prev => ({ ...prev, features: { ...prev.features, motor: { properties: { ...prev.features.motor.properties, temperature_c: t }}}}));
      setTempHistory(h => [...h.slice(-59), { t: tick.current + 1, v: t }]);
    }, []),

    dismissAlert: useCallback((id) => {
      setAlerts(a => a.filter(x => x.id !== id));
    }, []),
  };

  return { state, vibHistory, tempHistory, loadHistory, energyHistory, commandLog, alerts, eventLog, timeline, prevStateDiff, connected, ...cmd };
}

// ═══════════════════════════════════════════════════════════════
// LAYOUT COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Panel({ title, children, accent, className = "" }) {
  return (
    <div className={`rounded-lg border flex flex-col ${className}`} style={{ background: "#050d1a", borderColor: accent ? accent + "44" : "#0f172a" }}>
      {title && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "#0f172a" }}>
          {accent && <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
          <span className="text-xs font-mono uppercase tracking-widest" style={{ color: accent || "#475569" }}>{title}</span>
        </div>
      )}
      <div className="flex-1 p-3">{children}</div>
    </div>
  );
}

function MetricCard({ label, value, unit, color, sub, trend }) {
  const trendColor = trend > 0 ? "#ef4444" : trend < 0 ? "#22c55e" : "#475569";
  return (
    <div className="rounded-lg p-3" style={{ background: "#0a1526", border: "1px solid #0f172a" }}>
      <div className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: "#334155" }}>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-mono font-bold" style={{ color: color || "#e2e8f0", transition: "color 0.4s" }}>{value}</span>
        {unit && <span className="text-xs font-mono" style={{ color: "#334155" }}>{unit}</span>}
        {trend !== undefined && <span className="text-xs ml-1" style={{ color: trendColor }}>{trend > 0 ? "↑" : trend < 0 ? "↓" : "—"}</span>}
      </div>
      {sub && <div className="text-xs font-mono mt-0.5" style={{ color: "#1e3a5f" }}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ mode }) {
  const cfg = {
    NORMAL: { c: "#22c55e", bg: "#14532d22", bd: "#22c55e44", ic: "◉" },
    MAINTENANCE: { c: "#f59e0b", bg: "#78350f22", bd: "#f59e0b44", ic: "⚙" },
    LOCKDOWN: { c: "#ef4444", bg: "#7f1d1d22", bd: "#ef444444", ic: "⊗" },
  };
  const { c, bg, bd, ic } = cfg[mode] || cfg.NORMAL;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded font-mono font-bold text-xs tracking-widest" style={{ color: c, background: bg, border: `1px solid ${bd}` }}>
      <span style={{ fontSize: 12 }}>{ic}</span>{mode}
    </div>
  );
}

function CmdButton({ label, onClick, variant = "def", icon, size = "sm" }) {
  const vs = {
    danger:  "background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5",
    warning: "background:#431407;border:1px solid #92400e;color:#fcd34d",
    info:    "background:#082f49;border:1px solid #075985;color:#7dd3fc",
    success: "background:#052e16;border:1px solid #14532d;color:#86efac",
    blue:    "background:#0f2040;border:1px solid #1d4ed8;color:#93c5fd",
    def:     "background:#0f172a;border:1px solid #1e293b;color:#94a3b8",
  };
  return (
    <button onClick={onClick} className="rounded w-full text-left flex items-center gap-2 font-mono font-bold tracking-wider transition-opacity"
      style={{ ...Object.fromEntries(vs[variant].split(";").map(s => s.split(":"))), padding: size === "lg" ? "10px 14px" : "7px 10px", fontSize: size === "lg" ? 12 : 11, cursor: "pointer" }}
      onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
    >
      {icon && <span style={{ fontSize: 13 }}>{icon}</span>}{label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// DIGITAL TWIN SHAFT
// ═══════════════════════════════════════════════════════════════
function ElevatorShaft({ state, compact = false }) {
  const c = state.features.cabin.properties;
  const door = state.features.door.properties;
  const fIdx = Math.max(0, Math.min(NUM_FLOORS - 1, c.current_floor));
  const shaftH = NUM_FLOORS * FLOOR_H;
  const cabinY = shaftH - (fIdx + 1) * FLOOR_H + 3;
  const doorOpen = door.state === "OPEN" || door.state === "OPENING";
  const isE = c.emergency_stop;
  const loadPct = Math.min(1, c.load_kg / MAX_LOAD);
  const loadCol = loadPct > 0.95 ? "#ef4444" : loadPct > 0.7 ? "#f59e0b" : "#22c55e";
  const W = compact ? 120 : 160;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={W + 48} height={shaftH + 12} viewBox={`0 0 ${W + 48} ${shaftH + 12}`}>
        {Array.from({ length: NUM_FLOORS }, (_, i) => {
          const y = shaftH - (i + 1) * FLOOR_H;
          return (
            <g key={i}>
              <line x1="36" y1={y + FLOOR_H} x2={W + 36} y2={y + FLOOR_H} stroke="#0f172a" strokeWidth="1" />
              <text x="28" y={y + FLOOR_H - 4} textAnchor="end" fill="#1e3a5f" fontSize="10" fontFamily="monospace">{FLOOR_LABELS[i]}</text>
              {c.target_floor === i && c.current_floor !== i && (
                <circle cx={W + 44} cy={y + FLOOR_H / 2} r="3.5" fill="#3b82f6" opacity="0.9">
                  <animate attributeName="opacity" values="0.9;0.2;0.9" dur="1.2s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
        <rect x="36" y="0" width={W} height={shaftH} fill="#040c18" stroke="#0a1526" strokeWidth="2" rx="3" />
        <line x1="44" y1="0" x2="44" y2={shaftH} stroke="#070e18" strokeWidth="2" />
        <line x1={W + 28} y1="0" x2={W + 28} y2={shaftH} stroke="#070e18" strokeWidth="2" />
        <g style={{ transform: `translateY(${cabinY}px)`, transition: "transform 0.9s cubic-bezier(0.4,0,0.2,1)" }}>
          <rect x="39" y="2" width={W - 6} height={FLOOR_H - 6} fill={isE ? "#3b0000" : "#0a1e40"} stroke={isE ? "#ef4444" : "#1d4ed8"} strokeWidth="2" rx="3" />
          {!doorOpen && <>
            <rect x="39" y="2" width={(W - 6) / 2} height={FLOOR_H - 6} fill={isE ? "#3b0000" : "#0a1e40"} opacity="0.95" />
            <rect x={39 + (W - 6) / 2} y="2" width={(W - 6) / 2} height={FLOOR_H - 6} fill={isE ? "#3b0000" : "#0a1e40"} opacity="0.95" />
            <line x1={39 + (W - 6) / 2} y1="4" x2={39 + (W - 6) / 2} y2={FLOOR_H - 8} stroke={isE ? "#ef4444" : "#1d4ed8"} strokeWidth="1.5" />
          </>}
          <rect x="43" y={FLOOR_H - 13} width={W - 14} height="4" fill="#070e18" rx="2" />
          <rect x="43" y={FLOOR_H - 13} width={(W - 14) * loadPct} height="4" fill={loadCol} rx="2" style={{ transition: "width 0.5s ease, fill 0.4s ease" }} />
          <text x={39 + (W - 6) / 2} y={FLOOR_H / 2 - 3} textAnchor="middle" fill={isE ? "#fca5a5" : "#60a5fa"} fontSize={compact ? 18 : 22} fontFamily="monospace" fontWeight="700">{FLOOR_LABELS[fIdx]}</text>
          <text x={39 + (W - 6) / 2} y={FLOOR_H / 2 + 14} textAnchor="middle" fill={loadCol} fontSize="9" fontFamily="monospace">{Math.round(c.load_kg)}kg</text>
          {isE && <text x={39 + (W - 6) / 2} y={FLOOR_H - 20} textAnchor="middle" fill="#ef4444" fontSize="8" fontFamily="monospace">E-STOP</text>}
        </g>
        <text x={W + 38} y="14" fill="#1e3a5f" fontSize="9" fontFamily="monospace">{c.speed_ms.toFixed(1)}m/s</text>
      </svg>
      <div className="text-xs font-mono font-bold px-3 py-1 rounded tracking-widest" style={{ color: c.direction === "UP" ? "#22c55e" : c.direction === "DOWN" ? "#f59e0b" : "#334155", border: `1px solid ${c.direction === "UP" ? "#22c55e33" : c.direction === "DOWN" ? "#f59e0b33" : "#0f172a"}`, background: c.direction === "UP" ? "#14532d11" : c.direction === "DOWN" ? "#78350f11" : "#040c18" }}>
        {c.direction === "UP" ? "▲ UP" : c.direction === "DOWN" ? "▼ DOWN" : "— IDLE"}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RISK GAUGE
// ═══════════════════════════════════════════════════════════════
function RiskGauge({ score, size = 140 }) {
  const col = riskColor(score);
  const pct = Math.min(1, Math.max(0, score / 100));
  const r = size * 0.38;
  const circ = Math.PI * r;
  const dash = pct * circ;
  const cx = size / 2, cy = size * 0.58;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size * 0.68} viewBox={`0 0 ${size} ${size * 0.68}`}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#0f172a" strokeWidth={size * 0.08} strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={col} strokeWidth={size * 0.07} strokeLinecap="round" strokeDasharray={`${dash.toFixed(1)} ${circ}`} style={{ transition: "stroke-dasharray 0.7s ease, stroke 0.4s ease" }} />
        <text x={cx} y={cy - r * 0.25} textAnchor="middle" fill={col} fontSize={size * 0.18} fontWeight="700" fontFamily="monospace">{Math.round(score)}</text>
        <text x={cx} y={cy + 2} textAnchor="middle" fill="#334155" fontSize={size * 0.07} fontFamily="monospace">/ 100</text>
      </svg>
      <div className="text-xs font-mono font-bold px-3 py-1 rounded tracking-widest" style={{ color: col, border: `1px solid ${col}33`, background: `${col}11` }}>{riskLabel(score)}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LIVE CHART
// ═══════════════════════════════════════════════════════════════
function LiveChart({ data, color, yDomain, height = 70, unit = "" }) {
  const last = data[data.length - 1]?.v;
  const CustomTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontFamily: "monospace", color: "#94a3b8" }}>{payload[0]?.value?.toFixed(4)}{unit}</div>;
  };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color }}>{last?.toFixed(4)}{unit}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis domain={yDomain} hide />
          <CartesianGrid strokeDasharray="2 4" stroke="#070e18" />
          <Tooltip content={<CustomTip />} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#g${color})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE 1: COMMAND CENTER
// ═══════════════════════════════════════════════════════════════
function PageCommand() {
  const tw = useTwin();
  const { state, vibHistory, tempHistory, commandLog, alerts, cmd } = tw;
  const c = state.features.cabin.properties;
  const m = state.features.motor.properties;
  const sec = state.features.security.properties;
  const inc = state.features.incident_log.properties;
  const attr = state.attributes;
  const hCol = m.health_status === "GOOD" ? "#22c55e" : m.health_status === "WARNING" ? "#f59e0b" : "#ef4444";

  return (
    <div className="grid gap-3 h-full" style={{ gridTemplateColumns: "1fr 200px", gridTemplateRows: "auto 1fr 1fr" }}>
      {/* Top metrics */}
      <div className="grid gap-2 col-span-2" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        <MetricCard label="Floor" value={FLOOR_LABELS[c.current_floor]} sub={`→ ${FLOOR_LABELS[c.target_floor]}`} color="#93c5fd" />
        <MetricCard label="Speed" value={c.speed_ms.toFixed(1)} unit="m/s" color="#60a5fa" />
        <MetricCard label="Load" value={Math.round(c.load_kg)} unit="kg" color={c.load_kg > 760 ? "#ef4444" : c.load_kg > 640 ? "#f59e0b" : "#22c55e"} sub={`${Math.round(c.load_kg / MAX_LOAD * 100)}% cap`} />
        <MetricCard label="Risk Score" value={Math.round(attr.risk_score)} color={riskColor(attr.risk_score)} />
        <MetricCard label="Motor Temp" value={m.temperature_c.toFixed(1)} unit="°C" color={m.temperature_c > 85 ? "#ef4444" : m.temperature_c > 70 ? "#f59e0b" : "#64748b"} />
        <MetricCard label="Vibration" value={m.vibration_level.toFixed(3)} unit="g" color={m.vibration_level > 0.25 ? "#ef4444" : m.vibration_level > 0.12 ? "#f59e0b" : "#22c55e"} />
        <MetricCard label="System Health" value={Math.round(attr.system_health_index)} unit="%" color={healthColor(attr.system_health_index)} />
      </div>

      {/* Main content */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Telemetry */}
        <Panel title="Live Telemetry — Vibration" accent="#ef4444">
          <LiveChart data={vibHistory} color="#ef4444" yDomain={[0, 0.5]} unit="g" />
        </Panel>
        <Panel title="Live Telemetry — Temperature" accent="#f59e0b">
          <LiveChart data={tempHistory} color="#f59e0b" yDomain={[20, 100]} unit="°C" />
        </Panel>

        {/* Risk gauge + motor */}
        <Panel title="AI Risk Score" accent={riskColor(attr.risk_score)}>
          <div className="flex gap-4 items-center">
            <RiskGauge score={attr.risk_score} size={120} />
            <div className="flex flex-col gap-2 flex-1">
              {[["Health", m.health_status, hCol], ["Motor hrs", Math.round(m.hours_operated) + "h", m.hours_operated > 8000 ? "#ef4444" : "#64748b"], ["Power", m.power_kw.toFixed(1) + " kW", "#60a5fa"], ["Draw", m.current_draw_a.toFixed(1) + " A", "#94a3b8"]].map(([l, v, c]) => (
                <div key={l} className="flex justify-between text-xs font-mono">
                  <span style={{ color: "#334155" }}>{l}</span>
                  <span style={{ color: c, fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Incident log */}
        <Panel title={`Incidents ${inc.open_incidents > 0 ? `— ${inc.open_incidents} open` : ""}`} accent={inc.open_incidents > 0 ? "#ef4444" : "#334155"}>
          <div style={{ maxHeight: 120, overflowY: "auto" }}>
            {inc.entries.length === 0 ? <div className="text-xs font-mono py-3 text-center" style={{ color: "#1e3a5f" }}>No incidents</div> :
              inc.entries.slice(0, 8).map((e, i) => (
                <div key={i} className="flex gap-2 text-xs font-mono border-b py-1" style={{ borderColor: "#070e18" }}>
                  <span style={{ color: "#1e3a5f", flexShrink: 0 }}>{fmtTs(e.ts)}</span>
                  <span style={{ color: e.type.includes("ENTRY") || e.type.includes("DISTRESS") || e.type.includes("STOP") ? "#ef4444" : "#f59e0b", fontWeight: 700, flexShrink: 0 }}>{e.type}</span>
                  <span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</span>
                </div>
              ))}
          </div>
        </Panel>
      </div>

      {/* Command column */}
      <div className="flex flex-col gap-3">
        {/* Alert summary */}
        {alerts.filter(a => !a.dismissed).slice(0, 3).map(a => (
          <div key={a.id} className="rounded p-2 text-xs font-mono flex gap-2 items-start" style={{ background: a.severity === "CRITICAL" ? "#3b000033" : a.severity === "WARNING" ? "#43140733" : "#082f4933", border: `1px solid ${a.severity === "CRITICAL" ? "#7f1d1d" : a.severity === "WARNING" ? "#92400e" : "#075985"}`, color: a.severity === "CRITICAL" ? "#fca5a5" : a.severity === "WARNING" ? "#fcd34d" : "#7dd3fc" }}>
            <span>{a.message}</span>
            <button onClick={() => cmd.dismissAlert(a.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit", flexShrink: 0, fontSize: 14 }}>×</button>
          </div>
        ))}

        <Panel title="System Commands" accent="#3b82f6">
          <div className="flex flex-col gap-1.5">
            <CmdButton label="Emergency Stop" onClick={cmd.emergencyStop} variant="danger" icon="■" />
            <CmdButton label="Lockdown" onClick={cmd.lockdown} variant="danger" icon="⊗" />
            <CmdButton label="Maintenance Mode" onClick={cmd.maintenance} variant="warning" icon="⚙" />
            <CmdButton label="Reset to Normal" onClick={cmd.reset} variant="success" icon="↺" />
          </div>
        </Panel>

        <Panel title="Smart Automation" accent="#22c55e">
          <div className="flex flex-col gap-1.5">
            <CmdButton label="Optimize Routing" onClick={cmd.optimizeRouting} variant="blue" icon="◎" />
            <CmdButton label="Reduce Energy" onClick={cmd.reduceEnergy} variant="info" icon="~" />
          </div>
        </Panel>

        <Panel title="Command History" accent="#334155">
          <div style={{ maxHeight: 120, overflowY: "auto" }}>
            {commandLog.slice(0, 10).map(l => (
              <div key={l.id} className="flex gap-2 text-xs font-mono border-b py-0.5" style={{ borderColor: "#070e18" }}>
                <span style={{ color: "#1e3a5f", flexShrink: 0 }}>{fmtTs(l.ts)}</span>
                <span style={{ color: l.result === "OK" || l.result === "EXECUTED" ? "#22c55e" : l.result === "INJECTED" ? "#f59e0b" : "#94a3b8", fontWeight: 700 }}>{l.cmd}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Bottom row */}
      <div className="grid gap-3 col-span-2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Panel title="Floor Control" accent="#3b82f6">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {Array.from({ length: NUM_FLOORS }, (_, i) => (
              <button key={i} onClick={() => cmd.sendFloor(i)} className="rounded text-xs font-mono font-bold py-2 transition-all" style={{ background: c.current_floor === i ? "#1e3a5f" : "#0a1526", border: `1px solid ${c.current_floor === i ? "#3b82f6" : c.target_floor === i ? "#334155" : "#0f172a"}`, color: c.current_floor === i ? "#93c5fd" : c.target_floor === i ? "#60a5fa" : "#334155", cursor: "pointer" }}>
                {FLOOR_LABELS[i]}
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Security Status" accent={sec.alert_level === "NORMAL" ? "#334155" : sec.alert_level === "HIGH" ? "#f59e0b" : "#ef4444"}>
          <div className="flex flex-col gap-2">
            {[["Alert Level", sec.alert_level, sec.alert_level === "NORMAL" ? "#475569" : sec.alert_level === "HIGH" ? "#f59e0b" : "#ef4444"], ["RFID Status", sec.rfid_access_granted ? "GRANTED" : "DENIED", sec.rfid_access_granted ? "#22c55e" : "#ef4444"], ["Distress", sec.audio_distress_active ? "ACTIVE" : "CLEAR", sec.audio_distress_active ? "#ef4444" : "#22c55e"], ["Unauth Attempts", sec.unauthorized_access_attempts + "×", sec.unauthorized_access_attempts > 0 ? "#f59e0b" : "#334155"], ["Last Card", sec.rfid_last_card, "#475569"]].map(([l, v, c]) => (
              <div key={l} className="flex justify-between text-xs font-mono">
                <span style={{ color: "#334155" }}>{l}</span>
                <span style={{ color: c, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Energy Overview" accent="#3b82f6">
          <div className="flex flex-col gap-2">
            {[["Today", state.features.energy.properties.kwh_today.toFixed(2) + " kWh", "#60a5fa"], ["Month", state.features.energy.properties.kwh_month + " kWh", "#475569"], ["Baseline", state.features.energy.properties.kwh_baseline + " kWh", "#334155"], ["Regen", state.features.energy.properties.regen_kwh + " kWh", "#22c55e"], ["CO₂ Saved", state.features.energy.properties.co2_kg + " kg", "#22c55e"]].map(([l, v, c]) => (
              <div key={l} className="flex justify-between text-xs font-mono">
                <span style={{ color: "#334155" }}>{l}</span>
                <span style={{ color: c, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE 2: DIGITAL TWIN
// ═══════════════════════════════════════════════════════════════
function PageTwin() {
  const { state, prevStateDiff, cmd } = useTwin();
  const c = state.features.cabin.properties;
  const door = state.features.door.properties;
  const m = state.features.motor.properties;
  const attr = state.attributes;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "auto 1fr 1fr" }}>
      {/* Shaft */}
      <div className="flex flex-col gap-3">
        <Panel title="Visual Twin — Building A">
          <ElevatorShaft state={state} />
        </Panel>
        <Panel title="Floor Dispatch" accent="#3b82f6">
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            {Array.from({ length: NUM_FLOORS }, (_, i) => (
              <button key={i} onClick={() => cmd.sendFloor(i)} className="rounded text-xs font-mono font-bold py-2" style={{ background: c.current_floor === i ? "#1e3a5f" : "#0a1526", border: `1px solid ${c.current_floor === i ? "#3b82f6" : "#0f172a"}`, color: c.current_floor === i ? "#93c5fd" : "#475569", cursor: "pointer" }}>
                {FLOOR_LABELS[i]}
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {/* State details */}
      <div className="flex flex-col gap-3">
        <Panel title="Cabin Properties" accent="#3b82f6">
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[["Current Floor", FLOOR_LABELS[c.current_floor], "#93c5fd"], ["Target Floor", FLOOR_LABELS[c.target_floor], "#60a5fa"], ["Direction", c.direction, c.direction === "UP" ? "#22c55e" : c.direction === "DOWN" ? "#f59e0b" : "#475569"], ["Speed", c.speed_ms.toFixed(2) + " m/s", "#60a5fa"], ["Load", Math.round(c.load_kg) + " kg", c.load_kg > 760 ? "#ef4444" : "#22c55e"], ["Capacity", Math.round(c.load_kg / MAX_LOAD * 100) + "%", "#94a3b8"], ["Cabin Temp", c.temperature_c.toFixed(1) + " °C", "#94a3b8"], ["E-Stop", c.emergency_stop ? "ACTIVE" : "CLEAR", c.emergency_stop ? "#ef4444" : "#22c55e"]].map(([l, v, c]) => (
              <div key={l} className="p-2 rounded text-xs font-mono" style={{ background: "#0a1526", border: "1px solid #0f172a" }}>
                <div style={{ color: "#334155" }}>{l}</div>
                <div style={{ color: c, fontWeight: 700, fontSize: 14, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Motor & Mechanics" accent={m.health_status === "GOOD" ? "#22c55e" : m.health_status === "WARNING" ? "#f59e0b" : "#ef4444"}>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[["Vibration", m.vibration_level.toFixed(4) + " g", m.vibration_level > 0.25 ? "#ef4444" : m.vibration_level > 0.12 ? "#f59e0b" : "#22c55e"], ["Temperature", m.temperature_c.toFixed(1) + " °C", m.temperature_c > 85 ? "#ef4444" : m.temperature_c > 70 ? "#f59e0b" : "#64748b"], ["Health", m.health_status, m.health_status === "GOOD" ? "#22c55e" : m.health_status === "WARNING" ? "#f59e0b" : "#ef4444"], ["Hours", Math.round(m.hours_operated) + " h", m.hours_operated > 8000 ? "#ef4444" : "#64748b"], ["Current Draw", m.current_draw_a.toFixed(1) + " A", "#60a5fa"], ["Power", m.power_kw.toFixed(2) + " kW", "#60a5fa"]].map(([l, v, c]) => (
              <div key={l} className="p-2 rounded text-xs font-mono" style={{ background: "#0a1526", border: "1px solid #0f172a" }}>
                <div style={{ color: "#334155" }}>{l}</div>
                <div style={{ color: c, fontWeight: 700, fontSize: 14, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Door State" accent={door.state === "BLOCKED" ? "#ef4444" : "#334155"}>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[["State", door.state, door.state === "OPEN" ? "#22c55e" : door.state === "BLOCKED" ? "#ef4444" : "#64748b"], ["Forced Entry", door.door_forced_entry ? "YES" : "NO", door.door_forced_entry ? "#ef4444" : "#22c55e"], ["Cycle Count", door.cycle_count?.toLocaleString(), "#64748b"], ["Obstruction Events", door.obstruction_events || 0, "#94a3b8"]].map(([l, v, c]) => (
              <div key={l} className="p-2 rounded text-xs font-mono" style={{ background: "#0a1526", border: "1px solid #0f172a" }}>
                <div style={{ color: "#334155" }}>{l}</div>
                <div style={{ color: c, fontWeight: 700, fontSize: 13, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* State diff + timeline */}
      <div className="flex flex-col gap-3">
        <Panel title="State Diff Viewer" accent="#7c3aed">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-mono" style={{ color: "#334155", marginBottom: 4 }}>Δ since last tick</div>
            {prevStateDiff && Object.entries(prevStateDiff).map(([k, v]) => {
              const changed = k === "floor" ? v : parseFloat(v) !== 0;
              return (
                <div key={k} className="flex justify-between items-center text-xs font-mono p-2 rounded" style={{ background: changed ? "#1a0533" : "#0a1526", border: `1px solid ${changed ? "#7c3aed44" : "#0f172a"}` }}>
                  <span style={{ color: "#475569" }}>{k}</span>
                  <span style={{ color: changed ? "#a78bfa" : "#1e3a5f", fontWeight: changed ? 700 : 400 }}>
                    {k === "floor" ? (v ? "CHANGED" : "STABLE") : v > 0 ? `+${v}` : v}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="System Health Index" accent="#22c55e">
          <div className="flex flex-col gap-3">
            {[["System Overall", attr.system_health_index, "%"], ["Motor RUL", Math.round(state.features.predicted_failures.properties.motor_rul_hours), "h"], ["Bearing Health", state.features.predicted_failures.properties.bearing_health_pct, "%"], ["Door Mechanism", state.features.predicted_failures.properties.door_mechanism_pct, "%"], ["Rope Tension", state.features.predicted_failures.properties.rope_tension_pct, "%"]].map(([l, v, u]) => (
              <div key={l}>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span style={{ color: "#334155" }}>{l}</span>
                  <span style={{ color: healthColor(v), fontWeight: 700 }}>{v}{u}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: "#0f172a", overflow: "hidden" }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${v}%`, background: healthColor(v), transition: "width 0.6s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Mode & Attributes" accent="#334155">
          <div className="flex flex-col gap-2">
            <StatusBadge mode={attr.system_mode} />
            {[["Location", attr.location], ["Maint. Priority", attr.maintenance_priority], ["Uptime", attr.uptime_pct + "%"], ["Energy Efficiency", attr.energy_efficiency + "%"]].map(([l, v]) => (
              <div key={l} className="flex justify-between text-xs font-mono">
                <span style={{ color: "#334155" }}>{l}</span>
                <span style={{ color: "#475569" }}>{v}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE 3: ANALYTICS
// ═══════════════════════════════════════════════════════════════
function PageAnalytics() {
  const { state, vibHistory, tempHistory, loadHistory, energyHistory, timeline } = useTwin();
  const m = state.features.motor.properties;
  const pf = state.features.predicted_failures.properties;
  const attr = state.attributes;

  const rulPct = Math.round(pf.motor_rul_hours / MOTOR_DESIGN_LIFE * 100);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
      {/* AI Insights */}
      <Panel title="AI Insights Engine" accent="#7c3aed" className="col-span-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
          {AI_INSIGHTS.map(i => (
            <div key={i.id} className="p-3 rounded text-xs font-mono" style={{ background: i.severity === "CRITICAL" ? "#3b000022" : i.severity === "WARNING" ? "#43140722" : "#082f4922", border: `1px solid ${i.severity === "CRITICAL" ? "#7f1d1d" : i.severity === "WARNING" ? "#92400e" : "#075985"}` }}>
              <div className="font-bold mb-1" style={{ color: i.severity === "CRITICAL" ? "#ef4444" : i.severity === "WARNING" ? "#f59e0b" : "#3b82f6" }}>{i.severity}</div>
              <div style={{ color: "#64748b", lineHeight: 1.5 }}>{i.msg}</div>
              {i.eta && <div className="mt-1 font-bold" style={{ color: "#7c3aed" }}>ETA: {i.eta}</div>}
            </div>
          ))}
        </div>
      </Panel>

      {/* Vibration trend */}
      <Panel title="Vibration — 60 tick trend" accent="#ef4444">
        <LiveChart data={vibHistory} color="#ef4444" yDomain={[0, 0.5]} height={100} unit="g" />
      </Panel>

      {/* Temperature trend */}
      <Panel title="Motor Temperature — trend" accent="#f59e0b">
        <LiveChart data={tempHistory} color="#f59e0b" yDomain={[20, 100]} height={100} unit="°C" />
      </Panel>

      {/* Load trend */}
      <Panel title="Cabin Load — trend" accent="#22c55e">
        <LiveChart data={loadHistory} color="#22c55e" yDomain={[0, MAX_LOAD]} height={100} unit="kg" />
      </Panel>

      {/* Risk score */}
      <Panel title="Risk Score Analysis" accent={riskColor(attr.risk_score)}>
        <div className="flex gap-4 items-center">
          <RiskGauge score={attr.risk_score} size={100} />
          <div className="flex flex-col gap-2 flex-1">
            <div className="text-xs font-mono" style={{ color: "#334155" }}>Breakdown factors:</div>
            {[["Vibration deviation", m.vibration_level > 0.1 ? "HIGH" : "OK", m.vibration_level > 0.1 ? "#ef4444" : "#22c55e"], ["Motor thermal", m.temperature_c > 70 ? "WARM" : "OK", m.temperature_c > 70 ? "#f59e0b" : "#22c55e"], ["Service overdue", m.hours_operated > 1800 ? "YES" : "NO", m.hours_operated > 1800 ? "#f59e0b" : "#22c55e"], ["Security events", state.features.security.properties.unauthorized_access_attempts > 0 ? "YES" : "NO", state.features.security.properties.unauthorized_access_attempts > 0 ? "#f59e0b" : "#22c55e"]].map(([l, v, c]) => (
              <div key={l} className="flex justify-between text-xs font-mono">
                <span style={{ color: "#334155" }}>{l}</span>
                <span style={{ color: c, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* Predicted failures */}
      <Panel title="Failure Prediction (RUL)" accent="#7c3aed">
        <div className="flex flex-col gap-3">
          {[["Motor RUL", pf.motor_rul_hours + " h", pf.motor_rul_hours], ["Bearing Health", pf.bearing_health_pct + "%", pf.bearing_health_pct], ["Door Mechanism", pf.door_mechanism_pct + "%", pf.door_mechanism_pct], ["Rope Tension", pf.rope_tension_pct + "%", pf.rope_tension_pct]].map(([l, v, pct]) => (
            <div key={l}>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span style={{ color: "#334155" }}>{l}</span>
                <span style={{ color: healthColor(pct > 100 ? 100 : pct), fontWeight: 700 }}>{v}</span>
              </div>
              <div className="h-2 rounded-full" style={{ background: "#0f172a" }}>
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, pct > 100 ? pct / MOTOR_DESIGN_LIFE * 100 : pct)}%`, background: healthColor(pct > 100 ? 70 : pct), transition: "width 0.6s" }} />
              </div>
            </div>
          ))}
          <div className="text-xs font-mono mt-1" style={{ color: "#334155" }}>Next service: <span style={{ color: "#7c3aed" }}>{pf.next_service_date}</span></div>
        </div>
      </Panel>

      {/* Energy */}
      <Panel title="Energy Consumption — Hourly" accent="#3b82f6">
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={energyHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="h" tick={{ fontSize: 8, fill: "#334155", fontFamily: "monospace" }} interval={3} />
            <YAxis hide domain={[0, 3]} />
            <CartesianGrid strokeDasharray="2 4" stroke="#070e18" />
            <Bar dataKey="kwh" fill="#1d4ed8" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* Timeline playback */}
      <Panel title="Timeline Playback (Time-Travel)" accent="#475569" className="col-span-3">
        <div style={{ maxHeight: 110, overflowY: "auto" }}>
          <table style={{ width: "100%", fontSize: 10, fontFamily: "monospace", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Tick", "Time", "Floor", "Risk", "Vib (g)", "Temp (°C)"].map(h => <th key={h} style={{ textAlign: "left", padding: "2px 8px", color: "#334155", borderBottom: "1px solid #0f172a" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {timeline.slice(-20).reverse().map((row, i) => (
                <tr key={row.tick} style={{ background: i === 0 ? "#0a1e3322" : "transparent" }}>
                  {[row.tick, fmtTs(row.ts), FLOOR_LABELS[row.floor], row.risk, row.vib.toFixed(4), row.temp].map((v, j) => (
                    <td key={j} style={{ padding: "2px 8px", color: j === 3 ? riskColor(parseFloat(row.risk)) : "#475569", borderBottom: "1px solid #070e18" }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE 4: SECURITY OPS
// ═══════════════════════════════════════════════════════════════
function PageSOC() {
  const { state, cmd } = useTwin();
  const sec = state.features.security.properties;
  const inc = state.features.incident_log.properties;
  const attr = state.attributes;
  const [rfidLog] = useState(() => Array.from({ length: 12 }, (_, i) => ({ ts: new Date(Date.now() - i * 180000).toISOString(), card: i % 5 === 0 ? `UNKNOWN_${4000 + i * 100}` : ["CARD-A001", "CARD-A002", "CARD-B001", "CARD-MAINT-01"][i % 4], granted: i % 5 !== 0, floor: Math.floor(Math.random() * NUM_FLOORS) })));

  const threatLevel = attr.system_mode === "LOCKDOWN" ? "CRITICAL" : sec.alert_level === "CRITICAL" ? "HIGH" : sec.alert_level === "HIGH" ? "ELEVATED" : "NORMAL";
  const threatCol = { CRITICAL: "#ef4444", HIGH: "#ef4444", ELEVATED: "#f59e0b", NORMAL: "#22c55e" }[threatLevel];

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
      {/* Threat level */}
      <Panel title="Threat Level Indicator" accent={threatCol} className="col-span-3">
        <div className="flex items-center gap-8 py-1">
          {["NORMAL", "ELEVATED", "HIGH", "CRITICAL"].map(l => {
            const active = l === threatLevel;
            const c = { NORMAL: "#22c55e", ELEVATED: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" }[l];
            return (
              <div key={l} className="flex items-center gap-2">
                <div className="rounded" style={{ width: 12, height: 12, background: active ? c : "#0f172a", border: `1px solid ${c}44`, animation: active && l !== "NORMAL" ? "blink 1s infinite" : "none" }} />
                <span className="text-xs font-mono font-bold" style={{ color: active ? c : "#1e3a5f" }}>{l}</span>
              </div>
            );
          })}
          <div className="ml-auto text-xs font-mono font-bold" style={{ color: threatCol }}>CURRENT: {threatLevel}</div>
        </div>
      </Panel>

      {/* Security status */}
      <Panel title="Security State" accent={sec.alert_level !== "NORMAL" ? "#ef4444" : "#22c55e"}>
        <div className="flex flex-col gap-2">
          {[["Alert Level", sec.alert_level, sec.alert_level !== "NORMAL" ? "#ef4444" : "#22c55e"], ["Audio Distress", sec.audio_distress_active ? "ACTIVE" : "CLEAR", sec.audio_distress_active ? "#ef4444" : "#22c55e"], ["RFID Last Card", sec.rfid_last_card, "#64748b"], ["Access Granted", sec.rfid_access_granted ? "YES" : "NO", sec.rfid_access_granted ? "#22c55e" : "#ef4444"], ["Forced Entry", state.features.door.properties.door_forced_entry ? "DETECTED" : "CLEAR", state.features.door.properties.door_forced_entry ? "#ef4444" : "#22c55e"], ["Unauth Attempts", sec.unauthorized_access_attempts + " total", sec.unauthorized_access_attempts > 2 ? "#ef4444" : sec.unauthorized_access_attempts > 0 ? "#f59e0b" : "#22c55e"]].map(([l, v, c]) => (
            <div key={l} className="flex justify-between text-xs font-mono">
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* RFID Access Log */}
      <Panel title="RFID Access Log" accent="#3b82f6">
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {rfidLog.map((e, i) => (
            <div key={i} className="flex gap-2 text-xs font-mono py-1 border-b" style={{ borderColor: "#070e18" }}>
              <span style={{ color: "#1e3a5f", flexShrink: 0 }}>{fmtTs(e.ts)}</span>
              <span style={{ color: e.granted ? "#22c55e" : "#ef4444", fontWeight: 700, flexShrink: 0 }}>{e.granted ? "OK" : "DENY"}</span>
              <span style={{ color: e.granted ? "#334155" : "#f59e0b" }}>{e.card}</span>
              <span style={{ color: "#1e3a5f", marginLeft: "auto" }}>F{FLOOR_LABELS[e.floor]}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Incident timeline */}
      <Panel title="Incident Timeline" accent={inc.open_incidents > 0 ? "#ef4444" : "#334155"}>
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {inc.entries.length === 0 ? <div className="text-xs font-mono py-4 text-center" style={{ color: "#1e3a5f" }}>No incidents logged</div> :
            inc.entries.map((e, i) => (
              <div key={i} className="border-b py-2 text-xs font-mono" style={{ borderColor: "#070e18" }}>
                <div className="flex gap-2 mb-0.5">
                  <span style={{ color: "#1e3a5f" }}>{fmtTs(e.ts)}</span>
                  <span style={{ color: e.resolved ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{e.resolved ? "RESOLVED" : "OPEN"}</span>
                </div>
                <div style={{ color: "#f59e0b", fontWeight: 700 }}>{e.type}</div>
                <div style={{ color: "#334155", marginTop: 1 }}>{e.description}</div>
              </div>
            ))}
        </div>
      </Panel>

      {/* SOC actions */}
      <Panel title="SOC Quick Actions" accent="#ef4444">
        <div className="flex flex-col gap-2">
          <CmdButton label="Inject Forced Entry" onClick={cmd.injectForcedEntry} variant="danger" icon="⊗" />
          <CmdButton label="Inject Audio Distress" onClick={cmd.injectAudioDistress} variant="danger" icon="◎" />
          <CmdButton label="Inject Invalid RFID" onClick={cmd.injectInvalidRFID} variant="warning" icon="≠" />
          <CmdButton label="Initiate Lockdown" onClick={cmd.lockdown} variant="danger" icon="⊗" />
          <CmdButton label="Reset Security State" onClick={cmd.reset} variant="success" icon="↺" />
        </div>
      </Panel>

      {/* Incident stats */}
      <Panel title="Security Metrics" accent="#f59e0b">
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {[["Open Incidents", inc.open_incidents, "#ef4444"], ["Total Logged", inc.entries.length, "#64748b"], ["Unauth Access", sec.unauthorized_access_attempts, sec.unauthorized_access_attempts > 0 ? "#f59e0b" : "#22c55e"], ["System Mode", attr.system_mode, attr.system_mode === "NORMAL" ? "#22c55e" : "#ef4444"]].map(([l, v, c]) => (
            <div key={l} className="p-2 rounded text-xs font-mono" style={{ background: "#0a1526", border: "1px solid #0f172a" }}>
              <div style={{ color: "#334155" }}>{l}</div>
              <div style={{ color: c, fontWeight: 700, fontSize: 16, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Door Security" accent="#f59e0b">
        <div className="flex flex-col gap-2">
          {[["Door State", state.features.door.properties.state, state.features.door.properties.state === "BLOCKED" ? "#ef4444" : "#22c55e"], ["Forced Entry", state.features.door.properties.door_forced_entry ? "DETECTED" : "CLEAR", state.features.door.properties.door_forced_entry ? "#ef4444" : "#22c55e"], ["Total Cycles", state.features.door.properties.cycle_count?.toLocaleString(), "#64748b"], ["Obstruction Events", state.features.door.properties.obstruction_events || 0, "#94a3b8"]].map(([l, v, c]) => (
            <div key={l} className="flex justify-between text-xs font-mono">
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE 5: MAINTENANCE
// ═══════════════════════════════════════════════════════════════
function PageMaintenance() {
  const { state, vibHistory, tempHistory, cmd } = useTwin();
  const m = state.features.motor.properties;
  const pf = state.features.predicted_failures.properties;
  const perf = state.features.performance.properties;

  const TASKS = [
    { id: 1, task: "Motor bearing inspection", due: "2026-05-15", priority: "HIGH", est_h: 4, status: "SCHEDULED" },
    { id: 2, task: "Lubrication — guide rails", due: "2026-05-20", priority: "MEDIUM", est_h: 1, status: "PENDING" },
    { id: 3, task: "Door mechanism service", due: "2026-06-01", priority: "MEDIUM", est_h: 2, status: "PENDING" },
    { id: 4, task: "Rope tension check", due: "2026-06-15", priority: "LOW", est_h: 1, status: "PENDING" },
    { id: 5, task: "Full electrical inspection", due: "2026-07-01", priority: "LOW", est_h: 6, status: "PLANNED" },
  ];

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
      {/* Health overview */}
      <Panel title="Component Health Overview" accent="#22c55e" className="col-span-3">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
          {[["Motor RUL", pf.motor_rul_hours, "h remaining", "#f59e0b"], ["Bearing Health", pf.bearing_health_pct, "% healthy", "#22c55e"], ["Door Mechanism", pf.door_mechanism_pct, "% healthy", "#22c55e"], ["Rope Tension", pf.rope_tension_pct, "% nominal", "#22c55e"], ["Vibration Level", (m.vibration_level * 100).toFixed(1), "% of threshold", m.vibration_level > 0.2 ? "#ef4444" : "#22c55e"]].map(([l, v, u, c]) => (
            <div key={l} className="p-3 rounded text-center" style={{ background: "#0a1526", border: `1px solid ${c}22` }}>
              <div className="text-xs font-mono mb-2" style={{ color: "#334155" }}>{l}</div>
              <div className="text-2xl font-mono font-bold" style={{ color: c }}>{typeof v === "number" ? Math.round(v) : v}</div>
              <div className="text-xs font-mono mt-1" style={{ color: "#1e3a5f" }}>{u}</div>
              <div className="mt-2 h-1 rounded-full" style={{ background: "#0f172a" }}>
                <div className="h-1 rounded-full" style={{ width: `${Math.min(100, typeof v === "number" && u.includes("%") ? v : 50)}%`, background: c }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Vibration analysis */}
      <Panel title="Vibration Analysis" accent="#ef4444">
        <LiveChart data={vibHistory} color="#ef4444" yDomain={[0, 0.5]} height={90} unit="g" />
        <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {[["Current", m.vibration_level.toFixed(4) + " g", "#ef4444"], ["Threshold", "0.25 g", "#334155"], ["Status", m.vibration_level > 0.25 ? "EXCEEDED" : "NORMAL", m.vibration_level > 0.25 ? "#ef4444" : "#22c55e"], ["Trend", "↑ +2%/h", "#f59e0b"]].map(([l, v, c]) => (
            <div key={l} className="text-xs font-mono flex justify-between">
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Temperature analysis */}
      <Panel title="Thermal Analysis" accent="#f59e0b">
        <LiveChart data={tempHistory} color="#f59e0b" yDomain={[20, 100]} height={90} unit="°C" />
        <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {[["Current", m.temperature_c.toFixed(1) + " °C", "#f59e0b"], ["Critical", "85 °C", "#334155"], ["Health", m.health_status, m.health_status === "GOOD" ? "#22c55e" : m.health_status === "WARNING" ? "#f59e0b" : "#ef4444"], ["Motor Hrs", Math.round(m.hours_operated) + " h", "#64748b"]].map(([l, v, c]) => (
            <div key={l} className="text-xs font-mono flex justify-between">
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Performance */}
      <Panel title="Performance Metrics" accent="#3b82f6">
        <div className="flex flex-col gap-2">
          {[["Avg Wait Time", perf.avg_wait_s + " s", "#60a5fa"], ["Avg Trip Time", perf.avg_trip_s + " s", "#60a5fa"], ["Availability", perf.availability_pct + "%", perf.availability_pct > 99 ? "#22c55e" : "#f59e0b"], ["Response Time", perf.response_time_ms + " ms", "#64748b"], ["Door Efficiency", perf.door_cycle_efficiency + "%", "#22c55e"], ["Trips Today", Math.round(state.features.cabin.properties.trips_today), "#94a3b8"]].map(([l, v, c]) => (
            <div key={l} className="flex justify-between text-xs font-mono">
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Work orders */}
      <Panel title="Maintenance Schedule" accent="#7c3aed" className="col-span-2">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 10, fontFamily: "monospace", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Task", "Due Date", "Priority", "Est. Hours", "Status"].map(h => <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: "#334155", borderBottom: "1px solid #0f172a" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {TASKS.map(t => (
                <tr key={t.id} style={{ borderBottom: "1px solid #070e18" }}>
                  {[t.task, t.due, t.priority, t.est_h + "h", t.status].map((v, i) => (
                    <td key={i} style={{ padding: "4px 8px", color: i === 2 ? (t.priority === "HIGH" ? "#ef4444" : t.priority === "MEDIUM" ? "#f59e0b" : "#64748b") : i === 4 ? (t.status === "SCHEDULED" ? "#3b82f6" : "#475569") : "#475569" }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <CmdButton label="Activate Maintenance Mode" onClick={cmd.maintenance} variant="warning" icon="⚙" />
        </div>
      </Panel>

      {/* Self-healing */}
      <Panel title="Self-Healing Simulation" accent="#22c55e">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-mono" style={{ color: "#334155", marginBottom: 4 }}>Auto-recovery capabilities:</div>
          {[["Vibration dampening", "ACTIVE", "#22c55e"], ["Thermal regulation", m.temperature_c > 70 ? "OVERRIDDEN" : "ACTIVE", m.temperature_c > 70 ? "#f59e0b" : "#22c55e"], ["Load balancing", "ACTIVE", "#22c55e"], ["Door retry logic", "ACTIVE", "#22c55e"], ["RFID blacklist sync", "ACTIVE", "#22c55e"]].map(([l, v, c]) => (
            <div key={l} className="flex justify-between text-xs font-mono py-1 border-b" style={{ borderColor: "#070e18" }}>
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>● {v}</span>
            </div>
          ))}
          <div className="mt-2">
            <CmdButton label="Trigger Auto-Recover" onClick={cmd.reset} variant="success" icon="↺" />
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE 6: SIMULATION LAB
// ═══════════════════════════════════════════════════════════════
function PageSimulation() {
  const { state, vibHistory, tempHistory, loadHistory, cmd } = useTwin();
  const [vibSlider, setVibSlider] = useState(0.02);
  const [loadSlider, setLoadSlider] = useState(0);
  const [tempSlider, setTempSlider] = useState(0);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
      {/* Scenario presets */}
      <Panel title="Scenario Presets" accent="#ef4444" className="col-span-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
          {Object.entries(SCENARIOS).map(([key, sc]) => (
            <button key={key} onClick={() => cmd.runScenario(key)} className="rounded p-3 text-left font-mono transition-opacity" style={{ background: sc.color + "11", border: `1px solid ${sc.color}44`, cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.75"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              <div className="text-xs font-bold mb-1" style={{ color: sc.color }}>INJECT</div>
              <div className="text-xs" style={{ color: "#64748b", lineHeight: 1.4 }}>{sc.label}</div>
            </button>
          ))}
        </div>
      </Panel>

      {/* Anomaly injectors */}
      <Panel title="Anomaly Injectors" accent="#f59e0b">
        <div className="flex flex-col gap-2">
          <CmdButton label="High Vibration Spike" onClick={cmd.injectHighVib} variant="warning" icon="〜" size="lg" />
          <CmdButton label="Forced Door Entry" onClick={cmd.injectForcedEntry} variant="danger" icon="⊗" size="lg" />
          <CmdButton label="Audio Distress Signal" onClick={cmd.injectAudioDistress} variant="danger" icon="◎" size="lg" />
          <CmdButton label="Invalid RFID Scan" onClick={cmd.injectInvalidRFID} variant="warning" icon="≠" size="lg" />
          <div className="border-t mt-1 pt-2" style={{ borderColor: "#0f172a" }}>
            <CmdButton label="Emergency Stop" onClick={cmd.emergencyStop} variant="danger" icon="■" size="lg" />
            <div className="mt-1.5">
              <CmdButton label="Reset All — Normal" onClick={cmd.reset} variant="success" icon="↺" size="lg" />
            </div>
          </div>
        </div>
      </Panel>

      {/* Parameter sliders */}
      <Panel title="Parameter Override" accent="#7c3aed">
        <div className="flex flex-col gap-4">
          {/* Vibration */}
          <div>
            <div className="flex justify-between text-xs font-mono mb-2">
              <span style={{ color: "#334155" }}>Vibration Level</span>
              <span style={{ color: vibSlider > 0.25 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>{vibSlider.toFixed(3)} g</span>
            </div>
            <input type="range" min={0} max={0.9} step={0.001} value={vibSlider} onChange={e => { const v = parseFloat(e.target.value); setVibSlider(v); cmd.setVibration(v); }} style={{ width: "100%", accentColor: vibSlider > 0.25 ? "#ef4444" : "#7c3aed" }} />
            <div className="flex justify-between text-xs font-mono mt-1" style={{ color: "#1e3a5f" }}>
              <span>0.000</span><span style={{ color: "#f59e0b" }}>warn 0.12</span><span style={{ color: "#ef4444" }}>crit 0.25</span>
            </div>
          </div>

          {/* Load */}
          <div>
            <div className="flex justify-between text-xs font-mono mb-2">
              <span style={{ color: "#334155" }}>Cabin Load</span>
              <span style={{ color: loadSlider > 760 ? "#ef4444" : loadSlider > 640 ? "#f59e0b" : "#22c55e", fontWeight: 700 }}>{loadSlider} kg</span>
            </div>
            <input type="range" min={0} max={1000} step={10} value={loadSlider} onChange={e => { const v = parseInt(e.target.value); setLoadSlider(v); cmd.setLoad(v); }} style={{ width: "100%", accentColor: loadSlider > 760 ? "#ef4444" : "#7c3aed" }} />
            <div className="flex justify-between text-xs font-mono mt-1" style={{ color: "#1e3a5f" }}>
              <span>0 kg</span><span style={{ color: "#f59e0b" }}>max 800</span><span style={{ color: "#ef4444" }}>1000</span>
            </div>
          </div>

          {/* Temperature */}
          <div>
            <div className="flex justify-between text-xs font-mono mb-2">
              <span style={{ color: "#334155" }}>Motor Temperature</span>
              <span style={{ color: tempSlider > 85 ? "#ef4444" : tempSlider > 70 ? "#f59e0b" : "#64748b", fontWeight: 700 }}>{tempSlider} °C</span>
            </div>
            <input type="range" min={20} max={95} step={1} value={tempSlider} onChange={e => { const v = parseInt(e.target.value); setTempSlider(v); cmd.setMotorTemp(v); }} style={{ width: "100%", accentColor: tempSlider > 85 ? "#ef4444" : "#7c3aed" }} />
            <div className="flex justify-between text-xs font-mono mt-1" style={{ color: "#1e3a5f" }}>
              <span>20°C</span><span style={{ color: "#f59e0b" }}>warn 70</span><span style={{ color: "#ef4444" }}>crit 85</span>
            </div>
          </div>
        </div>
      </Panel>

      {/* Live state feedback */}
      <Panel title="Live State Feedback" accent="#3b82f6">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-mono mb-2" style={{ color: "#334155" }}>Current injected values:</div>
          {[["Motor Vibration", state.features.motor.properties.vibration_level.toFixed(4) + " g", state.features.motor.properties.vibration_level > 0.25 ? "#ef4444" : "#22c55e"], ["Cabin Load", Math.round(state.features.cabin.properties.load_kg) + " kg", state.features.cabin.properties.load_kg > 760 ? "#ef4444" : "#22c55e"], ["Motor Temp", state.features.motor.properties.temperature_c.toFixed(1) + " °C", state.features.motor.properties.temperature_c > 85 ? "#ef4444" : "#64748b"], ["Risk Score", Math.round(state.attributes.risk_score), riskColor(state.attributes.risk_score)], ["System Mode", state.attributes.system_mode, state.attributes.system_mode !== "NORMAL" ? "#ef4444" : "#22c55e"], ["Motor Health", state.features.motor.properties.health_status, state.features.motor.properties.health_status === "GOOD" ? "#22c55e" : "#ef4444"]].map(([l, v, c]) => (
            <div key={l} className="flex justify-between text-xs font-mono p-1.5 rounded" style={{ background: "#0a1526" }}>
              <span style={{ color: "#334155" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Charts for active simulation */}
      <Panel title="Vibration Response" accent="#ef4444">
        <LiveChart data={vibHistory} color="#ef4444" yDomain={[0, 1]} height={90} unit="g" />
      </Panel>
      <Panel title="Temperature Response" accent="#f59e0b">
        <LiveChart data={tempHistory} color="#f59e0b" yDomain={[20, 100]} height={90} unit="°C" />
      </Panel>
      <Panel title="Load Response" accent="#22c55e">
        <LiveChart data={loadHistory} color="#22c55e" yDomain={[0, MAX_LOAD + 200]} height={90} unit="kg" />
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function Sidebar({ page, setPage, state, connected }) {
  const attr = state.attributes;
  return (
    <div className="flex flex-col" style={{ width: 52, background: "#020810", borderRight: "1px solid #0a1526", minHeight: "100vh" }}>
      {/* Logo */}
      <div style={{ padding: "12px 0", borderBottom: "1px solid #0a1526", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 28, height: 28, background: "#0f2040", border: "1px solid #1d4ed8", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#60a5fa" }}>◈</div>
      </div>
      {/* Live indicator */}
      <div style={{ padding: "8px 0", borderBottom: "1px solid #0a1526", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444", animation: connected ? "blink 2s infinite" : "none" }} />
      </div>
      {/* Nav items */}
      {PAGES.map(p => (
        <button key={p.id} onClick={() => setPage(p.id)} title={p.label} style={{ padding: "12px 0", display: "flex", justifyContent: "center", cursor: "pointer", background: page === p.id ? "#0a1e40" : "transparent", border: "none", borderLeft: page === p.id ? "2px solid #3b82f6" : "2px solid transparent", fontSize: 16, color: page === p.id ? "#60a5fa" : "#334155", transition: "all 0.2s" }}>
          {p.icon}
        </button>
      ))}
      {/* Mode indicator at bottom */}
      <div style={{ marginTop: "auto", padding: "12px 0", borderTop: "1px solid #0a1526", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: attr.system_mode === "NORMAL" ? "#22c55e" : attr.system_mode === "MAINTENANCE" ? "#f59e0b" : "#ef4444" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════
function TopBar({ page, state, connected }) {
  const attr = state.attributes;
  const pageInfo = PAGES.find(p => p.id === page);
  return (
    <div style={{ background: "#030b17", borderBottom: "1px solid #0a1526", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "#60a5fa", fontSize: 14, fontWeight: 700 }}>{pageInfo?.icon}</span>
        <span style={{ color: "#94a3b8", fontSize: 12, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{pageInfo?.label}</span>
        <span style={{ color: "#1e3a5f", fontSize: 11, fontFamily: "monospace" }}>/ {attr.location}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "monospace", color: "#22c55e" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444", animation: "blink 2s infinite" }} />
          {connected ? "LIVE" : "OFFLINE"}
        </div>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1e3a5f" }}>thing: building:floor1:elevator</div>
        <StatusBadge mode={attr.system_mode} />
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#1e3a5f" }}>{new Date().toLocaleTimeString("en-GB", { hour12: false })}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════
const PAGE_COMPONENTS = {
  command: PageCommand,
  twin: PageTwin,
  analytics: PageAnalytics,
  soc: PageSOC,
  maintenance: PageMaintenance,
  simulation: PageSimulation,
};

export default function ElevatorOS() {
  const [page, setPage] = useState("command");
  const engine = useDigitalTwinEngine();

  // Expose cmd on the engine object for child access
  const ctx = {
    ...engine,
    cmd: {
      emergencyStop: engine.emergencyStop,
      lockdown: engine.lockdown,
      maintenance: engine.maintenance,
      reset: engine.reset,
      sendFloor: engine.sendFloor,
      optimizeRouting: engine.optimizeRouting,
      reduceEnergy: engine.reduceEnergy,
      injectHighVib: engine.injectHighVib,
      injectForcedEntry: engine.injectForcedEntry,
      injectAudioDistress: engine.injectAudioDistress,
      injectInvalidRFID: engine.injectInvalidRFID,
      runScenario: engine.runScenario,
      setVibration: engine.setVibration,
      setLoad: engine.setLoad,
      setMotorTemp: engine.setMotorTemp,
      dismissAlert: engine.dismissAlert,
    }
  };

  const PageComponent = PAGE_COMPONENTS[page] || PageCommand;

  return (
    <TwinContext.Provider value={ctx}>
      <div style={{ background: "#020810", minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Courier New', monospace" }}>
        <GlobalAlertBanner state={engine.state} />
        <div style={{ display: "flex", flex: 1 }}>
          <Sidebar page={page} setPage={setPage} state={engine.state} connected={engine.connected} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <TopBar page={page} state={engine.state} connected={engine.connected} />
            <div style={{ flex: 1, padding: 12, overflowY: "auto" }}>
              <PageComponent />
            </div>
          </div>
        </div>
        <style>{`
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
          ::-webkit-scrollbar{width:4px;height:4px}
          ::-webkit-scrollbar-track{background:#020810}
          ::-webkit-scrollbar-thumb{background:#0f172a;border-radius:2px}
          button{cursor:pointer}
          input[type=range]{cursor:pointer}
        `}</style>
      </div>
    </TwinContext.Provider>
  );
}
