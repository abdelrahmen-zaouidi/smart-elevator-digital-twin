# Validation Test Procedures

This document provides repeatable procedures for the major validation groups. Use it with `test-matrix.md`, `evidence-checklist.md`, and `results-template.md`.

No procedure should be marked as passed until the evidence listed in the procedure has been saved in the validation evidence folder.

## 1. Common Setup Procedure

### Objective

Prepare a controlled, repeatable environment for all validation tests.

### Required Setup

- Eclipse Ditto stack running separately.
- This repository available on the test machine.
- `.env` configured from `.env.example`.
- Physical ESP32 prototype available for physical tests.
- Python simulator disabled unless explicitly running simulator/fault-injection tests.
- n8n workflows imported, credentials attached, and activated only for tests that require them.

### Commands to Run

```powershell
docker compose ps
node scripts\validation\check-system-health.js
python scripts\validate_mqtt_topics.py
python -m unittest tests.test_simulator -v
```

Provision Ditto if needed:

```powershell
.\scripts\init-ditto.ps1
```

Start this stack:

```powershell
docker compose up -d --build
```

Start the dashboard:

```powershell
cd apps/dashboard
npm run dev
```

### Expected Result

- Mosquitto, bridge, n8n, PostgreSQL, and required optional services report running or a clear warning.
- Ditto health endpoint is reachable.
- Thing `building:floor1:elevator` exists.
- Dashboard is reachable at `http://localhost:3000`.
- MQTT topic validation script reports no unexpected legacy topics.

### Evidence to Capture

- Terminal output of `check-system-health.js`.
- `docker compose ps` output.
- Ditto Thing JSON export.
- Dashboard home screenshot after login.
- n8n workflow activation screenshot.

### Pass/Fail Rule

Pass only if the required services for the target test group are reachable. If optional services are intentionally disabled, record them as warnings, not failures.

## 2. Hardware Bench Validation Procedure

### Objective

Validate the reduced-scale physical prototype independently from cloud and dashboard layers.

### Required Setup

- ESP32 firmware flashed.
- Serial monitor open at the configured baud rate.
- Prototype powered from the final validation supply.
- Hall-effect sensors installed at floors 0, 1, 2, and 3.
- HX711 load-cell calibration completed or calibration process ready.
- RFID authorized and unauthorized cards available.
- Emergency-stop button connected.
- LCD connected if included in final prototype.

### Physical Actions

1. Photograph the full prototype, electronics bay, power supply, sensor placement, and actuator wiring.
2. Move the cabin manually or through safe jog mode to floor 0, then floors 1, 2, and 3.
3. Record serial output for each floor sensor state.
4. Perform a one-floor movement from floor 0 to floor 1.
5. Perform a multi-floor movement from floor 0 to floor 3.
6. Open and close the door actuator.
7. Apply known normal load and overload conditions.
8. Present one authorized RFID card and one unauthorized RFID card.
9. Press the emergency stop during idle and, if mechanically safe, during movement.
10. Record LCD status changes for floor, door, overload, RFID, and emergency stop.

### Expected MQTT Message

For each state change, the ESP32 should publish JSON telemetry on:

```text
elevator/building-floor1-elevator/telemetry
```

Expected feature-aligned fields include:

```json
{
  "thingId": "building:floor1:elevator",
  "features": {
    "cabin": {
      "properties": {
        "current_floor": 0,
        "target_floor": 0,
        "load_kg": 0,
        "speed_ms": 0,
        "emergency_stop": false
      }
    },
    "door": {
      "properties": {
        "state": "CLOSED",
        "door_forced_entry": false
      }
    },
    "security": {
      "properties": {
        "rfid_last_card": "",
        "rfid_access_granted": true,
        "alert_level": "NORMAL"
      }
    }
  }
}
```

The payload may be a Ditto envelope with `path: "/features"` and `value` containing the feature tree. The field names must still map to the Ditto feature model.

