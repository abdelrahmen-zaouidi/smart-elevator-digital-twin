# Formal Validation Campaign

Project: Agentic AI-Driven Digital Twin for Smart and Secure Elevator Management

This document defines the formal validation campaign for the smart elevator digital twin platform. It is written as an academic validation chapter and as an engineering test plan. It does not claim certification or fabricate test results. Test outcomes remain pending until the evidence listed in this package is collected during controlled experiments.

## 1. Purpose of Validation

The purpose of this validation campaign is to transform the current prototype into a repeatable and auditable engineering experiment. The campaign verifies that the reduced-scale elevator prototype, ESP32 firmware, MQTT ingestion, MQTT-to-Ditto bridge, Eclipse Ditto twin, n8n agents, PostgreSQL/TimescaleDB storage, and Next.js SCADA dashboard operate according to the project architecture.

The campaign is designed to answer the following questions:

- Does the physical elevator prototype produce reliable sensor and actuator behavior?
- Does the ESP32 publish canonical JSON telemetry and handle reconnection and commands?
- Does MQTT act only as the ingestion and transport layer?
- Does Eclipse Ditto remain the authoritative current state of the elevator?
- Do n8n agents archive, analyze, notify, and control through deterministic safety rules?
- Does the dashboard visualize current and historical state without becoming the control authority?
- Are abnormal situations detected, logged, and handled with explicit pass/fail evidence?

## 2. Validation Scope

The validation covers the complete data and command path:

```text
ESP32 or simulator
  -> Eclipse Mosquitto MQTT
  -> Node.js MQTT-to-Ditto bridge
  -> Eclipse Ditto Thing
  -> n8n agent workflows
  -> PostgreSQL / TimescaleDB history
  -> Next.js SCADA dashboard
  -> Ditto command intent
  -> device-side command execution or rejection
```

The Python simulator and ESP8266 sketch are included only as fallback, test, and fault-injection tools. The ESP32 physical prototype remains the canonical source for final physical validation.

## 3. Repository Findings Relevant to Validation

The repository contains the following validation-relevant artifacts:

| Area | Findings |
|---|---|
| Docker services | `docker-compose.yml` defines Mosquitto, bridge, simulator, n8n, PostgreSQL/TimescaleDB, optional Ollama, Adminer, and Grafana. Eclipse Ditto is expected to run in a separate Docker Compose stack on the external `docker_default` network. |
| MQTT topics | The canonical convention is `elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}`. For `building:floor1:elevator`, the MQTT-safe ID is `building-floor1-elevator`. |
| Ditto Thing | `scripts/init-ditto.ps1` and `scripts/init-ditto.sh` provision `building:floor1:elevator` with features `cabin`, `door`, `motor`, `security`, `incident_log`, `energy`, `performance`, `predicted_failures`, `ai_analysis`, and `maintenance_schedule`. |
| Bridge | `dashboard/backend/bridge.js` subscribes to telemetry, events, and status topics, parses JSON, normalizes aliases, suppresses unchanged writes per Ditto path, retries failed writes, and writes to `/api/2/things/{thingId}` feature or attribute paths. |
| Simulator | `esp32_simulator.py` implements physics, anomaly profiles, MQTT QoS 1 publishing, reconnect logic, status health markers, runtime twin snapshots, and fault-injection profiles. |
| ESP8266 fallback sketch | `ELEVATOR_SIMULATOR_ESP8266/ELEVATOR_SIMULATOR_ESP8266.ino` publishes a Ditto-compatible payload and canonical MQTT topic. It is a fallback/test tool, not the canonical ESP32 evidence source. |
| n8n workflows | Six exported workflows exist: ingestion/surveillance, analysis AI brain, control agent, security/maintenance agents, notification agent, and optimization/audit agents. Code-node source is available under `N8n workflows/enterprise-upgrade-code/`. |
| Command safety gate | Two deterministic safety-gate surfaces are present and must both be validated: n8n workflow code `03_control_safety_gate.js`, and the dashboard server-side gate `dashboard/src/lib/commandSafetyGate.js` exposed through `dashboard/app/api/commands/route.js`. The route is exercised by `scripts/validation/test-command-safety-gate.mjs`. Rejected commands must not produce Ditto writes. |
| Database schema | `postgres/init` and `postgres/migrations` define `telemetry_raw`, `audit_log`, `notification_outbox`, `control_command_log`, `maintenance_work_orders`, `system_health_history`, `hourly_risk`, `hourly_energy`, and `active_elevator_incidents`. |
| Dashboard | The Next.js SCADA app is a single authenticated shell with pages for Digital Twin, Monitoring, Command Center, AI Insights, Security, Maintenance, Alerts & Logs, Devices/Sensors, Reports, Settings, and Help/About. |
| Dashboard data access | `useDitto` reads Ditto by SSE with polling fallback. `mqttClient` can subscribe by MQTT WebSocket. Historical APIs read the database server-side only. |
| Existing tests | `tests/test_simulator.py` covers simulator topic builders, config, physics, anomaly engine, payload schema, runtime artifacts, and safety latch behavior. `scripts/validate_mqtt_topics.py` validates canonical MQTT topic usage. `scripts/validation/test-command-safety-gate.mjs` covers the dashboard command safety gate. |
| Existing runtime evidence | `runtime/live-twin.json`, `runtime/bridge.log`, `runtime/bridge.err.log`, `runtime/dashboard-dev.*.log`, and `runtime/phase2-dashboard.png` exist, but they are not enough by themselves to mark thesis validation scenarios as passed. |

