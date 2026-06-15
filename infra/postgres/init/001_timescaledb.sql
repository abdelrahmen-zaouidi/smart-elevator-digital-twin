CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry_raw (
  time timestamptz NOT NULL,
  thing_id text NOT NULL,
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  system_mode text NOT NULL,
  current_floor smallint,
  target_floor smallint,
  load_kg real,
  speed_ms real,
  door_state text,
  forced_entry boolean DEFAULT false,
  audio_distress boolean DEFAULT false,
  motor_temp_c real,
  vibration_g real,
  power_kw real,
  current_draw_a real,
  hours_operated real,
  risk_score smallint,
  raw_payload jsonb NOT NULL
);

SELECT create_hypertable('telemetry_raw', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_thing_time
  ON telemetry_raw (thing_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_event_type
  ON telemetry_raw (event_type, time DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  audit_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  agent_name text NOT NULL,
  event_type text NOT NULL,
  thing_id text NOT NULL,
  action text NOT NULL,
  trigger text,
  risk_score integer DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_thing_time
  ON audit_log (thing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  thing_id text NOT NULL,
  severity text NOT NULL,
  channel text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next_attempt
  ON notification_outbox (status, next_attempt_at);

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_risk
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  thing_id,
  ROUND(AVG(risk_score)::numeric, 1) AS avg_risk,
  MAX(risk_score) AS max_risk,
  COUNT(*) FILTER (WHERE event_type = 'ANOMALY_DETECTED') AS anomaly_count,
  COUNT(*) FILTER (WHERE event_type = 'SECURITY_BREACH') AS breach_count
FROM telemetry_raw
GROUP BY bucket, thing_id;

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_energy
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  thing_id,
  ROUND(AVG(power_kw)::numeric, 2) AS avg_power_kw,
  ROUND(AVG(current_draw_a)::numeric, 2) AS avg_current_a,
  ROUND(AVG(vibration_g)::numeric, 4) AS avg_vibration_g
FROM telemetry_raw
GROUP BY bucket, thing_id;
