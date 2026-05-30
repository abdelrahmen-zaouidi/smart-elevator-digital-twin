# Smart Elevator Digital Twin — Local Setup Guide

End-to-end instructions for running the full stack on a single machine.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker Desktop | ≥ 24 | All containerised services |
| Docker Compose | v2 (bundled with Desktop) | Service orchestration |
| Node.js | ≥ 20 | Dashboard (Next.js) — host-side only |
| Python | ≥ 3.11 | Simulator — only needed if running outside Docker |
| curl + bash | any | `scripts/init-ditto.sh` |

> **Windows users:** run bash commands in Git Bash or WSL2.
> PowerShell equivalents are noted where relevant.

---

## Architecture at a glance

```
esp32_simulator  ──MQTT──▶  mosquitto  ──MQTT──▶  bridge  ──REST──▶  Eclipse Ditto
                                                                          │
                                 n8n (workflows) ◀──poll/SSE──────────────┤
                                 postgres (TimescaleDB)                    │
                                 dashboard (Next.js)  ◀─────proxy──────────┘
```

**Eclipse Ditto runs in its own separate Docker Compose stack** (not this one).
Everything else starts from this repo's `docker-compose.yml`.

---

## Step 1 — Environment configuration

```bash
cp .env.example .env
```

Edit `.env` only if your setup differs from the defaults:

| Variable | Default | Change when... |
|----------|---------|----------------|
| `DITTO_BASE_URL` | `http://docker-nginx-1` | Ditto nginx container has a different name |
| `DITTO_PUBLIC_BASE_URL` | `http://localhost:8080` | Ditto listens on a different host port |
| `POSTGRES_PASSWORD` | `change_me_local_only` | Always change for non-throwaway data |
| `SIMULATOR_PUBLISH_INTERVAL_S` | `3` | Faster/slower simulation ticks |

---

## Step 2 — Start Eclipse Ditto

Eclipse Ditto must be started **before** this stack because this `docker-compose.yml`
attaches to the external `docker_default` network that Ditto creates.

```bash
# In the Eclipse Ditto repository (separate folder):
docker compose up -d
```

Wait until `http://localhost:8080/health` returns HTTP 200 before continuing.

Default Ditto credentials:
- Regular user: `ditto` / `ditto`
- Admin user:   `devops` / `foobar`

---

## Step 3 — Start this stack

```bash
docker compose up -d --build
```

This starts: **mosquitto**, **bridge**, **n8n**, **postgres**.

The **simulator is OFF by default** — the `up` command will not spawn
`elevator_simulator` so the platform can run against real device telemetry
without synthetic data getting mixed in. Start it on demand with:
```bash
docker compose --profile simulator up -d --build simulator
```
Stop it again with `docker compose stop simulator` (or `docker compose rm -sf simulator`
to discard the container).

Check everything started:
```bash
docker compose ps
```

Expected state — all services should be `running`:
```
elevator-mqtt        running
elevator_bridge      running
elevator_agents      running
elevator_db          running (healthy)
elevator_simulator   (only when started with --profile simulator)
```

---

## Step 4 — Provision the Ditto Thing

Run this once. It is safe to re-run (all operations are PUT/upsert):

```powershell
# PowerShell (Windows)
.\scripts\init-ditto.ps1

# Bash / WSL / Git Bash
bash scripts/init-ditto.sh
```

Expected output:
```
[1/3] Waiting for Eclipse Ditto to be ready...
  Ditto is up.
[2/3] Creating policy building:floor1:elevator...
  Policy created (HTTP 201).
[3/3] Provisioning Thing building:floor1:elevator...
  Thing created (HTTP 201).
Done. Thing building:floor1:elevator is provisioned.
```

> **If you get HTTP 403 on the policy step**, re-run with the admin user:
> ```bash
> DITTO_USERNAME=devops DITTO_PASSWORD=foobar bash scripts/init-ditto.sh
> ```

---

## Step 5 — Start the dashboard

The dashboard runs on the host (not in Docker) so Next.js fast-refresh works:

