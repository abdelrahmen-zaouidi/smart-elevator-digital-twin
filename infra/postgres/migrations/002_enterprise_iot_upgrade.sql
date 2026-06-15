-- Smart Elevator Enterprise IoT upgrade migration.
-- Safe to run more than once. It only adds columns, tables, and indexes.

CREATE EXTENSION IF NOT EXISTS timescaledb;

ALTER TABLE IF EXISTS telemetry_raw
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS duplicate_hash text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'RECORDED',
  ADD COLUMN IF NOT EXISTS duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_source text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS audit_log
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS workflow_name text,
  ADD COLUMN IF NOT EXISTS node_name text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS duration_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS notification_outbox
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS message_hash text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- Unique index on dedupe_key is required for ON CONFLICT (dedupe_key) DO NOTHING.
-- Safe to run on volumes that predate the dedupe_key column in 001_timescaledb.sql.
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_outbox_dedupe_key
  ON notification_outbox (dedupe_key);

CREATE TABLE IF NOT EXISTS agent_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_command_log (
  command_id text PRIMARY KEY,
  correlation_id text NOT NULL,
  thing_id text NOT NULL,
  command text NOT NULL,
  requested_by text,
  source_agent text NOT NULL,
  reason text NOT NULL,
  risk_score integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  ditto_path text,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  acknowledged_at timestamptz,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  work_order_id text PRIMARY KEY,
  correlation_id text,
  thing_id text NOT NULL,
  issue_key text NOT NULL DEFAULT 'general',
  priority text NOT NULL,
  wear_index numeric(5,2) NOT NULL,
  estimated_failure_days integer NOT NULL,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS system_health_history (
  id bigserial PRIMARY KEY,
  correlation_id text,
  thing_id text NOT NULL,
  component text NOT NULL,
  status text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  latency_ms integer,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_correlation
  ON telemetry_raw (correlation_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_duplicate_hash_time
  ON telemetry_raw (thing_id, duplicate_hash, time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_status_time
  ON telemetry_raw (processing_status, time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_severity_risk_time
  ON telemetry_raw (severity, risk_score, time DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_correlation
  ON audit_log (correlation_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_status_time
  ON audit_log (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_workflow_time
  ON audit_log (workflow_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_correlation
  ON notification_outbox (correlation_id);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_lock
  ON notification_outbox (status, next_attempt_at, locked_at);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_priority
  ON notification_outbox (priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_command_log_thing_time
  ON control_command_log (thing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_command_log_correlation
  ON control_command_log (correlation_id);

CREATE INDEX IF NOT EXISTS idx_control_command_log_status
  ON control_command_log (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_work_orders_thing_status
  ON maintenance_work_orders (thing_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_work_orders_correlation
  ON maintenance_work_orders (correlation_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_maintenance_open_issue
  ON maintenance_work_orders (thing_id, issue_key)
  WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS idx_system_health_history_component_time
  ON system_health_history (component, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_health_history_thing_time
  ON system_health_history (thing_id, checked_at DESC);

-- Optional helper view for dashboards and audit reviews.
CREATE OR REPLACE VIEW active_elevator_incidents AS
SELECT
  thing_id,
  MAX(time) AS last_seen_at,
  MAX(risk_score) AS peak_risk_score,
  COUNT(*) FILTER (WHERE severity = 'CRITICAL') AS critical_events,
  COUNT(*) FILTER (WHERE event_type = 'SECURITY_BREACH') AS security_breaches,
  COUNT(*) FILTER (WHERE event_type = 'ANOMALY_DETECTED') AS anomalies
FROM telemetry_raw
WHERE time >= now() - interval '24 hours'
  AND (severity IN ('WARNING', 'CRITICAL') OR risk_score >= 60)
GROUP BY thing_id;
