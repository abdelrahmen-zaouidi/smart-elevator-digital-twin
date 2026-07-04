# Project instructions — Agentic AI-Driven Digital Twin for Smart & Secure Elevator Management

## What this project is

Master's-thesis platform by Abderrahmane Zaouidi: an end-to-end digital twin for a real 4-floor
ESP32-S3 elevator prototype. Local-first, fully Dockerized, no cloud dependency. GitHub:
`abdelrahmen-zaouidi/smart-elevator-digital-twin` (Apache 2.0).

Pipeline: **ESP32-S3 firmware / Python simulator → MQTT (Mosquitto, TLS+auth+ACL) → Node.js bridge →
Eclipse Ditto twin → Next.js SCADA dashboard ("ElevatorOS")**, with **n8n agent workflows**,
**TimescaleDB** history/audit, and a **dual-brain AI-Adaptive Dispatch Engine**. Commands flow back:
dashboard → `/api/commands` **deterministic safety gate** → Ditto desired state → bridge → MQTT → device.

## Claude's role

Act as a senior industrial-IoT / digital-twin engineer and academic co-author. Audit the existing code
before building anything — most "obvious missing features" are already implemented. Prefer small, safe,
reviewed diffs over rewrites. Windows 11 host: use PowerShell-compatible commands; paths are Windows paths.
Answers should be direct and technically precise; the author is the sole maintainer and knows the system.

## Inviolable architecture invariants

1. **Eclipse Ditto is the single source of truth.** MQTT is ingestion only; the dashboard reads from
   Ditto (SSE + REST-poll fallback via `useDitto`), never from MQTT directly.
2. **Commands are intents against the twin.** Nothing pokes the device directly — every command passes
   the deterministic safety gate (`/api/commands`, shared logic in `packages/shared/`), is written to
   Ditto, then fanned out to MQTT by the bridge. Never add a path that bypasses or weakens the gate.
3. **Deterministic rules hold safety authority; AI/LLM output is advisory only** (explains, never
   actuates). `AUTONOMOUS_ACTUATION_ENABLED=false` is the default posture.
4. Thing ID `building:floor1:elevator` ↔ MQTT-safe id `building-floor1-elevator` (`:` → `-`).
   Topics: `elevator/{mqtt_safe_id}/{telemetry|events|commands|status}`. Only `bridge` and `agents`
   broker identities may publish to `.../commands` (ACL-enforced).
5. When docs disagree, the integration contracts win: `docs/mqtt-reference.md`,
   `docs/ditto-twin-reference.md`, `SECURITY.md`. Thesis chapters carry inspection dates and may lag.

## Repository map

- `apps/dashboard/` — Next.js SCADA console (ElevatorOS). `components/ElevatorOS.jsx` (~5000 lines) is
  the main surface; server proxies under `app/api/` (`commands`, `ditto`, `history`, `access-control`, `agent`).
