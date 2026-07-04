# Changelog

All notable changes to the Smart Elevator Digital Twin platform are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-07-04

First tagged release: the complete thesis-grade platform — ESP32-S3 firmware
and physics simulator, MQTT over TLS with per-identity ACLs, Eclipse Ditto
digital twin, deterministic command safety gate, dual-brain AI-adaptive
dispatch engine, n8n agent workflows, TimescaleDB history/audit, and the
ElevatorOS SCADA dashboard.

### Added
- **Foundation sprint (Phase 1):**
  - GitHub Actions CI mirroring the manual validation suite (node suites,
    python suites, dashboard typecheck/lint/build, service image builds).
  - npm workspaces monorepo (`apps/dashboard`, `packages/shared`) with the
    first committed lockfile; dashboard package renamed to
    `@elevatoros/dashboard`.
  - Five-minute demo mode: `docker compose --profile demo up -d` with
    one-shot idempotent Ditto twin provisioning (`demo-init`) and a seeded,
    deterministic demo simulator; fresh-clone bootstrap script; `DEMO.md`.
  - `GET /api/system/health` aggregate platform health endpoint (Ditto,
    bridge heuristic, MQTT, Postgres, n8n) and the `SystemHealthStrip`
    top-bar component.
  - Backup/restore tooling (`scripts/backup.ps1`, `scripts/restore.ps1`)
    with a rehearsed restore drill; `docs/operations.md`.
  - Contributor scaffolding: `CONTRIBUTING.md`, `ROADMAP.md`,
    `CODE_OF_CONDUCT.md`, issue/PR templates, reworked README.
- **Twin-UX enterprise upgrade (2026-06-25 → 2026-07-04):** calm
  control-room token system on shadcn/ui, monolith split into pages +
  twin engine, reactive 3D digital-twin scene (react-three-fiber) with
  sensor overlays, full command lifecycle (durable `pending_command`
  intent → bridge fanout → device `COMMAND_RESULT` ack), LCD 16x4 support
  with DDRAM row addressing, device authorization context, agent activity
  panel with optional advisory-only LLM "why" narration (Ollama/Anthropic),
  Basic-Auth demo middleware.
- **n8n workflow upgrade package (2026-06-19):** control safety gate +
  persistence, webhook shared-secret auth, reliability hardening,
  integration depth, hygiene passes, and the workflow audit document.
- **Journal paper (2026-06-29 → 2026-07-03):** IEEEtran article in `paper/`
  with measured in-process numbers — safety gate 5.7 µs median, Brain A
  dispatch 15.6 µs, cost-of-safety ~5.3 µs/command, MQTT loopback RTT
  1.11 ms TCP / 1.19 ms TLS — and reviewer-response revision v2.

### Changed
- Repository restructured into a monorepo (2026-06-16): `apps/`,
  `services/`, `packages/`, `firmware/`, `workflows/`, `infra/`, `docs/`.
- Simulator command-payload unit tests updated to the parsed-dict contract
  (JSON is decoded once at the MQTT boundary).

### Fixed
- Migration 008 made safe for the plain (non-hypertable) `telemetry_raw`
  table; provides `prune_telemetry_raw(days)` fallback retention.
- n8n health probe workflow uses the httpRequest node (Code-node `$http` is
  undefined in n8n 2.x).
- Compose forwards `N8N_WEBHOOK_SECRET` (+ internal URL, coalesce, actuation
  flags) to the n8n container.

### Security
- MQTT security baseline live since 2026-06-10: broker anonymous access
  disabled, per-identity ACLs (only `bridge` may publish commands),
  server-only TLS on 8883 with pinned local CA; leaf-only certificate
  re-issue tooling (`scripts/reissue-server-cert.sh`).

## Pre-1.0 development history (reconstructed from git)

- **2026-05-30** — initial public platform: firmware, simulator, Mosquitto,
  bridge, Ditto model, n8n workflows, TimescaleDB schema, Next.js dashboard.
- **2026-06-04** — repo hygiene wave (stale broker config, legacy firmware
  and ESP8266 simulator removed, docs moved).
- **2026-06-10 → 13** — MQTT auth+TLS cutover on the live broker; isolated
  lab LAN (192.168.10.0/24) with PC-as-NTP-server and firmware offline-clock
  fallback.
- **2026-06-16** — monorepo restructure checkpoint + realtime integration.
- **2026-06-19** — n8n enterprise workflow upgrades + DB migration fixes.
- **2026-06-25 → 26** — dashboard enterprise refactor (tokens, shadcn,
  3D twin scene, monolith split).
- **2026-06-29 → 07-03** — journal paper phases 1–6 + reviewer revision v2.
- **2026-07-04** — Phase 1 Foundation sprint (this release).

[Unreleased]: https://github.com/abdelrahmen-zaouidi/smart-elevator-digital-twin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/abdelrahmen-zaouidi/smart-elevator-digital-twin/releases/tag/v1.0.0
