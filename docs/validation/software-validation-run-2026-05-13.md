# Software Validation Run - 2026-05-13

## Evidence Source

This file records the software-level validation output supplied by the operator from a local terminal run on 2026-05-13. The raw terminal transcript should be stored with the thesis evidence package before these checks are marked as formally passed in the main test matrix.

## Environment

| Field | Value |
|---|---|
| Repository | `C:\Users\Administrator\smart-elevator-twin` |
| Operating shell | Windows command prompt for the reported commands |
| System under test | Local Smart Elevator Digital Twin stack |
| Thing ID | `building:floor1:elevator` |
| MQTT ID | `building-floor1-elevator` |

## Executed Checks

| Check | Command | Observed Result | Status | Notes |
|---|---|---|---|---|
| System health check | `node scripts\validation\check-system-health.js` | 48 PASS, 4 WARNING, 0 FAIL | PASS | Dashboard, n8n, Ditto, MQTT, PostgreSQL, Docker services, schema tables, and canonical topic configuration were reachable/configured. Warnings were optional service inventory notes. |
| MQTT topic convention validation | `python scripts\validate_mqtt_topics.py` | Scanned 178 files; no unexpected legacy MQTT topic patterns; all reference files contain expected canonical topics | PASS | Supports MQTT topic convention validation. |
| Simulator regression tests | `python -m unittest tests.test_simulator -v` | Ran 20 tests in 0.478 s; OK | PASS | Supports simulator, anomaly, topic-builder, payload-schema, runtime-artifact, and safety-latch software validation. |
| Command safety gate unit tests | `node scripts\validation\test-command-safety-gate.mjs` | 33 tests; 33 pass; 0 fail; duration 94.1908 ms | PASS | Supports command normalization, rejection behavior, source validation, stale twin handling, cooldown handling, and no-Ditto-write invariant for rejected commands. |
| Database evidence export | `type scripts\validation\export-validation-data.sql \| docker exec -i elevator_db psql -U admin -d smart_building -q` | Corrected `cmd.exe` command executed successfully. Evidence queries returned the expected tables and recent records. | PASS | `system_health_history` existed but returned 0 rows, so DB-06 remains pending until health history records are generated. |

## Matrix Impact

These results provide software-level evidence for the validation campaign. They do not provide physical hardware evidence for ESP32 sensors, actuator movement, RFID cards, load-cell calibration, emergency-stop wiring, or final thesis demonstration scenarios.

| Area | Related Tests | Evidence Status |
|---|---|---|
| Health and readiness | DEMO-01, DB-01 to DB-06, DT-01, MQTT-01 to MQTT-03 | Software evidence available from health check; raw transcript should be archived. |
| MQTT topic convention | MQTT-02 | Software evidence available from topic validation script. |
| Simulator behavior | FAULT-01 to FAULT-05, selected EMB fallback tests | Software regression evidence available; physical validation remains pending. |
| Command safety gate | SEC-01 to SEC-06, N8N-04 to N8N-05, DASH-05 | Unit-level gate evidence available; integration evidence through UI, Ditto, MQTT command topic, and logs remains pending. |
| Database evidence export | DB-01 to DB-08 | Corrected command verified. Recent telemetry, audit, notification, command, and maintenance records were present; `system_health_history` still requires records. |

## Database Export Summary

The corrected database export command was verified after the operator transcript. The query bundle completed successfully and returned these high-level observations:

| Evidence Query | Observed Summary |
|---|---|
| Table availability | `telemetry_raw`, `audit_log`, `notification_outbox`, `control_command_log`, `maintenance_work_orders`, and `system_health_history` were available. |
| Latest telemetry | Latest exported state was for `building:floor1:elevator` at `2026-05-13 21:22:55 UTC`. |
| Row counts | `telemetry_raw`: 16270; `audit_log`: 24225; `notification_outbox`: 170; `control_command_log`: 2351; `maintenance_work_orders`: 3; `system_health_history`: 0. |
| Active incident view | The active incident view returned one row for `building:floor1:elevator`. |
| Remaining gap | No rows were present in `system_health_history`; this table requires an active health-history workflow or explicit recording step. |

## Required Follow-up

- Save the raw terminal transcript as evidence, for example under `docs/validation/evidence/software/2026-05-13-software-smoke-run.txt`.
- Rerun the database evidence export using the command that matches the active shell.
- Capture screenshots of the dashboard, Ditto Thing JSON, n8n executions, MQTT Explorer, and PostgreSQL query output.
- Keep all physical hardware tests as `Pending physical validation` until real ESP32/prototype evidence is collected.
