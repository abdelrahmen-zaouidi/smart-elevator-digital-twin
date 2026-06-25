'use client';

// ── 3D Digital Twin (React-Three-Fiber) ─────────────────────────────────────
// A reactive, physically-plausible elevator twin. Every mechanical element binds
// to a live telemetry field and animates in useFrame via refs (no per-tick React
// re-render of the 3D tree — only the HTML HUD re-renders).
//
// Elements: hoistway + floor slabs, guide rails, cabin + sliding doors + load,
// traction machine (electric motor + drive sheave) with thermal/vibration cues,
// ropes + counterweight (moves opposite the cabin), per-floor call lights, and an
// interactive status HUD with click-to-dispatch (respecting the safety gate).

import { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { NUM_FLOORS, FLOOR_LABELS, MAX_LOAD } from "../../lib/twinConstants";
import { T } from "../../theme/tokens";
import { readTwinPalette, prefersReducedMotion } from "./twinTheme";

// Layout (world units)
const GAP = 2.4;                       // vertical spacing between floors
const MAXY = (NUM_FLOORS - 1) * GAP;   // top floor cabin-bottom height
const CW = 1.7, CH = 1.85, CD = 1.45;  // cabin width / height / depth
const MACHINE_Y = MAXY + CH + 1.7;     // machine room height
const lerp = (a, b, t) => a + (b - a) * t;
const cabinCenterY = (floor) => floor * GAP + CH / 2;

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// ── Hoistway: corner posts, back wall, per-floor slabs + labels ──────────────
function Hoistway({ palette, showLabels }) {
  const halfW = CW / 2 + 0.5, halfD = CD / 2 + 0.35;
  const postH = MAXY + CH + 0.4;
  const posts = [
    [-halfW, postH / 2 - 0.2, -halfD], [halfW, postH / 2 - 0.2, -halfD],
    [-halfW, postH / 2 - 0.2, halfD], [halfW, postH / 2 - 0.2, halfD],
  ];
  return (
    <group>
      {posts.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.1, postH, 0.1]} />
          <meshStandardMaterial color={palette.shaftEdge} roughness={0.7} metalness={0.2} />
        </mesh>
      ))}
      {/* Back wall */}
      <mesh position={[0, MAXY / 2 + CH / 2 - 0.2, -halfD]}>
        <boxGeometry args={[halfW * 2, postH, 0.06]} />
        <meshStandardMaterial color={palette.shaft} roughness={0.95} metalness={0.05} transparent opacity={0.55} />
      </mesh>
      {/* Floor slabs + labels */}
      {Array.from({ length: NUM_FLOORS }, (_, i) => (
        <group key={i} position={[0, i * GAP - 0.04, 0]}>
          <mesh>
            <boxGeometry args={[halfW * 2, 0.08, halfD * 2]} />
            <meshStandardMaterial color={palette.floor} roughness={0.9} metalness={0.05} />
          </mesh>
          {showLabels && (
            <Html position={[-halfW - 0.25, 0.1, 0]} center distanceFactor={10} pointerEvents="none">
              <div style={hudLabel}>{FLOOR_LABELS[i]}</div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

// ── Guide rails the cabin tracks ─────────────────────────────────────────────
function GuideRails({ palette }) {
  const railH = MAXY + CH;
  return (
    <group>
      {[-CW / 2 - 0.06, CW / 2 + 0.06].map((x, i) => (
        <mesh key={i} position={[x, railH / 2, 0]}>
          <boxGeometry args={[0.05, railH, 0.18]} />
          <meshStandardMaterial color={palette.rail} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// ── Cabin with sliding doors + load indicator ────────────────────────────────
function Cabin({ stateRef, palette, setHovered }) {
  const group = useRef();
  const bodyMat = useRef();
  const leftDoor = useRef();
  const rightDoor = useRef();
  const loadBar = useRef();
  const loadMat = useRef();
  const openRef = useRef(0);
  const reduced = useMemo(prefersReducedMotion, []);
  const cEstop = useMemo(() => new THREE.Color(palette.cabinEstop), [palette]);
  const cBase = useMemo(() => new THREE.Color(palette.cabin), [palette]);

  useFrame((_, dt) => {
    const s = stateRef.current;
    const cab = s.features.cabin.properties;
    const door = s.features.door.properties;
    const k = Math.min(1, dt * 2.2);
    // Vertical travel toward current floor
    const targetY = cabinCenterY(Math.max(0, Math.min(NUM_FLOORS - 1, num(cab.current_floor))));
    if (group.current) group.current.position.y = lerp(group.current.position.y, targetY, k);
    // Doors
    const open = door.state === "OPEN" || door.state === "OPENING";
    openRef.current = lerp(openRef.current, open ? 1 : 0, Math.min(1, dt * 4));
    const slide = openRef.current * (CW / 2 - 0.06);
    if (leftDoor.current) leftDoor.current.position.x = -CW / 4 - slide;
    if (rightDoor.current) rightDoor.current.position.x = CW / 4 + slide;
    // E-stop / blocked tint
    const estop = cab.emergency_stop || door.state === "BLOCKED";
    if (bodyMat.current) {
      bodyMat.current.color.lerp(estop ? cEstop : cBase, 0.1);
      bodyMat.current.emissive.lerp(estop ? cEstop : new THREE.Color("#000000"), 0.1);
      bodyMat.current.emissiveIntensity = estop ? (reduced ? 0.4 : 0.35 + 0.25 * Math.sin(performance.now() / 200)) : 0;
    }
    // Load bar
    const frac = Math.max(0, Math.min(1, num(cab.load_kg) / MAX_LOAD));
    if (loadBar.current) loadBar.current.scale.x = Math.max(0.001, frac);
    if (loadMat.current) loadMat.current.color.set(frac > 0.95 ? palette.crit : frac > 0.7 ? palette.warn : palette.ok);
  });

  return (
    <group ref={group} position={[0, cabinCenterY(0), 0]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered("cabin"); }}
      onPointerOut={() => setHovered(null)}>
      {/* Body */}
      <mesh castShadow>
        <boxGeometry args={[CW, CH, CD]} />
        <meshStandardMaterial ref={bodyMat} color={palette.cabin} roughness={0.45} metalness={0.35} transparent opacity={0.92} />
      </mesh>
      {/* Frame edges */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(CW, CH, CD)]} />
        <lineBasicMaterial color={palette.cabinEdge} />
      </lineSegments>
      {/* Doors on +Z face */}
      <mesh ref={leftDoor} position={[-CW / 4, 0, CD / 2 + 0.01]}>
        <boxGeometry args={[CW / 2 - 0.04, CH - 0.18, 0.04]} />
        <meshStandardMaterial color={palette.door} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh ref={rightDoor} position={[CW / 4, 0, CD / 2 + 0.01]}>
        <boxGeometry args={[CW / 2 - 0.04, CH - 0.18, 0.04]} />
        <meshStandardMaterial color={palette.door} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Load bar (anchored left, scales right) */}
      <group position={[-CW / 2 + 0.12, -CH / 2 + 0.12, CD / 2 + 0.04]}>
        <mesh ref={loadBar} position={[(CW - 0.24) / 2, 0, 0]} scale={[0.001, 1, 1]}>
          <boxGeometry args={[CW - 0.24, 0.07, 0.03]} />
          <meshStandardMaterial ref={loadMat} color={palette.ok} emissive={palette.ok} emissiveIntensity={0.3} />
        </mesh>
      </group>
    </group>
  );
}

// ── Traction machine: electric motor + drive sheave ──────────────────────────
function TractionMachine({ stateRef, palette, setHovered, sheaveRef }) {
  const motorGroup = useRef();
  const motorMat = useRef();
  const prevCabinY = useRef(cabinCenterY(0));
  const reduced = useMemo(prefersReducedMotion, []);
  const cCool = useMemo(() => new THREE.Color(palette.motor), [palette]);
  const cHot = useMemo(() => new THREE.Color(palette.motorHot), [palette]);

  useFrame((_, dt) => {
    const s = stateRef.current;
    const m = s.features.motor.properties;
    const cab = s.features.cabin.properties;
    const cabY = cabinCenterY(Math.max(0, Math.min(NUM_FLOORS - 1, num(cab.current_floor))));
    const dY = cabY - prevCabinY.current;
    prevCabinY.current = lerp(prevCabinY.current, cabY, Math.min(1, dt * 2.2));
    // Sheave rotates with rope travel; idle drift only when actually moving
    if (sheaveRef.current) sheaveRef.current.rotation.z -= dY * 1.6 + (Math.abs(dY) > 1e-4 ? dt * 0.6 : 0);
    // Thermal colour from motor temperature (35..85 degC -> cool..hot)
    const tHot = Math.max(0, Math.min(1, (num(m.temperature_c) - 35) / 50));
    if (motorMat.current) {
      motorMat.current.color.copy(cCool).lerp(cHot, tHot);
      motorMat.current.emissive.copy(cHot);
      motorMat.current.emissiveIntensity = tHot * 0.35;
    }
    // Vibration shake
    const vib = num(m.vibration_level);
    if (motorGroup.current) {
      const amp = reduced ? 0 : Math.min(0.05, Math.max(0, (vib - 0.05)) * 0.25);
      motorGroup.current.position.x = (Math.random() - 0.5) * amp;
      motorGroup.current.position.y = MACHINE_Y + (Math.random() - 0.5) * amp;
    }
  });

  return (
    <group>
      {/* Support beam */}
      <mesh position={[0, MACHINE_Y + 0.7, 0]}>
        <boxGeometry args={[CW + 1.3, 0.14, CD + 0.6]} />
        <meshStandardMaterial color={palette.shaftEdge} roughness={0.7} metalness={0.3} />
      </mesh>
      {/* Electric motor (cylinder lying along X) */}
      <group ref={motorGroup} position={[0, MACHINE_Y, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered("motor"); }}
        onPointerOut={() => setHovered(null)}>
        <mesh position={[-0.95, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.42, 0.42, 1.1, 24]} />
          <meshStandardMaterial ref={motorMat} color={palette.motor} roughness={0.4} metalness={0.6} />
        </mesh>
        {/* cooling fins */}
        {[-1.25, -1.1, -0.95, -0.8, -0.65].map((x, i) => (
          <mesh key={i} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.46, 0.46, 0.03, 24]} />
            <meshStandardMaterial color={palette.shaftEdge} roughness={0.6} metalness={0.5} />
          </mesh>
        ))}
        {/* Drive shaft to sheave */}
        <mesh position={[-0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 0.8, 16]} />
          <meshStandardMaterial color={palette.sheave} roughness={0.3} metalness={0.7} />
        </mesh>
        {/* Drive sheave (grooved disc, face along Z) */}
        <group ref={sheaveRef} position={[0.55, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.62, 0.62, 0.22, 28]} />
            <meshStandardMaterial color={palette.sheave} roughness={0.35} metalness={0.7} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.66, 0.66, 0.1, 28]} />
            <meshStandardMaterial color={palette.shaftEdge} roughness={0.5} metalness={0.5} />
          </mesh>
          {/* spoke marker so rotation is visible */}
          <mesh position={[0, 0.34, 0.12]}>
            <boxGeometry args={[0.08, 0.5, 0.05]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ── Ropes (cabin & counterweight) + counterweight ────────────────────────────
function RopesAndCounterweight({ stateRef, palette, setHovered }) {
  const rope1 = useRef();   // sheave -> cabin
  const rope2 = useRef();   // sheave -> counterweight
  const rope1Mat = useRef();
  const rope2Mat = useRef();
  const cwGroup = useRef();
  const sheaveX = 0.55, ropeTopY = MACHINE_Y;

  const setRope = (ref, topY, botY, x) => {
    if (!ref.current) return;
    const len = Math.max(0.01, topY - botY);
    ref.current.position.set(x, (topY + botY) / 2, 0);
    ref.current.scale.y = len;
  };

  useFrame((_, dt) => {
    const s = stateRef.current;
    const cab = s.features.cabin.properties;
    const pf = s.features.predicted_failures.properties;
    const cabY = cabinCenterY(Math.max(0, Math.min(NUM_FLOORS - 1, num(cab.current_floor))));
    // Counterweight mirrors the cabin vertically
    const cwY = (CH / 2 + (MAXY + CH / 2)) - cabY;
    if (cwGroup.current) cwGroup.current.position.y = lerp(cwGroup.current.position.y, cwY, Math.min(1, dt * 2.2));
    setRope(rope1, ropeTopY, cabY + CH / 2, sheaveX - 0.35);
    setRope(rope2, ropeTopY, (cwGroup.current ? cwGroup.current.position.y : cwY) + 0.9, sheaveX + 0.35);
    // Rope tension health -> colour
    const tension = num(pf.rope_tension_pct, 100);
    const col = tension < 70 ? palette.ropeWarn : palette.rope;
    rope1Mat.current?.color.set(col);
    rope2Mat.current?.color.set(col);
  });

  return (
    <group>
      <mesh ref={rope1}>
        <cylinderGeometry args={[0.018, 0.018, 1, 8]} />
        <meshStandardMaterial ref={rope1Mat} color={palette.rope} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh ref={rope2}>
        <cylinderGeometry args={[0.018, 0.018, 1, 8]} />
        <meshStandardMaterial ref={rope2Mat} color={palette.rope} roughness={0.6} metalness={0.4} />
      </mesh>
      <group ref={cwGroup} position={[sheaveX + 0.35, MAXY / 2, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered("counterweight"); }}
        onPointerOut={() => setHovered(null)}>
        <mesh>
          <boxGeometry args={[0.5, 1.6, 0.5]} />
          <meshStandardMaterial color={palette.counterweight} roughness={0.6} metalness={0.5} />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(0.5, 1.6, 0.5)]} />
          <lineBasicMaterial color={palette.shaftEdge} />
        </lineSegments>
      </group>
    </group>
  );
}

// ── Per-floor hall-call lights ───────────────────────────────────────────────
function FloorCalls({ stateRef, palette }) {
  const refs = useRef(Array.from({ length: NUM_FLOORS }, () => ({ mesh: null, mat: null })));
  useFrame(() => {
    const s = stateRef.current;
    const q = s.features.request_queue.properties;
    const up = q.hall_up || [], down = q.hall_down || [], cabinCalls = q.cabin || [];
    for (let i = 0; i < NUM_FLOORS; i++) {
      const r = refs.current[i];
      if (!r.mat) continue;
      const called = up[i] || down[i] || cabinCalls[i];
      const priority = q.priority_active && q.priority_floor === i;
      const target = priority ? palette.crit : called ? palette.warn : palette.idle;
      r.mat.color.set(target);
      r.mat.emissive.set(target);
      r.mat.emissiveIntensity = priority ? 0.6 + 0.4 * Math.sin(performance.now() / 220)
        : called ? 0.6 : 0.05;
    }
  });
  const halfW = CW / 2 + 0.5;
  return (
    <group>
      {Array.from({ length: NUM_FLOORS }, (_, i) => (
        <mesh key={i} position={[halfW - 0.06, i * GAP + 0.6, CD / 2 + 0.1]}
          ref={(el) => { if (el) { refs.current[i].mesh = el; refs.current[i].mat = el.material; } }}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshStandardMaterial color={palette.idle} emissive={palette.idle} emissiveIntensity={0.05} />
        </mesh>
      ))}
    </group>
  );
}

// ── Scene composition ────────────────────────────────────────────────────────
function SceneContents({ stateRef, palette, showLabels, setHovered }) {
  const sheaveRef = useRef();
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={[0xbcd0e8, 0x1a1f27, 0.5]} />
      <directionalLight position={[6, 12, 8]} intensity={0.9} />
      <directionalLight position={[-6, 4, -6]} intensity={0.25} />
      <group position={[0, -MAXY / 2 - CH / 2, 0]}>
        <Hoistway palette={palette} showLabels={showLabels} />
        <GuideRails palette={palette} />
        <RopesAndCounterweight stateRef={stateRef} palette={palette} setHovered={setHovered} />
        <TractionMachine stateRef={stateRef} palette={palette} setHovered={setHovered} sheaveRef={sheaveRef} />
        <Cabin stateRef={stateRef} palette={palette} setHovered={setHovered} />
        <FloorCalls stateRef={stateRef} palette={palette} />
      </group>
      <OrbitControls enablePan={false} minDistance={6} maxDistance={20}
        minPolarAngle={0.35} maxPolarAngle={Math.PI / 1.9} target={[0, 0, 0]} />
    </>
  );
}

// ── HTML HUD label style (shared) ────────────────────────────────────────────
const hudLabel = {
  font: "600 11px ui-monospace, Consolas, monospace",
  color: "#cdd5e0", background: "rgba(20,26,34,0.7)",
  border: "1px solid rgba(120,140,170,0.25)", borderRadius: 6,
  padding: "1px 6px", whiteSpace: "nowrap",
};

// ── Live HUD readout for a hovered element ───────────────────────────────────
function hoverReadout(key, s) {
  if (!key) return null;
  const c = s.features.cabin.properties, m = s.features.motor.properties, d = s.features.door.properties;
  switch (key) {
    case "cabin": return ["Cabin", `Floor ${FLOOR_LABELS[c.current_floor] ?? "?"} -> ${FLOOR_LABELS[c.target_floor] ?? "?"} · ${c.direction} · ${Math.round(c.load_kg)}kg · ${num(c.temperature_c).toFixed(1)}degC`];
    case "motor": return ["Electric motor", `${num(m.temperature_c).toFixed(1)}degC · vib ${num(m.vibration_level).toFixed(3)}g · ${m.health_status} · ${num(m.current_draw_a).toFixed(1)}A · ${num(m.power_kw).toFixed(2)}kW`];
    case "doors": return ["Doors", `${d.state} · ${num(d.cycle_count)} cycles · ${num(d.obstruction_events)} obstructions`];
    case "counterweight": return ["Counterweight", "Balances the cabin — travels opposite"];
    default: return null;
  }
}

// ── Public component ─────────────────────────────────────────────────────────
export default function DigitalTwinScene({ state, sendFloor, movementBlocked = false, height = 380 }) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const [mounted, setMounted] = useState(false);
  const [palette, setPalette] = useState(readTwinPalette);
  const [showLabels, setShowLabels] = useState(true);
  const [hovered, setHovered] = useState(null);
  useEffect(() => { setMounted(true); setPalette(readTwinPalette()); }, []);

  const attr = state.attributes;
  const cab = state.features.cabin.properties;
  const modeColor = attr.system_mode === "NORMAL" ? T.green : attr.system_mode === "MAINTENANCE" ? T.yellow : T.red;
  const readout = hoverReadout(hovered, state);

  return (
    <div style={{ position: "relative", width: "100%", height, borderRadius: 16, overflow: "hidden", border: `1px solid ${T.border}`, background: `radial-gradient(circle at 50% 18%, ${T.surfaceHi}, ${T.bg})` }}>
      {mounted && (
        <Canvas shadows dpr={[1, 2]} camera={{ position: [7, 5, 9], fov: 38 }} style={{ cursor: hovered ? "pointer" : "grab" }}>
          <SceneContents stateRef={stateRef} palette={palette} showLabels={showLabels} setHovered={setHovered} />
        </Canvas>
      )}

      {/* Top-left status */}
      <div style={{ position: "absolute", top: 10, left: 12, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        <span style={{ ...badge, color: modeColor, borderColor: `${modeColor}55` }}>{attr.system_mode}</span>
        <span style={{ ...badge, color: T.cyan, borderColor: `${T.cyan}55` }}>RISK {Math.round(attr.risk_score)}</span>
        <span style={{ ...badge, color: T.textSub }}>{cab.direction} · {num(cab.speed_ms).toFixed(2)} m/s</span>
      </div>

      {/* Top-right controls */}
      <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setShowLabels(v => !v)} style={ctrlBtn(showLabels)}>Labels</button>
      </div>

      {/* Hover readout */}
      {readout && (
        <div style={{ position: "absolute", bottom: 54, left: 12, right: 12, ...panel, pointerEvents: "none" }}>
          <strong style={{ color: T.cyan, marginRight: 8 }}>{readout[0]}</strong>
          <span style={{ color: T.textSub }}>{readout[1]}</span>
        </div>
      )}

      {/* Dispatch dock */}
      <div style={{ position: "absolute", bottom: 10, left: 12, display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ color: T.textMute, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 2 }}>Dispatch</span>
        {Array.from({ length: NUM_FLOORS }, (_, i) => (
          <button key={i} type="button" disabled={movementBlocked || !sendFloor}
            onClick={() => sendFloor && sendFloor(i)}
            title={movementBlocked ? "Movement blocked by active safety state" : `Dispatch to floor ${FLOOR_LABELS[i]}`}
            style={dispatchBtn(cab.current_floor === i, cab.target_floor === i, movementBlocked)}>
            {FLOOR_LABELS[i]}
          </button>
        ))}
      </div>
    </div>
  );
}

const badge = { display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", background: "rgba(13,22,38,0.72)", border: "1px solid transparent", fontFamily: "ui-monospace, Consolas, monospace" };
const panel = { background: "rgba(13,22,38,0.82)", border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontFamily: "ui-monospace, Consolas, monospace", backdropFilter: "blur(3px)" };
function ctrlBtn(active) { return { padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: active ? T.cyanDim : "rgba(13,22,38,0.72)", color: active ? T.cyan : T.textSub, border: `1px solid ${active ? T.cyan + "66" : T.border}`, cursor: "pointer" }; }
function dispatchBtn(isCurrent, isTarget, blocked) {
  return {
    width: 34, height: 34, borderRadius: 9, fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, Consolas, monospace",
    background: isCurrent ? T.blueDim : "rgba(13,22,38,0.72)",
    color: isCurrent ? T.blue : isTarget ? T.cyan : T.textSub,
    border: `1px solid ${isCurrent ? T.blue : isTarget ? T.cyan : T.border}`,
    cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.5 : 1,
  };
}
