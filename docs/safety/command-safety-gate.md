# Command Safety Gate

> **Academic research prototype.** This is a software-level safety gate intended for thesis demonstration and traceability. It does NOT replace certified elevator safety hardware. Real deployments must comply with EN 81 / ASME A17 elevator safety standards and use certified controllers.

## 1. Purpose

Every elevator command in the system — whether issued by an operator on the SCADA dashboard, by an n8n agent, or by a system task — must pass through a **deterministic, rule-based** admission layer before it can:

1. produce a write to the Eclipse Ditto Digital Twin,
2. dispatch a command to the elevator controller (future MQTT `commands` topic),
3. mutate any safety-relevant state.

The Command Safety Gate is that admission layer. It is the single visible answer to the question that drives this thesis: *“how do we keep an LLM-augmented system from authorising unsafe physical actions?”*

## 2. Architectural authority principle

```
┌─────────────┐    ┌─────────────┐    ┌───────────────┐
│ Dashboard   │    │ n8n agents  │    │ Future MQTT   │
│ (operator)  │    │ (LLM-fed)   │    │ commands ACK  │
└──────┬──────┘    └──────┬──────┘    └──────┬────────┘
       │ POST              │ POST              │
       ▼                   ▼                   │
┌────────────────────────────────────────────┐ │
│       DETERMINISTIC COMMAND SAFETY GATE     │◀┘
│       packages/shared/commandSafetyGate.js│
│       N8n .../03_control_safety_gate.js     │
│  - allow-list                               │
│  - source, role, mode, risk, twin freshness │
│  - reason / confirmation requirements       │
│  - cooldown                                 │
└──────────────┬─────────────────────────────┘
               │ accepted ➜ Ditto write plan
               ▼
        ┌───────────────┐
        │ Eclipse Ditto │
        └───────────────┘
```

- AI / n8n / LLM may **propose** commands.
- Only the deterministic safety gate **decides**.
- The LLM is **non-authoritative** by construction: the gate never consults an LLM, never reads the LLM's confidence score, and never accepts an LLM-only signature as authorisation.

## 3. Single source of truth

The canonical rules live in [`packages/shared/commandSafetyGate.js`](../../packages/shared/commandSafetyGate.js). The n8n control agent uses an aligned standalone version at [`workflows/n8n/enterprise-upgrade-code/03_control_safety_gate.js`](../../workflows/n8n/enterprise-upgrade-code/03_control_safety_gate.js) (n8n Code nodes cannot `require()` external modules). Both files share the same:

- command allow-list,
- rejection-reason strings (`REJECTED: <reason>`),
- safety-snapshot shape (`current_floor`, `door_state`, `emergency_stop`, `load_kg`, `alert_level`, `system_mode`, `risk_score`, `forced_entry`, …),
- thresholds (`MAX_RISK_*`, `MIN_FLOOR`/`MAX_FLOOR`, `MAX_TWIN_AGE_SECONDS`, `COMMAND_COOLDOWN_SECONDS`).

## 4. Command flow

### 4.1 Operator command from the dashboard

1. Operator clicks `Emergency Stop` (or any other button on the Command Center page).
2. The button calls `submitCommand({...})` in `apps/dashboard/src/services/commandClient.js`.
3. The browser POSTs to `/api/commands` (Next.js route in `apps/dashboard/app/api/commands/route.js`).
4. The route:
   1. fetches the current Ditto Thing state (or marks `ditto_reachable:false`),
   2. runs `validateCommand(...)`,
   3. **always** persists the decision (accepted *or* rejected) to `control_command_log`,
   4. writes one row to `audit_log` per lifecycle event,
   5. POSTs to the n8n audit-agent webhook for fanout (best-effort),
   6. **only if accepted**, performs the planned Ditto PUTs,
   7. writes `features/control/properties/pending_command` with a unique `command_id`.
5. Bridge reconciles the Ditto command intent and publishes the compact MQTT command to `elevator/{mqtt_id}/commands` using the `bridge` broker identity. It marks forwarded command intents so bridge restarts do not replay stale commands.
6. Response is returned to the dashboard with the full decision envelope (`device_command_status: "QUEUED_VIA_DITTO_BRIDGE"` on successful Ditto writes).
7. The `CommandSafetyGatePanel` component refreshes every 5 s and renders the decision.

