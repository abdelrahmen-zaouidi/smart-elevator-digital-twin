const rawEvent = $input.first().json || {};
const event = (rawEvent.body && typeof rawEvent.body === 'object' && rawEvent.body.thing_id) ? rawEvent.body : rawEvent;
const payload = event.payload || {};
const security = payload.security || {};
const door = payload.door || {};
const cabin = payload.cabin || {};
const thingId = event.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator';
const now = Date.now();
const nowIso = new Date(now).toISOString();
const windowMs = Number($env.RFID_FAILURE_WINDOW_MINUTES || 5) * 60 * 1000;
const threshold = Number($env.RFID_BLACKLIST_THRESHOLD || 3);

const state = $getWorkflowStaticData('global');
const key = `security:${thingId}`;
state[key] = state[key] || {
  rfid_failures: {},
  blacklisted_cards: [],
  active_incidents: []
};

const memory = state[key];
const card = security.rfid_last_card || '';

if (card && security.rfid_access_granted === false) {
  const attempts = memory.rfid_failures[card] || [];
  attempts.push(now);
  memory.rfid_failures[card] = attempts.filter((ts) => now - ts <= windowMs);
}

for (const knownCard of Object.keys(memory.rfid_failures)) {
  memory.rfid_failures[knownCard] = memory.rfid_failures[knownCard].filter((ts) => now - ts <= windowMs);
  if (memory.rfid_failures[knownCard].length === 0) delete memory.rfid_failures[knownCard];
}

const repeatedCards = Object.keys(memory.rfid_failures)
  .filter((knownCard) => memory.rfid_failures[knownCard].length >= threshold);

memory.blacklisted_cards = Array.from(new Set([...(memory.blacklisted_cards || []), ...repeatedCards]));

const combined = [];
if (door.forced_entry && security.audio_distress) combined.push('FORCED_DOOR_AUDIO_DISTRESS');
if (door.forced_entry && String(cabin.direction || 'IDLE') !== 'IDLE') combined.push('FORCED_DOOR_WHILE_MOVING');
if (door.forced_entry && security.rfid_access_granted === false) combined.push('RFID_DENIED_FORCED_DOOR');
if (repeatedCards.length > 0) combined.push('REPEATED_ACCESS_ATTEMPTS');

let securityState = 'NORMAL';
let alertLevel = 'NORMAL';
let severity = 'INFO';
const actions = [];
const recommendation = [];

if (combined.some((item) => ['FORCED_DOOR_AUDIO_DISTRESS', 'FORCED_DOOR_WHILE_MOVING'].includes(item))) {
  securityState = 'LOCKDOWN';
  alertLevel = 'CRITICAL';
  severity = 'CRITICAL';
  actions.push({ agent: 'control', command: 'LOCKDOWN', priority: 'CRITICAL', reason: combined });
  recommendation.push('Immediate operator review and physical security inspection required.');
} else if (door.forced_entry || security.audio_distress) {
  securityState = 'HUMAN_REVIEW_REQUIRED';
  alertLevel = 'CRITICAL';
  severity = 'CRITICAL';
  actions.push({ agent: 'control', command: 'LOCKDOWN', priority: 'CRITICAL', reason: [door.forced_entry ? 'FORCED_ENTRY' : 'DISTRESS_AUDIO'] });
  recommendation.push('Lockdown recommended until the incident is acknowledged.');
} else if (combined.length > 0) {
  securityState = 'SUSPICIOUS';
  alertLevel = 'WARNING';
  severity = 'WARNING';
  recommendation.push('Monitor access attempts and verify RFID credential ownership.');
} else if (card && security.rfid_access_granted === false) {
  securityState = 'WATCH';
  alertLevel = 'WATCH';
  recommendation.push('Single denied RFID attempt observed.');
}

const activeSecurityIncident = ['LOCKDOWN', 'HUMAN_REVIEW_REQUIRED', 'SUSPICIOUS'].includes(securityState);
if (activeSecurityIncident) {
  memory.active_incidents.push({
    correlation_id: event.correlation_id,
    state: securityState,
    combined,
    observed_at: nowIso
  });
  memory.active_incidents = memory.active_incidents.slice(-50);
}

state[key] = memory;

return [{
  json: {
    ...event,
    severity: severity === 'CRITICAL' ? 'CRITICAL' : event.severity || severity,
    security_analysis: {
      state: securityState,
      alert_level: alertLevel,
      severity,
      blacklisted_cards: memory.blacklisted_cards,
      repeated_cards: repeatedCards,
      combined_events: combined,
      active_security_incident: activeSecurityIncident,
      human_review_required: securityState === 'HUMAN_REVIEW_REQUIRED',
      security_recommendation: recommendation.join(' '),
      actions,
      analyzed_at: nowIso
    },
    metadata: {
      ...(event.metadata || {}),
      workflow: '04_security_maintenance_agents',
      node: 'Security State Machine',
      schema_version: '1.0'
    }
  }
}];

