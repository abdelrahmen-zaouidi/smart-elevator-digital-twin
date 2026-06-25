# Master Prompt — Enterprise Digital-Twin UI/UX Upgrade

> Paste this into a fresh agent/Claude Code session at the repo root.
> It is grounded in the **actual** state of `apps/dashboard` as of this writing.
> Edit the `SCOPE` knobs at the bottom before running if you want a smaller first slice.

---

## ROLE

You are a **senior product designer + front-end architect** specializing in
industrial SCADA, IoT control rooms, and **digital-twin visualization**. You ship
**calm, dense, trustworthy enterprise software** — the visual language of
Honeywell/Siemens/AVEVA control rooms and Linear/Vercel-grade product polish,
**not** a neon "hacker dashboard." You refactor large codebases safely: small
verifiable steps, no behavior regressions, no broken data wiring.

## MISSION

Transform the Smart Elevator Digital Twin dashboard from a working-but-rough
single-file prototype into a **real, professional, enterprise-grade product** —
in both **architecture** and **UI/UX** — with a genuinely **reactive, interactive,
physically-faithful digital-twin visualization** at its core. Refine, enhance,
restyle, modernize, restructure, and **delete dead code**. Calm and organized over
flashy.

---

## GROUND TRUTH (verify before changing — do not trust this blindly, re-read the files)

**App:** Next.js (App Router) in `apps/dashboard`. Entry: `app/page.tsx` →
`components/ElevatorOS.jsx`.

**The core problem — a monolith:**
- `components/ElevatorOS.jsx` is **~5,054 lines / 271 KB in ONE file**. It contains:
  design tokens, the entire `useDigitalTwinEngine` state engine, telemetry
  normalization, ~30 page components (`PageTwin`, `PageMonitoring`,
  `PageControlPanel`, `PageAIInsights`, `PageSOC`, `PageAccessControl`,
  `PageMaintenance`, `PageSimulation`, `PageAlerts`, `PageLogs`, `PageDevices`,
  `PageReports`, `PageSettings`, `PageHelp`, login, etc.), ~25 shared components,
  and a 140-line `GlobalStyles` CSS string.

**Three competing styling systems (unify these):**
1. A **mutable module-global token object `T`** (lines ~78–155). It is declared with
   light values, **immediately overwritten** by `Object.assign(T, {…dark…})`, then
   re-mutated at render time by `applyThemeTokens()`. This is an SSR/theming
   anti-pattern (module-level mutable state shared across requests) — replace with
   CSS custom properties (`--eos-*`) + a `data-theme` attribute, or a React theme
   context. Components read `T.cyan` etc. directly today.
2. Inline `style={{…}}` objects scattered through every component.
3. The single giant `GlobalStyles` `<style>` block using `.eos-*` classes.

**Dead / unused code to audit and remove:**
- `components/ui/*` — a **full shadcn/Radix library (~60 files)** that appears largely
  **unused** because `ElevatorOS.jsx` uses inline styles instead. Confirm with a usage
  scan, then **either adopt it as the design-system layer OR delete it** — do not leave
  both. (Decide: adopting shadcn properly is the cleaner long-term path.)
- Duplicate hooks: `hooks/use-mobile.ts` + `components/ui/use-mobile.tsx`,
  `hooks/use-toast.ts` + `components/ui/use-toast.ts`.
- The redundant first `T = {…light…}` block that is overwritten one line later.

**The digital-twin visual is the weakest, highest-value area:**
- `ElevatorShaft` (lines ~2573–2653) is a **flat 2D SVG**: a shaft rectangle, two
  guide-rail lines, a cabin rectangle, sliding door panels, a load bar, a floor number,
  a direction pill. **It is missing every mechanical element of a real elevator.**

**The data is already rich and live — DO NOT break it.** `useDigitalTwinEngine`
(line ~1338) holds all state and ingests **real telemetry** via Eclipse Ditto SSE
(`src/hooks/useDitto.js`, `EventSource` + polling fallback), MQTT, and a simulation
mode. The twin schema (`INIT_STATE`, line ~242) already carries, per feature:
- `cabin`: current/target floor, direction, `load_kg`, `temperature_c`, `speed_ms`,
  `emergency_stop`, `trips_today`
- `door`: state (OPEN/OPENING/CLOSED/BLOCKED), `door_forced_entry`, `cycle_count`,
  `obstruction_events`
- `motor`: `vibration_level`, `hours_operated`, `health_status`, `temperature_c`,
  `current_draw_a`, `power_kw`
- `security`: RFID card/last decision, `unauthorized_access_attempts`, `alert_level`,
  `audio_distress_active`
- `fan`, `request_queue` (dispatch/hall calls), `energy`, `performance`,
  `predicted_failures` (`motor_rul_hours`, `bearing_health_pct`, `door_mechanism_pct`,
  `rope_tension_pct`, `next_service_date`)
