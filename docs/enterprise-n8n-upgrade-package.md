# Enterprise n8n / Digital Twin Upgrade Package

This package keeps the current local Docker architecture:

ESP32 or simulator -> Mosquitto MQTT -> bridge / n8n -> Eclipse Ditto -> dashboard / commands -> Ditto -> device

No paid API is required. Optional local AI uses Ollama only and is disabled by default.

## 1. Architecture Upgrade Summary

The upgrade standardizes all agent-to-agent messages with a correlation-aware event envelope, moves durable memory into Postgres where possible, keeps Ditto as the operational source of truth, and makes deterministic safety rules the authority for control decisions.

Main improvements:

- Correlation propagation through ingestion, analysis, control, security, maintenance, notification, audit, and health workflows.
- Idempotent TimescaleDB/Postgres migration for telemetry, audit, notification, agent state, command logs, work orders, and health history.
- Optional local LLM path through Ollama for explanations only. It never authorizes commands or changes deterministic risk scores.
- Multi-elevator readiness through `ELEVATOR_FLEET_IDS`, per-thing dedupe keys, and `thing_id` indexes everywhere.
- Control safety gate with explicit validation, command state, reasons, risk score, source agent, and audit payloads.
- Notification outbox with priority, locking, retry/backoff, dedupe, correlation IDs, and disabled-by-default external channels.
- Predictive maintenance and energy optimization based on local telemetry history and deterministic formulas.

## 2. Common Event Envelope

Every workflow should emit or preserve this shape:

```json
{
  "correlation_id": "CID-...",
  "event_id": "EVT-...",
  "thing_id": "building:floor1:elevator",
  "agent_source": "agent_name",
  "event_type": "TELEMETRY_UPDATE",
  "severity": "INFO",
  "timestamp": "2026-04-27T00:00:00.000Z",
  "system_mode": "NORMAL",
  "risk_score": 0,
  "payload": {},
  "risk_analysis": {},
  "triggered_action": {},
  "metadata": {
    "workflow": "",
    "node": "",
    "schema_version": "1.0",
    "source": "ditto"
  }
}
```

Severity values are `OK`, `INFO`, `WARNING`, `CRITICAL`. System modes are `NORMAL`, `MAINTENANCE`, `LOCKDOWN`, `DEGRADED`.

## 3. Updated Workflow Design

### 01 Ingestion / Surveillance Agent

Purpose: poll Ditto, normalize twin state, persist raw telemetry, route significant events, and audit the ingestion path.

Trigger: schedule. For multi-elevator mode, add a Code node before Ditto GET that emits one item per `ELEVATOR_FLEET_IDS`.

Inputs: Ditto Thing JSON from `/api/2/things/{thingId}`.

Processing steps:

- Validate Ditto shape and generate a degraded audit event when invalid.
- Normalize field aliases: `vibration_level`, `vibration_g`, `vibration_ms2`, `load_kg`, `payload_weight_kg`, `audio_distress_active`, `audio_distress_detected`.
- Generate `correlation_id`, `event_id`, stable `duplicate_hash`, and metadata source `ditto_poll`.
- Track per-elevator timeline and duplicate detection.
- Store every event in `telemetry_raw`; mark duplicates through `duplicate=true` and `processing_status='DUPLICATE'`.
- Route non-telemetry events to Analysis and all events to Audit.

Outputs: canonical envelope, telemetry row, analysis webhook request, audit event.

Error handling: failed Ditto reads should route to a dead-letter branch that increments `agent_state['ditto_failures:{thingId}']`, audits the failure, and notifies only after repeated failures.

Audit behavior: audit event for successful archive, invalid Ditto shape, and repeated Ditto availability failure.

Code node replacements:

- `Canonicalize Twin Event`: `N8n workflows/enterprise-upgrade-code/01_canonicalize_twin_event.js`
- `Dedupe & Update Timeline`: `N8n workflows/enterprise-upgrade-code/01_dedupe_update_timeline.js`
- `Prepare DB Row`: `N8n workflows/enterprise-upgrade-code/01_prepare_telemetry_params.js`

