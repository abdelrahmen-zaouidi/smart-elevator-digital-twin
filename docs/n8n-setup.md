# n8n Local Setup Guide — Smart Elevator Digital Twin (Phase 3)

Complete instructions for importing, configuring, and activating the six agentic AI workflows on a **self-hosted n8n free plan** running in Docker.

> **Constraint:** All instructions are written for n8n Community Edition (self-hosted, free).
> No `$vars`, no cloud features, no paid plan features are used anywhere.
> Environment variables are read in Code nodes via `process.env`. Workflow 05
> copies notification delivery settings into `$json.delivery.*` before sender
> nodes run, so Telegram/email/SMS/voice nodes do not depend on `$env` parameter
> expressions.

---

## Prerequisites

- Stack running: `docker compose up -d` (from repo root)
- `elevator_agents` container healthy: `docker compose ps n8n`
- `elevator_db` container healthy: `docker compose ps postgres`
- Eclipse Ditto reachable at `http://localhost:8080/health` → HTTP 200
- Thing provisioned: `bash scripts/init-ditto.sh` completed successfully

---

## Step 1 — Access n8n

Open [http://localhost:5678](http://localhost:5678).

On first visit, create your **owner account**. This account is local only and stored in the `n8n_data` Docker volume — it does not require a license or cloud connection.

---

## Step 2 — Create Credentials

> **Critical:** credential names must match exactly as shown. The workflow JSON files reference credentials by name. A mismatch causes every HTTP and Postgres node to fail silently.

### 2a. HTTP Basic Auth for Eclipse Ditto

1. Go to **Settings → Credentials → New Credential**
2. Type: **HTTP Basic Auth**
3. Name: **`Authentication`** (exactly this string, case-sensitive)
4. Username: `ditto`
5. Password: `ditto`
6. Save

### 2b. PostgreSQL for TimescaleDB

1. Go to **Settings → Credentials → New Credential**
2. Type: **PostgreSQL**
3. Name: **`Postgres account`** (exactly this string, case-sensitive)
4. Host: `postgres`
5. Port: `5432`
6. Database: `smart_building`
7. User: `admin`
8. Password: value of `POSTGRES_PASSWORD` from your `.env` (default: `change_me_local_only`)
9. SSL: **disabled**
10. Save

### 2c. Optional — Telegram (workflow 05 only)

Only needed when `TELEGRAM_ENABLED=true` in `.env`. `TELEGRAM_CHAT_ID` must also
be set; otherwise workflow 05 skips Telegram and records the alert in the
dashboard outbox only.

1. Type: **Telegram**
2. Name: **`Telegram account`**
3. Bot token: value of `TELEGRAM_BOT_TOKEN` from `.env`

### 2d. Optional — SMTP Email (workflows 05 and 06)

Only needed when `EMAIL_ENABLED=true` in `.env`.

1. Type: **SMTP**
2. Name: **`SMTP account`**
3. Host/port/user/password: values from `.env` (`EMAIL_SMTP_*`)

---

## Step 3 — Import Workflow Files

1. Go to **Workflows → Import from File**
2. Import each file from `n8n-workflows/` **in this order**:

| # | File | Description |
|---|------|-------------|
| 1 | `01_ingestion_surveillance_agent.json` | Polls Ditto every 5 s, deduplicates, writes `telemetry_raw` |
| 2 | `02_analysis_ai_brain_agent.json` | Risk scoring, LLM/deterministic analysis, writes `ai_analysis` feature |
| 3 | `03_control_agent.json` | Autonomous control decisions, writes desired state to Ditto |
| 4 | `04_security_maintenance_agents.json` | RFID blacklist, maintenance schedule, predicted failures |
| 5 | `05_notification_agent.json` | Sends alerts via Telegram / email / SMS / voice |
| 6 | `06_optimization_audit_agents.json` | Weekly compliance audit, energy baseline, writes audit_log |

3. After each import, open the workflow and **re-attach credentials** to every node that shows a credential warning (orange dot on the node). Assign the credential created in Step 2 that matches the node type.

---

## Step 4 — Attach Credentials Per Workflow

### 01_ingestion_surveillance_agent

| Node | Credential |
|------|-----------|
| GET Thing from Ditto | `Authentication` |
| Archive to Postgres | `Postgres account` |

### 02_analysis_ai_brain_agent

| Node | Credential |
|------|-----------|
| GET Thing (snapshot) | `Authentication` |
| PATCH risk_score to Ditto | `Authentication` |
| PATCH ai_analysis to Ditto | `Authentication` |

### 03_control_agent

| Node | Credential |
|------|-----------|
| GET Thing (safety check) | `Authentication` |
| PUT desired state to Ditto | `Authentication` |

### 04_security_maintenance_agents

| Node | Credential |
|------|-----------|
| GET Thing | `Authentication` |
| PATCH security to Ditto | `Authentication` |
| PATCH maintenance_schedule to Ditto | `Authentication` |

### 05_notification_agent

| Node | Credential |
|------|-----------|
| Query outbox (Postgres) | `Postgres account` |
| Send Telegram | `Telegram account` (if enabled) |
| Send Email | `SMTP account` (if enabled) |

### 06_optimization_audit_agents

| Node | Credential |
|------|-----------|
| GET Thing | `Authentication` |
| Query demand / energy / compliance (Postgres) | `Postgres account` |
| Insert Audit Log (Postgres) | `Postgres account` |
| Send Compliance Email | `SMTP account` (if enabled) |

---

## Step 5 — Activate Workflows (In Order)

Activate one at a time and verify before proceeding to the next.

### 5a. Activate workflow 01 first

Toggle **Active** on `01_ingestion_surveillance_agent`.

**Verify after 15 seconds:**

```bash
# Check telemetry_raw is receiving rows
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT count(*), max(time) FROM telemetry_raw;"
```

Expected: `count` increases every ~5 seconds.

```bash
# Check workflow execution log in n8n
# Workflows → 01_ingestion_surveillance_agent → Executions
# All executions should show green (success)
```

### 5b. Activate workflow 02

Toggle **Active** on `02_analysis_ai_brain_agent`.

**Verify:**

```bash
# Check ai_analysis feature is written to Ditto
curl -s -u ditto:ditto http://localhost:8080/api/2/things/building:floor1:elevator/features/ai_analysis \
  | python3 -m json.tool

# Check risk_score attribute
curl -s -u ditto:ditto http://localhost:8080/api/2/things/building:floor1:elevator/attributes/risk_score
```

Expected: `ai_analysis` properties contain `risk_level`, `anomalies`, `recommendations` (or equivalent deterministic output). `risk_score` is an integer 0–100.

If n8n returns `things:feature.notfound` for `ai_analysis`, the live Thing was
created without the current feature surface. Repair only the missing features:

```powershell
node scripts\validation\ensure-ditto-features.js
```

### 5c. Activate workflow 04

Toggle **Active** on `04_security_maintenance_agents`.

**Verify:**

```bash
# Check maintenance_schedule feature
curl -s -u ditto:ditto http://localhost:8080/api/2/things/building:floor1:elevator/features/maintenance_schedule \
  | python3 -m json.tool
```

### 5d. Activate workflow 05

Toggle **Active** on `05_notification_agent`.

**Verify:** Check n8n execution log. If Telegram/email are disabled, the workflow exits cleanly after the routing check — this is correct behavior.

### 5e. Activate workflow 03

Toggle **Active** on `03_control_agent`.

> **Safety note:** Workflow 03 can issue control commands to Ditto (floor calls, door commands). It only acts when `risk_score >= MAX_RISK_AUTO_CONTROL` (default: 85). Verify `MAX_RISK_AUTO_CONTROL` is set correctly in `.env` before activating.

### 5f. Activate workflow 06

Toggle **Active** on `06_optimization_audit_agents`.

**Verify:**

```bash
# Check audit_log has entries
docker exec elevator_db psql -U admin -d smart_building \
  -c "SELECT workflow_name, status, created_at FROM audit_log ORDER BY created_at DESC LIMIT 5;"
```

---

## Environment Variables Reference

All variables below are available inside n8n via `$env.VAR_NAME` (in expression nodes) and `process.env.VAR_NAME` (in Code nodes). They are injected into the `elevator_agents` container by `docker-compose.yml`.

| Variable | Default | Used by workflow |
|----------|---------|-----------------|
| `DITTO_BASE_URL` | `http://docker-nginx-1` | 01, 02, 03, 04, 06 |
| `DITTO_USERNAME` | `ditto` | 01, 02, 03, 04, 06 |
| `DITTO_PASSWORD` | `ditto` | 01, 02, 03, 04, 06 |
| `PRIMARY_THING_ID` | `building:floor1:elevator` | 01, 03, 04, 05, 06 |
| `POSTGRES_HOST` | `postgres` | 01, 05, 06 |
| `POSTGRES_PORT` | `5432` | 01, 05, 06 |
| `POSTGRES_DB` | `smart_building` | 01, 05, 06 |
| `POSTGRES_USER` | `admin` | 01, 05, 06 |
| `POSTGRES_PASSWORD` | *(from .env)* | 01, 05, 06 |
| `LOCAL_LLM_ENABLED` | `false` | 02 |
| `LOCAL_LLM_URL` | `http://ollama:11434` | 02 |
| `LOCAL_LLM_MODEL` | `llama3.2` | 02 |
| `MAX_RISK_AUTO_CONTROL` | `85` | 03 |
| `MIN_FLOOR` | `0` | 03 |
| `MAX_FLOOR` | `3` | 03 |
| `GROUND_FLOOR` | `0` | 03 |
| `RFID_BLACKLIST_THRESHOLD` | `3` | 04 |
| `RFID_FAILURE_WINDOW_MINUTES` | `5` | 04 |
| `NOTIFICATION_DEDUPE_MINUTES` | `5` | 05 |
| `TELEGRAM_ENABLED` | `false` | 05 |
| `TELEGRAM_CHAT_ID` | *(empty)* | 05 |
| `EMAIL_ENABLED` | `false` | 05, 06 |
| `SMS_ENABLED` | `false` | 05 |
| `VOICE_ENABLED` | `false` | 05 |
| `DASHBOARD_URL` | `http://localhost:3000` | 05 |

---

## Ditto Write Paths (what each workflow writes)

| Workflow | Ditto path | Content |
|----------|-----------|---------|
| 02 | `attributes/risk_score` | Integer 0–100 |
| 02 | `features/ai_analysis` | `{ properties: { risk_level, anomalies, recommendations, ... } }` |
| 03 | `features/cabin/properties/targetFloor` | Integer (floor number) |
| 04 | `features/security/properties` | RFID blacklist state, lock status |
| 04 | `features/maintenance_schedule/properties` | Scheduled tasks, wear index |
| 04 | `features/predicted_failures/properties` | Component wear predictions |

The dashboard reads `features/ai_analysis/properties` for the **AI Insights** page and `features/maintenance_schedule/properties` for the **Maintenance** page. Workflow 02 writes the full `features/ai_analysis` feature object so Ditto can create the feature if it is missing. Empty states are shown when these features have no data.

---

## PostgreSQL Write Paths (what each workflow writes)

| Workflow | Table | Key columns written |
|----------|-------|-------------------|
| 01 | `telemetry_raw` | All sensor fields + `correlation_id`, `duplicate_hash`, `source`, `severity`, `risk_score` |
| 03 | `control_command_log` | `command_id` (UPSERT), `status` (`VALIDATED`/`REJECTED`), `command`, `source_agent`, `reason`, `risk_score`, `metadata` |
| 04 | `maintenance_work_orders` | `work_order_id`, `issue_key`, `priority`, `wear_index`, `tasks`, `status` (deduped on `(thing_id, issue_key)` while `OPEN`/`IN_PROGRESS`) |
| 05 | `notification_outbox` | `status`, `sent_at`, `locked_at`, `last_error`, `attempts`, `next_attempt_at` (exponential backoff on failure) |
| 06 | `audit_log` | `workflow_name`, `node_name`, `status`, `duration_ms`, `metadata` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Node shows orange credential dot after import | Credential ID in JSON doesn't match fresh install | Re-attach credential manually in the node editor |
| Workflow 01 executions fail with DB connection error | POSTGRES_* vars not in n8n container | Run `docker compose down && docker compose up -d`; confirm vars with `docker exec elevator_agents env \| grep POSTGRES` |
| `$env.DITTO_BASE_URL` is undefined in expressions | n8n container missing the var | Check `docker compose ps n8n`; ensure container restarted after `docker-compose.yml` edit |
| Telegram node fails with `chat_id is empty` | Active workflow still uses old `$env.TELEGRAM_CHAT_ID` expression, or Telegram is enabled without `TELEGRAM_CHAT_ID` | Re-import `n8n-workflows/05_notification_agent.json`, restart n8n, and confirm `TELEGRAM_CHAT_ID` is set in `.env` |
| Workflow 02 always uses deterministic engine | `LOCAL_LLM_ENABLED=false` or Ollama not running | Start with `docker compose --profile ai up -d`; pull model |
| Workflow 03 never fires control commands | `risk_score` below `MAX_RISK_AUTO_CONTROL` | Lower threshold in `.env` for testing; restart n8n container |
| Execution history shows red for workflow 06 | `audit_log` missing `workflow_name` column | Run `002_enterprise_iot_upgrade.sql` migration (see SETUP.md) |

---

## Verification Commands (PowerShell)

```powershell
# Confirm telemetry_raw is growing
docker exec elevator_db psql -U admin -d smart_building -c "SELECT count(*) FROM telemetry_raw;"

# Confirm ai_analysis feature exists on the twin
Invoke-RestMethod -Uri "http://localhost:8080/api/2/things/building:floor1:elevator/features/ai_analysis" `
  -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("ditto:ditto")) }

# Confirm maintenance_schedule feature exists
Invoke-RestMethod -Uri "http://localhost:8080/api/2/things/building:floor1:elevator/features/maintenance_schedule" `
  -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("ditto:ditto")) }

# Check audit_log entries from workflow 06
docker exec elevator_db psql -U admin -d smart_building `
  -c "SELECT workflow_name, status, created_at FROM audit_log ORDER BY created_at DESC LIMIT 10;"
```

---

*Last updated: Phase 3 agent integration.*