### Expected Ditto Update

The bridge should update:

- `/api/2/things/building:floor1:elevator/features/cabin`
- `/api/2/things/building:floor1:elevator/features/door`
- `/api/2/things/building:floor1:elevator/features/security`
- `/api/2/things/building:floor1:elevator/features/incident_log` for incidents.

### Expected Dashboard Behavior

- Digital Twin page shows floor, target, direction, door state, load, and emergency state.
- Security page reflects authorized or unauthorized RFID activity.
- Alerts & Logs page shows abnormal events after n8n/database paths are active.
- Command Center blocks movement when emergency stop, overload, or lockdown is active.

### Expected Database Record

When workflow 01 is active, `telemetry_raw` should contain one or more rows whose `thing_id`, timestamp, floor, load, door state, forced-entry flag, audio-distress flag, and risk fields correspond to the physical action.

### Expected n8n Workflow Behavior

- Workflow 01 archives telemetry.
- Workflow 02 computes deterministic risk for abnormal conditions.
- Workflow 03 rejects unsafe commands.
- Workflow 04 handles security and maintenance events.
- Workflow 05 queues alerts for warning/critical events.
- Workflow 06 records audit events when configured.

### Evidence to Capture

- Photos and videos of physical actions.
- ESP32 serial monitor log.
- MQTT capture.
- Ditto before/after JSON snapshots.
- Dashboard screenshots.
- n8n execution screenshots.
- PostgreSQL query output.

### Pass/Fail Rule

Pass only when the physical state, ESP32 serial output, MQTT payload, Ditto state, dashboard state, and database/n8n evidence are mutually consistent. If any layer is missing evidence, mark the test pending or blocked.

## 3. MQTT Communication Procedure

### Objective

Verify that ESP32 telemetry and events use canonical MQTT topics, valid JSON payloads, and reconnection behavior.

### Required Setup

- Mosquitto running.
- ESP32 or simulator publishing.
- MQTT Explorer or Docker `mosquitto_sub` available.

### Commands to Run

Subscribe to all telemetry:

```powershell
docker exec elevator-mqtt mosquitto_sub -t "elevator/+/telemetry" -v
```

Subscribe to all event and status topics:

```powershell
docker exec elevator-mqtt mosquitto_sub -t "elevator/+/events" -v
docker exec elevator-mqtt mosquitto_sub -t "elevator/+/status" -v
```

Validate static topic references:

```powershell
python scripts\validate_mqtt_topics.py
```

Restart broker for reconnect test:

```powershell
docker compose restart mosquitto
```

### Physical Action if Needed

Trigger floor movement, unauthorized RFID, overload, forced door, and emergency stop from the prototype.

### Expected MQTT Message

- Topic is `elevator/building-floor1-elevator/telemetry`, `events`, `commands`, or `status`.
- Payload is valid JSON.
- Payload is lightweight enough for embedded publication.
- Payload contains a Thing identifier or a Ditto feature patch.

### Expected Ditto Update

The bridge maps the MQTT payload to Ditto feature or attribute paths and logs synchronization.

### Expected Dashboard Behavior

If MQTT WebSocket is enabled, the dashboard may show MQTT connected. The authoritative operational state must still be read from Ditto.

### Expected Database Record

When n8n workflow 01 is active, telemetry appears in `telemetry_raw`.

### Expected n8n Workflow Behavior

Workflow 01 sees the corresponding Ditto state after the bridge update and creates a canonical event for downstream workflows.

### Evidence to Capture

- MQTT Explorer screenshot or `mosquitto_sub` log.
- Broker restart timestamp.
- ESP32 reconnect serial log.
- Bridge reconnect/sync log.
- First valid telemetry message after reconnect.

### Pass/Fail Rule

Pass only if telemetry resumes after broker restart without firmware restart and without crashing bridge or dashboard. Record telemetry loss and recovery time as KPIs.

