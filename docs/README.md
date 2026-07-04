# Documentation Index

Documentation map for the **Smart & Secure Elevator Digital Twin Platform** — a
local-first, production-oriented Industrial IoT / SCADA / agentic-AI platform for
elevators. Start here to find the right document for your task.

```
ESP32 telemetry layer ─► MQTT ingestion ─► bridge ─► Eclipse Ditto ─► SCADA dashboard (ElevatorOS)
                              (Mosquitto)              (source of truth)        ▲
                                                            │ ▲                 │
                                                            ▼ │ commands (gate) │
                                              n8n agent workflows  ◄────────────┘
                                              TimescaleDB (history + audit)
```

**Core invariants** (true across every document):

- **Eclipse Ditto is the single source of truth.** MQTT is ingestion only; the
  SCADA dashboard reads from Ditto, not MQTT.
- **Commands are intents against the twin.** The UI never pokes the device
  directly — every command passes a deterministic safety gate, is written to
  Ditto, then fanned out to MQTT by the bridge.
- **Deterministic rules hold safety authority; the optional LLM only explains.**

---

## Start here

| Doc | Read it when you want to… |
|---|---|
| [README.md](../README.md) | Get the project overview, tech stack, quickstart. |
| [SETUP.md](../SETUP.md) | Stand up the full stack locally, step by step. |
| [SECURITY.md](../SECURITY.md) | Understand the security baseline, MQTT auth/TLS/ACL, and cutover. |
| [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) | Understand the physical ESP32-S3 prototype, pin map, and firmware. |
| [AI_HANDOFF_CONTEXT.md](../AI_HANDOFF_CONTEXT.md) | Get a compact context primer (for a new engineer or AI session). |

## Architecture & design

| Doc | Scope |
|---|---|
| [system-architecture-and-design-chapter.md](system-architecture-and-design-chapter.md) | Layered architecture, design rationale, requirements, Mermaid diagrams (thesis chapter — see its update note for current-state deltas). |
| [software-design-and-implementation-chapter.md](software-design-and-implementation-chapter.md) | Implementation-oriented walkthrough (thesis chapter). |
| [features/global-synoptic-architecture-diagram.md](features/global-synoptic-architecture-diagram.md) | Global synoptic architecture diagram (light/dark SVGs). |

## Integration contracts

| Doc | Scope |
|---|---|
| [mqtt-reference.md](mqtt-reference.md) | **MQTT ingestion**: topic hierarchy, telemetry/event/status/command payloads, QoS/reliability, ACL summary, rules for adding sensors/events. |
| [ditto-twin-reference.md](ditto-twin-reference.md) | **Eclipse Ditto**: Thing ID format, attributes, all 12 features, REST API, policy, who-writes-what. |

## Subsystems

| Doc | Scope |
|---|---|
| [safety/command-safety-gate.md](safety/command-safety-gate.md) | Deterministic command admission: allow-list, validation rules, lifecycle, audit, env vars, tests. |
| [features/adaptive-dispatch-engine.md](features/adaptive-dispatch-engine.md) | AI-Adaptive Dispatch Policy Engine (dual-brain champion/challenger), policies, files, how to run, promotion gates. |
| [n8n-setup.md](n8n-setup.md) | **n8n agent workflows**: import, credentials, activation order, per-workflow Ditto/Postgres write paths, troubleshooting. |
| [database-analytics.md](database-analytics.md) | TimescaleDB schema, history API routes, dashboard pages, verification commands. |
| [operations.md](operations.md) | Backup/restore/DR procedures (`scripts/backup.ps1`, `scripts/restore.ps1`), rehearsed drill evidence. |
| [enterprise-n8n-upgrade-package.md](enterprise-n8n-upgrade-package.md) | Enterprise n8n upgrade package (code-node logic, validation tooling). |

## SCADA dashboard (ElevatorOS)

The Next.js SCADA dashboard is **ElevatorOS** (`apps/dashboard/`). It reads
authoritative state from Eclipse Ditto (SSE with REST-poll fallback via the
`useDitto` hook) and issues commands as twin intent through `/api/commands`.
The page/component breakdown and state-acquisition rules are documented in
[architecture chapter §2.12](system-architecture-and-design-chapter.md#212-web-dashboard-and-scada-supervision-interface);
dashboard environment variables are in
[database-analytics.md](database-analytics.md#dashboard-environment-variables) and
[`apps/dashboard/.env.example`](../apps/dashboard/.env.example); brand assets are in
[elevatoros-brand-assets.md](elevatoros-brand-assets.md).

## Validation & testing

| Doc | Scope |
|---|---|
| [validation/test-matrix.md](validation/test-matrix.md) | Requirement → test traceability matrix. |
| [validation/test-procedures.md](validation/test-procedures.md) | Step-by-step validation procedures. |
| [validation/validation-campaign.md](validation/validation-campaign.md) | Campaign plan and scope. |
| [validation/demo-validation-script.md](validation/demo-validation-script.md) | Scripted end-to-end demo run. |
| [validation/evidence-checklist.md](validation/evidence-checklist.md) | Evidence to capture (logs, captures, screenshots). |
| [validation/results-template.md](validation/results-template.md) | Results write-up template. |
| [validation/software-validation-run-2026-05-13.md](validation/software-validation-run-2026-05-13.md) | A recorded validation run. |

**Automated checks (no hardware required):**

```bash
python -m unittest tests.test_simulator -v                       # simulator unit tests
node --test scripts/validation/test-command-safety-gate.mjs      # safety-gate suite
node --test scripts/validation/test-dispatch-policy-engine.mjs   # dispatch engine suite
python scripts/validate_mqtt_topics.py                           # MQTT topic hygiene
node scripts/validate_n8n_upgrade_package.js                       # n8n workflow JSON + Code-node syntax
cd apps/dashboard && npx tsc --noEmit                                 # dashboard type safety
```

---

## Conventions used across the docs

- **Terminology:** Digital Twin · Eclipse Ditto · MQTT ingestion · SCADA
  dashboard · n8n agent workflows · ESP32 telemetry layer.
- **Thing ID** `building:floor1:elevator` ↔ **MQTT-safe id**
  `building-floor1-elevator` (`:` → `-`).
- File paths are real repository paths; commands come from `package.json`,
  `scripts/`, and `docker-compose.yml`.
- Authoritative-source rule: when two docs disagree on a fact, the **integration
  contract** docs (MQTT / Ditto) and **SECURITY.md** describe current behaviour;
  thesis chapters carry their inspection date and an update note.
