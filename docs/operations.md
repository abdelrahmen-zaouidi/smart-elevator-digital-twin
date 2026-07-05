# Operations — Backup, Restore & Disaster Recovery

Operational procedures for the platform's stateful stores. Everything here
was rehearsed on the reference host — see
[`evidence/ops/backup-drill-2026-07-04.md`](../evidence/ops/backup-drill-2026-07-04.md).

## What is stateful (and where it lives)

| Store | Location | Contains |
|---|---|---|
| PostgreSQL/TimescaleDB | Docker volume `pg_data` (container `elevator_db`) | telemetry history, audit log, command log, notification outbox, work orders |
| n8n | Docker volume `n8n_data` (container `elevator_agents`) | workflows, **encrypted credentials + the encryption key**, executions |
| Eclipse Ditto | MongoDB volume in the separate Ditto compose stack | the digital-twin state itself |
| MQTT broker | `infra/mqtt/` on the host (gitignored) | passwordfile, TLS CA/server key material, broker conf, ACLs |
| Dashboard/env config | `.env`, `apps/dashboard/.env.local`, `firmware/.../secrets.h` (all gitignored) | credentials, endpoints |

## Backup

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1        # full
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 -SkipMongo   # Ditto stack down
```

Produces `backups\<timestamp>\` with the Postgres dump, n8n workflow +
credential exports (volume-tar fallback if the CLI export fails), the Ditto
MongoDB archive, `mqtt_config.zip`, and a `manifest.txt`. Dumps run inside
the containers and are copied out with `docker cp` — no client tools needed
on the host.

**Rules:**

- `backups/` is **gitignored and sensitive** (DB contents, broker passwords,
  TLS private key). Treat each backup like a credential file.
- **Copy every backup off-host.** A backup on the same disk protects against
  mistakes, not disk failure. External drive or another machine on the lab
  LAN both qualify; this step is deliberately manual.
- `.env` files and `secrets.h` are NOT captured (they live outside Docker) —
  keep your own secure copy; `mqtt_config.zip` covers the broker side.
- Suggested cadence for the thesis rig: before every firmware flash, schema
  migration, or demo day.

## Restore

`scripts\restore.ps1` restores **one store at a time** and is **dry-run by
default** — without `-Force` it only prints the plan:

```powershell
# Rehearse into a scratch DB (never touches live data):
powershell -File scripts\restore.ps1 -BackupDir backups\<stamp> -Target pg -Force

# Real recovery over the live database (deliberate, explicit):
powershell -File scripts\restore.ps1 -BackupDir backups\<stamp> -Target pg -Database smart_building -Force

