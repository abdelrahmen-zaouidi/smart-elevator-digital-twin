# Eclipse Ditto — Digital Twin Reference

> Canonical reference for the **Eclipse Ditto** Digital Twin layer: the single
> source of truth for elevator state. Every consumer — SCADA dashboard, n8n
> agent workflows, the dispatch engine — reads authoritative state from Ditto,
> never from MQTT directly. This document describes the Thing model exactly as
> provisioned by `scripts/init-ditto.{sh,ps1}`.

Related docs: [MQTT ingestion reference](mqtt-reference.md) ·
[n8n agent setup](n8n-setup.md) · [Command safety gate](safety/command-safety-gate.md) ·
[Adaptive dispatch engine](features/adaptive-dispatch-engine.md) ·
[Architecture chapter](system-architecture-and-design-chapter.md)

---

## 1. Ditto as the source of truth

```
MQTT telemetry ─► bridge ──REST PUT──► Eclipse Ditto ◄──REST/SSE── SCADA dashboard
                                          ▲   │
                            n8n PATCH ─────┘   └──► change events (SSE) ─► dashboard, dispatch engine
```

- MQTT is the **ingestion protocol**; Ditto is the **system of record**.
- The bridge writes telemetry into Ditto features; n8n agents write derived
  state (`ai_analysis`, `maintenance_schedule`, `predicted_failures`, …); the
  dashboard reads via a server-side proxy and writes **command intent** only.
- Telemetry loss, retransmission, or out-of-order delivery never corrupts the
  user-facing state, because the twin — not the wire — is authoritative.

