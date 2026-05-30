-- =============================================================================
-- Migration 005 — Command Safety Gate schema extension
-- =============================================================================
-- Extends control_command_log with the columns the deterministic Command
-- Safety Gate writes for every decision (accepted or rejected) so that the
-- dashboard, n8n control agent, and historical audit views can reconstruct
-- the full decision context.
--
-- All operations are idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF
-- NOT EXISTS. Re-running this migration on a database that already has the
-- columns is a no-op.
--
-- Does NOT drop existing columns or rename anything; backward-compatible
-- with rows written by 002_enterprise_iot_upgrade.sql.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- control_command_log: new columns for the safety gate decision envelope.
-- ---------------------------------------------------------------------------
ALTER TABLE control_command_log
  ADD COLUMN IF NOT EXISTS command_label      text,
  ADD COLUMN IF NOT EXISTS decision           text,
  ADD COLUMN IF NOT EXISTS accepted           boolean,
  ADD COLUMN IF NOT EXISTS source             text,
  ADD COLUMN IF NOT EXISTS system_mode        text,
  ADD COLUMN IF NOT EXISTS current_floor      integer,
  ADD COLUMN IF NOT EXISTS target_floor       integer,
  ADD COLUMN IF NOT EXISTS door_state         text,
  ADD COLUMN IF NOT EXISTS emergency_stop     boolean,
  ADD COLUMN IF NOT EXISTS load_kg            numeric(8, 2),
  ADD COLUMN IF NOT EXISTS rejection_reasons  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS safety_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_command        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ditto_payload      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ditto_write_status text,
  ADD COLUMN IF NOT EXISTS audit_status       text,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- The original schema marked reason as NOT NULL but for REJECTED commands the
-- user may not have provided one. Relax to allow NULL while keeping existing
-- rows valid.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'control_command_log' AND column_name = 'reason' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE control_command_log ALTER COLUMN reason DROP NOT NULL;
  END IF;
END $$;

-- Ditto path was a single-string column. Accepted commands often write to
-- several paths atomically, so the canonical write plan now lives in
-- ditto_payload (jsonb array). ditto_path remains for backward compatibility
-- and may hold a comma-joined summary.
COMMENT ON COLUMN control_command_log.ditto_payload IS
  'JSONB array of {path, value} entries representing the canonical Ditto write plan produced by the safety gate. Empty array for rejected commands (invariant).';
COMMENT ON COLUMN control_command_log.rejection_reasons IS
  'JSONB array of REJECTED:* strings produced by the safety gate. Empty array for accepted commands.';
COMMENT ON COLUMN control_command_log.safety_snapshot IS
  'JSONB object capturing the safety-relevant twin slice at the moment of decision (floor, door, load, mode, alert, etc).';

-- ---------------------------------------------------------------------------
-- Indexes — query patterns the Command Safety Gate panel needs.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_control_command_log_decision_time
  ON control_command_log (decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_command_log_command_time
  ON control_command_log (command, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_command_log_source_time
  ON control_command_log (source, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger so the column reflects the latest write status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control_command_log_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_control_command_log_touch_updated_at
  ON control_command_log;

CREATE TRIGGER trg_control_command_log_touch_updated_at
  BEFORE UPDATE ON control_command_log
  FOR EACH ROW
  EXECUTE FUNCTION control_command_log_touch_updated_at();

COMMIT;
