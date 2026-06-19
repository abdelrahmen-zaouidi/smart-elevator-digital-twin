# n8n Agent Workflow Audit (Phase A)

> Read-only inspection of the 6 n8n workflows in `workflows/n8n/` and their integration
> with Eclipse Ditto, Postgres/Timescale, and the Next.js dashboard. **No files were
> changed.** This report ends with open questions and a prioritized findings list; Phase B
> (changes) must not begin until these are approved.
>
> Scope verified against: the 6 `*.json` workflows, `workflows/n8n/enterprise-upgrade-code/*.js`,
> `infra/postgres/init/001_timescaledb.sql`, `infra/postgres/migrations/002/004/005/006`,
> and the dashboard routes under `apps/dashboard/app/api/{agent,commands,history}/`.

---

## A1. Inventory (per workflow)

### `01_ingestion_surveillance_agent.json` (active) — id `TZGSTLLctLRe52k5`
Trigger: **scheduleTrigger** every **5 s**. Pipeline:

| Node | Type / ver | External call | Error handling |
|---|---|---|---|
| Schedule: Poll Ditto Every 5s | scheduleTrigger v1 | — | — |
| GET Current Thing from Ditto | httpRequest 4.1 | `GET {DITTO_BASE_URL}/api/2/things/{PRIMARY_THING_ID}`, httpBasicAuth `Authentication` | retry×3, `onError: continueErrorOutput` → DLQ |
| Canonicalize Twin Event | code v2 | — | builds canonical event + `duplicate_hash` + `timeline_entry` |
| Dedupe & Update Timeline | code v2 | — | `$getWorkflowStaticData('global')`; sets `duplicate`, `risk_score` seed |
| Prepare DB Row | code v2 | — | builds parameterized `_db_query`/`_db_params` |
| Archive Telemetry to Postgres | postgres 2.6 | `INSERT … telemetry_raw … ON CONFLICT(event_id)` | **none — no retry, no onError** ⚠ |
| Route: Significant Event? | if v1 | — | forwards only `event_type != TELEMETRY_UPDATE` |
| Queue Analysis Agent | httpRequest 4.1 | `POST n8n:5678/webhook/analysis-agent` | retry×3 |
| Queue Audit Agent | httpRequest 4.1 | `POST n8n:5678/webhook/audit-agent` | retry×3 |
| Dead-Letter Ingestion Failure | code v2 | — | counts `ditto_failures` in static data |
| Audit Ingestion Failure | httpRequest 4.1 | `POST …/webhook/audit-agent` | retry×3 |

### `02_analysis_ai_brain_agent.json` (active) — id `krTefMrILF9CMRAE`
Trigger: **webhook** `analysis-agent`. Nodes: Deterministic Risk Engine (code) → Route: LLM Required? (`risk_score ≥ 30`) → LLM Context Analyzer (code, Ollama `POST {LOCAL_LLM_URL}/api/chat`, gated by `LOCAL_LLM_ENABLED`) **or** LLM Skipped → Finalize Risk Analysis → fan-out to **Write Risk Score to Ditto** (`PUT …/attributes/risk_score`), **Write AI Analysis to Ditto** (`PUT …/features/ai_analysis`), **Route: Notify Advisory?** → Queue Notification Agent, **Route: Action Required?** → Action Router → Route Control/Security/Maintenance → Queue Control/Security/Maintenance Agent. All Ditto writes httpBasicAuth + retry×3.

### `03_control_agent.json` (active) — id `fYSnnxjFFZ1KKXZK`
Trigger: **webhook** `control-agent`. Nodes: **Control Safety Gate** (code, deterministic allow-list + write plan) → fan-out to **Persist Control Command State** (postgres `control_command_log`, retry×3) and **Route: Control Validated?**. Validated → Audit Control Dispatch + **Explode Ditto Writes** (code) → **PUT Desired State to Ditto** (`PUT …/{path}`, retry×3, `onError: continueErrorOutput`) → Audit Successful Write / Dead-Letter Control Write → Audit Failed Write. Rejected → Audit Control Rejected.