```bash
cd dashboard
cp .env.example .env.local    # already done if you see dashboard/.env.local
npm install                   # first time only
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Step 6 — Import n8n workflows (optional)

1. Open [http://localhost:5678](http://localhost:5678)
2. Create your owner account on first visit
3. Go to **Settings → Import** and import each file from `N8n workflows/`:
   - `01_ingestion_surveillance_agent.json`
   - `02_analysis_ai_brain_agent.json`
   - `03_control_agent.json`
   - `04_security_maintenance_agents.json`
   - `05_notification_agent.json`
   - `06_optimization_audit_agents.json`
4. **Recreate credentials** — the exported files reference credential IDs that do
   not exist in a fresh n8n. You must create them manually:

   | Credential name | Type | Values |
   |-----------------|------|--------|
   | `Authentication` | HTTP Basic Auth | user: `ditto`, pass: `ditto` |
   | `Postgres account` | PostgreSQL | host: `postgres`, port: `5432`, db: `smart_building`, user/pass from `.env` |

5. Open each workflow, re-attach the credentials, then **Activate workflows in this order**:
   `01` → `02` → `04` → `05` → `03` → `06`
   Activate one at a time and verify its execution log before activating the next.

   > Order rationale: workflow 06 owns the `/webhook/audit-agent` endpoint that
   > 01, 03, and 04 POST to. Activating 01–05 first is intentional — they will
   > emit a few harmless 404s for audit calls until 06 is active, but no
   > telemetry, control, or notification logic depends on those audit POSTs
   > succeeding. Activate 06 last so the audit log stops missing events.

> **n8n community (self-hosted) note:** Environment variables are available in
> Function nodes because `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is already set in
> `docker-compose.yml`. No paid plan is required for local self-hosted use.
> **Full Phase 3 setup guide** (credential names, activation order, verification): [`docs/n8n-setup.md`](docs/n8n-setup.md)

---

## Verifying the pipeline

### Check MQTT messages are flowing

The project uses a single canonical topic convention:

```
elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
```

`mqtt_safe_thing_id` is the Ditto Thing ID with `:` replaced by `-`.
For `building:floor1:elevator` the MQTT-safe id is `building-floor1-elevator`.

```bash
# In a second terminal — subscribe to all elevators' telemetry
docker exec elevator-mqtt mosquitto_sub -t "elevator/+/telemetry" -v
```

Expected output (truncated):
```
elevator/building-floor1-elevator/telemetry {"topic":"building/floor1:elevator/things/twin/commands/modify","thingId":"building:floor1:elevator","mqttId":"building-floor1-elevator","value":{...}}
```

### Check Ditto is receiving updates
```bash
curl -s -u ditto:ditto http://localhost:8080/api/2/things/building:floor1:elevator \
  | python3 -m json.tool | grep -A5 '"cabin"'
```

### Check bridge logs
```bash
docker logs elevator_bridge --tail 20
```

Expected:
```
[Bridge] Connected to MQTT mqtt://mosquitto:1883
[Bridge] Subscribed to elevator/+/telemetry, elevator/+/events, elevator/+/status
[Bridge] PUT /api/2/things/... 204
```

### Check simulator logs
```bash
docker logs elevator_simulator --tail 10
```