Postgres node `Archive Telemetry to Postgres`:

```text
operation: executeQuery
query: {{ $json._db_query }}
options.queryReplacement: {{ $json._db_params }}
```

### 02 Analysis AI Brain Agent

Purpose: deterministic local risk scoring, optional local explanation, and routing actions.

Trigger: `/webhook/analysis-agent`.

Inputs: canonical envelope from ingestion or another agent.

Processing steps:

- Compute deterministic risk across security, motor, door, cabin, load, current, power, speed, timeline, and maintenance degradation.
- Optional Ollama summary if `LOCAL_LLM_ENABLED=true`; skipped by default.
- Write deterministic risk score to Ditto `attributes/risk_score`.
- Write analysis to Ditto `features/ai_analysis`. The body must be the full
  Ditto feature object, for example
  `{ properties: { analyzed_at, severity, risk_score, flags, llm_analysis,
  recommended_action, explanation, requires_human_review } }`. Writing the
  feature root makes the operation idempotent when a live Thing is missing the
  seeded `ai_analysis` feature, while the dashboard still reads
  `state.features.ai_analysis.properties`.
- Route actions to control, security, maintenance, notification.

Outputs: risk analysis envelope, Ditto updates, downstream agent webhook requests.

Error handling: failed LLM call returns `llm_analysis.skipped=true`; failed Ditto writes must audit and not block deterministic routing.

Audit behavior: audit `ANALYSIS_COMPLETED`, `DITTO_RISK_WRITE_SUCCEEDED`, and failed Ditto writes.

Code node replacements:

- `Deterministic Risk Engine`: `N8n workflows/enterprise-upgrade-code/02_deterministic_risk_engine.js`
- `LLM Context Analyzer`: `N8n workflows/enterprise-upgrade-code/02_ollama_context_analyzer.js`
- `Finalize Risk Analysis`: `N8n workflows/enterprise-upgrade-code/02_finalize_risk_analysis.js`
- `Action Router`: `N8n workflows/enterprise-upgrade-code/02_action_router.js`

Ditto endpoints:

```text
PUT {{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $json.thing_id }}/attributes/risk_score
PUT {{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $json.thing_id }}/features/ai_analysis
```

### 03 Control Agent

Purpose: safety-gate every control command before writing desired state to Ditto.

Trigger: `/webhook/control-agent`.

Inputs: `triggered_action` or direct `control_command`.

Processing steps:

- Normalize command and required audit fields.
- Validate command allowlist, `thing_id`, `correlation_id`, `source_agent`, reason, target floor range, lockdown state, emergency stop state, and resume-normal clearance.
- Convert valid command into explicit Ditto path writes.
- Insert command state into `control_command_log`.
- Write each Ditto path.
- Audit success or failure for every command and write.

Outputs: control command log row, Ditto writes, audit events.

Error handling: rejected commands are audited and never reach Ditto. Failed writes are audited with `WRITE_FAILED` and persisted in `control_command_log`.

Audit behavior: `RECEIVED`, `VALIDATED`, `REJECTED`, `DISPATCHED`, `WRITE_SUCCEEDED`, `WRITE_FAILED`, `ACKNOWLEDGED`.

Nodes to add:

- `Control Safety Gate` Code node before `Explode Ditto Writes`.
- `Persist Control Command State` Postgres node after the safety gate.
- `Route: Control Validated?` IF node before Ditto writes.

Code node replacements:

- `Control Safety Gate`: `N8n workflows/enterprise-upgrade-code/03_control_safety_gate.js`
- `Explode Ditto Writes`: `N8n workflows/enterprise-upgrade-code/03_explode_ditto_writes.js`

Implemented connection topology (must match `03_control_agent.json`):

`Control Safety Gate` fans out to (a) `Persist Control Command State` and (b)
`Route: Control Validated?`. The IF node's true branch dispatches to
`Audit Control Dispatch` and `Explode Ditto Writes`; the false branch goes to
`Audit Control Rejected`. `PUT Desired State to Ditto` has
`onError=continueErrorOutput`: success path goes to `Audit Successful Ditto
Write`; the error output goes to `Dead-Letter Control Write` and then to
`Audit Failed Ditto Write`. Every command — validated or rejected — is
upserted into `control_command_log` so `/api/history/commands` reflects the
full decision history.