### `04_security_maintenance_agents.json` (active) — id `dEbsAQc8JujdcYnP`
Three independent sub-flows in one workflow:
- **Security**: webhook `security-agent` → Security State Machine (code, `$getWorkflowStaticData` RFID memory) → Write Security State to Ditto (`PUT …/features/security/properties`), Route: Notify Security? → Queue Security Notification, Route: Lockdown? → Build Lockdown Request → Queue Control Lockdown (`POST …/webhook/control-agent`).
- **Maintenance (scheduled)**: **scheduleTrigger `{field:"hours"}`** → GET Current Thing → Normalize Maintenance Snapshot → Predictive Maintenance Engine → Persist Maintenance Work Order (`maintenance_work_orders`) + Ensure Maintenance Feature Exists → Write Maintenance Schedule to Ditto → Route: Notify Maintenance? → Queue Maintenance Notification.
- **Maintenance (event)**: webhook `maintenance-agent` → Predictive Maintenance Engine (shared).

### `05_notification_agent.json` (active) — id `51HelS8BzpPFccp6`
Trigger A: **webhook** `notification-agent` → Build Notification Outbox Rows (code, env-gated channels) → Insert Notification Outbox Row (`notification_outbox … ON CONFLICT(dedupe_key) DO NOTHING`).
Trigger B: **scheduleTrigger** every **1 min** → Claim Due Notifications (`UPDATE … FOR UPDATE SKIP LOCKED`, excludes `channel='dashboard'`) → Format Delivery Payload (code) → Route Telegram/Email/SMS/Voice → Send (telegram / emailSend / httpRequest, each `onError: continueErrorOutput`) → Mark Notification Sent / Mark Notification Failed (exponential backoff).

### `06_optimization_audit_agents.json` (active) — id `scY8eOqx6E4T0kHR`
Four independent sub-flows:
- **Predictive dispatch** (sched 15 m): GET Thing → Extract Dispatch Context → Query Demand Floor (`telemetry_raw` mode by hour/DOW) → Decide Predictive Dispatch → Route: Dispatch? → Queue Predictive Dispatch (`→ control-agent`).
- **Energy** (sched 15 m): GET Thing → Extract Energy Context → Query Energy Baseline (`telemetry_raw` 7 d) → Energy Optimization Engine → Route: Notify Energy? → Queue Energy Maintenance Review (`→ maintenance-agent`) + Queue Energy Notification (`→ notification-agent`).
- **Weekly compliance** (sched weekly Mon 08:00): Query Weekly Compliance Report → Format → Send Compliance Email (SMTP).
- **Audit sink**: webhook `audit-agent` → Insert Audit Log (`audit_log`).

**Credentials in use** (3): httpBasicAuth `Authentication` (id `DHKgydzDWawM8nkx`), postgres `Postgres account` (id `Y3xIBg0WwpRKadx2`), telegram `Telegram account`, smtp `SMTP account`. **Webhooks (6, all unauthenticated):** `analysis-agent`, `control-agent`, `security-agent`, `maintenance-agent`, `notification-agent`, `audit-agent`. Node typeVersions observed: webhook v1, httpRequest 4.1, postgres 2.6, code v2, if v1.

---

## A2. End-to-end data flow & canonical contract

