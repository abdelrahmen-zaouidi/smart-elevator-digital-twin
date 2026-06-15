# AI-Adaptive Dispatch Policy Engine — Implementation

> Status: implemented (software). The dual-brain dispatch engine selects the most
> suitable dispatch *logic* for the live building/machine context, explains why,
> exposes it in the twin, and lets a human override it. Brain A (deterministic
> scorer + optional LLM narration) is the champion; Brain B (ML) trains in shadow
> and is promoted only after it provably wins.

This document records what was built. The design rationale lives in
[adaptive-dispatch-ai-prompt.md](adaptive-dispatch-ai-prompt.md).

---

## Architecture (live software loop)

```
Ditto twin ──► dispatchEngine ──► planDispatchUpdate ──► /api/commands gate ──► Ditto control/dispatch_policy
   ▲                │                  │  (active brain binding)                         │
   │                │                  └─ shadow brains (recorded, never applied)        │ bridge fanout (RFC-7396 merge)
   │                └─ POST /api/dispatch/log ──► dispatch_decision_log                  ▼
   └──────────── device_applied_policy ◄── simulator/firmware adopts ◄── DISPATCH_POLICY MQTT command
```

- **Ditto is the source of truth.** Policy intent lives at
  `features/control/properties/dispatch_policy`; the device reports what it is
  actually running at `features/control/properties/device_applied_policy`.
- **Everything actuating goes through the command safety gate** (`SET_DISPATCH_POLICY`).
- **Both brains share one feature builder, one algorithm layer, one reward function.**

## The two brains (champion–challenger)

| | Brain A (`scorer_v1`) | Brain B (`ml_v1`) |
|---|---|---|
| Type | Deterministic weighted scorer + optional Ollama narration | Softmax linear model over the shared feature vector |
| Role | **ACTIVE / champion** — binds the decision | **STANDBY / challenger** — shadow only |
| Explainable | score table (named terms) | per-feature weight attributions |
| Promotion | always installed (safe fallback) | promoted only after passing the gates + human approval |

Switching is one flag: `DISPATCH_ACTIVE_BRAIN=scorer_v1|ml_v1` (rollback = flip back).

## Dispatch policies (the "logics")

`SCAN_COLLECTIVE` (default), `UP_PEAK`, `DOWN_PEAK`, `ECO_ENERGY`, `NEAREST_GREEDY`,
`HEALTH_LIMP`, `BALANCED_INTERFLOOR`, `SECURITY_RESTRICTED`. Hard safety overrides
pre-empt all of them: `FIRE_RECALL`, `EMERGENCY_STOP`, `FULL_LOCKDOWN`, `OVERLOAD_HOLD`.

Selection is **multi-factor**, not clock-driven: empirical up/down-call ratio, lobby
origin, queue/starvation, energy tariff + power-vs-baseline + kWh budget, motor
temp/vibration/**RUL**, load, security state, and a fairness SLA that disqualifies
energy-saving policies once a call starves.

## Files

Shared library — `packages/shared/dispatch/`:
- `constants.js` — policy/override IDs, geometry, tunable config.
- `context.js` — `buildContext()` feature builder + `contextToFeatureVector()` (shared flat vector).
- `policies.js` — 8 policies + 4 overrides with scoring affinities; `detectOverride()`.
- `scorer.js` — Brain A `selectDispatchPolicy()` + `createScorerBrain()` (guardrails, hysteresis, confidence).
- `brainML.js` — Brain B `createMlBrain()` + seed model.
- `reward.js` — shared reward function + `machineStressProxy()`.
- `evaluation.js` — offline outcome proxy + `evaluateBrains()` + `evaluatePromotion()`.
- `orchestrator.js` — `planDispatchUpdate()` (twin→context→decide→command→gate preview).
- `models/ml_v1.json` — trained Brain B spec (generated).

Wiring:
- `packages/shared/commandSafetyGate.js` — `SET_DISPATCH_POLICY` catalog entry + validation.
- `apps/dashboard/app/api/commands/route.js` — device-action intent (carries `policy_id`/`params`).
- `services/ditto-bridge/bridge.js` — translates the intent to a `DISPATCH_POLICY` MQTT command.
- `services/dispatch/dispatchEngine.mjs` — the live loop (active + shadow brains, decision logging).
- `apps/dashboard/app/api/dispatch/route.js` — read-only status; `app/api/dispatch/log/route.js` — decision log.
- `apps/dashboard/app/api/history/dispatch/route.js` — decisions + reward history.
- `apps/dashboard/components/scada/DispatchPolicyPanel.jsx` — SCADA panel + manual override.
- `esp32_simulator.py` — adopts policy params (park/bias/speed/dwell/restrict), reports applied policy.
- `infra/postgres/migrations/006_dispatch_policy_engine.sql` — decision/outcome stores + model registry.
- `scripts/init-ditto.{ps1,sh}` — seed `control/dispatch_policy`.

## How to run

```bash
# 1. provision Ditto (seeds control/dispatch_policy)
./scripts/init-ditto.sh                       # or .ps1 on Windows
# 2. apply the migration
psql ... -f infra/postgres/migrations/006_dispatch_policy_engine.sql
# 3. start the dashboard (gate + APIs + panel) and the simulator
cd apps/dashboard && npm run dev
docker compose --profile simulator up -d simulator
# 4. start the dispatch engine (Brain A active, Brain B shadow)
node services/dispatch/dispatchEngine.mjs            # add --once --dry-run to preview

# Train + evaluate Brain B
node scripts/dispatch/generate-training-data.mjs --n 4000
node scripts/dispatch/train-brain-b.mjs
node scripts/dispatch/evaluate-brains.mjs --n 2000   # prints the promotion-gate report

# Promote (only after the gates pass + human review):
#   DISPATCH_ACTIVE_BRAIN=ml_v1 node services/dispatch/dispatchEngine.mjs     # rollback: scorer_v1
```

## Tests (all green)

| Suite | Count |
|---|---|
| `test-dispatch-policy-engine.mjs` (Brain A + 10 scenarios) | 19 |
| `test-dispatch-safety-gate.mjs` | 13 |
| `test-dispatch-orchestrator.mjs` | 9 |
| `test-dispatch-brain-b.mjs` (Brain B + reward) | 11 |
| `test-dispatch-evaluation.mjs` (promotion gates) | 8 |
| `test-command-safety-gate.mjs` (regression) | 33 |
| `tests/test_simulator.py` (incl. 13 dispatch) | 33 |

## Current status & honest limitations

- Brain B's seed/trained model imitates Brain A at ~66% (linear model can't capture
  every non-linear rule). It is **shadow-only** and currently **not eligible** for
  promotion: its reward margin over Brain A does not clear the gate — the system
  correctly keeps Brain A active.
- The outcome model used offline is a transparent **proxy** (`evaluation.js`). The
  live system records real `dispatch_outcome` rows; the sim-to-real gap is a thesis
  limitation. The promotion pipeline is the same either way.
- When Brain B is made active, hysteresis is currently applied only on the Brain A
  path; wrapping the active brain in hysteresis is a small follow-up before any real
  ML promotion.
- Live end-to-end (DISP-08) needs the full stack running; the software loop is
  verified in `--dry-run` and by the unit suites.