Control command insert:

```sql
INSERT INTO control_command_log (
  command_id, correlation_id, thing_id, command, requested_by,
  source_agent, reason, risk_score, status, created_at, metadata
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9, COALESCE($10::timestamptz, now()), $11::jsonb
)
ON CONFLICT (command_id) DO UPDATE SET
  status = EXCLUDED.status,
  metadata = control_command_log.metadata || EXCLUDED.metadata;
```

Ditto write endpoint:

```text
PUT {{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $json.thing_id }}/{{ $json.path }}
```

### 04 Security / Maintenance Agents

Purpose: security escalation and predictive maintenance generation.

Triggers:

- `/webhook/security-agent`
- `/webhook/maintenance-agent`
- scheduled maintenance scan

Security processing:

- Track denied RFID attempts per card and time window.
- Blacklist cards after `RFID_BLACKLIST_THRESHOLD`.
- Detect combined high-risk states: forced door with audio distress, forced door while moving, RFID denied with forced door.
- Write security state to Ditto.
- Queue lockdown request only through Control Agent, never direct device writes.

Maintenance processing:

- Normalize Ditto snapshot or risk event payload.
- Compute `wear_index`, `estimated_failure_days`, task list, priority, and evidence.
- Insert work order with `issue_key` to avoid duplicate open work orders.
- Write maintenance schedule to Ditto.
- Notify only for `MEDIUM`, `HIGH`, `CRITICAL`.

Code node replacements:

- `Security State Machine`: `N8n workflows/enterprise-upgrade-code/04_security_state_machine.js`
- `Predictive Maintenance Engine`: `N8n workflows/enterprise-upgrade-code/04_predictive_maintenance_engine.js`

Implemented connection topology (must match `04_security_maintenance_agents.json`):

`Predictive Maintenance Engine` fans out to (a) `Persist Maintenance Work Order`
and (b) `Ensure Maintenance Feature Exists`. The work-order persistence runs
in parallel with the Ditto schedule write so `/api/history/maintenance` always
reflects open issues even if Ditto is briefly unreachable.

Maintenance work order insert:

```sql
INSERT INTO maintenance_work_orders (
  work_order_id, correlation_id, thing_id, issue_key, priority,
  wear_index, estimated_failure_days, tasks, evidence, status, created_at
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8::jsonb, $9::jsonb, 'OPEN', COALESCE($10::timestamptz, now())
)
ON CONFLICT (thing_id, issue_key) WHERE status IN ('OPEN', 'IN_PROGRESS')
DO UPDATE SET
  priority = EXCLUDED.priority,
  wear_index = GREATEST(maintenance_work_orders.wear_index, EXCLUDED.wear_index),
  estimated_failure_days = LEAST(maintenance_work_orders.estimated_failure_days, EXCLUDED.estimated_failure_days),
  evidence = maintenance_work_orders.evidence || EXCLUDED.evidence;
```

Ditto endpoints:

```text
PUT {{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $json.thing_id }}/features/security/properties
PUT {{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $json.work_order.thing_id }}/features/maintenance_schedule/properties
```

### 05 Notification Agent

Purpose: reliable outbox-based notification routing with dedupe and retry.

Triggers:

- `/webhook/notification-agent`
- scheduled outbox drain

Processing steps:

- Select channels from severity and enabled variables.
- Validate channel configuration before queueing external delivery rows.
- Insert deduped outbox rows; dashboard-visible rows are marked `SENT` immediately.
- Claim due external delivery rows using `FOR UPDATE SKIP LOCKED`.
- Format compact and detailed messages with dashboard URL and `correlation_id`.
- Send enabled channels.
- Mark sent or failed with exponential backoff.

Outputs: outbox rows, optional Telegram/email/SMS/voice webhook deliveries.

Error handling: delivery failures update `last_error`, `attempts`, `next_attempt_at`, and `status`.

Audit behavior: audit inserted, sent, retry, failed, and escalated notification events.