## 4. System Under Test

The system under test is the reduced-scale smart elevator platform with the following layers:

- Hardware prototype: cabin, guide rail, floor sensors, load cell, RFID reader, door/cabin actuators, emergency stop, LCD, wiring, and power supply.
- Embedded controller: ESP32 firmware as the canonical real data source.
- MQTT transport: Eclipse Mosquitto TCP listener on `1883` and WebSocket listener on `9001`.
- Bridge: Node.js MQTT-to-Ditto bridge.
- Digital twin: Eclipse Ditto Thing `building:floor1:elevator`.
- Agent layer: n8n workflows for ingestion, analysis, control, security, maintenance, notification, optimization, and audit.
- Historical storage: PostgreSQL/TimescaleDB.
- SCADA dashboard: Next.js/React dashboard.
- Fault-injection tools: Python simulator and ESP8266 simulator sketch.

## 5. Test Environment

### 5.1 Hardware Setup

Record the exact hardware used during the final validation run:

| Item | Required record |
|---|---|
| Controller | ESP32 board model, firmware commit/date, serial port, baud rate |
| Floor sensors | Hall-effect sensor model, magnet placement, floor index mapping 0 to 3 |
| Load sensing | Load cell rating, HX711 wiring, calibration factor, tare procedure |
| RFID | Reader model, authorized card IDs, unauthorized test card IDs |
| Actuators | Motor/driver model, door actuator model, limit switches if present |
| Safety devices | Emergency-stop wiring and latch/reset behavior |
| Display | LCD model and expected status fields |
| Power | Supply voltage/current rating, common ground verification, driver power isolation |
| Evidence | Prototype photo, wiring photo, serial monitor capture, short video for movement tests |

### 5.2 Software Setup

The local software setup is expected to use:

- Docker Desktop and Docker Compose v2.
- Eclipse Ditto running in a separate stack.
- This repository's Docker Compose stack for Mosquitto, bridge, simulator, n8n, PostgreSQL, and optional services.
- Node.js 20 or later for the dashboard.
- Python 3.11 or later for simulator tests.
- Browser access to dashboard and n8n.
- MQTT Explorer or `mosquitto_sub` for topic evidence.
- `psql` through Docker for database evidence.

### 5.3 Reference Configuration

| Setting | Reference value |
|---|---|
| Ditto Thing ID | `building:floor1:elevator` |
| MQTT-safe ID | `building-floor1-elevator` |
| Telemetry topic | `elevator/building-floor1-elevator/telemetry` |
| Events topic | `elevator/building-floor1-elevator/events` |
| Commands topic | `elevator/building-floor1-elevator/commands` |
| Status topic | `elevator/building-floor1-elevator/status` |
| Fleet telemetry subscription | `elevator/+/telemetry` |
| Ditto REST path | `/api/2/things/{thingId}` |
| Dashboard | `http://localhost:3000` |
| n8n | `http://localhost:5678` |
| Mosquitto TCP | `localhost:1883` |
| Mosquitto WebSocket | `localhost:9001` |
| PostgreSQL | `localhost:5432` from host, `postgres:5432` from containers |

## 6. Tools Used

