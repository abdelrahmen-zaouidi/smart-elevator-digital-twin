-- =============================================================================
-- Migration 010 — dashboard users + command audit attribution (RBAC)
-- =============================================================================
-- Additive and idempotent (new table + nullable columns only) — safe to apply
-- live with no coordinated cutover, unlike 009.
--
-- Backs per-user authentication (Auth.js / NextAuth credentials provider) and
-- role-based access control on POST /api/commands. Roles:
--   viewer      - read-only; cannot issue commands (403 before the safety gate)
--   operator    - may issue operator commands (existing risk cap 85)
--   maintainer  - operator + access-control mutations
--   admin       - everything + user management
--
-- Passwords are bcrypt hashes created by scripts/create-dashboard-user.mjs;
-- no credentials are ever committed.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('viewer','operator','maintainer','admin')),
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Command audit attribution: which authenticated user issued the command.
-- Nullable so pre-existing rows and non-interactive (n8n/system) commands
-- remain valid.
ALTER TABLE control_command_log ADD COLUMN IF NOT EXISTS user_id  bigint;
ALTER TABLE control_command_log ADD COLUMN IF NOT EXISTS username text;

COMMIT;