Code node replacements:

- `Build Notification Outbox Rows`: `N8n workflows/enterprise-upgrade-code/05_build_notification_outbox_rows.js`
- `Format Delivery Payload`: `N8n workflows/enterprise-upgrade-code/05_format_delivery_payload.js`

Implemented connection topology (must match `05_notification_agent.json`):

Each `Send Telegram` / `Send Email` / `Send SMS` / `Send Voice Escalation`
node has `onError=continueErrorOutput`. Output 0 (success) feeds
`Mark Notification Sent`; output 1 (failure) feeds `Mark Notification Failed`,
which applies the exponential backoff defined below and only marks the row
`FAILED` once `attempts >= max_attempts`. Without that error branch, failed
deliveries stay in `SENDING` until the lock ages out and never get backoff or
escalation.

Outbox insert:

```sql
INSERT INTO notification_outbox (
  correlation_id, thing_id, severity, priority, channel, dedupe_key,
  payload, status, next_attempt_at, attempts, max_attempts, sent_at
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7::jsonb,
  COALESCE($9::text, 'PENDING'),
  now(),
  0,
  $8,
  CASE WHEN COALESCE($9::text, 'PENDING') = 'SENT' THEN now() ELSE NULL END
)
ON CONFLICT (dedupe_key) DO NOTHING;
```

Claim due notifications:

```sql
UPDATE notification_outbox o
SET status = 'SENDING',
    locked_at = now(),
    attempts = attempts + 1
WHERE o.id IN (
  SELECT id
  FROM notification_outbox
  WHERE status IN ('PENDING', 'RETRY')
    AND channel <> 'dashboard'
    AND next_attempt_at <= now()
    AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
  ORDER BY priority DESC, created_at
  LIMIT 25
  FOR UPDATE SKIP LOCKED
)
RETURNING
  o.id, o.correlation_id, o.thing_id, o.severity, o.priority,
  o.channel, o.payload, o.attempts, o.max_attempts, o.escalation_level;
```

Mark sent:

```sql
UPDATE notification_outbox
SET status = 'SENT',
    sent_at = now(),
    locked_at = NULL,
    last_error = NULL
WHERE id = $1;
```

Mark failed / retry:

```sql
UPDATE notification_outbox
SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'RETRY' END,
    locked_at = NULL,
    last_error = $2,
    next_attempt_at = now() + make_interval(secs => LEAST(3600, (POWER(2, attempts)::int * 60))),
    escalation_level = CASE WHEN attempts >= max_attempts THEN escalation_level + 1 ELSE escalation_level END
WHERE id = $1;
```

### 06 Optimization / Audit Agents

Purpose: local predictive dispatch, energy anomaly detection, compliance, and centralized audit.

Triggers:

- dispatch schedule
- energy schedule
- weekly compliance schedule
- `/webhook/audit-agent`

Processing steps:

- Query TimescaleDB for historical demand by hour/day.
- Predict demand floor from recent/historical load.
- Detect power/current/vibration energy anomalies against local baseline.
- Write optimization recommendations to Ditto.
- Normalize audit events and insert into `audit_log`.

Code node replacements:

- `Energy Optimization Engine`: `N8n workflows/enterprise-upgrade-code/06_energy_optimization_engine.js`
- New `Normalize Audit Event`: `N8n workflows/enterprise-upgrade-code/06_audit_event_normalizer.js`

Audit insert:

```sql
INSERT INTO audit_log (
  audit_id, correlation_id, created_at, agent_name, workflow_name, node_name,
  event_type, thing_id, action, trigger, risk_score, status,
  details, error_message, duration_ms
) VALUES (
  $1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6,
  $7, $8, $9, $10, $11, $12,
  $13::jsonb, $14, $15
)
ON CONFLICT (audit_id) DO NOTHING;
```

Optimization Ditto endpoint:

```text
PUT {{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $json.thing_id }}/features/optimization/properties
```

### 07 System Health Agent

Purpose: scheduled local health checks for Ditto, MQTT, Postgres, n8n, simulator, and dashboard.

Trigger: schedule every 1 minute.

Nodes to create:

- `Schedule: Health Every 1m`
- `Check Ditto Health`: HTTP GET `{{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}/api/2/things/{{ $env.PRIMARY_THING_ID || 'building:floor1:elevator' }}`
- `Check Postgres Health`: Postgres query `SELECT 'postgres' AS component, 'UP' AS status, now() AS checked_at;`
- `Check MQTT Health`: execute command or MQTT publish/read if MQTT nodes are available
- `Check Dashboard Health`: HTTP GET `{{ $env.DASHBOARD_URL || 'http://host.docker.internal:3000' }}`
- `Aggregate Health Status`: `N8n workflows/enterprise-upgrade-code/07_system_health_aggregator.js`
- `Write Health to Ditto`: PUT `features/system_health/properties`
- `Archive Health History`: Postgres insert into `system_health_history`
- `Queue Audit Agent`

Health Ditto payload:

```json
{
  "ditto": "UP",
  "mqtt": "UP",
  "postgres": "UP",
  "n8n": "UP",
  "simulator": "UNKNOWN",
  "dashboard": "UNKNOWN",
  "last_check_at": "ISO-8601"
}
```

## 4. Exact n8n Node Changes

Apply these changes incrementally. Keep the existing webhook paths unchanged.

### Global modifications

- Replace hardcoded `http://docker-nginx-1` with `{{ $env.DITTO_BASE_URL || 'http://docker-nginx-1' }}`.
- Replace hardcoded `building:floor1:elevator` in scheduled workflows with `{{ $env.PRIMARY_THING_ID || 'building:floor1:elevator' }}` until the fleet fan-out node is added.
- Set HTTP Request nodes to `retryOnFail=true`, `maxTries=3`, and timeout `5000` to `8000`.
- Ensure all webhook-to-webhook calls pass `correlation_id`.
- Add a sticky note to each workflow: "Ditto is the source of truth. MQTT is ingestion only. Control writes are safety gated and audited."

### Free self-hosted environment variable set

Do not use the paid n8n Variables feature. These workflows use `$env`, which reads ordinary Docker environment variables from the self-hosted `n8n` container.

Set these values in `.env` and pass them into the `n8n` service environment. The updated `docker-compose.yml` already does this.

```text
PRIMARY_THING_ID=building:floor1:elevator
DITTO_BASE_URL=http://docker-nginx-1
DASHBOARD_URL=http://localhost:3000
LOCAL_LLM_ENABLED=false
LOCAL_LLM_URL=http://ollama:11434
LOCAL_LLM_MODEL=llama3.2
MAX_RISK_AUTO_CONTROL=85
MAINTENANCE_SCAN_INTERVAL_HOURS=6
NOTIFICATION_ESCALATION_MINUTES=15
NOTIFICATION_DEDUPE_MINUTES=5
ELEVATOR_FLEET_IDS=building:floor1:elevator
MIN_FLOOR=0
MAX_FLOOR=3
GROUND_FLOOR=0
TELEGRAM_ENABLED=false
EMAIL_ENABLED=false
SMS_ENABLED=false
VOICE_ENABLED=false
RFID_FAILURE_WINDOW_MINUTES=5
RFID_BLACKLIST_THRESHOLD=3
```

## 5. Database Migration SQL

Run:

```powershell
docker cp postgres/migrations/002_enterprise_iot_upgrade.sql elevator_db:/tmp/002_enterprise_iot_upgrade.sql
docker exec -i elevator_db psql -U admin -d smart_building -f /tmp/002_enterprise_iot_upgrade.sql
docker cp postgres/migrations/004_notification_outbox_contract.sql elevator_db:/tmp/004_notification_outbox_contract.sql
docker exec -i elevator_db psql -U admin -d smart_building -f /tmp/004_notification_outbox_contract.sql
```

The complete SQL is in:

```text
postgres/migrations/002_enterprise_iot_upgrade.sql
postgres/migrations/004_notification_outbox_contract.sql
```

It does not drop existing data.

## 6. Docker Compose Improvements

The Compose file now keeps the current local services and adds optional free profiles:

