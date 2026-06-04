const event = $input.first().json;
const state = $getWorkflowStaticData('global');
const thingId = event.thing_id || 'unknown';
const key = `ingestion:${thingId}`;
const now = Date.now();

state[key] = state[key] || {
  last_duplicate_hash: null,
  behavior_timeline: [],
  ditto_failures: []
};

const memory = state[key];
const isDuplicate = !!event.duplicate_hash && memory.last_duplicate_hash === event.duplicate_hash;
memory.last_duplicate_hash = event.duplicate_hash || memory.last_duplicate_hash;

if (event.timeline_entry) {
  memory.behavior_timeline.push(event.timeline_entry);
}

const cutoff = now - 60_000;
memory.behavior_timeline = memory.behavior_timeline
  .filter((entry) => Number.isFinite(new Date(entry.ts).getTime()) && new Date(entry.ts).getTime() >= cutoff)
  .slice(-120);

const cabin = event.payload?.cabin || {};
const door = event.payload?.door || {};
const motor = event.payload?.motor || {};
const security = event.payload?.security || {};
const riskSeed = (
  (door.forced_entry ? 45 : 0) +
  (security.audio_distress ? 40 : 0) +
  (cabin.emergency_stop ? 30 : 0) +
  (motor.temperature_c > 85 ? 20 : 0) +
  (motor.vibration_g > motor.vibration_baseline_g * 2.5 ? 20 : 0)
);

state[key] = memory;

return [{
  json: {
    ...event,
    duplicate: isDuplicate,
    processing_status: isDuplicate ? 'DUPLICATE' : event.processing_status || 'RECORDED',
    risk_score: Math.min(100, riskSeed),
    behavior_timeline: memory.behavior_timeline,
    metadata: {
      ...(event.metadata || {}),
      duplicate_window_seconds: 60,
      duplicate_detected: isDuplicate
    }
  }
}];

