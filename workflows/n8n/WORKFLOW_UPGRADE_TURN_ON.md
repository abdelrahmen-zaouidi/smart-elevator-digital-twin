# n8n Workflow Upgrades — Turn-On Guide (Phase B)

This is the **one checklist** to activate everything from the WU1–WU6 work. The code is
already committed on branch `feat/realtime-integration` (commits `bc71587`, `25f03a4`,
`4deaa33`, `29937f0`). Nothing is live until you do the steps below — your running system is
unchanged until you re-import.

---

## What changed (before → after)

| Unit | Fix | Before | After |
|---|---|---|---|
| WU1 | F2,F3 | autonomous control actions showed as blank "REJECTED" in the dashboard; gate allowed floor 10 on a 4-floor rig | gate uses canonical vocab + `MAX_FLOOR=3` + stale-twin check; `control_command_log` stores the full decision so `/api/agent/activity` shows ACCEPTED/REJECTED correctly |
| WU2 | F1 | all 6 internal webhooks open to anyone on the network | every webhook requires header `x-n8n-webhook-secret`; all 17 senders + dashboard attach it |
| WU3 | F4,F5,F10 | a DB blip dropped a tick silently; identical states re-fired analysis/control every 5s; downstream failures vanished | telemetry INSERT retries + dead-letters; routing requires `duplicate==false`; commands coalesce on one id; new `00_error_handler` catches failed executions |
| WU4 | F7 | **deferred** | n8n static data already persists across restarts in single-main mode; `agent_state` migration only needed if you move to queue mode (and needs a live test) |
| WU5 | F8,F9,D4 | health panel had no data source; two dispatchers competed; autonomous actions never reached firmware | new `07_system_health` writes `system_health_history`; `AUTONOMOUS_ACTUATION_ENABLED` flag (off) can route through `pending_command`; `06` dispatch is now advisory-only |
| WU6 | F6,F11,F12,F13 | "6h" scan ran hourly; telemetry grew forever; URLs hardcoded; a dead action item | scan runs 6h; migration 008 adds compression+retention; URLs use `N8N_INTERNAL_URL`; dead action removed |

---

## Turn-on steps (do them in this order)

### 1. Add the new env vars to your real `.env` files
Copy these from `.env.example` (root) and `apps/dashboard/.env.example` into your actual envs and
give the secret a real value:

| Var | Where | Value |
|---|---|---|
| `N8N_WEBHOOK_SECRET` | root **and** dashboard | a long random string (same value in both) |
| `N8N_AUDIT_URL` | dashboard | `http://127.0.0.1:5678/webhook/audit-agent` |
| `N8N_INTERNAL_URL` | root (n8n container) | `http://n8n:5678` |
| `COMMAND_COALESCE_SECONDS` | root | `30` |
| `AUTONOMOUS_ACTUATION_ENABLED` | root | `false` (leave off for now) |
| `TELEMETRY_RETENTION_DAYS` | root | `90` |

### 2. Start Docker Desktop, bring the stack up
```bash
docker compose up -d
```

### 3. Run the new database migration
WU1 needs no new migration (columns already exist from `002`/`005`). WU6 adds one:
```bash
docker compose exec -T postgres psql -U admin -d smart_building < infra/postgres/migrations/008_telemetry_retention.sql
```

### 4. Create the webhook secret credential in n8n
n8n UI → **Credentials → New → "Header Auth"**:
- Name: **`n8n Webhook Secret`** (exact)
- Header Name: `x-n8n-webhook-secret`
- Header Value: the same string you put in `N8N_WEBHOOK_SECRET`

### 5. Re-import the workflows
Import these files (n8n → Import from File). New ones: **`00_error_handler.json`**,
**`07_system_health.json`**. Changed ones: `01`, `02`, `03`, `04`, `06`. (`05` is unchanged.)
- On each of the 6 webhook nodes, set the credential to **`n8n Webhook Secret`** (n8n flags the
  placeholder id `__SET_WEBHOOK_SECRET_CRED__` until you do).
- Make sure each workflow is **Active**.

### 6. Set the global error handler
For each workflow: **⋯ menu → Settings → Error Workflow → `00_error_handler`**.

### 7. Restart the dashboard so it picks up the new env + code
```bash
docker compose restart dashboard    # or rebuild if running the dashboard on the host
```

---

## Acceptance checks (prove it works)

```bash
# WU2 — webhook is now locked (no secret => rejected, with secret => accepted)
curl -s -o /dev/null -w 'no-secret: %{http_code}\n' -X POST http://localhost:5678/webhook/control-agent -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w 'with-secret: %{http_code}\n' -X POST http://localhost:5678/webhook/control-agent -H 'content-type: application/json' -H "x-n8n-webhook-secret: $N8N_WEBHOOK_SECRET" -d '{"triggered_action":{"agent":"control","command":"EMERGENCY_STOP","source":"n8n","source_agent":"t","correlation_id":"CID-A","reason":["t"]}}'
# expect: no-secret: 403   with-secret: 200

# WU1 — autonomous actions now render correctly (not a blank REJECTED)
curl -s 'http://localhost:3000/api/agent/activity?kind=GATE&limit=5' | jq '.data[] | {command,decision,accepted,command_label}'

# WU5 — health panel now has data (was always empty)
curl -s 'http://localhost:3000/api/history/system-health?limit=6' | jq '.data[] | {component,status,latency_ms}'
# expect rows for ditto / postgres / n8n within ~1 minute

# WU6 — retention/compression policies registered
docker compose exec -T postgres psql -U admin -d smart_building -c "SELECT proc_name, config FROM timescaledb_information.jobs WHERE hypertable_name='telemetry_raw';"
```

---

## Notes
- **`.env.example` changes are not committed** (those files had prior local edits) — the new vars
  are documented there for you to copy; review before committing them yourself.
- **Optional — autonomous actuation:** flip `AUTONOMOUS_ACTUATION_ENABLED=true` only after you've
  confirmed the bridge consumes `features/control/properties/pending_command` (the dashboard
  already uses this path). Default off = twin-state writes only, exactly as before.
- **WU4 (durable agent state)** is intentionally not done — only needed if you switch n8n to
  queue mode; revisit with the stack up so it can be tested on the live ingestion path.