```powershell
docker compose up -d
docker compose --profile ai up -d ollama
docker compose --profile tools up -d adminer
docker compose --profile observability up -d grafana
```

Ollama remains disabled unless the `ai` profile is started and `LOCAL_LLM_ENABLED=true` is set in `.env` and the n8n container is recreated.

To pull a local model:

```powershell
docker exec -it elevator_ollama ollama pull llama3.2
```

## 7. Environment Variables

Use `.env.example` as the local template. Keep secrets out of workflow code and n8n Code nodes.

Important split:

- Docker `.env`: service runtime settings and values read by n8n expressions such as `$env.DITTO_BASE_URL`.
- n8n Credentials: Ditto Basic Auth, Postgres, SMTP, Telegram credentials.

## 8. Testing Plan

Run these cases from the simulator, dashboard commands, or webhook calls:

1. Normal telemetry: event is archived, risk is `OK` or `INFO`, no control action.
2. Duplicated telemetry: second event is archived with `duplicate=true` and `processing_status='DUPLICATE'`.
3. Forced door: analysis flags `FORCED_ENTRY`, security state escalates, lockdown request goes through Control Agent.
4. Motor vibration anomaly: flags `HIGH_VIBRATION` or `CRITICAL_VIBRATION`, maintenance work order generated when threshold is met.
5. Motor overheat: flags `MOTOR_OVERHEAT`, risk is `WARNING` or `CRITICAL`.
6. Audio distress: flags `DISTRESS_AUDIO`, security state requires human review.
7. Repeated unauthorized RFID: card appears in `blacklisted_cards` after threshold in the configured window.
8. Emergency stop command: command is validated, written to Ditto, and logged in `control_command_log`.
9. Lockdown command: writes emergency stop, security alert, and `attributes/system_mode=LOCKDOWN`.
10. Resume normal rejected if unsafe: unresolved critical security or maintenance state causes `REJECTED`.
11. Maintenance work order dedupe: same `thing_id + issue_key` updates the open work order instead of creating duplicates.
12. Notification dedupe and retry: repeated same alert creates one outbox row per channel per dedupe bucket; failed delivery schedules retry.
13. Ditto down: ingestion dead-letter/audit branch records degraded state without notification spam.
14. Postgres down: workflows fail visibly and audit/log DB recovery should be verified after restart.
15. MQTT down: health workflow writes `mqtt=DOWN` or `DEGRADED` to Ditto.
16. Multi-elevator simulation: set `ELEVATOR_FLEET_IDS=building:floor1:elevator,building:floor2:elevator` and verify per-thing telemetry, dedupe, risk, audit, notifications.

## 9. Acceptance Criteria

The upgrade is accepted when:

- All workflows import into n8n.
- No paid service is required.
- Docker stack runs locally.
- Telemetry is archived in TimescaleDB/Postgres.
- Deterministic risk analysis works with `LOCAL_LLM_ENABLED=false`.
- Ollama can be enabled later without changing workflow logic.
- Critical actions pass Control Safety Gate.
- Every important action creates an audit event.
- Notifications are deduplicated and retried.
- Maintenance work orders are not duplicated for the same open issue.
- Additional elevator IDs are added by config.
- Ditto Thing schema remains backward-compatible with existing dashboard fields.

## 10. Academic Thesis Value

This design demonstrates:

- Agentic AI orchestration: separate surveillance, analysis, control, security, maintenance, notification, optimization, and audit agents coordinate through explicit events.
- Digital Twin synchronization: Ditto remains the source of truth for current elevator state, AI analysis, control intent, health, and optimization recommendations.
- IoT telemetry ingestion: MQTT and simulator data are normalized into an auditable TimescaleDB history.
- Predictive maintenance: deterministic wear scoring combines vibration, temperature, hours, current, power, load, and door cycles.
- Safety-aware autonomous control: critical commands are generated by rules, validated by a safety gate, written through Ditto, and audited.
- Observability: audit log, notification outbox, health history, command log, and continuous aggregates make the system explainable.
- Scalable smart-building infrastructure: every table and workflow carries `thing_id` and `correlation_id`, preparing the system for multi-elevator and multi-building deployment.
