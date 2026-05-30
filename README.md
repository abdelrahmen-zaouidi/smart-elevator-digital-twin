# Smart Elevator Digital Twin

An end-to-end **Agentic AI Digital Twin platform** for a 4-floor elevator prototype: ESP32-S3 firmware on a real rig, MQTT-over-TLS to a local broker, an Eclipse Ditto digital twin, a Next.js SCADA dashboard, TimescaleDB analytics, and n8n agentic workflows for surveillance, predictive maintenance, and notifications.

> Built as a Master's thesis platform. Local-first, fully Dockerized, no cloud dependency.

---

## Architecture

```
ESP32-S3 firmware ─┐
                   ├──MQTT──▶ Mosquitto ──▶ bridge ──REST──▶ Eclipse Ditto ◀── Next.js dashboard
esp32_simulator.py ┘                              │                ▲
                                                  ▼                │
                                       n8n agentic workflows ──────┘
                                       TimescaleDB (telemetry + audit)
```

Dashboard commands flow back through a deterministic **safety gate** → Ditto desired state → MQTT command topic → ESP32-S3.

## Features

- **Real + simulated devices** — firmware for a physical ESP32-S3 prototype and a Python simulator that publishes the same MQTT contract.
- **Digital twin** — Eclipse Ditto holds the canonical state; the bridge merges telemetry one tick at a time.
- **SCADA dashboard** — Next.js / React with live MQTT (WebSocket) subscriptions, command panel, and maintenance views.
- **Agentic workflows (n8n)** — surveillance, predictive maintenance, security, notification, and audit agents.
- **TimescaleDB analytics** — hypertable-backed telemetry, command audit log, notification outbox.
- **Deterministic command safety gate** — risk-scored admission, cooldowns, twin-freshness checks (see `docs/safety/`).
- **MQTT security baseline** — TLS on the ESP32 hop, per-identity ACLs, anonymous access disabled.
- **Optional local LLM** — Ollama integration, off by default.

## Technology stack

| Layer | Stack |
|---|---|
| Firmware | Arduino / ESP32-S3 (Arduino framework), PubSubClient, WiFiClientSecure |
| Broker | Eclipse Mosquitto (TLS + password file + ACL) |
| Twin | Eclipse Ditto (separate compose stack) |
| Bridge | Node.js (MQTT ↔ Ditto REST merge-patch loop) |
| Workflows | n8n (self-hosted) |
| Dashboard | Next.js (React, server proxies, MQTT-WS client) |
| Database | PostgreSQL + TimescaleDB |
| Orchestration | Docker Compose |

## Quickstart

Prerequisites: Docker Desktop ≥ 24, Node.js ≥ 20, Python ≥ 3.11, Git Bash or WSL2 on Windows.

```bash
cp .env.example .env                      # fill secrets locally
docker compose up -d                      # broker, postgres, n8n, bridge, simulator
cd dashboard && cp .env.example .env.local && npm install && npm run dev
```

Eclipse Ditto runs from its own compose stack — see [SETUP.md](SETUP.md) for the full procedure including Ditto init, MQTT cert generation, and dashboard provisioning.

## Repository layout

```
.
├── main_esp_32_code_smart_elevator_v6/   # primary ESP32-S3 firmware (uses secrets.h)
├── main_esp_32_code_smart_elevator/      # older ESP32-S3 firmware variant
├── ELEVATOR_SIMULATOR_ESP8266/           # ESP8266 simulator sketch
├── esp32_simulator.py                    # Python-side simulator
├── dashboard/                            # Next.js SCADA dashboard
├── postgres/                             # init + migrations
├── mosquitto/, mosquitto_config/         # broker config (certs/passwordfile gitignored)
├── N8n workflows/                        # exported agentic workflows
├── scripts/                              # ops helpers (cert gen, Ditto init, validators)
├── tests/, tools/                        # validation + admin utilities
├── docs/                                 # safety + validation docs
├── docker-compose.yml
├── Dockerfile.bridge, Dockerfile.simulator
├── SETUP.md                              # full local setup
├── SECURITY.md                           # security baseline + ACL matrix
└── PROJECT_CONTEXT.md                    # technical context for the prototype
```

## Configuration

All runtime config lives in `.env` (gitignored). Copy `.env.example` and fill in:

- Postgres / TimescaleDB credentials
- n8n encryption key (`openssl rand -base64 24`)
- Ditto endpoint + credentials
- MQTT topic conventions (canonical: `elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}`)
- MQTT broker identities (`bridge`, `agents`, `dashboard`, `esp32-elevator`, `healthcheck`)
- Optional Telegram / email / SMS / voice notification channels
- Optional local LLM (Ollama) settings

For firmware: copy `main_esp_32_code_smart_elevator_v6/secrets.h.example` to `secrets.h` and fill in WiFi/MQTT credentials.

## Security

See [SECURITY.md](SECURITY.md) for the full baseline. Highlights:

- MQTT-over-TLS on the ESP32 hop with pinned CA
- Per-identity ACLs; anonymous access disabled
- Secrets gitignored (`.env`, `dashboard/.env.local`, `secrets.h`, `mosquitto_config/passwordfile`, `mosquitto_config/certs/`)
- Browser-side MQTT identity is read-only (commands go through the dashboard's server-side Ditto proxy)

## Documentation

- [SETUP.md](SETUP.md) — full local setup procedure
- [SECURITY.md](SECURITY.md) — security baseline + threat model
- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — prototype hardware + integration context
- [docs/safety/](docs/safety/) — command safety gate rules
- [docs/validation/](docs/validation/) — validation procedures

## Status

Research / thesis prototype. Not intended for production deployment without further hardening (HTTPS on dashboard + Ditto, intra-Docker TLS, secrets manager, audit retention policy).

## License

See [LICENSE](LICENSE).