powershell -File scripts\restore.ps1 -BackupDir backups\<stamp> -Target n8n   -Force
powershell -File scripts\restore.ps1 -BackupDir backups\<stamp> -Target mongo -Force   # replaces Ditto state (--drop)
powershell -File scripts\restore.ps1 -BackupDir backups\<stamp> -Target mqtt  -Force   # then: docker compose restart mosquitto
```

Notes:

- **pg**: default target is the scratch DB `smart_building_restore_test`, so
  a drill can never damage live data. TimescaleDB catalog warnings during
  dump/restore are expected; verification is by row counts (see the drill).
- **n8n**: credentials import only decrypts with the original n8n encryption
  key, which lives inside the `n8n_data` volume (or `N8N_ENCRYPTION_KEY`).
  Losing that key makes credential backups unreadable — the volume-tar
  fallback preserves it.
- **mongo**: `mongorestore --drop` replaces current twin state; restart the
  Ditto stack afterwards.
- After an `mqtt` restore, clients must still hold matching passwords
  (`.env` + firmware `secrets.h`).

## Disaster-recovery order (cold host)

1. Start Docker Desktop; start the Ditto stack, then this repo's stack
   (`docker compose up -d`).
2. Restore in order: `mongo` (twin) → `pg` (history) → `n8n` (agents) →
   `mqtt` (only if `infra/mqtt` was lost).
3. Re-run the drill verification queries (row counts) before trusting the rig.
4. Restart everything: Ditto stack, then `docker compose restart`.

## Migration 009 — hypertable cutover (zero-gap runbook)

Migration `009_hypertable_conversion.sql` converts `telemetry_raw` into a
TimescaleDB hypertable and rebuilds `hourly_risk` / `hourly_energy` as
continuous aggregates. It is **fully rehearsed** on a full-size restore
(see `evidence/ops/timescale-migration-2026-07-05.md`) but is a
**coordinated cutover** because it changes the primary key from `event_id`
to `(event_id, time)`, which breaks the n8n ingestion upsert
`ON CONFLICT (event_id)` until the workflow is re-imported.

Run these steps together so telemetry ingestion never errors (zero gap):

1. **Pause ingestion** — in the n8n UI, deactivate
   `01_ingestion_surveillance_agent` (or `docker exec elevator_agents n8n
   update:workflow --id=<id> --active=false`).
2. **Back up** — `powershell -File scripts\backup.ps1`.
3. **Apply the migration** (not in a txn block — `create_hypertable` forbids it):
   ```bash
   docker cp infra/postgres/migrations/009_hypertable_conversion.sql elevator_db:/tmp/009.sql
   MSYS_NO_PATHCONV=1 docker exec elevator_db psql -U admin -d smart_building -v ON_ERROR_STOP=1 -f /tmp/009.sql
   ```
4. **Re-import the corrected ingestion workflow** so the running n8n uses
   `ON CONFLICT (event_id, time)`. The in-repo JSON
   (`workflows/n8n/01_ingestion_surveillance_agent.json`) is already fixed;
   import it via the n8n UI (Workflows → Import from File), or patch-and-import
   the live export in place:
   ```bash
   docker exec elevator_agents n8n export:workflow --id=<id> --output=/tmp/wf.json
   # replace ON CONFLICT (event_id) -> ON CONFLICT (event_id, time) in /tmp/wf.json
   docker exec elevator_agents n8n import:workflow --input=/tmp/wf.json
   ```
5. **Reactivate** the workflow and `docker compose restart n8n`.
6. **Verify** ingestion resumed and is deduping correctly:
   ```bash
   docker exec elevator_db psql -U admin -d smart_building -c \
     "SELECT count(*), max(time) FROM telemetry_raw;"   # count should grow
   docker exec elevator_db psql -U admin -d smart_building -c \
     "SELECT hypertable_name FROM timescaledb_information.hypertables;"
   ```

Rollback: restore the pre-migration `postgres_smart_building.sql` from the
step-2 backup (`scripts\restore.ps1 ... -Target pg -Database smart_building`).

Dedup note: the new conflict target `(event_id, time)` preserves dedup because
`event.timestamp` is deterministic per event. The only divergence is if an
event is ever ingested WITHOUT a timestamp (the code falls back to
`new Date()`), in which case a re-ingest could insert a duplicate — telemetry
always carries a timestamp, so the window is effectively nil.

## Structured logs (command correlation)

The bridge (`services/ditto-bridge/logger.js`) and the dashboard API routes
(`apps/dashboard/src/server/log.js`) emit **JSON lines** (pino) with a shared
field convention:

```
{ ts, level, svc, event?, thing_id?, command_id?, correlation_id?, msg, ... }
```

Every command-lifecycle line carries the same `command_id`, so one query
reconstructs a command end to end across both services:

```bash
# dashboard dev server stdout + bridge container:
grep '"command_id":"CMD-..."' <dashboard-log>
docker logs elevator_bridge | grep '"command_id":"CMD-..."'
```

Lifecycle `event` values: `command_accepted` / `command_rejected` (dashboard
gate) → `command_intent_forwarded` → `command_mqtt_published` →
`command_ack_received` (or `command_ack_timeout` / `command_dropped`) on the
bridge. `LOG_LEVEL` (default `info`) tunes verbosity. Example trace:
`evidence/ops/command-log-correlation-2026-07-05.md`.

## Observability (Prometheus + Grafana)

`docker compose --profile observability up -d` starts Prometheus (7-day
retention, ≤300 MB) and a provisioned Grafana. OFF by default; total
footprint ≈ 104 MiB (see `evidence/ops/observability-2026-07-05.md`).

- **Bridge** exposes `/metrics` (+ `/health`) on port 9464 (in-network only):
  `bridge_ingest_messages_total{type}`, `bridge_ditto_merge_duration_seconds`
  (the single-thing write bottleneck), `bridge_ditto_merge_total{result}`,
  `bridge_command_lifecycle_total{event}`, `bridge_mqtt_reconnects_total`.
- **Dashboard** exposes `/api/system/metrics` (exempt from the demo Basic-Auth
  gate — read-only): `dashboard_gate_decisions_total{verdict,command}`,
  `dashboard_gate_admission_seconds`, `dashboard_health_probe_status{dependency}`.
- **Grafana** (`http://localhost:3001`, admin password from
  `GRAFANA_ADMIN_PASSWORD`) auto-provisions the Prometheus datasource and the
  **ElevatorOS — Platform Overview** dashboard.

The dashboard runs on the host, so Prometheus scrapes it via
`host.docker.internal:3000`; the bridge is scraped in-network at `bridge:9464`.
Tear down with `docker compose --profile observability down`.

## Known limitations / roadmap ties

- The ~1 GB SQL dump is dominated by per-row JSON payloads + bloat in
  `telemetry_raw`/`audit_log`; retention (`prune_telemetry_raw`) and the
  hypertable/compression migration on the [roadmap](../ROADMAP.md) will
  shrink it substantially.
- No automated schedule yet — candidate for an n8n schedule trigger or
  Windows Task Scheduler entry once an off-host target exists.
- Docker Desktop's vhdx grows during a restore drill and does not shrink
  after `DROP DATABASE`.
