# Database Analytics — Phase 4 Guide

Historical intelligence layer for the Smart Elevator Digital Twin.

---

## Architecture

```
telemetry_raw (PostgreSQL/TimescaleDB)
        │
        ├─ hourly_risk VIEW  ──▶  /api/history/risk
        └─ hourly_energy VIEW ──▶  /api/history/energy
                                         │
audit_log ──────────────────────────▶  /api/history/audit
notification_outbox ────────────────▶  /api/history/notifications
control_command_log ────────────────▶  /api/history/commands
maintenance_work_orders ────────────▶  /api/history/maintenance
system_health_history ──────────────▶  /api/history/system-health
                (all above) ─────────▶  /api/history/summary
                                         │
                              dashboard pages (server-side, no DB creds in browser)
```

---

## Database Schema Overview

### `telemetry_raw`
Primary telemetry store. One row per ingestion event from n8n workflow 01.

Key columns: `time`, `thing_id`, `event_id` (PK), `event_type`, `risk_score`,
`motor_temp_c`, `vibration_g`, `power_kw`, `door_state`, `forced_entry`,
`severity`, `correlation_id`, `duplicate_hash`, `processing_status`

**Note:** `telemetry_raw` is a regular PostgreSQL table (not a TimescaleDB hypertable).
The `event_id` primary key predates Phase 4. Converting to a hypertable would require
changing the primary key to include `time`, which would break the n8n `ON CONFLICT (event_id)`
upsert. The Phase 4 analytics views use `time_bucket()` directly on the plain table.

### `hourly_risk` (view, created by migration 003)
Hourly aggregation of risk scores. Columns: `bucket`, `thing_id`, `avg_risk`,
`max_risk`, `anomaly_count`, `breach_count`

### `hourly_energy` (view, created by migration 003)
Hourly aggregation of power and vibration. Columns: `bucket`, `thing_id`,
`avg_power_kw`, `avg_current_a`, `avg_vibration_g`

### `audit_log`
One row per n8n workflow execution event. Key columns: `agent_name`,
`event_type`, `action`, `workflow_name`, `node_name`, `status`, `severity`

### `notification_outbox`
Queued and sent notifications. Key columns: `severity`, `channel`, `status`,
`attempts`, `priority`, `sent_at`, `locked_at`, `last_error`, `payload`

### `control_command_log`
Commands issued by n8n workflow 03. Key columns: `command`, `source_agent`,
`risk_score`, `status`, `ditto_path`

### `maintenance_work_orders`
Work orders created by n8n workflow 04. Key columns: `work_order_id`,
`issue_key`, `priority`, `wear_index`, `estimated_failure_days`, `status`

### `system_health_history`
Component health snapshots. Key columns: `component`, `status`, `latency_ms`

---

## How Telemetry Is Stored

```
n8n workflow 01
  │
  ├─ GET Thing from Eclipse Ditto (every 5s)
  ├─ Canonicalize Twin Event (normalize fields)
  ├─ Dedupe & Update Timeline (detect duplicates, compute risk seed)
  ├─ Prepare DB Row (build parameterized INSERT query)
  └─ Archive to Postgres
       INSERT INTO telemetry_raw (...) ON CONFLICT (event_id) DO UPDATE SET ...
```

Each row contains a full snapshot of all sensor values plus metadata
(`correlation_id`, `severity`, `processing_status`, `duplicate`).

---

## How n8n Writes to Each Table

| Workflow | Table | Notes |
|----------|-------|-------|
| 01 | `telemetry_raw` | Every 5s poll, deduped by `duplicate_hash` |
| 02 | `audit_log` (indirectly via webhook to 06) | risk analysis events |
| 04 | `maintenance_work_orders` | created on wear threshold breach |
| 05 | `notification_outbox` | read + status update on delivery |
| 06 | `audit_log` | weekly compliance audit entries |

---

## API Routes

All routes are server-side Next.js App Router handlers. Database credentials
are never sent to the browser.

### Common query parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `thing_id` | `building:floor1:elevator` | Filter by Ditto Thing ID |
| `limit` | varies | Max rows returned (capped per route) |
| `from` | — | ISO 8601 start timestamp |
| `to` | — | ISO 8601 end timestamp |

### Response shape

```json
{ "data": [...], "total": 42, "error": null }
```

On error: `{ "data": [], "total": 0, "error": "message" }` with HTTP 500.

### Route reference

