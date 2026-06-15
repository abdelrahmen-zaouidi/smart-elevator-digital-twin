const raw = $input.first().json || {};
const event = (raw.body && typeof raw.body === 'object' && raw.body.thing_id) ? raw.body : raw;
const payload = event.payload || {};
const cabin = payload.cabin || {};
const door = payload.door || {};
const motor = payload.motor || {};
const security = payload.security || {};
const timeline = Array.isArray(event.behavior_timeline) ? event.behavior_timeline : [];

const add = (breakdown, flags, key, points, flag) => {
  breakdown[key] = (breakdown[key] || 0) + points;
  if (flag && !flags.includes(flag)) flags.push(flag);
};

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

let score = 0;
const flags = [];
const breakdown = {};

if (door.forced_entry) add(breakdown, flags, 'forced_door_entry', 65, 'FORCED_ENTRY');
if (security.audio_distress) add(breakdown, flags, 'audio_distress', 60, 'DISTRESS_AUDIO');
if (security.rfid_last_card && security.rfid_access_granted === false) add(breakdown, flags, 'unauthorized_rfid', 25, 'UNAUTHORIZED_RFID');
if (num(security.unauthorized_access_attempts) >= 3) add(breakdown, flags, 'repeated_failed_rfid', 20, 'REPEATED_RFID_FAILURES');

const vib = num(motor.vibration_g);
const vibBaseline = Math.max(num(motor.vibration_baseline_g, 0.05), 0.001);
const vibRatio = vib / vibBaseline;
if (vibRatio >= 4) add(breakdown, flags, 'motor_vibration_critical', 35, 'CRITICAL_VIBRATION');
else if (vibRatio >= 2.5) add(breakdown, flags, 'motor_vibration_high', 22, 'HIGH_VIBRATION');
else if (vibRatio >= 1.75) add(breakdown, flags, 'motor_vibration_elevated', 10, 'ELEVATED_VIBRATION');

const motorTemp = num(motor.temperature_c);
if (motorTemp >= 90) add(breakdown, flags, 'motor_overheat', 35, 'MOTOR_OVERHEAT');
else if (motorTemp >= 75) add(breakdown, flags, 'motor_warm', 15, 'MOTOR_WARM');

const loadRatio = num(cabin.load_kg) / Math.max(num(cabin.max_load_kg, 800), 1);
if (loadRatio > 1.0) add(breakdown, flags, 'overload', 40, 'OVERLOAD');
else if (loadRatio >= 0.95) add(breakdown, flags, 'near_overload', 15, 'NEAR_OVERLOAD');

if (cabin.emergency_stop) add(breakdown, flags, 'emergency_stop', 45, 'EMERGENCY_STOP_ACTIVE');
if (cabin.between_floors && cabin.direction === 'IDLE') add(breakdown, flags, 'stuck_between_floors', 35, 'STUCK_BETWEEN_FLOORS');
if (num(cabin.speed_ms) > 0.15 && ['OPEN', 'OPENING', 'BLOCKED'].includes(String(door.state || '').toUpperCase())) {
  add(breakdown, flags, 'speed_with_open_door', 70, 'MOVING_WITH_DOOR_OPEN');
}

if (num(motor.current_draw_a) >= 45) add(breakdown, flags, 'high_current_draw', 18, 'HIGH_CURRENT_DRAW');
if (num(motor.power_kw) >= 12) add(breakdown, flags, 'high_power_usage', 14, 'HIGH_POWER_USAGE');
if (num(door.cycle_count) >= 30000) add(breakdown, flags, 'door_cycles_high', 12, 'DOOR_CYCLE_FATIGUE');
if (num(motor.hours_operated) >= 8000) add(breakdown, flags, 'overdue_service', 18, 'OVERDUE_SERVICE');
else if (num(motor.hours_operated) >= 6000) add(breakdown, flags, 'approaching_service', 8, 'APPROACHING_SERVICE');

if (timeline.length >= 5) {
  const securityEvents = timeline.filter((entry) => entry.forced_entry || entry.audio_distress).length;
  if (securityEvents >= 3) add(breakdown, flags, 'security_event_frequency', 18, 'REPEATED_SECURITY_EVENTS');

  const recentDoorCycles = timeline.filter((entry) => String(entry.door_state || '').toUpperCase() === 'OPEN').length;
  if (recentDoorCycles >= 4) add(breakdown, flags, 'rapid_door_activity', 8, 'RAPID_DOOR_CYCLES');

  const vibrations = timeline.map((entry) => num(entry.motor_vibration_g, NaN)).filter(Number.isFinite);
  if (vibrations.length >= 4) {
    const midpoint = Math.floor(vibrations.length / 2);
    const firstAvg = vibrations.slice(0, midpoint).reduce((sum, value) => sum + value, 0) / midpoint;
    const lastAvg = vibrations.slice(midpoint).reduce((sum, value) => sum + value, 0) / (vibrations.length - midpoint);
    if (firstAvg > 0 && lastAvg > firstAvg * 1.25) add(breakdown, flags, 'vibration_trend', 12, 'VIBRATION_ACCELERATING');
  }
}

const cappedScore = Math.min(100, Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)));
let severity = 'OK';
if (cappedScore >= 85 || flags.includes('MOVING_WITH_DOOR_OPEN')) severity = 'CRITICAL';
else if (cappedScore >= 60) severity = 'WARNING';
else if (cappedScore >= 30) severity = 'INFO';

const requiresHumanReview = severity === 'CRITICAL' ||
  flags.some((flag) => ['FORCED_ENTRY', 'DISTRESS_AUDIO', 'MOVING_WITH_DOOR_OPEN', 'STUCK_BETWEEN_FLOORS'].includes(flag));

return [{
  json: {
    ...event,
    risk_score: cappedScore,
    severity,
    risk_analysis: {
      risk_score: cappedScore,
      severity,
      flags,
      breakdown,
      action_required: cappedScore >= 60 || requiresHumanReview,
      requires_human_review: requiresHumanReview,
      triggered_action: { agent: 'none', command: '', priority: 'LOW', reason: [], target_floor: null },
      explanation: flags.length
        ? `Deterministic risk engine detected: ${flags.join(', ')}.`
        : 'No elevated risk indicators detected.',
      analyzed_at: new Date().toISOString()
    },
    metadata: {
      ...(event.metadata || {}),
      workflow: '02_analysis_ai_brain_agent',
      node: 'Deterministic Risk Engine'
    }
  }
}];