## 4. Bridge and Ditto Synchronization Procedure

### Objective

Verify that MQTT telemetry becomes a consistent Eclipse Ditto Thing update through the bridge.

### Required Setup

- Ditto reachable.
- Thing provisioned.
- Bridge container running.
- MQTT telemetry available.

### Commands to Run

Capture bridge logs:

```powershell
docker logs elevator_bridge --tail 100
```

Capture a Thing snapshot:

```powershell
$pair = "ditto:ditto"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
Invoke-RestMethod -Uri "http://localhost:8080/api/2/things/building:floor1:elevator" -Headers @{ Authorization = "Basic $auth" } | ConvertTo-Json -Depth 20
```

### Physical Action if Needed

Move the cabin, open/close the door, trigger RFID denial, or trigger overload.

### Expected MQTT Message

MQTT payload contains a feature tree or a Ditto path envelope that can be mapped to:

- `features.cabin.properties`
- `features.door.properties`
- `features.motor.properties`
- `features.security.properties`
- `features.energy.properties`
- `features.performance.properties`
- `attributes.risk_score` when supplied by agents.

### Expected Ditto Update

Ditto feature values change only in the relevant feature path. Unrelated features remain intact.

### Expected Dashboard Behavior

Digital Twin and relevant pages reflect the same state as the Ditto snapshot.

### Expected Database Record

If workflow 01 is active, a telemetry row appears after the Ditto update.

### Expected n8n Workflow Behavior

Workflow 01 normalizes the updated Thing into a canonical event. Workflow 02 updates risk analysis when thresholds are met.

### Evidence to Capture

- MQTT payload.
- Bridge logs showing subscribe, write, retry, duplicate skip, or parse error.
- Ditto JSON before and after the trigger.
- Dashboard screenshot after update.

### Pass/Fail Rule

Pass only when the same trigger is visible in MQTT, bridge logs, Ditto, dashboard, and database/n8n evidence as applicable.

## 5. n8n Agentic Workflow Procedure

### Objective

Validate the agentic workflows while ensuring deterministic rules retain safety authority.

### Required Setup

- n8n reachable at `http://localhost:5678`.
- Workflows imported:
  - `01_ingestion_surveillance_agent`
  - `02_analysis_ai_brain_agent`
  - `03_control_agent`
  - `04_security_maintenance_agents`
  - `05_notification_agent`
  - `06_optimization_audit_agents`
- Credentials attached:
  - `Authentication` for Ditto HTTP Basic Auth.
  - `Postgres account` for PostgreSQL.
  - Optional Telegram/SMTP credentials only if channels are enabled.
- PostgreSQL migrations applied.

### Commands to Run

Check database tables:

```powershell
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(time) FROM telemetry_raw;"
docker exec elevator_db psql -U admin -d smart_building -c "SELECT created_at, workflow_name, status FROM audit_log ORDER BY created_at DESC LIMIT 10;"
```

Run evidence queries:

```powershell
Get-Content scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
```

Windows `cmd.exe` equivalent:

```bat
type scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
```

### Physical Action if Needed

Trigger unauthorized RFID, overload, emergency stop, forced door, high vibration, or motor overheating.

### Expected MQTT Message

Abnormal state should be represented in telemetry or event payloads and then reflected in Ditto.

### Expected Ditto Update

- Workflow 02 writes `attributes/risk_score`.
- Workflow 02 writes the idempotent `features/ai_analysis` feature object and the dashboard reads `features/ai_analysis/properties`.
- Workflow 04 writes `features/security/properties`, `features/maintenance_schedule/properties`, or `features/predicted_failures/properties` when applicable.
- Workflow 03 writes only validated control paths.

### Expected Dashboard Behavior

- AI Insights shows deterministic analysis output.
- Security page shows access-control results.
- Maintenance page shows work orders or empty state.
- Alerts & Logs shows audit and notification evidence.