```
                  ┌─────────────── 5s poll ───────────────┐
 Eclipse Ditto ──▶ 01 ingestion ──INSERT──▶ telemetry_raw  │
 (building:floor1  │  canonical event {correlation_id,     │
  :elevator)       │   event_id, thing_id, event_type,     │
                   │   severity, system_mode, payload{     │
                   │   cabin,door,motor,security},          │
                   │   timeline_entry, duplicate_hash}      │
                   └─ if event_type≠TELEMETRY_UPDATE ─▶ POST /analysis-agent
                                                              │
 02 analysis  ◀───────────────────────────────────────────┘
   Deterministic Risk Engine → risk_analysis{risk_score,severity,flags,
     breakdown, action_required, requires_human_review, triggered_action}
   (≥30 → optional Ollama summary, non-authoritative)
   ├─ PUT Ditto /attributes/risk_score   (number)
   ├─ PUT Ditto /features/ai_analysis     (properties{…})
   ├─ severity≠OK → POST /notification-agent
   └─ action_required → Action Router (1..n triggered_action items)
        ├ agent=control      → POST /control-agent
        ├ agent=security     → POST /security-agent
        └ agent=maintenance  → POST /maintenance-agent

 03 control   ◀── /control-agent (also from 04 lockdown, 06 dispatch)
   Control Safety Gate → control_command{command_id, status:VALIDATED|REJECTED,
     writes:[{path,value}], rejection_reasons[]}
   ├─ INSERT control_command_log  (THIN row — see A4)
   └─ VALIDATED → Explode → PUT Ditto /{path}  → audit-agent

 04 security/maint  ◀── /security-agent, /maintenance-agent, sched
   → PUT Ditto /features/security/properties, /features/maintenance_schedule
   → INSERT maintenance_work_orders ; LOCKDOWN → POST /control-agent

 05 notify   ◀── /notification-agent → INSERT notification_outbox
   sched 1m drain → Telegram/Email/SMS/Voice (dashboard rows pre-marked SENT)

 06 optim/audit  sched → telemetry_raw analytics → /control-agent, /maintenance-agent
   webhook /audit-agent ◀── ALL agents → INSERT audit_log

 Dashboard reads: /api/agent/activity (dispatch_decision_log + control_command_log),
   /api/history/{telemetry,risk,energy,audit,commands,maintenance,notifications,
   system-health,dispatch}
```

**Canonical event schema** is defined in `01 → Canonicalize Twin Event` (and the identical
`enterprise-upgrade-code/01_canonicalize_twin_event.js`) and re-derived/extended in
`02 → Deterministic Risk Engine` and `Finalize Risk Analysis`. `correlation_id` is minted in
01, threaded through 02→03/04/05, and persisted to every table. It is **not** schema-validated
anywhere (no JSON schema / shared module); each consumer defensively unwraps `raw.body`.

---

## A3. Reconciliation — `enterprise-upgrade-code/*.js` vs embedded JSON

Legend: **APPLIED** = byte-equivalent to the embedded node; **NOT APPLIED (newer)** = file is
ahead of the embedded node; **NOT WIRED** = no corresponding live node exists.

| `.js` file | Maps to node | Status | Evidence / note |
|---|---|---|---|
| `01_canonicalize_twin_event.js` | 01 Canonicalize Twin Event | **APPLIED** ✅ | Verified identical line-for-line. |
| `03_control_safety_gate.js` | 03 Control Safety Gate | **NOT APPLIED (newer)** 🔴 | See below — most important divergence. |
| `07_system_health_aggregator.js` | *(none)* | **NOT WIRED** 🟠 | No `07` workflow / no health node anywhere. Also emits an `AUDIT_EVENT` payload, **not** a `system_health_history` row. |
| `06_audit_event_normalizer.js` | *(none)* | **NOT WIRED** 🟠 | 06 `Insert Audit Log` inlines the same normalization inside the SQL `queryReplacement` instead of using a Code node. |
| `01_dedupe_update_timeline.js` | 01 Dedupe & Update Timeline | Presumed APPLIED | Filename↔node match; spot-diff recommended. |
| `01_prepare_telemetry_params.js` | 01 Prepare DB Row | Presumed APPLIED | Node renamed; logic matches. |
| `02_ollama_context_analyzer.js` | 02 LLM Context Analyzer | Presumed APPLIED | |
| `02_deterministic_risk_engine.js` | 02 Deterministic Risk Engine | Presumed APPLIED | |
| `02_finalize_risk_analysis.js` | 02 Finalize Risk Analysis | Presumed APPLIED | |
| `02_action_router.js` | 02 Action Router | Presumed APPLIED | |
| `03_explode_ditto_writes.js` | 03 Explode Ditto Writes | Presumed APPLIED | |
| `04_security_state_machine.js` | 04 Security State Machine | Presumed APPLIED | |
| `04_predictive_maintenance_engine.js` | 04 Predictive Maintenance Engine | Presumed APPLIED | |
| `05_build_notification_outbox_rows.js` | 05 Build Notification Outbox Rows | Presumed APPLIED | |
| `05_format_delivery_payload.js` | 05 Format Delivery Payload | Presumed APPLIED | |
| `06_energy_optimization_engine.js` | 06 Energy Optimization Engine | Presumed APPLIED | |

