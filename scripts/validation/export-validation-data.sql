-- Validation evidence query bundle for the Smart Elevator Digital Twin.
--
-- Usage from repository root:
--   PowerShell:
--     Get-Content scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
--   Windows cmd.exe:
--     type scripts\validation\export-validation-data.sql | docker exec -i elevator_db psql -U admin -d smart_building
--   Git Bash / WSL:
--     docker exec -i elevator_db psql -U admin -d smart_building < scripts/validation/export-validation-data.sql
--
-- This file does not modify data. It exports recent evidence useful for the
-- thesis validation campaign. Adjust the psql variables below when validating
-- a different elevator or a narrower time window.

\pset pager off
\pset null '[NULL]'
\set thing_id 'building:floor1:elevator'
\set lookback_interval '''24 hours'''
\set row_limit 25

\echo ''
\echo '=== Validation context ==='
SELECT
  :'thing_id' AS thing_id,
  now() AS exported_at,
  (:lookback_interval)::interval AS lookback_window;

\echo ''
\echo '=== Table availability ==='
SELECT
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'telemetry_raw',
    'audit_log',
    'notification_outbox',
    'control_command_log',
    'maintenance_work_orders',
    'system_health_history'
  )
ORDER BY table_name;

\echo ''
\echo '=== Recent telemetry records ==='
SELECT
  time,
  thing_id,
  event_id,
  event_type,
  system_mode,
  current_floor,
  target_floor,
  load_kg,
  speed_ms,
  door_state,
  forced_entry,
  audio_distress,
  motor_temp_c,
  vibration_g,
  power_kw,
  current_draw_a,
  risk_score,
  severity,
  processing_status,
  duplicate,
  correlation_id
FROM telemetry_raw
WHERE thing_id = :'thing_id'
ORDER BY time DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent security and incident telemetry ==='
SELECT
  time,
  event_type,
  severity,
  current_floor,
  door_state,
  forced_entry,
  audio_distress,
  risk_score,
  correlation_id,
  raw_payload #> '{payload,security}' AS security_payload,
  raw_payload #> '{payload,door}' AS door_payload
FROM telemetry_raw
WHERE thing_id = :'thing_id'
  AND (
    event_type IN ('SECURITY_BREACH', 'ANOMALY_DETECTED')
    OR forced_entry = true
    OR audio_distress = true
    OR severity IN ('WARNING', 'CRITICAL', 'LOCKDOWN')
    OR risk_score >= 60
  )
ORDER BY time DESC
LIMIT :row_limit;

\echo ''
\echo '=== Telemetry count per 5-minute window ==='
SELECT
  time_bucket('5 minutes', time) AS bucket,
  COUNT(*) AS telemetry_count,
  COUNT(*) FILTER (WHERE duplicate = true) AS duplicate_count,
  COUNT(*) FILTER (WHERE processing_status <> 'RECORDED') AS non_recorded_count,
  MAX(risk_score) AS max_risk_score,
  MAX(time) AS last_seen_at
FROM telemetry_raw
WHERE thing_id = :'thing_id'
  AND time >= now() - (:lookback_interval)::interval
GROUP BY time_bucket('5 minutes', time)
ORDER BY bucket DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent risk summary ==='
SELECT
  bucket,
  thing_id,
  avg_risk,
  max_risk,
  anomaly_count,
  breach_count
FROM hourly_risk
WHERE thing_id = :'thing_id'
ORDER BY bucket DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent energy and vibration summary ==='
SELECT
  bucket,
  thing_id,
  avg_power_kw,
  avg_current_a,
  avg_vibration_g
FROM hourly_energy
WHERE thing_id = :'thing_id'
ORDER BY bucket DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent command logs ==='
SELECT
  created_at,
  executed_at,
  command_id,
  correlation_id,
  thing_id,
  command,
  requested_by,
  source_agent,
  reason,
  risk_score,
  status,
  ditto_path,
  error_message,
  metadata
FROM control_command_log
WHERE thing_id = :'thing_id'
ORDER BY created_at DESC
LIMIT :row_limit;

\echo ''
\echo '=== Command rejection summary ==='
SELECT
  status,
  command,
  COUNT(*) AS command_count,
  MAX(created_at) AS last_seen_at
