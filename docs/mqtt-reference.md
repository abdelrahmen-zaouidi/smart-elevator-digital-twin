# MQTT Ingestion Reference

> Canonical reference for the **MQTT ingestion layer** of the Smart & Secure
> Elevator Digital Twin Platform. MQTT is the *transport* between the ESP32
> telemetry layer (or the simulator) and the backend — it is **not** the
> dashboard's source of truth. The [SCADA dashboard](ditto-twin-reference.md)
> reads authoritative state from **Eclipse Ditto**, never from MQTT directly.

Related docs: [Ditto twin reference](ditto-twin-reference.md) ·
[Security baseline](../SECURITY.md) · [Architecture chapter](system-architecture-and-design-chapter.md) ·
[Command safety gate](safety/command-safety-gate.md)

---

## 1. Role in the architecture

```
ESP32 telemetry layer ─┐
                       ├─► Mosquitto ─► bridge ──REST──► Eclipse Ditto ─► SCADA dashboard / n8n agents
esp32_simulator.py ────┘     (broker)   (normalize)        (source of truth)
                                  ▲
   bridge / agents publish commands │  (Ditto pending_command → MQTT commands fanout)
                                  └──────────────────────────────────────────────
```

MQTT carries four message classes per device. Telemetry, events, and status
flow **device → cloud**; commands flow **cloud → device**. The bridge subscribes
fleet-wide and writes normalized state into Ditto; agents subscribe for
monitoring. Telemetry loss is tolerated because the bridge writes are idempotent
and Ditto holds the canonical state.

---

## 2. Topic hierarchy

The project standardises on a **single canonical topic convention**:

```
elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
```

`mqtt_safe_thing_id` is the Ditto Thing ID with `:` replaced by `-`. The `:`
separator is legal in MQTT topics but collides awkwardly with the namespace
separator and complicates wildcard ACLs, so topic segments use the dashed form.

| Ditto Thing ID | MQTT-safe id |
|---|---|
| `building:floor1:elevator` | `building-floor1-elevator` |

The mapping is implemented by `thing_id_to_mqtt_id()` / `mqtt_id_to_thing_id()`
in `esp32_simulator.py` and `thingIdToMqttId()` in
`services/ditto-bridge/bridge.js`.

| Topic | Direction | Publisher | Subscriber | Purpose |
|---|---|---|---|---|
| `elevator/<mqtt_id>/telemetry` | device → cloud | ESP32 firmware / simulator | bridge, agents (`elevator/+/telemetry`) | Periodic full feature snapshot (Ditto envelope). |
| `elevator/<mqtt_id>/events` | device → cloud | ESP32 firmware / simulator | bridge, agents (`elevator/+/events`) | Discrete safety / security / maintenance events. |
| `elevator/<mqtt_id>/status` | device → cloud | ESP32 firmware / simulator | bridge, agents (`elevator/+/status`) | Presence heartbeat / last-will. Drives `microcontroller` online-offline state. |
| `elevator/<mqtt_id>/commands` | cloud → device | bridge, agents | ESP32 firmware / simulator | Validated control commands (incl. `DISPATCH_POLICY`). |

> **Single-device publish vs fleet-wide subscribe.** Publishers target one
> concrete topic (`MQTT_*_TOPIC`); the bridge and agents subscribe with the
> single-level wildcard (`MQTT_*_SUBSCRIPTION`, e.g. `elevator/+/telemetry`) so
> the whole fleet is ingested by one process. Subscription patterns are
> configured in [`.env.example`](../.env.example) and `docker-compose.yml`.

**Deprecated:** the legacy `elevator/telemetry/<id>` form is no longer the
default. The simulator/bridge still honour `MQTT_TOPIC` overrides for backward
compatibility, but new work must use the canonical convention above.

---

## 3. Telemetry payload

Telemetry uses the **Eclipse Ditto Protocol envelope** so the bridge can apply
it as a `/features` merge with minimal transformation. The exact payload is
produced by `build_ditto_payload()` in `esp32_simulator.py` and accepted by
`bridge.js`.

### 3.1 Envelope

```json
{
  "topic":   "building/floor1:elevator/things/twin/commands/modify",
  "headers": { "content-type": "application/json" },
  "path":    "/features",
  "value":   { "...": "feature tree (see below)" },
  "thingId": "building:floor1:elevator",
  "mqttId":  "building-floor1-elevator"
}
```

- `topic` is the Ditto-protocol topic (namespace/name/things/twin/commands/modify), **not** the MQTT topic.
- `thingId` / `mqttId` are identification helpers so subscribers never need to parse the MQTT topic.
- The bridge also accepts a flatter `{features, attributes}` patch and a
  per-feature object; it normalizes all shapes (see §6).

