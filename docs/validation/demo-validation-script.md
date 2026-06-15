# Thesis Demonstration Validation Script

This script defines the recommended order for the final defense demonstration. It is written to avoid unsupported claims: each step should show the system state and evidence rather than merely describe it.

## 1. Pre-Demo Rules

- Use the ESP32 physical prototype as the canonical source for final physical scenarios.
- Use the Python simulator only for fallback or fault injection, and state that clearly.
- Do not claim industrial certification.
- Do not show raw secrets in screenshots.
- Do not mark results as passed unless the evidence bundle is complete.
- Keep the dashboard, n8n, MQTT capture, Ditto REST output, and database terminal visible or ready.

## 2. Evidence Folder

Create a run folder before starting:

```text
docs/validation/evidence/YYYY-MM-DD_defense-rehearsal-01/
```

Store all screenshots, logs, and exports in this folder.

## 3. Start Eclipse Ditto

From the Eclipse Ditto repository or deployment folder:

```powershell
docker compose up -d
```

Verify:

```powershell
Invoke-WebRequest http://localhost:8080/health -UseBasicParsing
```

Expected evidence:

- Ditto health check output.
- Screenshot or terminal output showing Ditto stack running.

## 4. Start This Repository Stack

From this repository root:

```powershell
docker compose up -d --build
docker compose ps
```

Expected services:

- `elevator-mqtt`
- `elevator_bridge`
- `elevator_simulator` only if simulator fallback is enabled
- `elevator_agents`
- `elevator_db`

Run health check:

```powershell
node scripts\validation\check-system-health.js
```

Expected evidence:

- Terminal output of service state and health check.
- Any warning captured with explanation.

## 5. Provision Ditto Thing

```powershell
.\scripts\init-ditto.ps1
```

Export Thing snapshot:

```powershell
$pair = "ditto:ditto"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
Invoke-RestMethod -Uri "http://localhost:8080/api/2/things/building:floor1:elevator" -Headers @{ Authorization = "Basic $auth" } | ConvertTo-Json -Depth 20
```

Expected evidence:

- Thing JSON showing required features.
- Policy and Thing ID visible.

## 6. Start Dashboard

```powershell
cd apps/dashboard
npm run dev
```

Open:

```text
http://localhost:3000
```

Expected evidence:

- Dashboard login/session screenshot.
- Digital Twin page screenshot.
- Settings page screenshot showing no raw database credentials.

## 7. Start ESP32 or Simulator

### Preferred: ESP32

1. Connect ESP32 by USB.
2. Open serial monitor.
3. Reset ESP32.
4. Confirm Wi-Fi and MQTT connection logs.

Expected evidence:

- Serial monitor boot log.
- Prototype photo.
- MQTT connection log.

### Fallback: Python Simulator

Use only if the physical prototype is unavailable or if a fault-injection scenario is being demonstrated:

```powershell
docker compose up -d --build simulator
```

Expected evidence:

- Clear note that simulator evidence is not physical validation.
- Simulator logs and `runtime/live-twin.json`.

## 8. Verify MQTT Telemetry

Open a terminal:

```powershell
docker exec elevator-mqtt mosquitto_sub -t "elevator/+/telemetry" -v
```

Expected:

- Telemetry appears on `elevator/building-floor1-elevator/telemetry`.
- Payload is valid JSON.

Capture:

- MQTT Explorer screenshot or terminal log.

## 9. Verify Bridge and Ditto Synchronization

```powershell
docker logs elevator_bridge --tail 50
```

Then query the Thing:

```powershell
$pair = "ditto:ditto"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
Invoke-RestMethod -Uri "http://localhost:8080/api/2/things/building:floor1:elevator" -Headers @{ Authorization = "Basic $auth" } | ConvertTo-Json -Depth 20
```

Expected:

- Bridge logs synchronization.
- Ditto feature values match the latest telemetry.

Capture:

- Bridge log excerpt.
- Ditto JSON snapshot.

## 10. Verify Dashboard Real-Time Data

Open the Digital Twin and Monitoring pages.

Expected:

- Ditto connection indicator active or clear degraded state.
- Floor, door, load, motor, and security values match Ditto.
- Monitoring page shows charts or explicit empty state.

Capture:

- Digital Twin screenshot.
- Monitoring screenshot.
- Browser console screenshot if needed.

## 11. Demonstrate Floor Movement

### Physical action

Command or operate the cabin from floor 0 to floor 1, then floor 0 to floor 3 if safe.

Expected:

- ESP32 serial output reports target and current floor.
- MQTT telemetry reports `current_floor`, `target_floor`, and `direction`.
- Ditto `features.cabin.properties` updates.
- Dashboard shows the movement.
- Database receives `telemetry_raw` rows when workflow 01 is active.

