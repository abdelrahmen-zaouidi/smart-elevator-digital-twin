# Evidence Collection Checklist

Use this checklist during final validation and thesis defense rehearsal. Store all files under:

```text
docs/validation/evidence/YYYY-MM-DD_test-run-XX/
```

Do not mark a test as passed until the corresponding evidence is collected and referenced in `results-template.md`.

## 1. Test Run Metadata

- [ ] Test run identifier, for example `2026-05-13_test-run-01`
- [ ] Date and time range
- [ ] Operator name
- [ ] Repository revision or archive identifier
- [ ] ESP32 firmware version/date
- [ ] Hardware configuration photo
- [ ] `.env` configuration review with secrets redacted
- [ ] Docker Compose service list
- [ ] `node scripts/validation/check-system-health.js` output
- [ ] `python scripts/validate_mqtt_topics.py` output
- [ ] `python -m unittest tests.test_simulator -v` output
- [ ] `node scripts/validation/test-command-safety-gate.mjs` output
- [ ] Database evidence export output from `scripts/validation/export-validation-data.sql`

## 2. Hardware and Embedded Evidence

- [ ] Photo of complete physical prototype
- [ ] Photo of ESP32 wiring and power distribution
- [ ] Photo of Hall-effect sensor placement for floors 0 to 3
- [ ] Photo or video of cabin movement floor 0 to floor 1
- [ ] Photo or video of cabin movement floor 0 to floor 3
- [ ] ESP32 serial monitor output for boot and Wi-Fi connection
- [ ] ESP32 serial monitor output for MQTT connection and reconnect
- [ ] ESP32 serial monitor output for floor 0 detection
- [ ] ESP32 serial monitor output for floor 1 detection
- [ ] ESP32 serial monitor output for floor 2 detection
- [ ] ESP32 serial monitor output for floor 3 detection
- [ ] HX711 tare and calibration notes
- [ ] Normal-load measurement evidence
- [ ] Overload measurement evidence
- [ ] Authorized RFID card test log
- [ ] Unauthorized RFID card test log
- [ ] Door open command evidence
- [ ] Door close command evidence
- [ ] Forced-door evidence
- [ ] Emergency-stop button evidence
- [ ] LCD status update photo/video

## 3. MQTT Evidence

- [ ] MQTT Explorer screenshot showing `elevator/building-floor1-elevator/telemetry`
- [ ] MQTT Explorer screenshot showing `elevator/building-floor1-elevator/events`
- [ ] MQTT Explorer screenshot showing `elevator/building-floor1-elevator/status`
- [ ] `mosquitto_sub` telemetry log
- [ ] `mosquitto_sub` event log
- [ ] `mosquitto_sub` status/heartbeat log
- [ ] JSON payload validity proof
- [ ] Broker restart timestamp and command
- [ ] ESP32 reconnect log after broker restart
- [ ] First valid telemetry message after broker restart
- [ ] MQTT telemetry loss/recovery measurement

## 4. Mosquitto and Bridge Evidence

- [ ] Mosquitto service logs
- [ ] Mosquitto WebSocket listener evidence
- [ ] Bridge startup log showing subscriptions
- [ ] Bridge log for successful Ditto synchronization
- [ ] Bridge log for duplicate/unchanged write suppression
- [ ] Bridge retry log for failed Ditto write
- [ ] Bridge log for invalid JSON rejection
- [ ] Bridge log for unmappable payload rejection

## 5. Eclipse Ditto Evidence

- [ ] Ditto health check output
- [ ] Ditto policy JSON snapshot
- [ ] Ditto full Thing JSON before validation run
- [ ] Ditto full Thing JSON after validation run
- [ ] `features.cabin` before/after movement
- [ ] `features.door` before/after door and forced-entry tests
- [ ] `features.motor` before/after vibration/temperature tests
- [ ] `features.security` before/after RFID and forced-door tests
- [ ] `features.incident_log` after abnormal scenario
- [ ] `features.ai_analysis` after workflow 02 execution
- [ ] `features.maintenance_schedule` after maintenance workflow
- [ ] `attributes.risk_score` before/after risk scenario
- [ ] `attributes.system_mode` before/after emergency or lockdown scenario

## 6. n8n Evidence

- [ ] n8n workflow import screenshot
- [ ] Credential attachment screenshot with secret values hidden
- [ ] Workflow 01 ingestion execution screenshot
- [ ] Workflow 02 deterministic analysis execution screenshot
- [ ] Workflow 02 LLM skipped execution screenshot when disabled
- [ ] Workflow 03 accepted command execution screenshot
- [ ] Workflow 03 rejected command execution screenshot
- [ ] Workflow 04 security-agent execution screenshot
- [ ] Workflow 04 maintenance-agent execution screenshot
- [ ] Workflow 05 notification-agent execution screenshot
- [ ] Workflow 06 audit-agent execution screenshot
- [ ] n8n execution export for at least one critical scenario
- [ ] Dead-letter or failure execution screenshot if a negative test is run

