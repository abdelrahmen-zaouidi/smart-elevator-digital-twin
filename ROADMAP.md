# Roadmap

Direction, not promises. Items preserve the platform's invariants (twin as
source of truth, deterministic safety authority, advisory-only AI,
local-first). Based on the 2026-07 enterprise architecture review.

## Phase 1 — Foundation ✅ (2026-07-04)

- [x] CI pipeline mirroring the manual validation suite
- [x] npm-workspaces monorepo + first committed lockfile
- [x] Five-minute demo mode (`--profile demo`, idempotent twin provisioning)
- [x] `GET /api/system/health` + dashboard status strip
- [x] Backup/restore tooling with a rehearsed drill
- [x] Release engineering (CHANGELOG, v1.0.0) + contributor scaffolding

## Phase 2 — Enterprise hardening (next)

- [ ] **Observability**: Prometheus metrics from bridge + dashboard (gate
      verdicts, merge latency, ack timeouts), provisioned Grafana dashboards
      under the existing `observability` profile; structured JSON logs keyed
      by `command_id`
- [ ] **Identity**: per-user authentication (Auth.js/OIDC) with roles
      (viewer/operator/maintainer/admin) feeding the gate's actor context and
      audit attribution; enable n8n user management
- [ ] **TimescaleDB done right**: composite PK `(event_id, time)`, hypertable
      migration with `migrate_data`, real continuous aggregates, native
      compression + retention (backup first — tooling exists)
- [ ] **API maturity**: OpenAPI 3.1 spec generated from zod schemas, uniform
      error envelope, rate limiting on `/api/commands`
- [ ] Supply chain: Dependabot, image/SBOM scanning, digest-pinned bases
- [ ] Dashboard test harness (Vitest units + one Playwright smoke)

## Phase 3 — Product differentiation

- [ ] **Fleet support**: N elevators — per-thing bridge sessions, dashboard
      fleet grid, per-device broker identities (the contracts are already
      fleet-shaped: `elevator/+/…`, `ELEVATOR_FLEET_IDS`)
- [ ] **Root-cause timeline**: one merged what-happened-at-14:32 view across
      telemetry, events, commands, access log, agent actions
- [ ] **Historical replay**: scrub past incidents through the twin UI
      (client-side state reconstruction — never replays into the live thing)
- [ ] **Operator copilot (advisory)**: RAG over docs/ + live twin state,
      read-only tools, per-answer citations; extends the existing narration
      contract (never actuates)
- [ ] Brain B promotion pipeline: offline evaluation report, promotion gates,
      auto-demotion watchdog
- [ ] Incident lifecycle (open → ack → resolve) on top of the notification
      outbox

## Phase 4 — Scale & research

- [ ] OpenTelemetry command-lifecycle tracing (closes paper measurements
      M1/M3 continuously)
- [ ] Reproducible benchmark suite (`npm run bench` regenerating
      `evidence/perf/`)
- [ ] Extract the safety gate as a standalone OSS library (framework-free,
      citable alongside the paper)
- [ ] Energy/sustainability analytics: kWh + CO₂ model, ECO_ENERGY policy
      A/B savings from the dispatch shadow evaluation
- [ ] Statistical anomaly detection in shadow (advisory feature, evaluated
      like Brain B)
- [ ] Compliance mapping (IEC 62443 alignment table, EN 81-28 framing)

## Future vision (earned, not scheduled)

Multi-building tenancy & white-labeling · technician PWA with push ·
signed firmware OTA · docs site (GitHub Pages) · Zenodo DOI for releases.

## Deliberate non-goals

Kubernetes/microservice decomposition (5 containers on one host is the right
shape) · cloud-required features (local-first is a differentiator) · AI with
command authority (the advisory boundary is the thesis).
