'use client';

// Shared presentational primitives for the ElevatorOS shell.
// Extracted verbatim from the monolith (move-then-refactor); the calm-palette /
// shadcn restyle of these primitives happens in the restyle stage.

import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card as UICard, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { T } from "../../theme/tokens";
import { riskColor, FAN_THERMAL } from "../../lib/twinConstants";

// Built on the shadcn Card primitive (bg-card / border / shadow from CSS-var
// tokens). The accent stripe + dot stay prop-driven so callers keep their API.
export function Card({ title, accent, children, className = "", noPad = false }) {
  return (
    <UICard
      className={cn("gap-0 py-0 overflow-hidden transition-colors", className)}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      {title && (
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 py-3 border-b [.border-b]:pb-3">
          <span
            className="text-xs font-semibold tracking-wider uppercase text-muted-foreground"
            style={accent ? { color: accent } : undefined}
          >
            {title}
          </span>
          <span className="size-1.5 rounded-full bg-border" style={accent ? { background: accent } : undefined} />
        </CardHeader>
      )}
      <CardContent className={noPad ? "px-0" : "p-5"}>{children}</CardContent>
    </UICard>
  );
}

/** KPI metric tile (token-based surface) */
export function KpiTile({ label, value, unit, color, sub }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-2 bg-card border border-border shadow-sm">
      <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tabular-nums text-foreground" style={color ? { color } : undefined}>
          {value}
        </span>
        {unit && <span className="text-xs font-mono text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="text-xs font-mono text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Pill badge for system modes and statuses (shadcn Badge + dynamic colour) */
export function StatusPill({ label, color, pulse = false }) {
  return (
    <Badge
      variant="outline"
      className="gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase"
      style={{ color, borderColor: `${color}55`, background: `${color}1f` }}
    >
      <span
        className="size-2 rounded-full inline-block"
        style={{ background: color, animation: pulse ? "pulse 2s ease-in-out infinite" : undefined }}
      />
      {label}
    </Badge>
  );
}

/** Severity badge (shadcn Badge + semantic status tokens) */
export function SevBadge({ sev }) {
  const cls = {
    CRITICAL: "bg-crit-soft text-crit border-crit/30",
    WARNING:  "bg-warn-soft text-warn border-warn/30",
    INFO:     "bg-info-soft text-info border-info/30",
    NORMAL:   "bg-ok-soft text-ok border-ok/30",
  }[sev] || "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cn("rounded-md px-2.5 py-1 text-xs font-semibold tracking-wide uppercase", cls)}>
      {sev}
    </Badge>
  );
}

export function EmptyState({ title = "No data", detail = "Waiting for telemetry or operator action." }) {
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

export function FieldTile({ label, value, color, sub }) {
  return (
    <div className="rounded-lg px-3 py-2.5 bg-muted border border-border">
      <div className="text-[10px] text-muted-foreground mb-1 tracking-wide uppercase">{label}</div>
      <div className="text-[15px] font-extrabold font-mono text-foreground" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export function ConnectionIndicator({ label, active, detail }) {
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

/** Command button - enterprise style */
export function CmdBtn({ label, icon, onClick, variant = "default", disabled = false, confirm = false, reason }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    // React Strict Mode intentionally replays effects in development. Restore
    // the mounted flag during every setup so the async finally block can always
    // clear "Working..." after the replay cleanup.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Calm control-room button variants (desaturated, dark-tinted; no neon).
  const styles = {
    danger:   { bg: "#211314", border: "#6b3a37", text: "#d4948e", hover: "#2a1819" },
    warning:  { bg: "#201910", border: "#6b5a33", text: "#cdb079", hover: "#2a2014" },
    success:  { bg: "#122019", border: "#36664f", text: "#8fc7a8", hover: "#16271f" },
    info:     { bg: "#121a24", border: "#3a5573", text: "#9bbcd8", hover: "#16212e" },
    ghost:    { bg: "transparent", border: T.border, text: T.textSub, hover: T.surfaceHi },
    default:  { bg: T.surfaceHi, border: T.border, text: T.textSub, hover: T.borderHi },
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
export function RiskGauge({ score, size = 130 }) {
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
export function TelemetryChart({ data, color, yDomain, height = 72, unit = "" }) {
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

/** Health bar */
export function HealthBar({ label, pct, color }) {
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
export function FanControlCard({ fan, motorTempC, cabinTempC, setFan }) {
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
export function ToastStack({ toasts, dismiss }) {
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
export function GlobalAlertBanner({ state }) {
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

export function TableShell({ children }) {
  return <div style={{ overflowX: "auto", width: "100%" }}>{children}</div>;
}

export function MiniIconButton({ title, onClick, children, active = false }) {
  return (
    <button type="button" title={title} onClick={onClick} className="eos-icon-button" data-active={active ? "true" : "false"}>
      {children}
    </button>
  );
}

export function ToggleSwitch({ checked, onChange, label, detail }) {
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

export function SettingsSection({ title, accent = T.cyan, children }) {
  return <Card title={title} accent={accent}>{children}</Card>;
}

export function ConfirmModal({ open, title, detail, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false }) {
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
