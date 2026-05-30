# Validation Results Template

Use this file to record real observed results after each controlled validation run. Do not replace pending placeholders with `PASS` unless the evidence path contains the required logs, screenshots, photos, or query outputs.

## 1. Test Run Metadata

| Field | Value |
|---|---|
| Test run ID | To be filled after experiment |
| Date | To be filled after experiment |
| Operator | To be filled after experiment |
| Location | To be filled after experiment |
| Prototype configuration | To be filled after experiment |
| ESP32 firmware version/date | To be filled after experiment |
| Repository archive/revision | To be filled after experiment |
| Docker Compose stack version | To be filled after experiment |
| Ditto version/configuration | To be filled after experiment |
| n8n workflow set | To be filled after experiment |
| Dashboard environment | To be filled after experiment |
| Evidence folder | `docs/validation/evidence/YYYY-MM-DD_test-run-XX/` |

## 2. Individual Test Record

Copy this block once per test.

### Test ID: TBD

| Field | Value |
|---|---|
| Date | To be filled after experiment |
| Operator | To be filled after experiment |
| Environment | To be filled after experiment |
| Layer | To be filled after experiment |
| Scenario | To be filled after experiment |
| Preconditions | To be filled after experiment |
| Input / trigger | To be filled after experiment |
| Expected result | To be filled from `test-matrix.md` |
| Observed result | To be filled after experiment |
| MQTT evidence path | Requires screenshot/log evidence |
| Ditto evidence path | Requires screenshot/log evidence |
| n8n evidence path | Requires screenshot/log evidence |
| Database evidence path | Requires screenshot/log evidence |
| Dashboard evidence path | Requires screenshot/log evidence |
| Physical evidence path | Pending physical validation |
| Status | PENDING |
| Comment | To be filled after experiment |

## 3. Summary Table

| Test ID | Layer | Scenario | Expected result | Observed result | Evidence path | Status | Comment |
|---|---|---|---|---|---|---|---|
| HW-01 | Hardware bench | Hall sensor floor 0 detection | ESP32 reports floor 0 | Pending physical validation | Requires photo/serial/MQTT evidence | PENDING | To be filled after experiment |
| EMB-05 | ESP32 safety | Emergency stop button | Motion stops and emergency latches | Pending physical validation | Requires serial/MQTT/video evidence | PENDING | To be filled after experiment |
| MQTT-01 | MQTT | ESP32 publishes telemetry | Valid JSON on canonical topic | Requires log evidence | Requires MQTT capture | PENDING | To be filled after experiment |
| DT-02 | Eclipse Ditto | Cabin feature updates | Cabin feature reflects telemetry | Requires screenshot/log evidence | Requires Ditto JSON | PENDING | To be filled after experiment |
| N8N-04 | n8n control | Unsafe command rejection | Command rejected with reason | Requires screenshot/log evidence | Requires n8n and DB evidence | PENDING | To be filled after experiment |
| DASH-03 | Dashboard | Live floor changes | Dashboard reflects Ditto state | Requires screenshot/log evidence | Requires screenshot and Ditto JSON | PENDING | To be filled after experiment |
| DB-01 | Database | Telemetry records | `telemetry_raw` receives rows | Requires query evidence | Requires SQL output | PENDING | To be filled after experiment |
| E2E-01 | End-to-end | Move floor 0 to 3 | Evidence chain complete | Pending physical validation | Requires complete bundle | PENDING | To be filled after experiment |

## 4. KPI Results

| KPI | Method | Expected / target | Observed | Evidence path | Status |
|---|---|---|---|---|---|
| MQTT telemetry latency | ESP32 timestamp to broker receive timestamp | TBD | Pending measurement | Requires serial and MQTT logs | PENDING |
| Ditto synchronization latency | MQTT receive to Ditto feature update | TBD | Pending measurement | Requires MQTT, bridge, Ditto logs | PENDING |
| Dashboard update latency | Ditto update to visible UI update | TBD | Pending measurement | Requires screen recording/timestamps | PENDING |
| n8n workflow execution time | n8n execution duration | TBD | Pending measurement | Requires execution export | PENDING |
| Database insertion success rate | Inserted rows / expected events | TBD | Pending measurement | Requires DB query and telemetry count | PENDING |
| Command rejection accuracy | Rejected unsafe commands / unsafe commands sent | 100 percent for defined unsafe cases | Pending measurement | Requires command log | PENDING |
| Alert generation time | Trigger to notification outbox row | TBD | Pending measurement | Requires trigger and DB timestamps | PENDING |
| Telemetry loss during broker restart | Missing sequence or time gap count | TBD | Pending measurement | Requires broker restart logs | PENDING |
| Recovery time after reconnect | Broker restart to first valid telemetry | TBD | Pending measurement | Requires serial/MQTT logs | PENDING |

## 5. Scenario Result Template

### Scenario ID: E2E-XX

| Field | Value |
|---|---|
| Scenario name | To be filled after experiment |
| Date/time | To be filled after experiment |
| Operator | To be filled after experiment |
| Physical trigger | To be filled after experiment |
| ESP32 observed output | To be filled after experiment |
| MQTT observed output | To be filled after experiment |
| Bridge observed output | To be filled after experiment |
| Ditto observed state | To be filled after experiment |
| n8n observed execution | To be filled after experiment |
| Database observed rows | To be filled after experiment |
| Dashboard observed state | To be filled after experiment |
| Expected result | To be filled from matrix |
| Deviation | None / describe |
| Status | PENDING |
| Evidence bundle path | Requires screenshot/log evidence |

## 6. Incident and Fault Record

| Field | Value |
|---|---|
| Incident/fault ID | To be filled after experiment |
| Trigger | To be filled after experiment |
| Start time | To be filled after experiment |
| End time | To be filled after experiment |
| Affected layer | To be filled after experiment |
| Expected degraded behavior | To be filled from procedure |
| Observed degraded behavior | To be filled after experiment |
| Recovery action | To be filled after experiment |
| Recovery time | Pending measurement |
| Data loss | Pending measurement |
| Evidence path | Requires screenshot/log evidence |
| Status | PENDING |

## 7. Evidence Manifest

| Evidence file | Related test ID | Description | Captured by | Timestamp | Notes |
|---|---|---|---|---|---|
| To be filled after experiment | TBD | To be filled after experiment | To be filled after experiment | To be filled after experiment | To be filled after experiment |

## 8. Final Discussion Notes

Use this section after the campaign:

- Tests completed:
- Tests passed:
- Tests failed:
- Tests blocked:
- Tests still pending:
- Main technical risks discovered:
- Deviations from expected architecture:
- Safety behavior observations:
- Security hardening gaps:
- Limitations before industrial deployment:
- Recommended future work:

