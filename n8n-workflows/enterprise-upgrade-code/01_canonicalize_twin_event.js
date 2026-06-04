const body = $input.first().json || {};
const now = new Date();
const timestamp = now.toISOString();

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashText = (text) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const numberOr = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const boolOr = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
};

if (!body || typeof body !== 'object' || (!body.thingId && !body.features)) {
  const correlationId = `CID-DITTO-INVALID-${now.getTime()}`;
  return [{
    json: {
      correlation_id: correlationId,
      event_id: `EVT-DITTO-INVALID-${now.getTime()}`,
      thing_id: $env.PRIMARY_THING_ID || 'building:floor1:elevator',
      agent_source: '01_ingestion_surveillance_agent',
      event_type: 'AUDIT_EVENT',
      severity: 'WARNING',
      timestamp,
      system_mode: 'DEGRADED',
      risk_score: 0,
      payload: {
        health: {
          component: 'ditto',
          status: 'DEGRADED',
          reason: 'INVALID_DITTO_RESPONSE'
        }
      },
      risk_analysis: {},
      triggered_action: {},
      metadata: {
        workflow: '01_ingestion_surveillance_agent',
        node: 'Canonicalize Twin Event',
        schema_version: '1.0',
        source: 'ditto_poll'
      },
      raw_thing: body,
      duplicate_hash: hashText(stableStringify(body)),
      duplicate: false,
      processing_status: 'INVALID_DITTO_RESPONSE'
    }
  }];
}

const features = body.features || {};
const attributes = body.attributes || {};
const cabinRaw = features.cabin?.properties || {};
const doorRaw = features.door?.properties || {};
const motorRaw = features.motor?.properties || {};
const securityRaw = features.security?.properties || {};
const thingId = body.thingId || attributes.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator';
const thingToken = thingId.replace(/[^a-zA-Z0-9]/g, '-');
const correlationId = body.correlation_id || attributes.correlation_id || `CID-${thingToken}-${now.getTime()}`;

const cabin = {
  current_floor: numberOr(cabinRaw.current_floor, 0),
  target_floor: numberOr(cabinRaw.target_floor ?? cabinRaw.current_floor, 0),
  direction: cabinRaw.direction || 'IDLE',
  load_kg: numberOr(cabinRaw.load_kg ?? cabinRaw.payload_weight_kg, 0),
  max_load_kg: numberOr(cabinRaw.max_load_kg, 800),
  speed_ms: numberOr(cabinRaw.speed_ms, 0),
  temperature_c: numberOr(cabinRaw.temperature_c, 22),
  emergency_stop: boolOr(cabinRaw.emergency_stop, false),
  between_floors: boolOr(cabinRaw.between_floors, false)
};

const door = {
  state: doorRaw.state || 'UNKNOWN',
  forced_entry: boolOr(doorRaw.forced_entry ?? doorRaw.door_forced_entry, false),
  cycle_count: numberOr(doorRaw.cycle_count, 0),
  force_sensor_n: numberOr(doorRaw.force_sensor_n, 0),
  blocked: boolOr(doorRaw.blocked, false)
};

const motor = {
  vibration_g: numberOr(motorRaw.vibration_g ?? motorRaw.vibration_level ?? motorRaw.vibration_ms2, 0),
  vibration_baseline_g: numberOr(motorRaw.vibration_baseline_g ?? motorRaw.vibration_baseline_ms2, 0.05),
  temperature_c: numberOr(motorRaw.temperature_c, 0),
  hours_operated: numberOr(motorRaw.hours_operated ?? motorRaw.run_hours, 0),
  current_draw_a: numberOr(motorRaw.current_draw_a, 0),
  power_kw: numberOr(motorRaw.power_kw, 0),
  health_status: motorRaw.health_status || 'UNKNOWN'
};

const security = {
  audio_distress: boolOr(securityRaw.audio_distress_active ?? securityRaw.audio_distress_detected, false),
  rfid_last_card: securityRaw.rfid_last_card || '',
  rfid_access_granted: boolOr(securityRaw.rfid_access_granted, true),
  unauthorized_access_attempts: numberOr(securityRaw.unauthorized_access_attempts, 0),
  alert_level: securityRaw.alert_level || 'NORMAL',
  state: securityRaw.state || 'NORMAL'
};

let eventType = 'TELEMETRY_UPDATE';
let severity = 'INFO';
if (door.forced_entry || security.audio_distress) {
  eventType = 'SECURITY_BREACH';
  severity = 'CRITICAL';
} else if (motor.vibration_g > motor.vibration_baseline_g * 2.5 || motor.temperature_c > 85 || cabin.emergency_stop) {
  eventType = 'ANOMALY_DETECTED';
  severity = 'WARNING';
}

const payload = { cabin, door, motor, security };
const duplicateHash = hashText(stableStringify({
  thing_id: thingId,
  system_mode: attributes.system_mode || 'NORMAL',
  payload
}));

return [{
  json: {
    correlation_id: correlationId,
    event_id: `EVT-${thingToken}-${now.getTime()}`,
    thing_id: thingId,
    agent_source: '01_ingestion_surveillance_agent',
    event_type: eventType,
    severity,
    timestamp,
    system_mode: attributes.system_mode || 'NORMAL',
    risk_score: 0,
    payload,
    risk_analysis: {},
    triggered_action: {},
    metadata: {
      workflow: '01_ingestion_surveillance_agent',
      node: 'Canonicalize Twin Event',
      schema_version: '1.0',
      source: 'ditto_poll'
    },
    timeline_entry: {
      ts: timestamp,
      floor: cabin.current_floor,
      direction: cabin.direction,
      load_kg: cabin.load_kg,
      door_state: door.state,
      motor_temp_c: motor.temperature_c,
      motor_vibration_g: motor.vibration_g,
      power_kw: motor.power_kw,
      forced_entry: door.forced_entry,
      audio_distress: security.audio_distress,
      emergency_stop: cabin.emergency_stop
    },
    raw_thing: body,
    duplicate_hash: duplicateHash,
    duplicate: false,
    processing_status: 'RECORDED'
  }
}];

