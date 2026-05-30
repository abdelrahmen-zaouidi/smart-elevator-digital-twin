const event = $input.first().json;
const p = event.payload || {};
const c = p.cabin || {};
const d = p.door || {};
const m = p.motor || {};
const s = p.security || {};

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const b = (value) => value === true || value === 'true' || value === 1 || value === '1';

event._db_query = `
INSERT INTO telemetry_raw (
  time, thing_id, event_id, event_type, system_mode,
  current_floor, target_floor, load_kg, speed_ms, door_state,
  forced_entry, audio_distress, motor_temp_c, vibration_g,
  power_kw, current_draw_a, hours_operated, risk_score, raw_payload,
  correlation_id, duplicate_hash, source, schema_version,
  processing_status, duplicate, agent_source, severity, metadata
) VALUES (
  $1::timestamptz, $2, $3, $4, $5,
  $6::smallint, $7::smallint, $8::real, $9::real, $10,
  $11::boolean, $12::boolean, $13::real, $14::real,
  $15::real, $16::real, $17::real, $18::smallint, $19::jsonb,
  $20, $21, $22, $23,
  $24, $25::boolean, $26, $27, $28::jsonb
) ON CONFLICT (event_id) DO UPDATE SET
  processing_status = EXCLUDED.processing_status,
  duplicate = EXCLUDED.duplicate,
  metadata = telemetry_raw.metadata || EXCLUDED.metadata;
`;

event._db_params = [
  event.timestamp || new Date().toISOString(),
  event.thing_id,
  event.event_id,
  event.event_type,
  event.system_mode || 'NORMAL',
  n(c.current_floor),
  n(c.target_floor),
  n(c.load_kg),
  n(c.speed_ms),
  d.state || 'UNKNOWN',
  b(d.forced_entry),
  b(s.audio_distress),
  n(m.temperature_c),
  n(m.vibration_g),
  n(m.power_kw),
  n(m.current_draw_a),
  n(m.hours_operated),
  n(event.risk_score || event.risk_analysis?.risk_score || 0),
  JSON.stringify(event),
  event.correlation_id,
  event.duplicate_hash,
  event.metadata?.source || 'ditto_poll',
  event.metadata?.schema_version || '1.0',
  event.processing_status || 'RECORDED',
  b(event.duplicate),
  event.agent_source || '01_ingestion_surveillance_agent',
  event.severity || 'INFO',
  JSON.stringify(event.metadata || {})
];

return [{ json: event }];

