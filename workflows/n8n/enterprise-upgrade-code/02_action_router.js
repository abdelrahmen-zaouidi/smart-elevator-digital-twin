const event = $input.first().json || {};
const analysis = event.risk_analysis || {};
const flags = analysis.flags || [];
const actions = [];

const pushAction = (agent, command, priority, reason, extra = {}) => {
  actions.push({
    agent,
    command,
    priority,
    reason,
    target_floor: extra.target_floor ?? null,
    correlation_id: event.correlation_id,
    risk_score: analysis.risk_score || event.risk_score || 0,
    issued_at: new Date().toISOString(),
    requires_human_review: !!analysis.requires_human_review,
    ...extra
  });
};

if (flags.includes('MOVING_WITH_DOOR_OPEN') || flags.includes('STUCK_BETWEEN_FLOORS')) {
  pushAction('control', 'EMERGENCY_STOP', 'CRITICAL', flags);
}

if (flags.some((flag) => ['FORCED_ENTRY', 'DISTRESS_AUDIO', 'REPEATED_SECURITY_EVENTS'].includes(flag))) {
  pushAction('security', 'ESCALATE_SECURITY_STATE', 'CRITICAL', flags);
  pushAction('control', 'LOCKDOWN', 'CRITICAL', flags);
}

if (flags.includes('OVERLOAD')) {
  pushAction('control', 'RESTRICT_LOAD', 'HIGH', flags);
}

if (flags.some((flag) => [
  'CRITICAL_VIBRATION',
  'HIGH_VIBRATION',
  'MOTOR_OVERHEAT',
  'MOTOR_WARM',
  'HIGH_CURRENT_DRAW',
  'HIGH_POWER_USAGE',
  'OVERDUE_SERVICE',
  'APPROACHING_SERVICE',
  'VIBRATION_ACCELERATING',
  'DOOR_CYCLE_FATIGUE'
].includes(flag))) {
  pushAction('maintenance', 'CREATE_WORK_ORDER', analysis.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH', flags);
}

if (actions.length === 0) {
  return [{
    json: {
      ...event,
      triggered_action: {
        agent: 'none',
        command: '',
        priority: 'LOW',
        reason: [],
        target_floor: null
      }
    }
  }];
}

return actions.map((triggered_action) => ({
  json: {
    ...event,
    triggered_action
  }
}));