### Open dashboard
Navigate to [http://localhost:3000](http://localhost:3000). The **cabin**, **door**,
and **motor** panels should show live values updating every ~3 seconds.

---

## Database migrations

On a **fresh** database, Docker auto-applies all SQL files from `postgres/init/`
in alphabetical order:
1. `001_timescaledb.sql` — base schema (hypertable, continuous aggregates)
2. `002_enterprise_iot_upgrade.sql` — enterprise tables (agent_state, command_log, etc.)

If your `pg_data` Docker volume already exists, Docker will not re-run files from
`postgres/init/`. Apply the idempotent migrations manually in order:
```bash
docker exec -i elevator_db psql -U admin -d smart_building \
  < postgres/migrations/002_enterprise_iot_upgrade.sql
docker exec -i elevator_db psql -U admin -d smart_building \
  < postgres/migrations/003_phase4_policies.sql
docker exec -i elevator_db psql -U admin -d smart_building \
  < postgres/migrations/004_notification_outbox_contract.sql
```

The migrations are fully idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`
where appropriate). `004_notification_outbox_contract.sql` repairs older
notification outbox tables that are missing `sent_at`, which is required by
workflow `05_notification_agent` when marking a delivery as sent.

---

## Optional profiles

```bash
# Local LLM (requires a GPU or patience)
docker compose --profile ai up -d
# After it starts, pull the model:
docker exec elevator_ollama ollama pull llama3.2

# Adminer (database GUI at http://localhost:8081)
docker compose --profile tools up -d

# Grafana (http://localhost:3001)
docker compose --profile observability up -d
```

---

## Stopping the stack

```bash
docker compose down          # stop, keep volumes (data preserved)
docker compose down -v       # stop and DELETE all volumes (full reset)
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Bridge logs `ECONNREFUSED mosquitto:1883` | Mosquitto not ready | `docker compose restart elevator_bridge` |
| Init script returns HTTP 403 | Wrong Ditto user | Re-run with `DITTO_USERNAME=devops DITTO_PASSWORD=foobar` |
| Dashboard shows "No data" | Ditto Thing not provisioned | Run `bash scripts/init-ditto.sh` |
| Dashboard shows "MQTT disconnected" | Mosquitto WS port 9001 blocked | Check `docker compose ps elevator-mqtt` |
| `docker compose up` fails with "network not found" | Ditto not started yet | `docker compose up -d` in the Ditto repo first |
| `pg_data` volume exists but `002` tables missing | Volume pre-dates `002` migration | Run the manual migration command above |
| n8n workflows error on credentials | Credential IDs not matching | Recreate credentials as described in Step 6 |

---

## Simulator profiles, safety latch, and deterministic demos

The simulator is configured entirely through env vars. The most useful knobs:

| Variable | Default | Effect |
|----------|---------|--------|
| `SIM_ANOMALY_PROFILE` | `normal` | One of `normal` / `noisy` / `demo` / `critical` / `disabled`. Per-second activation rates, so changing `SIMULATOR_PUBLISH_INTERVAL_S` no longer distorts how often failures fire. |
| `SIM_EMERGENCY_AUTO_CLEAR` | `false` | When `false` (production-style), `emergency_stop`, `forced_entry`, and `audio_distress` latch and require operator acknowledgement. Set to `true` only for academic demos. |
| `SIM_DEMO_AUTO_CLEAR_S` | `90` | Seconds before a latched safety flag auto-clears, when `SIM_EMERGENCY_AUTO_CLEAR=true`. |
| `SIM_RANDOM_SEED` | unset | Set to any integer for fully repeatable demo / thesis runs. Leave empty for non-deterministic behaviour. |
| `SIM_PHYSICS_STEP_S` | `0.1` | Internal physics sub-step size. Tick size no longer dictates motion accuracy. |

To run with a deterministic demo profile:

```bash
SIM_ANOMALY_PROFILE=demo SIM_RANDOM_SEED=2026 docker compose up -d --build simulator
```

To enable the demo auto-clear behaviour (older default):

```bash
SIM_EMERGENCY_AUTO_CLEAR=true SIM_DEMO_AUTO_CLEAR_S=90 docker compose up -d simulator
```

Run the unit tests (no Docker / MQTT needed):

```bash
python -m unittest tests.test_simulator -v
```

## Command Safety Gate

Every operator and agent command is admitted by a deterministic safety gate
before any write to Eclipse Ditto. See
[`docs/safety/command-safety-gate.md`](docs/safety/command-safety-gate.md) for
the full specification.

Apply the migration once on existing databases:

```bash
docker exec -i elevator_db psql -U admin -d smart_building \
  < postgres/migrations/005_command_safety_gate.sql
```

Run the safety-gate test suite (no broker / dashboard needed):

```bash
node --test scripts/validation/test-command-safety-gate.mjs
```

New env variables (defaults are safe for local Docker):

```
MAX_RISK_AUTO_CONTROL=70
MAX_RISK_OPERATOR_CONTROL=85
MAX_TWIN_AGE_SECONDS=10
COMMAND_COOLDOWN_SECONDS=3
COMMAND_REQUIRE_REASON=true
COMMAND_AUDIT_ENABLED=true
```

## Remaining known limitations (Phase 1)

- **Ditto credentials** (`NEXT_PUBLIC_DITTO_USERNAME/PASSWORD`) are bundled into the
  browser JavaScript bundle. Acceptable for a local demo; not for production.
- **`predicted_failures`** is consumed by the dashboard but is currently populated
  only by the n8n maintenance agent (workflow 04). The simulator publishes the
  surrounding `energy`, `performance`, `motor.current_draw_a`, `motor.power_kw`,
  `motor.vibration_g`, `motor.vibration_baseline_g`, `cabin.between_floors`, and
  `cabin.max_load_kg` fields the n8n risk engine reads.
- **n8n workflow credential IDs** are hardcoded in the exported JSON and must be
  manually re-attached after import on any fresh n8n installation.