### 4.2 Autonomous command from n8n

1. Analysis agent detects a risk condition and POSTs a `triggered_action` payload to `/webhook/control-agent`.
2. The control agent's `03_control_safety_gate` Code node applies the same canonical rules.
3. Validated commands are exploded into Ditto PUTs; rejected commands skip the write nodes and fan out to the audit agent.
4. The control_command_log row carries the same canonical shape — decision, rejection_reasons, safety_snapshot — so the dashboard panel surfaces it identically.

### 4.3 Future ESP32 acknowledgement (designed-in, not yet implemented)

The canonical MQTT topic plan reserves `elevator/{mqtt_id}/commands` for cloud-to-device dispatch and `elevator/{mqtt_id}/commands/ack` (or `…/status`) for device acknowledgement. The acknowledgement payload format:

```json
{
  "command_id": "CMD-...",
  "correlation_id": "CID-...",
  "thing_id": "building:floor1:elevator",
  "status": "EXECUTED",
  "executed_at": "2026-05-13T20:00:00Z",
  "current_floor": 3,
  "details": {}
}
```

A future firmware release subscribes to the commands topic, executes the command, then publishes the ack. The bridge will write the ack to `control_command_log.acknowledged_at` and add an `EXECUTED` row to `audit_log`. The dashboard panel will distinguish *“written to Ditto”* from *“acknowledged by device”*.

## 5. Command allow-list

| Canonical | Aliases | Sources | Reason | Confirmation | Risk cap |
|---|---|---|---|---|---|
| `MOVE_TO_FLOOR` | `REPOSITION`, `SEND_TO_FLOOR` | dashboard, n8n, operator | yes | no | 70 |
| `OPEN_DOOR` | `DOOR_HOLD_OPEN` | dashboard, n8n, operator | yes | no | 80 |
| `CLOSE_DOOR` | `DOOR_CLOSE_SAFE` | dashboard, n8n, operator | yes | no | 80 |
| `EMERGENCY_STOP` | – | all | no | **yes** | none (always allowed) |
| `RESET_EMERGENCY` | `RESUME_NORMAL`, `RESET_NORMAL` | dashboard, operator (human only) | yes | **yes** | 50 |
| `LOCKDOWN` | – | dashboard, n8n, operator | yes | **yes** | none |
| `RELEASE_LOCKDOWN` | `CLEAR_SECURITY_ALERT` | dashboard, operator (human only) | yes | **yes** | 70 |
| `SET_MAINTENANCE_MODE` | `MAINTENANCE_MODE` | dashboard, n8n, operator | yes | **yes** | none |
| `RESUME_NORMAL_MODE` | – | dashboard, operator (human only) | yes | **yes** | 50 |
| `ACKNOWLEDGE_ALERT` | `ACKNOWLEDGE_INCIDENT` | dashboard, n8n, operator | no | no | none |
| `CLEAR_RESOLVED_INCIDENT` | – | dashboard, operator | yes | no | none |
| `REQUEST_STATUS_REFRESH` | – | all | no | no | none |

A command not in this catalogue is **always rejected** with `REJECTED: command not in allow-list`.

## 6. Validation rules

The gate evaluates these checks in order. A failure on any check appends a `REJECTED: …` entry to `rejection_reasons`; the entire list is returned (so the operator sees every problem at once, not just the first).