- Plus a **command safety gate** (`app/api/commands`, `CommandSafetyGatePanel`,
  `packages/shared/commandLifecycle.js`) — **never** bypass or weaken it.

**Hard rule:** the visualization and structure change; the live data contracts,
Ditto/MQTT wiring, command lifecycle, and safety gate behavior **must not regress**.

---

## DESIGN DIRECTION — "Calm Enterprise Control Room"

**Anti-goals (remove these):** neon/saturated colors, decorative glows and heavy
drop-shadows, gratuitous gradients, rainbow accents, anything that reads as a
"gamer/hacker" theme. Color is for **state and meaning only**, never decoration.

**Palette:**
- Build a single **neutral base ramp** (slate/zinc) for backgrounds, surfaces,
  borders, text — dark theme primary, light theme parity. Low chroma. Generous,
  consistent surface elevation via *border + subtle* shadow, not glow.
- **One** restrained brand accent (a muted blue or teal — desaturated, ~1 hue), used
  sparingly for primary actions and active nav.
- **Semantic-only status colors**, desaturated and accessibility-checked
  (WCAG AA on their surface): `nominal/ok`, `info`, `warning`, `critical`,
  plus a `neutral/idle`. Map existing risk/health logic
  (`riskColor`, `healthColor`, `riskLabel`) onto these tokens — keep the thresholds.
- Encode **every** color as a CSS variable token. No raw hex in components.

**Typography:** one clean UI sans (system stack is fine), one monospace for
telemetry/IDs/timestamps. Establish a real type scale (e.g. 11/12/13/15/17/20/24)
and weight rules. Tighten the current "everything is bold 800–950" look.

**Layout & density:** an 8px spacing grid, consistent card/radius/border tokens, a
clear visual hierarchy (page header → KPI strip → twin → detail grids). Information-
dense but breathable. Responsive down to tablet; the sidebar/topbar already have
mobile behavior — keep and refine it.

**Motion (reactive, not flashy):** purposeful, physics-plausible, fast
(150–400 ms), `prefers-reduced-motion` respected. Motion communicates **state
change** (cabin moving, doors cycling, a value crossing a threshold, a command
in-flight), never idle decoration. Replace ad-hoc SVG `<animate>` and random pulses
with intentional, data-driven transitions.

---

## DIGITAL-TWIN VISUALIZATION — the centerpiece

Replace `ElevatorShaft` with a **modular, component-based, data-bound 2.5D twin**
(SVG, or React-Three-Fiber if you justify the dependency). Every element binds to a
real telemetry field and **reacts in real time**. Build these as separate components
with clean props (no globals), each with a clear data binding and state:

1. **Hoistway / shaft** — multi-floor structure with floor sills, level labels
   (`FLOOR_LABELS`), and call/landing indicators per floor driven by `request_queue`
   (hall up/down, cabin calls, priority floor).
2. **Cabin** — smooth vraisemblable travel between floors bound to `current_floor` →
   `target_floor` with easing that reflects `speed_ms`; load indicator bound to
   `load_kg`/`MAX_LOAD`; interior temp tint from `temperature_c`; **E-stop** state.
3. **Doors** — actual open/close mechanism animation driven by `door.state`
   (OPEN/OPENING/CLOSED/BLOCKED) with an **obstruction/forced-entry** visual when
   `obstruction_events`/`door_forced_entry` fire.
4. **Traction machine / electric motor** — a dedicated **motor + sheave (drive
   pulley)** at the hoistway head. Visualize **rotation speed/direction** bound to
   cabin motion, **temperature** (`motor.temperature_c`), **vibration**
   (`vibration_level` → subtle shake/heat shimmer at thresholds), `current_draw_a`,
   `power_kw`, and `health_status` (GOOD/WARNING/CRITICAL). This is the element the
   user explicitly asked for — make it a first-class, legible part of the twin.
5. **Ropes / traction cables + counterweight** — cables over the sheave with a
   counterweight that moves **opposite** the cabin; rope tint reacts to
   `predicted_failures.rope_tension_pct`.
6. **Guide rails + governor** — rails the cabin tracks; an over-speed/governor cue.
7. **Sensors & devices overlay** — toggleable annotations for the real sensors
   (RFID reader, LCD, buzzer, cooling fan, load cell, vibration/temp probes) tied to
   their live state; this connects the twin to the `Devices/Sensors` page and the
   `firmware`/electrical-schematic reality.
8. **Status & risk HUD** — non-flashy overlay: system mode, risk gauge (reuse
   `RiskGauge` logic, restyled), active warnings, data-source/freshness badge
   (SIMULATION / DITTO SSE / OFFLINE) and "last update" age.

**Interactivity:** hover/click any element → contextual detail (live values, trend
sparkline, related incidents); click a floor → dispatch (respecting the safety gate
and `movementBlocked`); a labels/sensors/cutaway toggle; optional play/scrub of
recent history from the existing timeline buffer. Make the twin feel **alive and
inspectable**, the way a real operator console does.