### Expected Database Record

- `telemetry_raw` receives canonical events.
- `control_command_log` records accepted and rejected control requests.
- `maintenance_work_orders` stores generated work orders.
- `notification_outbox` stores dashboard or external alerts.
- `audit_log` stores workflow activity.

### Expected n8n Workflow Behavior

- Workflow 01 archives telemetry and deduplicates.
- Workflow 02 computes deterministic risk and skips optional LLM when disabled.
- Workflow 03 rejects unsafe command intent with explicit reasons.
- Workflow 04 handles RFID/security and maintenance analysis.
- Workflow 05 writes notification outbox rows and skips disabled external channels safely.
- Workflow 06 records audit activity and must not bypass the control safety gate.

### Evidence to Capture

- n8n execution screenshots for each triggered workflow.
- Execution JSON export if available.
- PostgreSQL query output.
- Ditto JSON snapshots.
- Dashboard screenshots.

### Pass/Fail Rule

Pass only when workflow execution is green or an expected rejection/failure is logged intentionally, with matching database and Ditto evidence. Any unhandled workflow error is a fail or blocked condition.

## 6. Command Safety Gate Procedure

### Objective

Verify that unsafe command intent is rejected and safe command intent is auditable.

### Required Setup

- Dashboard command API active at `http://localhost:3000/api/commands`.
- n8n workflow 03 active if validating the agent-side control path.
- Ditto reachable.
- Database table `control_command_log` exists.

### Commands to Run

Example dashboard safety-gate invalid-floor command:

```powershell
$body = @{
  command = "MOVE_TO_FLOOR"
  thing_id = "building:floor1:elevator"
  source = "dashboard"
  source_agent = "validation_operator"
  requested_by = "validation_operator"
  target_floor = 99
  reason = @("invalid floor validation")
  confirmation = $true
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/commands" -ContentType "application/json" -Body $body
```

Example n8n control-agent invalid-floor command:

```powershell
$body = @{
  thing_id = "building:floor1:elevator"
  system_mode = "NORMAL"
  triggered_action = @{
    command = "REPOSITION"
    target_floor = 99
    source_agent = "validation_operator"
    correlation_id = "CID-VALIDATION-SEC-04"
    reason = @("invalid floor validation")
    risk_score = 10
  }
  payload = @{
    cabin = @{
      emergency_stop = $false
    }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "http://localhost:5678/webhook/control-agent" -ContentType "application/json" -Body $body
```

Query command log:

```powershell
docker exec elevator_db psql -U admin -d smart_building -c "SELECT command_id, command, status, reason, error_message, created_at FROM control_command_log ORDER BY created_at DESC LIMIT 10;"
```

### Physical Action if Needed

For emergency stop and overload rejection, assert the physical condition first and verify the ESP32 telemetry reaches Ditto before sending movement intent.

### Expected MQTT Message

No direct MQTT movement command should be required to prove the safety gate. Command intent should be represented through n8n and Ditto. If the device also listens to MQTT commands, it must still enforce local interlocks.

### Expected Ditto Update

Rejected commands must produce no unsafe Ditto write. Validated commands may write specific paths only, such as:

- `features/cabin/properties/target_floor`
- `features/cabin/properties/emergency_stop`
- `features/security/properties/alert_level`
- `attributes/system_mode`

### Expected Dashboard Behavior

Command Center shows safe/blocked state and command feedback. Alerts/logs or reports show command log when database routes are active.

### Expected Database Record

`control_command_log.status` records `REJECTED` or `VALIDATED` with reason, risk score, source agent, and correlation ID.

### Expected n8n Workflow Behavior

Dashboard safety gate and n8n workflow 03:

- Rejects unsupported commands.
- Rejects missing reason.
- Rejects invalid floor.
- Rejects movement during emergency stop.
- Rejects movement during lockdown.
- Rejects high-risk auto-control when human approval is required.
- Accepts safe commands with complete metadata.

