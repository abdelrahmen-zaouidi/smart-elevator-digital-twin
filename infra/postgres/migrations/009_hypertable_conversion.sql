-- =============================================================================
-- Migration 009 — telemetry_raw -> TimescaleDB hypertable + continuous aggregates
-- =============================================================================
-- Supersedes the "plain table" reality documented in migration 008. Converts
-- telemetry_raw into a real hypertable and rebuilds hourly_risk / hourly_energy
-- as continuous aggregates, then (re)asserts compression + retention.
--
-- WHY THE PRIMARY KEY CHANGES:
--   TimescaleDB requires every unique/primary key to include the partition
--   column (time). The old PK was event_id alone, which is exactly what blocked
--   hypertable conversion. This migration swaps it to (event_id, time).
--
-- INGESTION UPSERT — BREAKING, COORDINATE THE CUTOVER:
--   The n8n ingestion workflow upserts with ON CONFLICT (event_id). After this
--   migration that target no longer matches a unique constraint and the insert
--   ERRORS. The workflow files are updated in-repo to ON CONFLICT (event_id, time)
--   (workflows/n8n/01_ingestion_surveillance_agent.json and
--   enterprise-upgrade-code/01_prepare_telemetry_params.js) but the RUNNING n8n
--   must be re-imported for the change to take effect. Apply this migration and
--   re-import the ingestion workflow together (see docs/operations.md).
--   Dedup semantics are preserved: event.timestamp is deterministic per event,
--   so the same event re-ingested yields the same (event_id, time).
--
-- Idempotent + guarded: safe to run more than once and safe if telemetry_raw is
-- already a hypertable. Output columns of hourly_risk / hourly_energy are
-- preserved EXACTLY so /api/history/{risk,energy} keep returning the same shape.
-- =============================================================================

-- create_hypertable(migrate_data) cannot run inside a transaction block, so this
-- migration is intentionally NOT wrapped in BEGIN/COMMIT. Each statement is
-- individually idempotent.

-- ---------------------------------------------------------------------------
-- 1. Primary key: event_id -> (event_id, time), then convert to a hypertable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  is_hyper boolean := EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'telemetry_raw'
  );
BEGIN
  IF is_hyper THEN
    RAISE NOTICE 'telemetry_raw is already a hypertable; skipping PK swap + conversion.';
  ELSE
    -- Swap the primary key so it includes the partition column.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telemetry_raw_pkey') THEN
      ALTER TABLE telemetry_raw DROP CONSTRAINT telemetry_raw_pkey;
    END IF;
    ALTER TABLE telemetry_raw ADD CONSTRAINT telemetry_raw_pkey PRIMARY KEY (event_id, "time");

    -- Dependent plain views must be dropped before conversion so they can be
    -- rebuilt as continuous aggregates below.
    DROP VIEW IF EXISTS hourly_risk;
    DROP VIEW IF EXISTS hourly_energy;

    PERFORM create_hypertable('telemetry_raw', 'time',
                              migrate_data => TRUE, if_not_exists => TRUE);
    RAISE NOTICE 'telemetry_raw converted to a hypertable.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Continuous aggregates replacing the former plain views.
--    Column lists are IDENTICAL to the old views (see 001) so the history
--    routes (SELECT bucket, avg_risk, max_risk, anomaly_count, breach_count
--    FROM hourly_risk; SELECT bucket, avg_power_kw, avg_current_a,
--    avg_vibration_g FROM hourly_energy) are unaffected.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS hourly_risk;      -- in case a plain view still exists
DROP VIEW IF EXISTS hourly_energy;

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_risk
WITH (timescaledb.continuous) AS
  SELECT time_bucket('01:00:00'::interval, "time") AS bucket,
         thing_id,
         round(avg(risk_score), 1) AS avg_risk,
         max(risk_score) AS max_risk,
         count(*) FILTER (WHERE event_type = 'ANOMALY_DETECTED')::integer AS anomaly_count,
         count(*) FILTER (WHERE event_type = 'SECURITY_BREACH')::integer AS breach_count
  FROM telemetry_raw
  GROUP BY bucket, thing_id
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_energy
WITH (timescaledb.continuous) AS
  SELECT time_bucket('01:00:00'::interval, "time") AS bucket,
         thing_id,
         round(avg(power_kw)::numeric, 2) AS avg_power_kw,
         round(avg(current_draw_a)::numeric, 2) AS avg_current_a,
         round(avg(vibration_g)::numeric, 4) AS avg_vibration_g
  FROM telemetry_raw
  GROUP BY bucket, thing_id
WITH NO DATA;

-- Materialize history once now (WITH NO DATA created them empty).
CALL refresh_continuous_aggregate('hourly_risk', NULL, NULL);
CALL refresh_continuous_aggregate('hourly_energy', NULL, NULL);

-- Keep them fresh going forward (hourly). end_offset = bucket width so the most
-- recent (still-filling) bucket is served by real-time aggregation.
SELECT add_continuous_aggregate_policy('hourly_risk',
         start_offset => INTERVAL '3 days',
         end_offset   => INTERVAL '1 hour',
         schedule_interval => INTERVAL '1 hour',
         if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('hourly_energy',
         start_offset => INTERVAL '3 days',
         end_offset   => INTERVAL '1 hour',
         schedule_interval => INTERVAL '1 hour',
         if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 3. Compression + retention (idempotent; mirrors migration 008's hypertable
--    branch so a single 009 apply yields a fully-configured hypertable).
--    Retention honours 90 days (see TELEMETRY_RETENTION_DAYS in .env).
-- ---------------------------------------------------------------------------
ALTER TABLE telemetry_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'thing_id',
  timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('telemetry_raw', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('telemetry_raw', INTERVAL '90 days', if_not_exists => TRUE);