**The control-safety-gate divergence (headline of A3).** The embedded gate in
`03_control_agent.json` is the *older* implementation. The `.js` file is *newer and aligned with
the dashboard's canonical gate* (`packages/shared/commandSafetyGate.js`):

| Aspect | Embedded (live) | `03_control_safety_gate.js` (unapplied) |
|---|---|---|
| Command vocabulary | n8n-only verbs (`REPOSITION`, `MAINTENANCE_MODE`, `RESUME_NORMAL`, `CLEAR_SECURITY_ALERT`…) | **ALIAS map → canonical dashboard verbs** (`MOVE_TO_FLOOR`, `RELEASE_LOCKDOWN`, `RESET_EMERGENCY`…) |
| `MAX_FLOOR` default | **10** (wrong for the 4-floor F0–F3 rig) | **3** |
| Risk thresholds | single `MAX_RISK_AUTO_CONTROL=85` | source-aware `auto=70` / `operator=85` |
| Stale-twin check | none | `MAX_TWIN_AGE_SECONDS` |
| Emits for dashboard | `status` only | **`decision`, `accepted`, `source`, `safety_snapshot`, `raw_command_name`, `canonical_command`** |

Applying it is the single change that would close the `/api/agent/activity` GATE-feed drift in
A4 — **but only if the `Persist Control Command State` INSERT is updated in lockstep** to write
those new columns (it currently does not). Treat as one coordinated change, not two.

---

## A4. Integration map & orphans

| Store / contract | Producer(s) | Consumer(s) | Status |
|---|---|---|---|
| `telemetry_raw` | 01 ingestion | `/api/history/{telemetry,risk,energy,summary}`, 06 analytics, `hourly_*` cont. aggs | ✅ healthy |
| `audit_log` | 06 `audit-agent` sink + dashboard `/api/commands` | `/api/history/audit` | ✅ healthy |
| `notification_outbox` | 05 | `/api/history/notifications`, 05 drain | ✅ healthy |
| `maintenance_work_orders` | 04 | `/api/history/maintenance` | ✅ healthy |
| `control_command_log` | **dashboard `/api/commands` (full envelope)** + **03 control agent (thin row)** | `/api/agent/activity` GATE, `/api/history/commands` | 🔴 **contract drift** |
| `dispatch_decision_log` | dashboard dual-brain dispatch engine | `/api/agent/activity` REASON, `/api/history/dispatch` | 🟠 **n8n 06 dispatch bypasses it** |
| `system_health_history` | **nobody** | `/api/history/system-health` | 🟠 **orphan read (panel always empty)** |
| Ditto `features/control/.../pending_command` | dashboard `/api/commands` only | ditto-bridge → MQTT firmware | 🟠 **03 control agent does not use it** |

