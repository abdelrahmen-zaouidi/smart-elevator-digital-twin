'use client';

// 2D SVG elevator shaft (legacy twin visual). Extracted from the monolith;
// scheduled to be superseded by the React-Three-Fiber 3D scene.
import { T } from "../../theme/tokens";
import { NUM_FLOORS, FLOOR_LABELS, FLOOR_H, MAX_LOAD } from "../../lib/twinConstants";
import { StatusPill } from "../common";

export default function ElevatorShaft({ state, compact = false }) {
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