### Evidence to Capture

- Dashboard `/api/commands` response for accepted and rejected commands.
- n8n execution for each rejection reason.
- `control_command_log` query output.
- Ditto before/after JSON proving no unsafe write.
- Dashboard command-center screenshot.

### Pass/Fail Rule

Pass only if every unsafe command is rejected and no unsafe Ditto state mutation occurs. Any unsafe movement command accepted without valid override is a fail.

## 7. Dashboard Validation Procedure

### Objective

Verify that the SCADA dashboard visualizes current and historical elevator state without becoming the safety controller.

### Required Setup

- Dashboard running at `http://localhost:3000`.
- Ditto reachable through `/api/ditto`.
- PostgreSQL reachable for history pages.
- Mosquitto WebSocket reachable if MQTT status is tested.

### Commands to Run

Start the dashboard:

```powershell
cd apps/dashboard
npm run dev
```

Call history APIs:

```powershell
Invoke-RestMethod "http://localhost:3000/api/history/summary" | ConvertTo-Json -Depth 6
Invoke-RestMethod "http://localhost:3000/api/history/telemetry?limit=5" | ConvertTo-Json -Depth 6
Invoke-RestMethod "http://localhost:3000/api/history/commands?limit=5" | ConvertTo-Json -Depth 6
```

### Physical Action if Needed

Move cabin, trigger RFID denied, overload, forced door, and emergency stop.

### Expected MQTT Message

If MQTT WebSocket is enabled, the dashboard may show connected status and last message. It must not treat MQTT as the authoritative operational state.

### Expected Ditto Update

Dashboard views should match the latest Ditto Thing snapshot.

### Expected Dashboard Behavior

- Digital Twin: live cabin, door, motor, security, energy, and performance values.
- Monitoring: charts update or show clear empty state.
- Command Center: safe commands only; blocked unsafe states visible.
- AI Insights: deterministic analysis and optional LLM status.
- Security: RFID, forced-door, alert-level information.
- Maintenance: predicted failures and work orders.
- Alerts & Logs: incident, command, audit, notification rows.
- Reports: historical aggregates.
- Settings: configuration status without browser-side database secrets.

### Expected Database Record

History API routes return server-side data from PostgreSQL without exposing database credentials to the browser.

### Expected n8n Workflow Behavior

Dashboard must reflect n8n output through Ditto and database routes. It must not override safety rules.

### Evidence to Capture

- Screenshot of each dashboard page.
- Browser console log with no critical runtime errors.
- API response files.
- Ditto snapshot matching dashboard state.

### Pass/Fail Rule

Pass only if the page renders without critical errors, shows correct current or empty state, and matches Ditto/database evidence.

## 8. Database Validation Procedure

### Objective

Verify persistence, historical queries, and server-side API access.

### Required Setup

- PostgreSQL/TimescaleDB container running.
- Migrations applied.
- n8n workflows active for the relevant tables.

### Commands to Run

Run the validation query bundle:

```powershell
Get-Content scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
```

Windows `cmd.exe` equivalent:

```bat
type scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
```

Run individual checks:

```powershell
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(time) FROM telemetry_raw;"
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(created_at) FROM audit_log;"
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(created_at) FROM notification_outbox;"
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(created_at) FROM control_command_log;"
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(created_at) FROM maintenance_work_orders;"
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*), max(checked_at) FROM system_health_history;"
```

### Expected MQTT Message

Telemetry rows should originate from real MQTT/Ditto updates, not manually inserted rows, unless the test explicitly states synthetic data.

### Expected Ditto Update

Database records should correspond to Ditto state at the same time or correlation ID.

### Expected Dashboard Behavior

History pages and API routes should display the same data or clear empty states.

### Expected Database Record

All expected tables exist. Rows are present only for tests that were actually run.

### Expected n8n Workflow Behavior

n8n workflows insert rows using parameterized queries and preserve correlation metadata.

