-- =============================================================================
-- Migration 007 — RFID Access-Control durable log
-- =============================================================================
-- Adds a durable, queryable record of every RFID access decision (granted or
-- denied) so the dashboard Access-Control page and historical audit views can
-- reconstruct WHO badged WHERE, WHEN, and WHY a scan was allowed or refused.
--
-- Source of truth for the *tag registry* remains the Eclipse Ditto
-- `accessControl` feature (authorizedTags). This table only mirrors the
-- *event stream* (the access log), fed by:
--   - the MQTT->Ditto bridge when the firmware/simulator reports an RFID scan
--   - the dashboard /api/access-control/logs route (manual / synthetic events)
--
-- All operations are idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Re-running
-- this migration on a database that already has the objects is a no-op. It does
-- not drop or rename anything and is backward-compatible with earlier schema.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- access_log: one row per RFID access decision.
-- decision is constrained to the canonical set used across the stack.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_log (
  id            bigserial PRIMARY KEY,
  time          timestamptz NOT NULL DEFAULT now(),
  thing_id      text        NOT NULL,
  elevator_id   text,
  tag_uid       text        NOT NULL,
  tag_label     text,
  role          text,
  decision      text        NOT NULL,
  reason        text,
  source        text,
  correlation_id text,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Defensive: add the columns if an older access_log table already existed.
ALTER TABLE access_log
  ADD COLUMN IF NOT EXISTS elevator_id    text,
  ADD COLUMN IF NOT EXISTS tag_label      text,
  ADD COLUMN IF NOT EXISTS role           text,
  ADD COLUMN IF NOT EXISTS reason         text,
  ADD COLUMN IF NOT EXISTS source         text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS details        jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Normalize decision values defensively (GRANTED / DENIED / UNKNOWN / REVOKED).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_log_decision_check'
  ) THEN
    ALTER TABLE access_log
      ADD CONSTRAINT access_log_decision_check
      CHECK (decision IN ('GRANTED', 'DENIED', 'UNKNOWN', 'REVOKED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_access_log_thing_time
  ON access_log (thing_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_access_log_tag_time
  ON access_log (tag_uid, time DESC);

CREATE INDEX IF NOT EXISTS idx_access_log_decision_time
  ON access_log (decision, time DESC);

COMMIT;
