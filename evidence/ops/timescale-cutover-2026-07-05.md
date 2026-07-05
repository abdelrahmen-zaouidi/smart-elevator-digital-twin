# TimescaleDB Hypertable Cutover — LIVE (2026-07-05)

Migration `009_hypertable_conversion.sql` applied to the **live**
`smart_building` database as a coordinated zero-gap cutover (the rehearsal
evidence is `timescale-migration-2026-07-05.md`).

## Sequence executed

1. **Backup**: `scripts/backup.ps1 -SkipMongo` → `backups/2026-07-05_232113`
   (pre-cutover safety net).
2. **Export + patch** the live ingestion workflow (`01_ingestion_surveillance_agent`,
   id `TZGSTLLctLRe52k5`): `ON CONFLICT (event_id)` → `ON CONFLICT (event_id, time)`.
3. **Deactivate** the workflow + restart n8n → polling stopped (row count
   stable at 39,851, confirmed over 12 s).
4. **Apply migration 009** to live (`ON_ERROR_STOP=1`) → completed with only the
   benign `column "event_id" should be used for segmenting or ordering`
   compression-hint warning.
5. **Re-import** the patched workflow in place (same id → credentials preserved),
   **reactivate**, restart n8n.
6. **Verify** ingestion resumed.

## Verification (live)

```
timescaledb_information.hypertables            -> telemetry_raw
timescaledb_information.continuous_aggregates  -> hourly_energy, hourly_risk
hourly_risk (route contract) -> 2026-07-05 22:00  avg 77.7 / max 100   (returns rows)
ingestion resumed            -> 39,853 -> 39,858 rows in 25 s, latest 22:29:25 (current)
```

- `telemetry_raw` is now a **hypertable**; `hourly_risk` / `hourly_energy` are
  **continuous aggregates** with unchanged output columns (so `/api/history/risk`
  and `/api/history/energy` are unaffected).
- The corrected `ON CONFLICT (event_id, time)` upsert works against the
  hypertable — ingestion is inserting new rows with current timestamps and no
  conflict errors.
- Telemetry gap during the cutover ≈ the deactivation window (~1 min); the twin
  itself (Ditto/bridge) was never interrupted.

Compression (7-day) + retention (90-day) policies are installed and run
automatically as chunks age.

## Verdict

PASS (live). The platform's "TimescaleDB analytics" claim is now literally true
in the running deployment: hypertable-backed telemetry with continuous
aggregates, compression, and retention.