| Route | DB source | Default limit | Max limit |
|-------|-----------|---------------|-----------|
| `GET /api/history/telemetry` | `telemetry_raw` | 200 | 500 |
| `GET /api/history/risk` | `hourly_risk` | 48 | 720 |
| `GET /api/history/energy` | `hourly_energy` | 48 | 720 |
| `GET /api/history/audit` | `audit_log` | 50 | 200 |
| `GET /api/history/notifications` | `notification_outbox` | 30 | 100 |
| `GET /api/history/commands` | `control_command_log` | 50 | 200 |
| `GET /api/history/maintenance` | `maintenance_work_orders` | 50 | 200 |
| `GET /api/history/system-health` | `system_health_history` | 50 | 200 |
| `GET /api/history/summary` | all tables (aggregated) | — | — |

The `/api/history/summary` route also returns `db.connected` and `db.latency_ms`.

---

## Example API Calls

```bash
# Summary (all tables)
curl http://localhost:3000/api/history/summary?thing_id=building:floor1:elevator

# Last 48 hours of hourly risk
curl "http://localhost:3000/api/history/risk?limit=48"

# Last 200 raw telemetry rows
curl "http://localhost:3000/api/history/telemetry?limit=200"

# Date-range filtered audit log
curl "http://localhost:3000/api/history/audit?from=2026-05-04T00:00:00Z&to=2026-05-05T23:59:59Z"

# Open work orders only
curl "http://localhost:3000/api/history/maintenance?status=OPEN"
```

PowerShell equivalents:

```powershell
Invoke-RestMethod http://localhost:3000/api/history/summary | ConvertTo-Json -Depth 5

Invoke-RestMethod "http://localhost:3000/api/history/risk?limit=24" | Select-Object -ExpandProperty data
```

---

## Dashboard Pages Using Historical Data

| Page | Historical data | Empty state |
|------|----------------|-------------|
| Monitoring | `hourly_risk` + `hourly_energy` charts | "No historical data yet. Activate workflow 01." |
| Reports | Summary stats from all tables | "No database data yet." |
| Alerts & Logs | `audit_log` + `notification_outbox` rows | Filter buttons for "audit" and "notifications" |
| Maintenance | `maintenance_work_orders` + `system_health_history` | "No work orders in database." |
| Settings | DB connection status + row counts | Shows "Unavailable" if DB is down |

---

## Dashboard Environment Variables

Add to `dashboard/.env.local` for local development (dashboard runs on the host, not in Docker):

```env
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=smart_building
POSTGRES_USER=admin
POSTGRES_PASSWORD=change_me_local_only
```

> **Important:** Use `127.0.0.1` (host loopback), not `postgres` (the Docker service name).
> `postgres` is only reachable from other containers, not from the Next.js process on the host.

---

## Verification Commands

```bash
# Confirm telemetry_raw is growing
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT COUNT(*) FROM telemetry_raw;"

# Latest 10 telemetry rows
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT time, thing_id, event_type, risk_score FROM telemetry_raw ORDER BY time DESC LIMIT 10;"

# Hourly risk aggregation (should show data if workflow 01 has been running)
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT bucket, avg_risk, max_risk, anomaly_count FROM hourly_risk ORDER BY bucket DESC LIMIT 10;"

# Latest audit log entries
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT created_at, agent_name, event_type, action FROM audit_log ORDER BY created_at DESC LIMIT 10;"

# Latest notifications
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT created_at, sent_at, severity, channel, status FROM notification_outbox ORDER BY created_at DESC LIMIT 10;"

# Open maintenance work orders
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT work_order_id, priority, issue_key, status FROM maintenance_work_orders WHERE status IN ('OPEN','IN_PROGRESS');"
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| API returns 503 | DB not reachable from dashboard host | Check `POSTGRES_HOST=127.0.0.1` in `dashboard/.env.local`; confirm port 5432 is mapped |
| `hourly_risk` / `hourly_energy` return empty | No telemetry yet | Activate workflow 01, wait 5 minutes for data |
| `time_bucket` function not found | TimescaleDB extension not loaded | Run `CREATE EXTENSION IF NOT EXISTS timescaledb;` in the DB |
| `maintenance_work_orders` empty | Workflow 04 not active or threshold not reached | Activate workflow 04; it creates work orders when wear index exceeds threshold |
| Dashboard shows "DB unavailable" in Settings | Wrong POSTGRES_HOST or DB stopped | Run `docker compose ps postgres`; check env var |
| Build error: `pg` not found | Package not installed | Run `npm install pg` inside `dashboard/` |

---

*Phase 4 — Database and Historical Analytics. Last updated: 2026-05-05.*