**Faithfulness:** match the real prototype — **4 floors (0–3)**, the actual sensor
set, deterministic speed model already in `speedEstimator.js`. Don't invent
hardware that doesn't exist; where something is design-only (e.g. KY-024/SPDT noted
in project memory as not in firmware), label it as a design element, not live.

---

## ARCHITECTURE / CODE QUALITY

1. **Decompose the monolith.** Split `ElevatorOS.jsx` into a sane tree, e.g.:
   - `src/twin/` — engine hook, telemetry normalization, state types, selectors.
   - `src/components/twin/` — the digital-twin elements above.
   - `src/components/pages/` — one file per page.
   - `src/components/common/` — `Card`, `KpiTile`, `StatusPill`, `RiskGauge`,
     `TelemetryChart`, badges, modals, toasts.
   - `src/theme/` — tokens + theme provider.
   Keep diffs reviewable: move-then-refactor; don't rewrite logic and relocate it in
   the same step.
2. **One styling system.** Pick **either** adopt the existing shadcn `components/ui`
   properly **or** a tokens-as-CSS-variables + small primitives approach — then make
   the codebase consistent and delete the other path. No more mutable global `T`.
3. **Delete dead code** with evidence (usage scan): unused `components/ui/*`,
   duplicate hooks, the overwritten token block, any orphaned helpers.
4. **No regressions:** preserve all pages, the command lifecycle, safety gate,
   access-control CRUD, history/charts APIs, Ditto/MQTT/sim data sources, light/dark
   theme, mobile/responsive behavior, and accessibility (focus states, keyboard nav,
   reduced motion, ARIA on the SVG twin).
5. **Performance:** the live tick + history buffers must stay smooth; memoize twin
   subcomponents; avoid re-rendering the whole tree on each telemetry sample.

---

## WORKING METHOD

1. **Inspect first.** Read the real files (start with `ElevatorOS.jsx`,
   `useDitto.js`, `INIT_STATE`, `ElevatorShaft`, `GlobalStyles`, the `scada/` panels,
   `components/ui/`). Run a dead-code/usage scan. Produce a short written **findings +
   plan** before large edits, and confirm the staged scope.
2. **Land in small, verifiable PRs/commits**, in this suggested order:
   (a) theme tokens → CSS variables + provider; (b) extract shared primitives;
   (c) split pages out of the monolith; (d) **rebuild the digital-twin visualization**
   (the headline); (e) restyle to the calm palette app-wide; (f) delete dead code;
   (g) polish motion, a11y, responsive, empty/loading states.
3. After each step: **build + lint pass**, click through every page, verify live data
   (or simulation) still flows and the safety gate still blocks unsafe commands.
   Show before/after for visual changes.
4. Match the surrounding code's conventions. Don't add dependencies without
   justification. Ask only when a decision is genuinely blocking; otherwise pick the
   sensible enterprise default and note it.

## DELIVERABLES

- Restructured `apps/dashboard` (no monolith), one consistent styling system, dead
  code removed.
- A modular, reactive, physically-faithful **digital-twin** with motor/sheave,
  doors, counterweight/ropes, rails, cabin, sensors overlay, and interactive HUD —
  all bound to live telemetry.
- A **calm enterprise visual language** (token file + brief design notes) applied
  across every page.
- A short **CHANGELOG / migration note**: what moved, what was deleted (and why it was
  safe), what to verify.

## ACCEPTANCE CRITERIA

- [ ] No single component file is a multi-thousand-line monolith; pages/elements are
      modular.
- [ ] Exactly one styling system; no mutable module-global theme object; tokens are
      CSS variables; light + dark both correct.
- [ ] Palette is calm/desaturated; color appears only for state/meaning; passes
      WCAG AA on key text/status.
- [ ] The digital twin shows and **reactively animates** motor/sheave, doors,
      cabin+counterweight+ropes, rails, per-floor calls, and a sensors overlay, each
      bound to a real field; interactions (hover/click/dispatch/toggles) work.
- [ ] All existing pages and flows work; Ditto/MQTT/simulation data still drives the
      UI; command safety gate still blocks unsafe commands; nothing in
      `services/`, `packages/shared/`, `workflows/`, `firmware/` is broken.
- [ ] Dead code removed with a usage-scan rationale; build + lint clean;
      `prefers-reduced-motion` and keyboard/focus behavior respected.

---

## SCOPE KNOBS (set before running)

- **Slice:** `full upgrade` | `twin-visual-only first` | `architecture-refactor first`
- **Styling target:** `adopt shadcn/ui` | `CSS-variable tokens + light primitives`
- **Twin tech:** `SVG/CSS 2.5D` (default) | `React-Three-Fiber 3D` (justify the dep)
- **Branch:** work on a feature branch; small commits; do **not** push or open a PR
  unless asked.
