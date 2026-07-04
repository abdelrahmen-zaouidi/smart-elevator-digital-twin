# ElevatorOS Digital Twin — v1.0.0

> Draft body for the GitHub Release. Maintainer: create the release with
> `gh release create v1.0.0 --title "v1.0.0 — Smart Elevator Digital Twin" --notes-file docs/release-notes-v1.0.0.md`
> after pushing the branch and tag.

**Smart & Secure Elevator Management — an end-to-end, local-first digital
twin platform** for a real 4-floor ESP32-S3 elevator prototype, built as a
Master's-thesis research platform.

## What this is

ESP32-S3 firmware / Python physics simulator → **MQTT over TLS** (Mosquitto,
per-identity ACLs, no anonymous access) → Node.js bridge → **Eclipse Ditto**
digital twin (single source of truth) → **ElevatorOS**, a Next.js SCADA
dashboard — plus n8n agent workflows, TimescaleDB history/audit, and a
dual-brain AI-adaptive dispatch engine.

Every actuation flows through a **deterministic command safety gate**
(risk scoring, twin-freshness checks, cooldowns, full audit trail). AI is
**advisory only** — it explains decisions, it never actuates.
`AUTONOMOUS_ACTUATION_ENABLED=false` is the default posture.

## Headline verified numbers

Measured in-process on the reference host (see `evidence/perf/` and
`scripts/measurement/`):

| Metric | Value |
|---|---|
| Safety-gate decision time | **5.7 µs median** (p99 < 20 µs) |
| Brain A dispatch decision from twin state | **15.6 µs** |
| Cost of safety (gate overhead per command) | **~5.3 µs** |
| MQTT loopback RTT | **1.11 ms** TCP / **1.19 ms** TLS |
| Automated validation assertions | 33 gate + 61 dispatch + 33 simulator, all green in CI |

## Highlights of this release

- **5-minute demo mode** — `docker compose --profile demo up -d` provisions
  the twin (idempotently) and drives it with a seeded, deterministic
  simulator. See [DEMO.md](../DEMO.md).
- **CI pipeline** — the full manual validation suite now runs on every push.
- **Platform health** — `GET /api/system/health` + a live status strip in
  the dashboard top bar.
- **Operations** — backup/restore scripts with a rehearsed drill
  ([docs/operations.md](operations.md)).
- **Command lifecycle** — durable `pending_command` intent in Ditto, bridge
  fanout over MQTT, device `COMMAND_RESULT` acks, LCD 16x4 operator display.
- **3D digital twin** — reactive react-three-fiber scene with live sensor
  overlays.

## Validation levels (evidence honesty)

Claims in this repository use three explicit levels:

1. **Software-validated (PASS)** — enforced by the automated suites in CI.
2. **Documented integration** — verified end-to-end on the reference rig
   (authenticated simulator as the device endpoint for the final E2E run).
3. **Outside scope (documented design)** — e.g. KY-024 floor sensors and the
   SPDT cabin switch are design extensions, not firmware v6 features.

**Known limitations** (deliberate, documented): temperature/vibration/load
are potentiometer-simulated on the physical rig; floor detection in firmware
v6 is functional open-loop step counting; `telemetry_raw` is a plain
Postgres table (hypertable migration is on the [roadmap](../ROADMAP.md));
single-elevator scope (fleet support is the next major theme); dashboard and
Ditto run behind HTTP on the isolated lab LAN.

## Upgrade / install

Fresh install: [SETUP.md](../SETUP.md). Quick look: [DEMO.md](../DEMO.md).
Requires Docker Desktop ≥ 24, Node ≥ 20, Python ≥ 3.11, plus the Eclipse
Ditto compose stack.

## License

Apache-2.0.