| Tool | Purpose |
|---|---|
| ESP32 serial monitor | Firmware boot, sensor values, actuator state, command reception |
| MQTT Explorer or `mosquitto_sub` | Topic, payload, reconnect, and event evidence |
| Docker logs | Mosquitto, bridge, simulator, n8n, and database operational logs |
| Eclipse Ditto REST API | Thing provisioning, feature updates, command intent, risk score |
| n8n execution UI | Agent execution traces and workflow failures |
| PostgreSQL `psql` | Historical table and query evidence |
| Next.js dashboard | SCADA visualization evidence |
| Browser screenshots | Dashboard, n8n, Ditto, MQTT Explorer evidence |
| `scripts/validation/check-system-health.js` | Pre-test local health check |
| `scripts/validation/export-validation-data.sql` | Repeatable database evidence queries |

## 7. Validation Levels

| Level | Description | Example tests |
|---|---|---|
| Unit-level validation | Isolated software behavior without full stack | Simulator physics tests, MQTT topic validation script |
| Hardware bench validation | Physical sensor and actuator behavior independent of cloud services | Hall sensors, HX711, RFID, door, emergency stop, LCD |
| Integration validation | Interfaces between layers | ESP32 to MQTT, bridge to Ditto, n8n to database |
| System validation | Full platform behavior under normal operation | Telemetry visible in Ditto, dashboard, database, and agents |
| Scenario validation | End-to-end operational cases | Move floor 0 to 3, unauthorized RFID, overload, emergency stop, forced door |
| Performance and latency validation | Timing and data-loss measurements | MQTT latency, Ditto sync latency, dashboard update latency |
| Safety validation | Unsafe command rejection and local interlocks | Emergency stop blocks movement, overload blocks dispatch |
| Security validation | Access control and deployment hardening | Unauthorized RFID, default credentials, public internet warnings |

## 8. Evidence Collection Method

Every test run must produce a dated evidence folder:

```text
docs/validation/evidence/YYYY-MM-DD_test-run-XX/
```

Recommended evidence naming:

```text
HW-01_hall-floor-0_photo.jpg
EMB-05_emergency-stop_serial.log
MQTT-01_telemetry_mosquitto-sub.log
DT-02_cabin-feature_before.json
DT-02_cabin-feature_after.json
N8N-04_control-rejection_execution.png
DB-04_control-command-log.csv
DASH-03_floor-change_dashboard.png
E2E-02_unauthorized-rfid_report.md
```

Each test record must include:

- Test ID.
- Date and time.
- Operator.
- Hardware setup and software versions.
- Input or trigger.
- Expected result.
- Observed result.
- Evidence path.
- Pass, fail, blocked, or pending status.
- Comment or deviation.

## 9. Test Assumptions

- The ESP32 is the canonical real data source during final validation.
- MQTT transports JSON messages and is not treated as the UI source of truth.
- Eclipse Ditto is the single source of truth for the current operational state.
- n8n agents use deterministic rules for safety and control decisions.
- Any optional LLM is explanatory only and has no command authority.
- Simulator results are valid for software regression and fault-injection validation, not for replacing physical hardware evidence.
- Database evidence is valid only when tied to the same correlation ID, timestamp window, or test run identifier as the triggering scenario.

## 10. Test Limitations and Academic Boundary

This project is an academic research prototype on a reduced-scale elevator model. It is not an industrially certified elevator safety controller. The deterministic rules and embedded interlocks are responsible for safety decisions. The optional local LLM is used only to produce explanatory context and must not authorize commands, modify safety thresholds, or bypass deterministic rejection logic.

Real building deployment would require certified safety hardware, industrial standards compliance, formal hazard analysis, independent verification and validation, secure commissioning, fail-safe electrical design, secure credential management, network segmentation, and formal risk assessment. No production certification is claimed by this validation campaign.

## 11. Required KPIs

All KPI values are placeholders until measured during controlled validation.

