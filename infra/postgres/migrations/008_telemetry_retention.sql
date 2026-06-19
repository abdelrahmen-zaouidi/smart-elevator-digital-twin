-- =============================================================================
-- Migration 008 — telemetry_raw retention (F11)
-- =============================================================================
-- The ingestion agent inserts one telemetry_raw row every 5s poll (~17k
-- rows/day/elevator). Without a retention policy the table grows without bound.
--
-- IMPORTANT — telemetry_raw is a PLAIN table on this deployment, not a
-- TimescaleDB hypertable. It cannot trivially become one: its primary key is
-- event_id alone and ingestion upserts via ON CONFLICT (event_id), but a
-- TimescaleDB hypertable requires every unique key to include the partition
-- column (time). So native compression/retention policies do not apply.
--
-- This migration is conditional and idempotent:
--   * if telemetry_raw IS a hypertable -> add native compression + retention.
--   * otherwise -> install prune_telemetry_raw(days) for plain-table retention,
--     callable manually or from a scheduler (n8n / pg_cron).
-- It always commits; it never aborts on the table type.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  is_hyper boolean := EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'telemetry_raw'
  );
BEGIN
  IF is_hyper THEN
    EXECUTE 'ALTER TABLE telemetry_raw SET ('
         || 'timescaledb.compress, '
         || 'timescaledb.compress_segmentby = ''thing_id'', '
         || 'timescaledb.compress_orderby = ''time DESC'')';
    PERFORM add_compression_policy('telemetry_raw', INTERVAL '7 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('telemetry_raw', INTERVAL '90 days', if_not_exists => TRUE);
    RAISE NOTICE 'telemetry_raw: TimescaleDB compression + retention policies ensured.';
  ELSE
    RAISE NOTICE 'telemetry_raw is a plain table; installing prune_telemetry_raw() for retention.';
  END IF;
END $$;

-- Plain-table retention helper. Deletes rows older than retention_days and
-- returns how many were removed. Schedule it (e.g. daily) via n8n or pg_cron:
--   SELECT prune_telemetry_raw(90);
CREATE OR REPLACE FUNCTION prune_telemetry_raw(retention_days integer DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  deleted bigint;
BEGIN
  DELETE FROM telemetry_raw
   WHERE time < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;

COMMIT;