| # | Rule | Rejection reason |
|---|---|---|
| 1 | Command must be in the allow-list. | `command not in allow-list` |
| 2 | All `required_fields` (e.g. `target_floor`) must be present. | `missing required field 'X'` |
| 3 | `source` must be in `ALLOWED_SOURCES`. | `unauthorized command source` |
| 4 | `source` must be in the command's `allowed_sources`. | `source 'X' not permitted for Y` |
| 5 | `source_agent` must be a non-empty explicit value. | `missing source_agent` |
| 6 | Required reason must be a non-empty array of strings. | `missing operator reason` |
| 7 | Required confirmation flag must be `true`. | `command requires human confirmation` |
| 8 | Current `system_mode` must not be in the command's `forbidden_modes`. | `system in LOCKDOWN`, `system in MAINTENANCE`, `command forbidden in system mode X` |
| 9 | If `system_mode` is set, it must be in `allowed_modes`. | `command not permitted in mode X` |
| 10 | If `emergency_stop` is active and the command doesn't allow it, reject. | `emergency stop active` |
| 11 | Likewise for door open, overload, forced entry. | `door is open`, `overload detected`, `door forced-entry active` |
| 12 | Apply risk caps (autonomous, operator, per-command). Critical commands bypass. | `risk score above ...` |
| 13 | `MOVE_TO_FLOOR`: `target_floor` must be `[MIN_FLOOR, MAX_FLOOR]`. | `target floor outside allowed range` |
| 14 | Recovery commands forbidden while a critical incident is open. | `recovery requires human review of active critical incident` |
| 15 | Non-emergency commands require fresh telemetry. | `stale Digital Twin state` |
| 16 | Autonomous sources cannot RESET / RELEASE / RESUME without `human_approved:true`. | `recovery requires human/operator source` |
| 17 | Same command, same target, same source, within `COMMAND_COOLDOWN_SECONDS`. | `command cooldown active` |
| 18 | If Ditto is unreachable (caller-supplied flag). | `Ditto unavailable` |

**Invariant:** if `rejection_reasons.length > 0`, the response's `ditto_writes` array is empty and `ditto_write_allowed` is `false`. This invariant is asserted by `scripts/validation/test-command-safety-gate.mjs` (test #15).

## 7. Command lifecycle

```
RECEIVED ─▶ VALIDATING ─▶ REJECTED ◀── invariant: no Ditto write
                       └─▶ ACCEPTED ─▶ DISPATCHED ─▶ DITTO_WRITE_SUCCEEDED ─▶ EXECUTION_PENDING ─▶ EXECUTED
                                                  └─▶ DITTO_WRITE_FAILED ─▶ (operator review)
```

The dashboard route currently advances commands as far as `DITTO_WRITE_SUCCEEDED` / `DITTO_WRITE_FAILED`. `EXECUTION_PENDING` and `EXECUTED` will be filled in when the future ESP32 firmware publishes acknowledgements on `elevator/{mqtt_id}/commands/ack`.

## 8. Database persistence

Migration `infra/postgres/migrations/005_command_safety_gate.sql` extends `control_command_log` so every decision — *including rejections* — is persisted with full context.

New columns:

| Column | Purpose |
|---|---|
| `command_label` | Human-readable summary (e.g. `Move elevator to floor 3`) |
| `decision` | `ACCEPTED` / `REJECTED` |
| `accepted` | Boolean mirror of `decision` for filter indexes |
| `source` | `dashboard` / `n8n` / `operator` / `system` |
| `system_mode`, `current_floor`, `target_floor`, `door_state`, `emergency_stop`, `load_kg` | Hoisted from safety snapshot for fast filtering |
| `rejection_reasons` | JSONB array of `REJECTED: …` strings |
| `safety_snapshot` | JSONB object with the full safety slice at decision time |
| `raw_command` | JSONB blob of the original POST body |
| `ditto_payload` | JSONB array of `{path, value}` for the planned writes |
| `ditto_write_status` | `SUCCEEDED` / `FAILED` / `PARTIAL` / `SKIPPED` / `PENDING` |
| `audit_status` | Audit insertion status |
| `updated_at` | Maintained by trigger |

The dashboard `CommandSafetyGatePanel` queries `GET /api/commands/recent` which selects from this table.

## 9. Audit logging

Every decision emits one or more rows into `audit_log` via the dashboard route (and via the existing n8n audit-agent webhook):

| Event type | Emitted when |
|---|---|
| `COMMAND_RECEIVED` | Route handler entered |
| `COMMAND_REJECTED` | Gate returned `accepted:false` |
| `COMMAND_ACCEPTED` | Gate returned `accepted:true` |
| `COMMAND_DITTO_WRITE_SUCCEEDED` | All planned PUTs returned 2xx |
| `COMMAND_DITTO_WRITE_FAILED` | At least one PUT failed |
| `COMMAND_EXECUTION_CONFIRMED` | (Reserved) Future ESP32 ack |
| `COMMAND_EXECUTION_TIMEOUT` | (Reserved) Future ESP32 ack timeout |

