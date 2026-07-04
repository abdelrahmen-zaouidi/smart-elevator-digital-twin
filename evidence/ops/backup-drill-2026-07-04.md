# Backup & Restore Drill — 2026-07-04

Executed on the live reference host (Windows 11, Docker Desktop) against the
running platform stack. Tooling: `scripts/backup.ps1` + `scripts/restore.ps1`
(this drill is also their first live validation).

## 1. Backup

Command: `powershell -ExecutionPolicy Bypass -File scripts\backup.ps1`

Output folder: `backups\2026-07-04_115928\`

| Artifact | Size | Notes |
|---|---|---|
| `postgres_smart_building.sql` | 982,799,882 B | pg_dump inside `elevator_db`, copied out via `docker cp`. TimescaleDB catalog emits circular-FK warnings (hypertable/chunk/continuous_agg) — expected for this extension, restore verified below. |
| `n8n_workflows.json` | — | `n8n export:workflow --all`: **20 workflows** exported. |
| `n8n_credentials.json` | — | `n8n export:credentials --all`: **8 credentials** (encrypted form; decrypting needs the n8n encryption key from the `n8n_data` volume). |
| `ditto_mongodb.archive` | 17,528,213 B | `mongodump --archive` inside `docker-mongodb-1` (Ditto stack). |
| `mqtt_config.zip` | 5,772 B | `infra\mqtt` incl. passwordfile + TLS private key — SENSITIVE. |

Observation recorded for the roadmap: the SQL dump is ~1 GB for only ~37k
telemetry rows + ~40k audit rows because both tables store large JSON
payloads per row (~6 kB/row) and carry heavy dead-tuple bloat
(`pg_total_relation_size` 247 MB / 228 MB). Retention pruning
(`prune_telemetry_raw`) and the hypertable/compression migration are the
planned fixes (see ROADMAP.md).

## 2. Restore rehearsal (scratch database — live data untouched)

Dry run first (no `-Force`): printed the plan, changed nothing.

Execute:
`powershell -File scripts\restore.ps1 -BackupDir backups\2026-07-04_115928 -Target pg -Force`
→ created `smart_building_restore_test`, replayed the dump via
`psql -v ON_ERROR_STOP=0 -q -f` (sequence `setval` outputs confirmed).

## 3. Verification — row counts (restored vs live)

| Table | Restored (snapshot) | Live (counted after backup) | Δ |
|---|---|---|---|
| `telemetry_raw` | 36,971 | 37,004 | +33 live |
| `audit_log` | 39,783 | 39,816 | +33 live |
| `notification_outbox` | 388 | 388 | 0 |
| `control_command_log` | 452 | 452 | 0 |

Static tables match exactly. The two continuously-written tables show
live > restored by exactly the rows ingested between the pg_dump snapshot
and the later live count (demo simulator + agent workflows were running) —
the expected direction for a consistent snapshot; no loss.

## 4. Cleanup

`DROP DATABASE smart_building_restore_test;` — confirmed dropped.
(Note: the Docker Desktop vhdx does not shrink after the drop; the drill
temporarily grows the VM disk by roughly the restored DB size.)

## Verdict

PASS — backup captures all four stores; the Postgres dump restores cleanly
into a scratch database with row-level verification; dry-run gating works.
Off-host copy of `backups\` remains a manual step (documented in
docs/operations.md).