> **Deployment note.** Eclipse Ditto runs as a **separate Docker Compose stack**
> (it is not vendored in this repo). This project's `docker-compose.yml` attaches
> to the external `docker_default` network and addresses Ditto at
> `http://docker-nginx-1` from inside Docker and `http://localhost:8080` from the
> host. See [reference: Ditto deployment](../SETUP.md#step-2--start-eclipse-ditto).

---

## 2. Thing ID format

| Field | Value |
|---|---|
| Thing ID | `building:floor1:elevator` (configurable via `PRIMARY_THING_ID`) |
| Namespace | `building` |
| Name | `floor1:elevator` |
| MQTT-safe id | `building-floor1-elevator` (`:` → `-`) |
| Policy ID | same as Thing ID (`building:floor1:elevator`) |

Multi-building deployments use hierarchical identifiers
(`building:<b>:floor:<f>:elevator:<e>`) — no code change, only configuration of
`PRIMARY_THING_ID` / `ELEVATOR_FLEET_IDS`.

---

## 3. REST API

Ditto's HTTP API (v2) is the access surface. The dashboard never talks to it
directly; the browser goes through `apps/dashboard/app/api/ditto/[...path]/route.ts`,
a server-side proxy that injects HTTP Basic Auth and supports SSE.

| Method · path | Purpose |
|---|---|
| `GET /api/2/things/{thingId}` | Full Thing (attributes + all features). |
| `GET /api/2/things/{thingId}/features/{feature}` | One feature. |
| `GET /api/2/things/{thingId}/features/{feature}/properties/{prop}` | One property. |
| `PUT /api/2/things/{thingId}/features/{feature}/properties/{prop}` | Write one property (operator/agent). |
| `PATCH /api/2/things/{thingId}` | RFC-7396 merge-patch (bridge feature merge, device-applied policy). |
| `PUT /api/2/policies/{policyId}` | Provision the policy (init script). |

Example reads:

```bash
# Full twin
curl -s -u ditto:ditto http://localhost:8080/api/2/things/building:floor1:elevator | python3 -m json.tool

# Just the cabin feature
curl -s -u ditto:ditto \
  http://localhost:8080/api/2/things/building:floor1:elevator/features/cabin
```

---

## 4. Attributes

Slowly-varying / device-identity fields:

| Attribute | Example | Meaning |
|---|---|---|
| `location` | `floor1` | Physical placement. |
| `manufacturer` | `ElevatorCo` | Device make. |
| `model` | `SmartLift-2000` | Device model. |
| `serialNumber` | `SL-2000-001` | Unit serial. |

n8n workflow 02 may also write `attributes/risk_score` (integer 0–100) as a
top-level convenience mirror of `ai_analysis.risk_score`.

---

## 5. Features

The Thing decomposes into **12 features** (provisioned by
`scripts/init-ditto.{sh,ps1}`). Decomposition mirrors physical/concern
boundaries so the bridge writes only what changed and each consumer subscribes
to the subset it cares about.

| Feature | Written by | Purpose |
|---|---|---|
| `cabin` | bridge (telemetry) | Motion, load, cabin environment. |
| `door` | bridge (telemetry) | Door state and integrity. |
| `motor` | bridge (telemetry) | Motor health / vibration / thermal / power. |
| `security` | bridge (telemetry), n8n 04 | RFID, distress, intrusion, alert level. |
| `microcontroller` | bridge (status) | ESP32 presence / transport metadata. |
| `incident_log` | bridge (telemetry) | Rolling incident entries. |
| `control` | dashboard, bridge, dispatch engine, device | Command intent + dispatch policy (intent vs applied). |
| `energy` | bridge (telemetry), n8n 06 | Consumption and efficiency. |
| `performance` | bridge (telemetry) | Wait/trip/availability KPIs. |
| `predicted_failures` | n8n 04 | Component RUL predictions. |
| `ai_analysis` | n8n 02 | Risk score, label, summary, recommendations. |
| `maintenance_schedule` | n8n 04 | Service dates, open work orders, priority. |

### Property tables

**`cabin`**

| Property | Type | Notes |
|---|---|---|
| `current_floor` / `target_floor` | int | Bounded `[MIN_FLOOR, MAX_FLOOR]` (0–3). |
| `direction` | string | `up` / `down` / `idle`. |
| `load_kg` / `max_load_kg` | float | Cabin load and rated capacity. |
| `temperature_c`, `speed_ms` | float | Cabin environment, current speed. |
| `emergency_stop` | bool | E-stop asserted. |
| `between_floors`, `trips_today` | bool / int | Mid-shaft flag, daily trip count. |

**`door`**: `state` (`OPEN`/`CLOSED`/`OPENING`/`CLOSING`/`BLOCKED`),
`door_forced_entry` (bool), `blocked` (bool), `cycle_count`, `obstruction_events`,
`force_sensor_n`.

**`motor`**: `vibration_level` (g), `vibration_baseline_g`, `hours_operated`,
`health_status` (`GOOD`/`WARNING`/`CRITICAL`), `temperature_c`, `current_draw_a`,
`power_kw`.

**`security`**: `audio_distress_active` (bool), `unauthorized_access_attempts`
(int), `rfid_last_card` (string), `rfid_access_granted` (bool), `alert_level`
(`NORMAL`/`HIGH`/`CRITICAL`), `state` (security state machine).

**`microcontroller`**: `board`, `connected` (bool), `status`
(`ONLINE`/`OFFLINE`), `source`, `transport`, `mqtt_id`, `mqtt_topic`,
`telemetry_topic`, `last_seen_at`, `last_telemetry_at`, `last_status_at`,
`last_disconnected_at`. Maintained by the bridge from the `status` heartbeat and
telemetry recency (see [MQTT §5](mqtt-reference.md#5-status--presence)).

**`incident_log`**: `entries` (array of incident objects — see
[MQTT §4](mqtt-reference.md#4-events-payload)), `open_incidents` (int).

**`control`** — command + dispatch state (intent vs applied):

| Path | Owner | Meaning |
|---|---|---|
| `control/properties/pending_command` | dashboard `/api/commands` | Accepted command intent (unique `command_id`); bridge reconciles → MQTT. |
| `control/properties/last_forwarded_command` | bridge | Last command fanned out to the device. |
| `control/properties/last_command_result` | bridge/device | Correlated terminal result: `COMPLETED`, `REJECTED`, `FAILED`, or `TIMED_OUT`. |
| `control/properties/last_ignored_command_result` | bridge | Stale/mismatched acknowledgement retained without clearing the active command. |
| `control/properties/dispatch_policy` | dispatch engine | **Authoritative** dispatch intent (active policy, brain, confidence, params, shadow). |
| `control/properties/device_applied_policy` | device/simulator | What the cabin is **actually** running (merge-patched alongside intent). |

**`energy`**: `kwh_today`, `kwh_month`, `kwh_baseline`, `co2_kg`, `regen_kwh`
(seed); live telemetry also reports `power_kw`, `current_draw_a`.

**`performance`**: `avg_wait_s`, `avg_trip_s`, `availability_pct`,
`door_cycle_efficiency` (seed); live telemetry reports `trips_today`,
`door_cycles`, `obstruction_events`, `availability_pct`.

**`predicted_failures`**: `bearing_days`, `door_motor_days`, `brake_days`,
`overall_risk`.

**`ai_analysis`**: `last_analysis_at`, `risk_score` (0–100), `risk_label`,
`summary`, `recommended_actions[]`.

**`maintenance_schedule`**: `next_service_date`, `last_service_date`,
`open_work_orders`, `priority`.

---

## 6. Feature-level update semantics

- **Bridge (telemetry).** Applies the device's `/features` envelope as a write,
  per-path, suppressing unchanged values and retrying with backoff. The bridge
  may use a thing-level RFC-7396 merge so a single tick is not fanned into ~20
  separate writes.
- **n8n agents.** Use targeted `PUT`/`PATCH` to the features they own
  (`ai_analysis`, `maintenance_schedule`, `predicted_failures`, `security`). See
  the [n8n write-path table](n8n-setup.md#ditto-write-paths-what-each-workflow-writes).
- **Dashboard.** Writes command **intent** only — never device state directly.
  An operator action becomes `control/properties/pending_command`, which the
  bridge reconciles and forwards over MQTT.
- **Dispatch engine / device.** `control/dispatch_policy` (intent, engine-owned)
  and `control/device_applied_policy` (applied, device-owned) are kept distinct
  via merge-patch so neither clobbers the other.

> **Missing-feature repair.** If a live Thing predates the current feature
> surface (e.g. n8n returns `things:feature.notfound`), run
> `node scripts/validation/ensure-ditto-features.js` to add only the missing
> features without disturbing live data.

---

## 7. Policy & access control

`init-ditto.{sh,ps1}` provisions a policy whose ID equals the Thing ID. The
default `owner` entry grants the configured Ditto subject (`nginx:ditto`)
`READ`/`WRITE` on `thing:/`, `policy:/`, and `message:/`.

This is **demonstrator-grade**. Production deployments should replace it with
role-separated entries (operator / maintenance / security / audit) carrying
per-feature grants — e.g. an operator may write `cabin/target_floor` but not
`motor/health_status`; a security agent may write `security` but not `cabin`.
See the hardening tables in [SECURITY.md](../SECURITY.md) and the architecture
chapter's [§2.14](system-architecture-and-design-chapter.md).

Provisioning is idempotent (every operation is a `PUT`/upsert). If policy
creation returns HTTP 403, re-run with the Ditto admin user:

```bash
DITTO_USERNAME=devops DITTO_PASSWORD=foobar bash scripts/init-ditto.sh
```

---

## 8. Example provisioned Thing

The complete, authoritative seed JSON (attributes + all 12 features with safe
zero/idle defaults, including the `control.dispatch_policy` block) lives in the
provisioning scripts and is the reference for field names and types:

- [`scripts/init-ditto.sh`](../scripts/init-ditto.sh) (Bash / WSL / Git Bash)
- [`scripts/init-ditto.ps1`](../scripts/init-ditto.ps1) (PowerShell)

Keep these scripts, `build_ditto_payload()` in `esp32_simulator.py`, and the
feature tables above in sync — they are the three places the Thing model is
defined.