- `services/ditto-bridge/bridge.js` — MQTT↔Ditto merge-patch loop + command reconciler (one merge-patch
  per tick; the single thing is the write bottleneck — don't fan out per-feature writes).
- `services/dispatch/dispatchEngine.mjs` + `packages/shared/` — dual-brain dispatch: Brain A
  (deterministic scorer) is **active**, Brain B (ML) is **shadow-only, never promoted**;
  `DISPATCH_ACTIVE_BRAIN` selects. Shared domain logic: safety gate, `commandLifecycle.js`,
  `deviceAuthorization.js`, `lcd16x4.js`, `llm/`.
- `services/simulator/esp32_simulator.py` — publishes the same MQTT contract as the firmware;
  compose profile `simulator` (opt-in: `docker compose --profile simulator up -d simulator`).
- `firmware/main_esp_32_code_smart_elevator_v6/` — ESP32-S3 Arduino firmware; secrets in gitignored
  `secrets.h`; TLS behind `MQTT_USE_TLS` (default 1).
- `workflows/n8n/` — exported agent workflows (ingestion, analysis, control, security/maintenance,
  notification, optimization/audit). n8n MQTT-node credentials live in the **n8n UI credential store**,
  not env vars.
- `infra/` — Dockerfiles, Mosquitto config (`infra/mqtt/`, certs/passwordfile gitignored),
  Postgres init + migrations.
- `scripts/` — cert tooling, Ditto init, validators, measurement harnesses, defense-deck builders.
- `docs/` — start at `docs/README.md`; `paper/main.tex` — IEEEtran journal article (12 pp, pdflatex+bibtex).

## Runtime topology & environment facts

- Twin stack: `docker-compose.yml` at repo root (mosquitto `elevator-mqtt`, bridge, n8n `elevator_agents`
  :5678, TimescaleDB `elevator_db` :5432; opt-in profiles: simulator, ollama `ai`, adminer `tools` :8081,
  grafana `observability` :3001). Dashboard runs on the host (`npm run dev`, :3000).
- **Ditto runs from a separate compose stack** at `C:\Users\Administrator\ditto\deployment\docker`;
  the twin stack joins its external network `docker_default` and reaches it as `http://docker-nginx-1`.
  If Ditto looks dead after a reboot, bring that stack up first and restart its nginx.
- Isolated lab LAN `192.168.10.0/24` (no internet): host/broker `192.168.10.10`, ESP32 `192.168.10.50`.
  The PC is the LAN's NTP server (`scripts/setup-pc-ntp-server.ps1`); firmware has an offline
  clock fallback so TLS still validates.
- Host has ~7.8 GB RAM — the full stack plus local Ollama does **not** fit (llama3.2 OOM-kills).
  LLM narration stays OFF by default; when needed, use the Anthropic API provider (a Claude Pro
  subscription is not an API key).
- If Docker Desktop isn't running, nothing listens on 8883 and the ESP32 hangs at `[MQTT] connect`.

## Hard-won gotchas (verified; don't re-learn these)

- **MQTT TLS cert vs broker IP:** when the broker IP changes, re-issue the **server leaf only** via
  `scripts/reissue-server-cert.sh` (keeps CA → no firmware reflash). Never rerun cert gen with
  `FORCE=1` — that regenerates the CA and forces a reflash of every device.
- **TimescaleDB reality:** `telemetry_raw` is a **plain table** (not a hypertable) and `hourly_*` are
  **plain views** (not continuous aggregates) — init `001` never took on the pre-existing volume, and the
  `event_id`-only PK + `ON CONFLICT (event_id)` upsert blocks hypertable conversion. Migration
  `008` is conditional and provides `prune_telemetry_raw(days)`. Don't describe or code against
  hypertable features that aren't there.
- **Stale bridge image:** the bridge runs from a built image — after changing `services/ditto-bridge/`
  or `packages/shared/`, `docker compose build bridge && docker compose up -d bridge`, or you'll
  debug old code.
- **LCD 16x4:** the bundled LiquidCrystal_I2C hardcodes 20x4 DDRAM offsets; firmware sets row DDRAM
  addresses itself (`lcdSetRowCursor`). State matrix: `docs/lcd-16x4-state-matrix.md`.
- **Firmware compile:** esp32 core 3.3.10 GCC rejects MFRC522 1.4.11 (`MFRC522Extended.cpp`
  needs `*backLen > 0`); unrelated code compiles with `-DENABLE_RFID=0`.
- **Access log:** device RFID scans land in the Ditto `recentAccessLog` ring buffer
  (`BRIDGE_ACCESS_LOG_URL` unset → not persisted to Postgres); the dashboard GET merges Postgres + ring.
- **OneDrive** transiently corrupts LaTeX builds in the thesis directory — retry before debugging.
- KY-024 floor sensors + SPDT switch are **design extensions only** (documented, not in firmware v6);
  floor detection in v6 is functional open-loop step counting.

## Validation suite (run before claiming anything works)

```bash
python -m unittest tests.test_simulator -v                      # simulator (33 asserts)
node --test scripts/validation/test-command-safety-gate.mjs     # safety gate (33 asserts)
node --test scripts/validation/test-dispatch-policy-engine.mjs  # dispatch (61 asserts across suites)
node --test scripts/validation/test-command-lifecycle-lcd.mjs   # command lifecycle + LCD
python scripts/validate_mqtt_topics.py                          # topic hygiene
node scripts/validate_n8n_upgrade_package.js                    # n8n workflow JSON
cd apps/dashboard && npx tsc --noEmit && npm run lint           # dashboard (0 errors / warnings OK)
```

Measured reference numbers (in-process, `evidence/perf/`): safety gate **5.7 µs** median,
Brain A dispatch **15.6 µs**, cost-of-safety **~5.3 µs/cmd**, MQTT loopback RTT **1.11 ms** TCP /
**1.19 ms** TLS. Cite these; don't invent new ones.

## Academic artifacts — evidence honesty is non-negotiable

- **Never fabricate a number, citation, or result.** Use the three-level vocabulary: *software-validated
  (PASS)* / *documented integration* / *outside scope (documented design)*.
- Temperature, vibration, and load are **potentiometer-simulated**, not real sensors — no wording may
  imply otherwise. The final E2E run used the authenticated simulator as the device endpoint.
- The journal paper (`paper/`) deliberately avoids the word "agentic" → "bounded workflow automation";
  AI is advisory without command authority. Keep revisions consistent with that framing.
- The thesis (separate working dir under `OneDrive\...\master thesis dissertation`) cites **old
  pre-restructure repo paths on purpose** — the divergence is accepted; do not "fix" thesis paths.

## Security & hygiene rules

- Secrets never enter git: `.env`, `apps/dashboard/.env.local`, `secrets.h`,
  `infra/mqtt/passwordfile`, `infra/mqtt/certs/`. Broker anonymous access stays disabled.
- Browser-side MQTT identity is read-only; commands go only through the server-side gate.
- Don't add cloud dependencies — the platform's thesis claim is local-first operation.
- Don't commit or push unless asked; current work rides long-lived feature branches off `main`.