## 7. Database Evidence

- [ ] `telemetry_raw` recent records query
- [ ] `telemetry_raw` telemetry count per time window
- [ ] `hourly_risk` query
- [ ] `hourly_energy` query
- [ ] `audit_log` recent records query
- [ ] `notification_outbox` recent records query
- [ ] `control_command_log` accepted command query
- [ ] `control_command_log` rejected command query
- [ ] `maintenance_work_orders` recent records query
- [ ] `system_health_history` recent records query
- [ ] CSV export for telemetry during end-to-end test
- [ ] CSV export for command/audit records during end-to-end test
- [ ] Proof that database credentials are not exposed to the browser

## 8. Dashboard Evidence

- [ ] Login or local operator session screenshot
- [ ] Digital Twin page screenshot during normal operation
- [ ] Digital Twin page screenshot during floor change
- [ ] Monitoring page screenshot with real-time or historical charts
- [ ] Command Center screenshot before command
- [ ] Command Center screenshot after safe command
- [ ] Command Center screenshot after unsafe command rejection
- [ ] AI Insights page screenshot after risk analysis
- [ ] Security page screenshot after authorized RFID
- [ ] Security page screenshot after unauthorized RFID
- [ ] Maintenance page screenshot after work-order scenario
- [ ] Alerts & Logs page screenshot after incident
- [ ] Devices/Sensors page screenshot
- [ ] Reports page screenshot with historical data or clear empty state
- [ ] Settings page screenshot showing configuration without secrets
- [ ] Dashboard degraded-state screenshot during MQTT or Ditto outage
- [ ] Browser console output showing no critical runtime errors

## 9. Safety and Security Evidence

- [ ] Emergency stop blocks movement
- [ ] Overload blocks movement
- [ ] Lockdown blocks unsafe movement command
- [ ] Invalid floor command rejected
- [ ] Missing reason command rejected
- [ ] Unauthorized or incomplete command source rejected/logged
- [ ] Dashboard `/api/commands` safety-gate rejection response
- [ ] Dashboard `/api/commands` accepted-command response
- [ ] Command safety gate rejection reason in `control_command_log`
- [ ] No unsafe Ditto write after rejected command
- [ ] Unauthorized RFID alert
- [ ] Forced-door alert
- [ ] Default credentials identified as development-only
- [ ] Public internet deployment warning included in thesis material

## 10. End-to-End Scenario Evidence

For each scenario, collect a complete evidence bundle.

### E2E-01 Move Floor 0 to 3

- [ ] Physical video/photo
- [ ] ESP32 serial log
- [ ] MQTT telemetry log
- [ ] Bridge log
- [ ] Ditto cabin feature before/after
- [ ] Dashboard before/after screenshot
- [ ] Database telemetry row
- [ ] n8n ingestion execution

### E2E-02 Unauthorized RFID

- [ ] Physical card presentation evidence
- [ ] ESP32 serial log
- [ ] MQTT payload
- [ ] Ditto security feature update
- [ ] Dashboard security/alerts screenshot
- [ ] Notification outbox row
- [ ] Audit log row

### E2E-03 Overload

- [ ] Load-cell calibration evidence
- [ ] Applied overload evidence
- [ ] ESP32 serial log
- [ ] MQTT payload
- [ ] Ditto cabin/risk update
- [ ] Dashboard warning
- [ ] Database telemetry row
- [ ] Command rejection if movement attempted

### E2E-04 Emergency Stop

- [ ] Emergency-stop physical action video/photo
- [ ] ESP32 serial log
- [ ] MQTT payload
- [ ] Ditto cabin and system mode update
- [ ] Dashboard critical alert
- [ ] Control safety gate rejection
- [ ] Audit/notification rows

### E2E-05 MQTT Disconnect

- [ ] Broker stop/restart command output
- [ ] ESP32 reconnect serial log
- [ ] Bridge reconnect log
- [ ] Dashboard degraded and recovered screenshots
- [ ] Telemetry loss count
- [ ] Recovery time measurement

### E2E-06 Forced Door

- [ ] Physical trigger evidence
- [ ] ESP32 serial log
- [ ] MQTT event/telemetry payload
- [ ] Ditto door/security/incident update
- [ ] Dashboard security alert
- [ ] n8n security workflow execution
- [ ] Audit log row

## 11. Final Thesis Evidence

- [ ] Completed `results-template.md` records for all tests executed
- [ ] Summary of passed, failed, blocked, and pending tests
- [ ] Discussion of limitations
- [ ] Statement that the system is an academic reduced-scale prototype
- [ ] Statement that no industrial certification is claimed
- [ ] Statement that deterministic safety rules have command authority
- [ ] Statement that optional LLM explanations have no command authority