### 3.2 Feature tree (`value`)

Representative real payload (snake_case canonical names; some duplicate
**alias** keys are emitted for backward compatibility — see §6):

```json
{
  "cabin": { "properties": {
    "current_floor": 2, "target_floor": 3, "direction": "up",
    "load_kg": 312.0, "max_load_kg": 800.0, "temperature_c": 22.4,
    "speed_ms": 1.42, "emergency_stop": false,
    "between_floors": true, "trips_today": 47
  }},
  "door": { "properties": {
    "state": "CLOSED", "door_forced_entry": false, "blocked": false,
    "cycle_count": 188, "obstruction_events": 0, "force_sensor_n": 0.0
  }},
  "motor": { "properties": {
    "vibration_level": 0.051, "vibration_baseline_g": 0.05,
    "hours_operated": 1240.5, "health_status": "GOOD",
    "temperature_c": 41.2, "current_draw_a": 6.1, "power_kw": 3.2
  }},
  "security": { "properties": {
    "audio_distress_active": false, "unauthorized_access_attempts": 0,
    "rfid_last_card": "", "rfid_access_granted": true,
    "alert_level": "NORMAL", "state": "SECURE"
  }},
  "incident_log": { "properties": { "entries": [], "open_incidents": 0 }},
  "control": { "properties": {
    "device_applied_policy": {
      "policy_id": "SCAN_COLLECTIVE", "park_floor": null, "direction_bias": 0,
      "accel_profile": "NORMAL", "speed_cap_ms": 1.6, "dwell_ms": 5000,
      "deep_idle": false, "force_fan": false, "restrict_floors": false,
      "applied_at": "2026-06-03T10:15:30Z"
    }
  }},
  "energy": { "properties": { "kwh_today": 12.4, "power_kw": 3.2, "current_draw_a": 6.1 }},
  "performance": { "properties": {
    "trips_today": 47, "door_cycles": 188, "obstruction_events": 0, "availability_pct": 99.5
  }}
}
```

> The `control.device_applied_policy` block is what the **device is actually
> running**. It is written via an RFC-7396 merge-patch so it sits *alongside*
> the dispatch engine's authoritative `control.dispatch_policy` (intent) without
> overwriting it. See the [adaptive dispatch engine](features/adaptive-dispatch-engine.md).

### 3.3 Telemetry cadence

The simulator publishes every `SIMULATOR_PUBLISH_INTERVAL_S` seconds (default
`3`) at QoS `SIM_MQTT_QOS` (default `1`). The ESP32 firmware publishes telemetry
on its own loop and **gates MQTT work while the stepper is moving** to protect
step timing.

---

## 4. Events payload

The `events` topic carries **discrete** safety / security / maintenance events
(as opposed to the periodic telemetry snapshot). Each entry follows the
`incident_log` entry shape (`Incident.to_dict()` in `esp32_simulator.py`):

```json
{
  "incident_id": "INC-00042",
  "ts": "2026-06-03T10:14:02Z",
  "type": "FORCED_DOOR",
  "description": "Door forced open while cabin idle",
  "resolved": false,
  "resolved_at": null
}
```

Incident `type` values currently emitted include: `FORCED_DOOR`,
`DISTRESS_AUDIO`, `OVERLOAD`, `DOOR_OBSTRUCTION`, `MOTOR_OVERHEAT`,
`POWER_FLUCTUATION`, `RFID_FAULT`, `FREE_FALL_VIBRATION`,
`STUCK_BETWEEN_FLOORS`. Latching safety incidents (forced door, audio distress,
emergency button, free-fall vibration, stuck-between-floors) require operator
acknowledgement or demo auto-clear — they do not self-resolve.

### Security / access-event example

An unauthorized RFID attempt surfaces in `security` telemetry and as an event:

```json
{ "incident_id": "INC-00051", "ts": "2026-06-03T10:20:11Z",
  "type": "RFID_FAULT", "description": "RC522 reader hardware fault",
  "resolved": false, "resolved_at": null }
```

with the corresponding `security` feature properties updated
(`unauthorized_access_attempts`, `rfid_last_card`, `rfid_access_granted`,
`alert_level`). The n8n security agent (workflow 04) consumes these to drive RFID
blacklisting and escalation — see [n8n setup](n8n-setup.md).

---

## 5. Status / presence

The `status` topic is a lightweight heartbeat. The ESP32 firmware publishes it
roughly every `MICROCONTROLLER_TELEMETRY_HEARTBEAT_MS` (default 5 s). The bridge
marks the controller **offline** after `MICROCONTROLLER_OFFLINE_AFTER_MS`
(default 15 s) without a status **or** telemetry message, and reflects this in
the Ditto `microcontroller` feature:

```json
{ "connected": true, "status": "ONLINE", "source": "mqtt_status",
  "board": "ESP32-S3", "last_status_at": "2026-06-03T10:20:30Z" }
```

See the `microcontroller` feature in the [Ditto twin reference](ditto-twin-reference.md#5-features).

---

## 6. Normalization & alias resolution (bridge)

`services/ditto-bridge/bridge.js` is tolerant of several payload shapes and a small
alias table so downstream consumers see exactly one canonical name per fact:

| Alias (accepted) | Canonical (written to Ditto) |
|---|---|
| `payload_weight_kg` | `load_kg` |
| `vibration_g` | `vibration_level` |
| `audio_distress` / `audio_distress_detected` | `audio_distress_active` |
| `forced_entry` | `door_forced_entry` |
| `unauthorized_access_count` | `unauthorized_access_attempts` |

The bridge also **suppresses unchanged writes** (per-path last-serialized cache),
**retries with backoff** (`putWithRetry`), and keeps a **latest-only** telemetry
slot so a bursty publisher cannot grow memory. Firmware should target the
canonical names to keep the alias table small.

---

## 7. Commands (cloud → device)

Operators and agents never publish commands from the UI. The flow is:

```
dashboard /api/commands  ─► safety gate ─► Ditto control/pending_command
                                                  │
                            bridge reconciles ◄────┘
                            publishes compact JSON ─► elevator/<mqtt_id>/commands ─► device
```

Only the `bridge` and `agents` broker identities may publish to
`.../commands` (enforced by the broker ACL — see §8). A representative dispatch
command emitted by the bridge:

```json
{ "command": "DISPATCH_POLICY", "command_id": "CMD-...",
  "policy_id": "ECO_ENERGY", "params": { "...": "policy params" } }
```

Admission rules, the command catalogue, risk caps, and the (reserved) device
acknowledgement path live in the
[command safety gate spec](safety/command-safety-gate.md).

---

## 8. Reliability & security expectations

- **QoS.** Telemetry is published at QoS 1 by the simulator (`SIM_MQTT_QOS`).
  Loss of an individual telemetry tick is masked by the next tick and the
  bridge's idempotent writes; for command and event topics QoS 1 is appropriate.
- **Reconnect.** Publishers reconnect with backoff; the bridge reconnects to the
  broker and reconciles any pending Ditto command intent on (re)connect so a
  bridge restart does not drop or replay stale commands.
- **Last will.** Status/presence is backed by the heartbeat + bridge offline
  timer rather than relying solely on broker LWT.
- **Authentication & ACL.** Anonymous access is **disabled**. Each client
  authenticates with a username/password and is constrained by
  `infra/mqtt/aclfile`. TLS (8883) protects the ESP32 ↔ broker hop. The
  authoritative description — identities, ACL matrix, TLS, cutover — is in
  [SECURITY.md](../SECURITY.md). Summary of who may do what:

  | Identity | Publish | Subscribe |
  |---|---|---|
  | `esp32-elevator` | telemetry, events, status (own device) | commands (own device) |
  | `bridge` | `elevator/+/commands` | telemetry, events, status |
  | `agents` (n8n) | `elevator/+/commands` | telemetry, events, status, commands |
  | `dashboard` (browser) | — (read-only) | telemetry, events, status |
  | `healthcheck` | `healthcheck/mqtt` only | — |

---

## 9. Rules for adding a new sensor or event

1. **Pick the feature it belongs to** (`cabin`, `door`, `motor`, `security`,
   `energy`, `performance`, …). Add the property to that feature in
   `build_ditto_payload()` and to the Ditto seed in `scripts/init-ditto.{sh,ps1}`
   so the dashboard never sees an undefined field.
2. **Use snake_case canonical names.** Only add an alias to `bridge.js` if
   firmware/legacy producers cannot emit the canonical name.
3. **Keep telemetry idempotent.** Republishing the same value every tick is
   fine — the bridge suppresses unchanged writes.
4. **Discrete safety/maintenance occurrences are events**, not telemetry fields:
   emit an `incident_log` entry (and, where applicable, an `events` message) so
   the n8n agents and audit trail capture them.
5. **Validate topic hygiene** with `python scripts/validate_mqtt_topics.py`.
6. **Update** the [Ditto twin reference](ditto-twin-reference.md) feature tables
   and re-run `node scripts/validation/ensure-ditto-features.js` against a live
   Thing if needed.