Capture:

- Video/photo.
- Serial log.
- MQTT capture.
- Ditto before/after JSON.
- Dashboard screenshot.
- Database query output.

## 12. Demonstrate RFID Access

### Authorized RFID

Present authorized card.

Expected:

- Access granted.
- Security feature remains normal.
- Dashboard security state remains normal.

### Unauthorized RFID

Present unauthorized card.

Expected:

- Access denied.
- Unauthorized counter increments.
- Security feature updates.
- Alert appears if rules route it.
- Notification outbox and audit log receive rows if workflows are active.

Capture:

- Serial log.
- MQTT payload.
- Ditto security feature.
- Security page screenshot.
- n8n execution screenshot.
- Database query output.

## 13. Demonstrate Overload

Apply a known overload to the cabin.

Expected:

- Load threshold exceeded.
- Movement is blocked locally and/or by command safety gate.
- Risk score increases according to deterministic rules.
- Dashboard warning appears.
- Database row records overload-related telemetry.

Capture:

- Load evidence.
- ESP32 serial log.
- MQTT telemetry.
- Ditto cabin/risk state.
- Dashboard warning.
- n8n analysis execution.
- Database rows.

## 14. Demonstrate Emergency Stop

Press the emergency-stop button.

Expected:

- Cabin stops.
- `emergency_stop` becomes true.
- System mode changes to maintenance/degraded according to implemented path.
- Movement commands are rejected until reset.
- Critical alert is visible and auditable.

Capture:

- Physical action video/photo.
- Serial log.
- MQTT telemetry.
- Ditto cabin/system mode snapshot.
- Dashboard critical alert.
- Control gate rejection execution.
- Command/audit/notification rows.

## 15. Demonstrate Forced Door or Security Event

Trigger forced-door condition safely.

Expected:

- Door forced-entry flag becomes true.
- Security alert level increases.
- Incident log updates.
- Security agent evaluates state.
- Audit record is created when workflow 06 is active.

Capture:

- Physical trigger evidence.
- MQTT payload.
- Ditto door/security/incident JSON.
- n8n security workflow screenshot.
- Dashboard security/alerts screenshot.
- Database audit row.

## 16. Demonstrate n8n Analysis and Control Safety

Show workflow executions in n8n:

- Workflow 01 ingestion.
- Workflow 02 deterministic risk.
- Workflow 03 rejected unsafe command.
- Workflow 04 security or maintenance analysis.
- Workflow 05 notification outbox.
- Workflow 06 audit.

Also show the dashboard command safety gate:

- `/api/commands` response for a safe operator command.
- `/api/commands` response for an unsafe command, such as an invalid target floor or movement while emergency stop is active.
- `control_command_log` row proving that rejected commands produced no Ditto write.

Expected:

- Deterministic risk explains the action.
- Optional LLM is shown as disabled/skipped unless explicitly enabled.
- Unsafe command is rejected with reason.
- No LLM output authorizes commands.

Capture:

- n8n execution screenshots.
- Control command log query.

## 17. Demonstrate Database History

Run:

```powershell
Get-Content scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
```

Windows `cmd.exe` equivalent:

```bat
type scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
```

Expected:

- Recent telemetry rows.
- Recent risk records.
- Command log records.
- Audit log records.
- Notification outbox records.
- Maintenance work orders if scenario was triggered.
- System health history if enabled.

Capture:

- Terminal output or CSV exports.
- Reports page screenshot.

## 18. Demonstrate MQTT Disconnect Recovery

Only run if it is safe and the demo time allows it.

```powershell
docker compose restart mosquitto
```

Expected:

- ESP32 or simulator reconnects.
- Bridge reconnects.
- Dashboard shows degraded then recovered state.
- Telemetry resumes.
- Recovery time and data loss are recorded.

Capture:

- Broker restart command.
- ESP32 serial reconnect log.
- Bridge log.
- MQTT capture before/after.
- Dashboard degraded/recovered screenshots.

## 19. Final Reports

Show:

- `docs/validation/test-matrix.md`
- Completed `docs/validation/results-template.md`
- Evidence folder.
- Database query output.
- Dashboard reports page.
- Thesis limitation statement.

## 20. Closing Statement for Defense

Use a statement similar to:

```text
This system is a reduced-scale academic research prototype. The ESP32 and deterministic rules provide the safety-critical decisions. Eclipse Ditto is the current-state authority. The optional LLM is explanatory only and has no command authority. The prototype demonstrates an event-driven digital twin architecture, but it is not an industrially certified elevator safety controller.
```