The audit row records `correlation_id` and `command_id`, so a single command's full trace can be reconstructed by joining `control_command_log ↔ audit_log` on either id.

## 10. Dashboard panel

The Command Center page (`Sidebar → Command Center` in ElevatorOS) renders a **Command Safety Gate** card with:

- Live counters (Accepted / Rejected / Failed / Pending).
- Filter strip (decision + source).
- Per-decision expandable rows showing the full safety snapshot, rejection trace, planned Ditto writes, IDs, and audit status.
- A persistent banner reminding the operator that *“AI agents may request commands; this deterministic gate decides whether they execute.”*

The panel auto-refreshes every 5 s (configurable via prop).

## 11. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MIN_FLOOR` | `0` | Lower target-floor bound |
| `MAX_FLOOR` | `3` | Upper target-floor bound |
| `GROUND_FLOOR` | `0` | Fire-recall target |
| `MAX_RISK_AUTO_CONTROL` | `70` | Risk cap for autonomous (n8n/system) commands |
| `MAX_RISK_OPERATOR_CONTROL` | `85` | Risk cap for operator commands |
| `MAX_TWIN_AGE_SECONDS` | `10` | Stale-twin threshold for non-emergency commands |
| `COMMAND_COOLDOWN_SECONDS` | `3` | Per-command cooldown to suppress duplicates |
| `COMMAND_REQUIRE_REASON` | `true` | Globally require operator reason |
| `COMMAND_AUDIT_ENABLED` | `true` | Persist audit events for every decision |

## 12. Tests

[`scripts/validation/test-command-safety-gate.mjs`](../../scripts/validation/test-command-safety-gate.mjs) covers 33 cases using Node's built-in `node:test`:

```
node --test scripts/validation/test-command-safety-gate.mjs
```

Key invariants exercised:

- Unknown command → rejected.
- `MOVE_TO_FLOOR` with valid / out-of-range / negative target.
- Movement during LOCKDOWN / MAINTENANCE / emergency stop / overload / forced entry.
- `EMERGENCY_STOP` is accepted even at risk 99 and from autonomous sources.
- `RESET_EMERGENCY` rejects autonomous source, missing reason, and active critical incident.
- Autonomous commands above `MAX_RISK_AUTO_CONTROL` rejected.
- Stale twin rejects non-emergency commands but still allows `EMERGENCY_STOP`.
- Unauthorized source and missing source_agent rejected.
- Cooldown rejects duplicates and allows the same command after the window elapses.
- Ditto unreachable → rejected.
- **Universal invariant**: every rejection carries zero Ditto writes.

## 13. Limitations and future work

- **Not a certified safety system.** This is a software gate, not an SIL-rated safety controller. Real elevators require hardware safety interlocks and certified controllers compliant with EN 81 / ASME A17.
- **Cooldown is per-process.** The in-memory ledger is reset by a dashboard restart. A multi-replica deployment would back it with Redis or the database.
- **ESP32 acknowledgement path is reserved but not yet implemented.** The lifecycle states `EXECUTION_PENDING` / `EXECUTED` / `TIMEOUT` are designed-in; the firmware does not yet publish on `elevator/{mqtt_id}/commands/ack`. The bridge would consume that topic and update `control_command_log.acknowledged_at`.
- **Twin freshness from Ditto `_modified`.** The route uses Ditto's `_modified` field as the proxy for telemetry recency. In practice the bridge updates the Thing every tick, so this is faithful, but it is not a direct device timestamp.
- **No client-side encryption of audit.** Audit rows are stored in PostgreSQL in plaintext; production deployments would layer at-rest encryption or move to an append-only audit store.
- **LLM remains non-authoritative.** The gate never consults the optional Ollama LLM. The LLM is permitted to write `features/ai_analysis` explanations and to set the `source_agent` field of an n8n-originated `MOVE_TO_FLOOR`, but the rule-based gate decides admissibility.