| KPI | Measurement method | Target or acceptance rule | Observed value | Status |
|---|---|---|---|---|
| MQTT telemetry latency | ESP32 timestamp to broker receive timestamp | TBD by experiment | Pending measurement | Pending |
| Ditto synchronization latency | MQTT receive timestamp to Ditto feature update timestamp | TBD by experiment | Pending measurement | Pending |
| Dashboard update latency | Ditto update timestamp to visible UI update | TBD by experiment | Pending measurement | Pending |
| n8n workflow execution time | n8n execution duration for workflows 01 to 06 | TBD by experiment | Pending measurement | Pending |
| Database insertion success rate | Inserted rows divided by expected telemetry events | TBD by experiment | Pending measurement | Pending |
| Command rejection accuracy | Unsafe commands rejected divided by unsafe commands sent | 100 percent for defined unsafe commands | Pending measurement | Pending |
| Alert generation time | Trigger timestamp to notification outbox row timestamp | TBD by experiment | Pending measurement | Pending |
| Telemetry loss during broker restart | Missing sequence count before and after restart | TBD by experiment | Pending measurement | Pending |
| Recovery time after reconnect | Broker restart to first valid post-restart telemetry | TBD by experiment | Pending measurement | Pending |
| Successful scenario count | Passed E2E scenarios divided by attempted E2E scenarios | TBD by defense plan | Pending measurement | Pending |
| Failed or pending scenario count | Failed plus pending tests after final run | Must be explicitly reported | Pending measurement | Pending |

## 12. Test Categories

The complete test matrix is maintained in `docs/validation/test-matrix.md`. It includes:

- Hardware bench validation.
- ESP32 sensor and actuator validation.
- ESP32-to-MQTT communication validation.
- MQTT broker and topic validation.
- MQTT-to-Ditto bridge validation.
- Eclipse Ditto synchronization validation.
- n8n agentic workflow validation.
- Command safety gate validation.
- Dashboard real-time visualization validation.
- PostgreSQL/TimescaleDB historical storage validation.
- Security and access-control validation.
- Fault-injection and abnormal scenario validation.
- End-to-end system validation.
- Thesis demonstration validation.

## 13. Pass/Fail Criteria

A test may be marked `PASS` only when all required evidence is available and the observed result matches the expected result. A test must remain `Pending physical validation`, `To be filled after experiment`, or `Requires screenshot/log evidence` when evidence is not yet captured.

| Status | Meaning |
|---|---|
| PASS | Procedure executed, evidence collected, observed result matches expected result |
| FAIL | Procedure executed, evidence collected, observed result contradicts expected result |
| BLOCKED | Procedure could not be executed due to missing hardware, service, credential, or setup |
| PENDING | Test is defined but not yet executed with required evidence |
| N/A | Test does not apply to the specific run and the reason is documented |

## 14. Expected Evidence by Layer

| Layer | Minimum evidence |
|---|---|
| Hardware | Prototype photos, wiring photo, serial logs, movement video, load calibration sheet |
| ESP32 | Serial monitor logs for boot, Wi-Fi, MQTT, sensor values, command reception |
| MQTT | Topic screenshots, `mosquitto_sub` logs, broker restart logs, invalid JSON rejection logs |
| Bridge | Bridge logs for subscribe, write, duplicate skip, retry, and error cases |
| Ditto | Thing JSON snapshots before and after selected events |
| n8n | Execution screenshots and exported execution details for key workflows |
| Database | Query outputs or CSV exports for all validation tables |
| Dashboard | Screenshots for all major pages and degraded-state behavior |
| Security | Unauthorized RFID, forced door, command rejection, credential warning evidence |
| End-to-end | Correlated evidence bundle across serial, MQTT, Ditto, n8n, DB, and dashboard |

## 15. Results Summary Template

Use the template in `docs/validation/results-template.md` for final results. A summary table should be included in the thesis:

| Category | Tests planned | Passed | Failed | Blocked | Pending | Comment |
|---|---:|---:|---:|---:|---:|---|
| Hardware | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| Embedded | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| MQTT/Bridge/Ditto | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| n8n Agents | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| Dashboard | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| Database | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| Safety/Security | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |
| End-to-end | TBD | TBD | TBD | TBD | TBD | To be filled after experiment |

## 16. Discussion Template

After the final campaign, discuss:

- Whether the architecture separation was respected in every scenario.
- Whether Ditto remained the current-state authority.
- Whether all safety-critical actions were deterministic and auditable.
- Whether any dashboard or agent behavior contradicted physical state.
- Whether failure modes were graceful or caused crashes, stale state, or missing audit records.
- Whether latency and recovery KPIs are acceptable for a reduced-scale research prototype.
- Which limitations remain before any industrial adaptation.

## 17. Conclusion Template

The conclusion must state:

- Which validation categories were completed.
- Which scenarios passed, failed, or remained pending.
- Which evidence artifacts support the results.
- Which limitations prevent claims of industrial certification.
- Which engineering actions are required before thesis defense or future work.