**🔴 `control_command_log` drift (most user-visible bug).** `/api/agent/activity` reads
top-level columns `decision, accepted, command_label, source, rejection_reasons`. The dashboard
gate (`apps/dashboard/app/api/commands/route.js`) writes all of them. The n8n control agent's
`Persist Control Command State` writes only `command_id, correlation_id, thing_id, command,
requested_by, source_agent, reason, risk_score, status, metadata` — leaving `accepted` and
`decision` **NULL**. The activity feed then computes `decision = r.decision || (r.accepted ?
"ACCEPTED" : "REJECTED")` → **every autonomous (n8n) control action renders as `REJECTED` with a
blank label** in the SCADA "agent activity" panel, even when it was VALIDATED and written to
Ditto. This directly undercuts the "agents visibly act on real data" story.

**🟠 Two dispatch deciders.** `dispatch_decision_log` (the REASON feed + dual-brain Brain A/B
audit) is written by the dashboard dispatch engine. n8n `06` runs its **own** simpler predictive
dispatch (`mode()` of historical floor) and posts `REPOSITION` straight to `control-agent` —
never logging to `dispatch_decision_log` and never passing through the dual-brain scorer. Two
uncoordinated brains can issue conflicting reposition intents; the n8n one is invisible to the
dashboard reasoning feed.

**🟠 Bridge/actuation inconsistency.** The dashboard writes a durable
`features/control/properties/pending_command` intent (with a unique `command_id`) precisely
because telemetry overwrites physical state like `cabin/target_floor` every tick; the bridge
fans that intent to MQTT. The n8n control agent instead PUTs desired values **directly** onto
`features/cabin/properties/target_floor`, `emergency_stop`, `attributes/system_mode`. Those can
be clobbered by the next 5 s telemetry merge-patch and are **not** guaranteed to reach the
firmware over MQTT.

**🟠 Two safety-gate implementations / two sources of truth** for "what control is admissible":
the embedded n8n JS gate and `packages/shared/commandSafetyGate.js`. The unapplied
`03_control_safety_gate.js` is an attempt to converge them but is not live.

---

## A5. Risk & gap register (ranked)

Severity × effort; **H/M/L**. "Effort" is rough implementation size.

| # | Sev | Eff | Finding | Evidence |
|---|---|---|---|---|
| F1 | **H** | M | **Unauthenticated `control-agent` webhook.** Any host able to reach `n8n:5678` can POST a forged `triggered_action:{command:'LOCKDOWN'}`; it passes the gate and writes to Ditto. Only Docker network isolation protects it. | 6 webhooks have `options:{}` (no auth) |
| F2 | **H** | M | **`control_command_log` drift** → autonomous actions show as REJECTED/blank in dashboard (A4). | `03` persist node vs `/api/commands` persist vs `/api/agent/activity` SELECT |
| F3 | **H** | S | **Embedded control gate is stale** (`MAX_FLOOR=10` on a 4-floor rig; n8n-only verbs; no stale-twin/`decision`/`accepted`). Newer `03_control_safety_gate.js` exists but unapplied. | A3 table |
| F4 | **M** | S | **`telemetry_raw` INSERT has no retry/onError.** A transient DB blip silently drops the tick *and* kills all downstream routing for that tick (no DLQ on this node, unlike the Ditto GET). | `01` Archive node has no `retryOnFail`/`onError` |
| F5 | **M** | M | **Duplicate / repeat-fire storm.** `duplicate` is computed but never gates routing; a sustained `SECURITY_BREACH`/`ANOMALY` re-queues analysis every 5 s, and the Action Router re-issues `EMERGENCY_STOP`/`LOCKDOWN` with a fresh `command_id` each cycle → repeated Ditto control writes for one physical condition. | `01` Dedupe (flag unused for routing); `02` Action Router uses `Date.now()` ids |
| F6 | **M** | S | **Maintenance scan misconfigured.** "Schedule: Maintenance Scan Every **6h**" has `interval:[{field:"hours"}]` with **no `hoursInterval`** → n8n defaults to **every 1 hour**. Name/behaviour mismatch. | `04` scheduleTrigger params |
| F7 | **M** | M | **Workflow static-data state is fragile.** Dedupe timeline (01) and RFID memory (04) live in `$getWorkflowStaticData('global')` — lost on restart, not shared across executors, breaks under n8n queue mode. The purpose-built `agent_state` table (migration 002) is **unused**. | `001`/`002` + nodes |
| F8 | **M** | M | **`system_health_history` orphan.** Table + `/api/history/system-health` route exist; nothing writes it; the would-be writer (`07_system_health_aggregator.js`) is unwired and emits the wrong shape. No liveness for ditto/mqtt/postgres/n8n. | A4 |
| F9 | **M** | M | **n8n control writes bypass the durable `pending_command` bridge intent** → autonomous commands may not actuate firmware / get clobbered by telemetry merge. | A4 |
| F10 | **M** | M | **No inter-workflow DLQ.** `Queue *` posts are fire-and-forget (webhook acks 200 immediately); if the downstream workflow throws after ack, the event is lost. | all `Queue …` httpRequest nodes |
| F11 | **L** | M | **No retention/compression on `telemetry_raw`.** 5 s poll inserts every tick even when unchanged (~17k rows/day/elevator); hypertable created but no `add_retention_policy`/compression. | `001` |
| F12 | **L** | S | **Hardcoded internal URLs** `http://n8n:5678/...` (not env-driven) and node-name-coupled expressions (`$('Dedupe & Update Timeline')`). | multiple |
| F13 | **L** | S | **Dead action item.** Action Router emits an `agent:'notification'` item with no matching downstream route (notifications already queued via Route: Notify Advisory) → silently dropped. | `02` Action Router + routes |
| F14 | **L** | S | **`duration_ms` always 0; consecutive-failure counter never alerts.** Observability stubs not finished. | `06` audit insert; `01` DLQ |

