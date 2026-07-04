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

## Known limitations / roadmap ties

- The ~1 GB SQL dump is dominated by per-row JSON payloads + bloat in
  `telemetry_raw`/`audit_log`; retention (`prune_telemetry_raw`) and the
  hypertable/compression migration on the [roadmap](../ROADMAP.md) will
  shrink it substantially.
- No automated schedule yet — candidate for an n8n schedule trigger or
  Windows Task Scheduler entry once an off-host target exists.
- Docker Desktop's vhdx grows during a restore drill and does not shrink
  after `DROP DATABASE`.
