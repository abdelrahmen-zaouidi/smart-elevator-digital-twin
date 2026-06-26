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
import { reconcileCommandResult, submitCommand } from "../src/services/commandClient";
import {
  activeCommandFromThing,
  commandOutcomeMessage,
  commandResultForId,
  normalizeCommandStatus,
} from "@smart-elevator/shared/commandLifecycle.js";
import { useAccessControl } from "../src/hooks/useAccessControl";
import { recordAccessEvent } from "../src/services/accessControlClient";
import { createSpeedEstimator } from "../src/lib/speedEstimator";
import { ROLES, normalizeUid } from "../src/lib/accessControl";
import CommandSafetyGatePanel from "./scada/CommandSafetyGatePanel";
import DispatchPolicyPanel from "./scada/DispatchPolicyPanel";
import AgentActivityPanel from "./scada/AgentActivityPanel";
import { T, applyThemeTokens } from "../src/theme/tokens";
import {
  NUM_FLOORS, FLOOR_LABELS, FLOOR_H, MAX_LOAD, MOTOR_LIFE_H,
  HISTORY_LIMIT, TIMELINE_LIMIT,
  riskColor, riskLabel, healthColor, fmtTime, relTime,
  FAN_THERMAL, decideFanState,
} from "../src/lib/twinConstants";
import {
  Card, KpiTile, StatusPill, SevBadge, EmptyState, FieldTile,
  ConnectionIndicator, CmdBtn, RiskGauge, TelemetryChart, HealthBar,
  FanControlCard, ToastStack, GlobalAlertBanner, TableShell,
  MiniIconButton, ToggleSwitch, SettingsSection, ConfirmModal,
} from "../src/components/common";
import ElevatorShaft from "../src/components/twin/ElevatorShaft";
import DigitalTwinScene from "../src/components/twin/DigitalTwinScene";
import {
  DEFAULT_PREFERENCES, DEFAULT_PROFILE, FIRMWARE_DIAGNOSTIC_COMMANDS, INIT_STATE,
  PAGES, PAGE_GROUPS, SCENARIO_DEFS, TwinContext, buildRequestQueueRows,
  commandResultSeverity, getAiAnalysis, getAnalysisText, getMicrocontrollerStatus,
  getSeverityFromRisk, hasFeatureDataBeyondSeed, incidentIdentifier,
  useDigitalTwinEngine, useHistoryApi, useStoredObject, useTwin,
} from "../src/twin/engine";
import {
  PageCommand, PageTwin, PageAIInsights, PageSOC, PageAccessControl, PageMaintenance,
  PageSimulation, PageMonitoring, PageControlPanel, PageAlerts, PageLogs, PageDevices,
  PageReports, PageSettings, PageHelp,
} from "../src/components/pages";


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

  // Keep the shadcn CSS-variable tokens (the .dark class) in sync with the app
  // theme so the token-based primitives match the legacy T-based components.
  useEffect(() => {
    const root = document.documentElement;
    const dark = preferences.theme !== "light";
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
  }, [preferences.theme]);

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