### Evidence to Capture

- SQL output as text.
- CSV exports where useful.
- Dashboard history API responses.
- n8n execution screenshots for inserts.

### Pass/Fail Rule

Pass only if the database row content matches the trigger and no credentials are exposed in browser-side code or screenshots.

## 9. Fault-Injection Procedure

### Objective

Validate degraded behavior under communication, parsing, service, and abnormal physical scenarios.

### Required Setup

- Full stack running.
- ESP32 or simulator active.
- Evidence capture started.

### Commands to Run

Broker restart:

```powershell
docker compose restart mosquitto
```

Bridge log capture:

```powershell
docker logs elevator_bridge --tail 200
```

Invalid JSON injection:

```powershell
docker exec elevator-mqtt mosquitto_pub -t "elevator/building-floor1-elevator/telemetry" -m "{invalid-json"
```

Duplicate payload test:

```powershell
docker exec elevator-mqtt mosquitto_pub -t "elevator/building-floor1-elevator/telemetry" -m "{\"thingId\":\"building:floor1:elevator\",\"features\":{\"cabin\":{\"properties\":{\"current_floor\":0,\"target_floor\":0,\"direction\":\"IDLE\",\"load_kg\":0,\"speed_ms\":0,\"emergency_stop\":false}}}}"
docker exec elevator-mqtt mosquitto_pub -t "elevator/building-floor1-elevator/telemetry" -m "{\"thingId\":\"building:floor1:elevator\",\"features\":{\"cabin\":{\"properties\":{\"current_floor\":0,\"target_floor\":0,\"direction\":\"IDLE\",\"load_kg\":0,\"speed_ms\":0,\"emergency_stop\":false}}}}"
```

### Physical Action if Needed

Trigger forced door, overload, emergency stop, unauthorized RFID, or a disconnected sensor if safe.

### Expected MQTT Message

Valid messages resume after fault. Invalid messages are logged and ignored.

### Expected Ditto Update

No corrupted Ditto state from invalid JSON. Valid post-recovery telemetry updates the correct paths.

### Expected Dashboard Behavior

Dashboard shows disconnected/degraded state while needed and recovers without reload when possible.

### Expected Database Record

Fault events and audit entries are recorded when n8n workflows are active. Data gaps are measured, not hidden.

### Expected n8n Workflow Behavior

Workflows either process the recovered state or record explicit failure/dead-letter paths.

### Evidence to Capture

- Broker logs.
- Bridge logs.
- Dashboard degraded screenshot.
- Reconnection timestamp.
- Database rows before and after fault.
- KPI calculations for recovery time and telemetry loss.

### Pass/Fail Rule

Pass only if the system degrades visibly, avoids crashes, recovers, and records the fault or data loss. Silent failure is a fail.

## 10. End-to-End Scenario Procedure

### Objective

Validate thesis demonstration scenarios across all layers.

### Required Setup

- Full stack running.
- Physical prototype available.
- Evidence folders prepared.
- n8n workflows active and healthy.
- Dashboard open.
- MQTT capture running.
- ESP32 serial capture running.

### Scenarios

Run the following scenarios one at a time:

1. Move cabin from floor 0 to floor 3.
2. Authorized RFID access.
3. Unauthorized RFID access.
4. Overload.
5. Emergency stop.
6. Forced door/security event.
7. MQTT disconnect and reconnect.

### Expected Evidence Chain

Each scenario requires the following evidence chain:

```text
Physical action
  -> ESP32 serial output
  -> MQTT topic capture
  -> Bridge log
  -> Ditto Thing JSON
  -> Dashboard screenshot
  -> n8n execution screenshot
  -> PostgreSQL query result
  -> Result record
```

### Pass/Fail Rule

Pass only if the evidence chain is complete and consistent. If the physical evidence is missing, the scenario remains `Pending physical validation` even if the simulator reproduces the software path.
