-- =============================================================================
-- Migration 008 — telemetry_raw compression + retention (F11)
-- =============================================================================
-- The ingestion agent inserts one telemetry_raw row every 5s poll (~17k
-- rows/day/elevator) even when state is unchanged. Without a retention or
-- compression policy the hypertable grows without bound. This migration adds
-- TimescaleDB native compression (after 7 days) and a retention policy
-- (default 90 days). The continuous aggregates hourly_risk / hourly_energy keep
-- their rolled-up history even after raw chunks are dropped.
--
-- Idempotent: add_*_policy use if_not_exists; the compress ALTER is guarded.
-- Adjust the retention interval to match TELEMETRY_RETENTION_DAYS in .env.
-- =============================================================================

BEGIN;

-- Enable native compression on the hypertable (safe to re-run; guarded so an
-- existing compression configuration with compressed chunks doesn't abort).
DO $$
BEGIN
  ALTER TABLE telemetry_raw SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'thing_id',
    timescaledb.compress_orderby   = 'time DESC'
  );
EXCEPTION WHEN others THEN
  RAISE NOTICE 'telemetry_raw compression settings unchanged: %', SQLERRM;
END $$;

-- Compress chunks older than 7 days.
SELECT add_compression_policy('telemetry_raw', INTERVAL '7 days', if_not_exists => TRUE);

-- Drop raw chunks older than 90 days (continuous aggregates retain rollups).
-- Keep this interval in sync with TELEMETRY_RETENTION_DAYS in .env.
SELECT add_retention_policy('telemetry_raw', INTERVAL '90 days', if_not_exists => TRUE);

COMMIT;