FROM control_command_log
WHERE thing_id = :'thing_id'
  AND created_at >= now() - (:lookback_interval)::interval
GROUP BY status, command
ORDER BY last_seen_at DESC;

\echo ''
\echo '=== Recent audit logs ==='
SELECT
  created_at,
  audit_id,
  correlation_id,
  agent_name,
  workflow_name,
  node_name,
  event_type,
  action,
  trigger,
  risk_score,
  severity,
  status,
  duration_ms,
  error_message
FROM audit_log
WHERE thing_id = :'thing_id'
ORDER BY created_at DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent notification outbox records ==='
SELECT
  created_at,
  sent_at,
  thing_id,
  severity,
  priority,
  channel,
  status,
  attempts,
  next_attempt_at,
  locked_at,
  last_error,
  dedupe_key,
  correlation_id,
  COALESCE(payload->>'title', payload->>'subject', payload->>'compact') AS title_or_summary
FROM notification_outbox
WHERE thing_id = :'thing_id'
ORDER BY created_at DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent maintenance work orders ==='
SELECT
  created_at,
  closed_at,
  work_order_id,
  correlation_id,
  thing_id,
  issue_key,
  priority,
  wear_index,
  estimated_failure_days,
  status,
  tasks,
  evidence
FROM maintenance_work_orders
WHERE thing_id = :'thing_id'
ORDER BY created_at DESC
LIMIT :row_limit;

\echo ''
\echo '=== Recent system health history ==='
SELECT
  checked_at,
  correlation_id,
  thing_id,
  component,
  status,
  latency_ms,
  error_message,
  details
FROM system_health_history
WHERE thing_id = :'thing_id'
ORDER BY checked_at DESC
LIMIT :row_limit;

\echo ''
\echo '=== Maximum risk score per correlation ID ==='
SELECT
  correlation_id,
  MIN(time) AS first_seen_at,
  MAX(time) AS last_seen_at,
  COUNT(*) AS telemetry_count,
  MAX(risk_score) AS max_risk_score,
  STRING_AGG(DISTINCT event_type, ', ' ORDER BY event_type) AS event_types,
  STRING_AGG(DISTINCT severity, ', ' ORDER BY severity) AS severities
FROM telemetry_raw
WHERE thing_id = :'thing_id'
  AND correlation_id IS NOT NULL
  AND time >= now() - (:lookback_interval)::interval
GROUP BY correlation_id
ORDER BY last_seen_at DESC
LIMIT :row_limit;

\echo ''
\echo '=== Latest elevator state from telemetry_raw ==='
SELECT
  time,
  thing_id,
  system_mode,
  current_floor,
  target_floor,
  load_kg,
  speed_ms,
  door_state,
  forced_entry,
  audio_distress,
  motor_temp_c,
  vibration_g,
  power_kw,
  current_draw_a,
  risk_score,
  severity,
  raw_payload->'metadata' AS metadata,
  raw_payload->'risk_analysis' AS risk_analysis
FROM telemetry_raw
WHERE thing_id = :'thing_id'
ORDER BY time DESC
LIMIT 1;

\echo ''
\echo '=== Active elevator incidents view ==='
SELECT *
FROM active_elevator_incidents
WHERE thing_id = :'thing_id';

\echo ''
\echo '=== Dashboard API backing table row counts ==='
SELECT 'telemetry_raw' AS source, COUNT(*) AS rows_for_thing FROM telemetry_raw WHERE thing_id = :'thing_id'
UNION ALL
SELECT 'audit_log', COUNT(*) FROM audit_log WHERE thing_id = :'thing_id'
UNION ALL
SELECT 'notification_outbox', COUNT(*) FROM notification_outbox WHERE thing_id = :'thing_id'
UNION ALL
SELECT 'control_command_log', COUNT(*) FROM control_command_log WHERE thing_id = :'thing_id'
UNION ALL
SELECT 'maintenance_work_orders', COUNT(*) FROM maintenance_work_orders WHERE thing_id = :'thing_id'
UNION ALL
SELECT 'system_health_history', COUNT(*) FROM system_health_history WHERE thing_id = :'thing_id'
ORDER BY source;
