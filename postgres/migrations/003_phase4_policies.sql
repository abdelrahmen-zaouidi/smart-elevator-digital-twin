-- Phase 4: Analytics views and safe TimescaleDB policies.
-- Safe to run more than once (uses CREATE OR REPLACE / if_not_exists).
--
-- NOTE: telemetry_raw was created with event_id as the sole PRIMARY KEY.
-- TimescaleDB requires the partition column (time) to be part of any unique
-- index before converting the table to a hypertable. Rather than rewrite the
-- primary key (which would break the n8n workflow's ON CONFLICT (event_id)),
-- we create hourly_risk and hourly_energy as regular SQL views.
-- time_bucket() is available from the TimescaleDB extension even on plain
-- tables, so these views produce the same hourly aggregation.

-- Drop continuous-aggregate versions if they were somehow partially created
-- (this is a no-op on a fresh install or if the views don't exist).
DROP VIEW IF EXISTS hourly_risk CASCADE;
DROP VIEW IF EXISTS hourly_energy CASCADE;

-- Hourly risk aggregation view
CREATE OR REPLACE VIEW hourly_risk AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  thing_id,
  ROUND(AVG(risk_score)::numeric, 1)                            AS avg_risk,
  MAX(risk_score)                                               AS max_risk,
  COUNT(*) FILTER (WHERE event_type = 'ANOMALY_DETECTED')::int  AS anomaly_count,
  COUNT(*) FILTER (WHERE event_type = 'SECURITY_BREACH')::int   AS breach_count
FROM telemetry_raw
GROUP BY time_bucket('1 hour', time), thing_id;

-- Hourly energy / vibration aggregation view
CREATE OR REPLACE VIEW hourly_energy AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  thing_id,
  ROUND(AVG(power_kw)::numeric, 2)      AS avg_power_kw,
  ROUND(AVG(current_draw_a)::numeric, 2) AS avg_current_a,
  ROUND(AVG(vibration_g)::numeric, 4)    AS avg_vibration_g
FROM telemetry_raw
GROUP BY time_bucket('1 hour', time), thing_id;

-- Supporting indexes on telemetry_raw for the above views and API queries
CREATE INDEX IF NOT EXISTS idx_telemetry_raw_time_desc
  ON telemetry_raw (time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_thing_event_type
  ON telemetry_raw (thing_id, event_type, time DESC);
