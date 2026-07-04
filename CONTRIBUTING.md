# Contributing

Thanks for your interest in the Smart Elevator Digital Twin. This is a
research platform with a working physical rig behind it, so contributions are
held to the same discipline the thesis is: **respect the invariants, run the
validation suite, never fabricate evidence.**

## Architecture invariants (review criteria)

Every PR is reviewed against these. A change that violates one is rejected
regardless of how useful it is:

1. **Eclipse Ditto is the single source of truth.** MQTT is ingestion only;
   the dashboard reads from Ditto (SSE + REST-poll fallback), never from MQTT
   directly.
2. **Commands are intents against the twin.** Every actuation passes the
   deterministic safety gate (`/api/commands`, shared logic in
   `packages/shared/`), is written to Ditto, then fanned out to MQTT by the
   bridge. **Never add a path that bypasses or weakens the gate.**
3. **Deterministic rules hold safety authority; AI/LLM output is advisory
   only** — it explains, it never actuates. `AUTONOMOUS_ACTUATION_ENABLED=false`
   is the default posture.
4. Thing ID `building:floor1:elevator` ↔ MQTT-safe id
   `building-floor1-elevator` (`:` → `-`); topics
   `elevator/{mqtt_safe_id}/{telemetry|events|commands|status}`. Only the
   `bridge` and `agents` broker identities may publish to `.../commands`.
5. **Local-first.** No cloud dependency may be required for core operation.
6. Secrets never enter git: `.env`, `apps/dashboard/.env.local`, `secrets.h`,
   `infra/mqtt/passwordfile`, `infra/mqtt/certs/`.

When documents disagree, the integration contracts win:
[docs/mqtt-reference.md](docs/mqtt-reference.md),
[docs/ditto-twin-reference.md](docs/ditto-twin-reference.md),
[SECURITY.md](SECURITY.md).

## Dev setup

Prerequisites: Docker Desktop ≥ 24, Node ≥ 20, Python ≥ 3.11, Git Bash/WSL on
Windows.

```bash
npm install                      # root: installs the npm workspaces
# The platform needs TWO compose stacks:
#   1. Eclipse Ditto (its own compose project — see SETUP.md)
#   2. this repo:  docker compose up -d
cd apps/dashboard && npm run dev # ElevatorOS on :3000
```

Fast path to a running system: [DEMO.md](DEMO.md). Full procedure (certs,
broker auth, Ditto init, n8n import): [SETUP.md](SETUP.md).

Gotcha: the bridge runs from a **built image** — after changing
`services/ditto-bridge/` or `packages/shared/`, run
`docker compose build bridge && docker compose up -d bridge`.

## The validation suite is the merge gate

CI runs it on every push/PR; run it locally before opening a PR:

```bash
npm run validate
```

which is: safety-gate + dispatch + command-lifecycle node suites, n8n
workflow package validation, simulator unit tests, MQTT topic hygiene,
dashboard typecheck + lint. All must pass (lint: **0 errors**; the existing
warnings are the accepted baseline — don't add new ones).

If your change has a runtime surface, demonstrate it: paste the relevant
command + output (or a screenshot for UI) in the PR. Claims follow the
project's evidence vocabulary: *software-validated (PASS)* / *documented
integration* / *outside scope (documented design)*.

## Commits & releases

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`,
  `refactor:` — small commits, one concern each.
- User-visible changes add a line under `[Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format).
- Releases are semver tags (`vX.Y.Z`) cut from `main`; the changelog section
  becomes the GitHub Release body.

## Scope notes for newcomers

- The dashboard is **already fully wired** to the real Ditto/MQTT
  architecture — audit before "connecting" anything.
- `telemetry_raw` is a plain Postgres table (not a hypertable) — see
  [ROADMAP.md](ROADMAP.md) before touching retention/aggregation.
- Firmware changes require the physical rig to verify; PRs that only compile
  are labeled *documented design* until flashed.
