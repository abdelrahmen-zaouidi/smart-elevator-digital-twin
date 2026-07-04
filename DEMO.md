# 5-Minute Demo — ElevatorOS Digital Twin

Bring the full digital-twin platform up with realistic, deterministic, moving
data — no physical elevator, no manual twin provisioning.

## Prerequisites

- Docker Desktop ≥ 24 (running)
- Node.js ≥ 20
- **The Eclipse Ditto stack** (separate compose project — see
  [SETUP.md](SETUP.md#eclipse-ditto)). The platform joins its
  `docker_default` network. If Ditto isn't running, the demo fails fast with
  an actionable error.
- Git Bash or WSL for the one-time bootstrap (fresh clones only).

## Commands

```bash
bash scripts/demo/bootstrap-demo.sh        # fresh clone only: .env + broker auth + certs (idempotent)
docker compose --profile demo up -d --build
cd apps/dashboard && npm install && npm run dev
# open http://localhost:3000
```

> Already have a provisioned `.env`, passwordfile, and certs? Skip the
> bootstrap — the demo profile reuses your existing configuration.

What the demo profile does:

- **`demo-init`** (one-shot): waits for Ditto, then provisions the
  `building:floor1:elevator` policy + Thing with all 13 features — **only if
  the Thing doesn't exist**. An already-initialized twin is never touched.
- **`demo-simulator`**: the physics simulator with a fixed random seed (42),
  the `demo` anomaly profile, and emergencies that auto-clear after 90 s so a
  live audience sees recovery, not a latched fault.

Do **not** run `--profile demo` and `--profile simulator` at the same time —
both publish as the same device identity. And keep the physical ESP32
powered off during demos: the demo simulator impersonates it.

## What you should see within 60 seconds

1. `docker compose ps` — `elevator_demo_init` exited `(0)`,
   `elevator_demo_simulator` and the core stack `Up`.
2. The dashboard header shows the device **ONLINE** with live telemetry —
   the cabin starts answering simulated hall calls, floor position and speed
   update every ~3 s.
3. Charts begin filling; the dispatch policy panel shows the active policy
   and its reasoning.

## Three-minute guided tour

| Minute | What to do | What it demonstrates |
|---|---|---|
| 0–1 | Watch the synoptic view: cabin moves, doors cycle, load/temperature evolve. | Live MQTT → bridge → Ditto → SSE pipeline; the twin as single source of truth. |
| 1–2 | Wait for a demo anomaly (vibration/temperature spike — the `demo` profile fires them on a friendly cadence). Watch risk analysis + notification agents react, then the fault auto-clear after ~90 s. | Agentic monitoring, deterministic risk engine, recovery story. |
| 2–3 | Issue **MOVE_TO_FLOOR 3** from the command panel (provide a reason when prompted). Watch it pass the safety gate, appear as `pending_command` intent, get fanned out over MQTT, and come back with a device `COMMAND_RESULT` ack. | The deterministic command safety gate and the full audited command lifecycle — the platform's core safety claim. |

## Tear down (demo containers only)

```bash
docker compose stop demo-simulator demo-init && docker compose rm -f demo-simulator demo-init
```

The core platform (broker, bridge, n8n, database) keeps running.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `elevator_demo_init` exits non-zero: "Ditto is not reachable" | Start the Ditto compose stack first, then `docker compose --profile demo up -d`. |
| Simulator logs `not authorised` | `MQTT_ESP32_PASSWORD` in `.env` doesn't match `infra/mqtt/passwordfile` — re-run the bootstrap on a fresh setup, or copy the password from the firmware's `secrets.h`. |
| Dashboard shows OFFLINE | Check `docker logs elevator_bridge --tail 20` (bridge merges telemetry into Ditto) and that Ditto's nginx is up. |
| Broker won't start | `infra/mqtt/passwordfile` or `infra/mqtt/certs/` missing — run `bash scripts/demo/bootstrap-demo.sh`. |
