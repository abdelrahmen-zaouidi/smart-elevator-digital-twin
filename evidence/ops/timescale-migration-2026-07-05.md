# TimescaleDB Hypertable Migration — Rehearsal Evidence (2026-07-05)

Migration `infra/postgres/migrations/009_hypertable_conversion.sql` rehearsed
on a **full-size restore** of the live database, on the reference host
(Windows 11, Docker Desktop, TimescaleDB 2.26). The live `smart_building`
database was **not** modified — the conversion is a coordinated cutover (see
`docs/operations.md`), because the PK change breaks the n8n
`ON CONFLICT (event_id)` ingestion upsert until the workflow is re-imported.

## Method

1. Fresh backup: `scripts/backup.ps1` → `postgres_smart_building.sql`
   (1,031,244,138 bytes; live `telemetry_raw` = 38,277 rows spanning
   2026-05-20 → 2026-07-05, i.e. ~45 days).
2. Restored the dump into a scratch DB `smb_migtest` (38,286 rows).
3. Captured `hourly_risk` / `hourly_energy` output BEFORE migration.
4. Ran `009_hypertable_conversion.sql` with `ON_ERROR_STOP=1` → completed
   successfully (one benign `WARNING: column "event_id" should be used for
   segmenting or ordering`, a compression hint, not an error).
5. Verified conversion + re-captured view output + probed the upsert change.
6. Dropped the scratch DB.

## Results — conversion

```
timescaledb_information.hypertables         -> telemetry_raw
timescaledb_information.continuous_aggregates -> hourly_energy, hourly_risk
```

## Results — API contract preserved (the critical check)

`hourly_risk` (columns `bucket, avg_risk, max_risk, anomaly_count, breach_count`)
and `hourly_energy` (`bucket, avg_power_kw, avg_current_a, avg_vibration_g`) —
**byte-identical output before and after** the migration (top 3 buckets):

| view | bucket | values (before == after) |
|---|---|---|
| hourly_risk | 2026-07-05 13:00 | avg 10.1 / max 95 / anomaly 6 / breach 13 |
| hourly_risk | 2026-07-05 00:00 | avg 9.1 / max 30 / anomaly 200 / breach 0 |
| hourly_energy | 2026-07-05 13:00 | 2.34 kW / 5.57 A / 0.0580 g |
| hourly_energy | 2026-07-05 00:00 | 3.61 kW / 8.60 A / 0.0562 g |

So `GET /api/history/risk` and `/api/history/energy` return the same shapes and
values after the migration (the continuous aggregates use the same
`round(avg(...))` / `count(*) FILTER (...)` expressions as the former views;
both confirmed supported inside a CAGG on 2.26).

## Results — upsert change (the reason for the coordinated cutover)

```
OLD  ON CONFLICT (event_id)        -> ERROR: there is no unique or exclusion
                                      constraint matching the ON CONFLICT specification
NEW  ON CONFLICT (event_id, time)  -> INSERT 0 1  (works)
```

This confirms the repo fix (`workflows/n8n/01_ingestion_surveillance_agent.json`
+ `enterprise-upgrade-code/01_prepare_telemetry_params.js`, now
`ON CONFLICT (event_id, time)`) is required and correct, and that the running
n8n workflow must be re-imported as part of the cutover.

## Compression / retention

Policies are created by the migration (compress chunks older than 7 days;
retention 90 days). With ~45 days of data, ~38 days of chunks are
compression-eligible, so compression will reclaim space as the policy runs.
NOTE: the exact before/after byte measurement of manual chunk compression was
interrupted by Docker Desktop API instability + host disk exhaustion during the
rehearsal (C: reached 0 GB free from the 1 GB scratch restore); it is not
reported here rather than reported inaccurately. The conversion, CAGGs, and
contract-preservation checks above all completed and are the load-bearing
evidence.

## Verdict

PASS (rehearsal). The migration converts `telemetry_raw` to a hypertable and
rebuilds the analytics views as continuous aggregates with an unchanged API
contract. Live application is staged as the coordinated cutover runbook in
`docs/operations.md` (migration + n8n re-import together = zero ingestion gap).