No SQL-injection found: all Postgres nodes use parameterized `queryReplacement` (the `01` Archive
query text flows via expression but its VALUES are bound `$1..$28`). LLM is correctly
non-authoritative in both gates.

---

## A6. Open questions (need answers before Phase B)

1. **n8n version / execution mode?** typeVersions (webhook v1, if v1) suggest an older line.
   Confirms whether `responseMode:lastNode`, error-workflows, and **queue mode** are available —
   decisive for F7 (static data) and F10 (DLQ).
2. **Is the dashboard `/api/commands` gate intended to be the single safety gate**, with the n8n
   control gate aligned to it (apply `03_control_safety_gate.js`) — or kept as an independent
   second gate? Determines whether F2/F3 is "align" or "merge".
3. **Should n8n control actions actuate firmware** via the durable `pending_command` bridge
   intent (like the dashboard), or are they intentionally twin-only for simulation? (F9)
4. **Is n8n `06` predictive dispatch redundant** with the dual-brain dispatch engine, or should
   it feed `dispatch_decision_log`? (A4 / two deciders)
5. **Canonical floor range** for the real rig — F0–F3 (`MAX_FLOOR=3`) confirmed? (F3)
6. **Desired `telemetry_raw` retention/compression** horizon? (F11)
7. **Webhook auth mechanism** preference — n8n header-auth credential, shared secret, or rely on
   network isolation only? (F1)
8. Confirm `agent_state` table is meant to back cross-restart agent memory (F7).

---

## Suggested Phase-B sequencing (for discussion only — not yet actioned)

1. **Contract-first (F2+F3):** apply `03_control_safety_gate.js` **and** widen `Persist Control
   Command State` to the full envelope in one change; verify `/api/agent/activity` shows
   autonomous actions correctly. 2. **Safety/abuse (F1):** add webhook auth, starting with
   `control-agent`. 3. **Reliability (F4, F5, F10):** retry/onError on the telemetry INSERT,
   dedupe-gated routing + stable command ids, inter-workflow DLQ. 4. **State (F7):** move static
   data to `agent_state`. 5. **Integration depth (F8, F9):** wire system-health → table → panel;
   route autonomous control through `pending_command`. 6. **Hygiene (F6, F11–F14).**

**STOP — awaiting approval of findings and answers to A6 before any change.**
