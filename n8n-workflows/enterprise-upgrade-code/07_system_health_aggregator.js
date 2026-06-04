const checks = $input.all().map((item) => item.json || {});
const now = new Date().toISOString();
const thingId = $env.PRIMARY_THING_ID || 'building:floor1:elevator';

const byComponent = {};
for (const check of checks) {
  const component = check.component || check.service || 'unknown';
  byComponent[component] = {
    status: check.status || (check.error ? 'DOWN' : 'UP'),
    latency_ms: Number(check.latency_ms || 0),
    error_message: check.error_message || check.error || '',
    checked_at: check.checked_at || now
  };
}

return [{
  json: {
    correlation_id: `CID-HEALTH-${Date.now()}`,
    event_id: `EVT-HEALTH-${Date.now()}`,
    thing_id: thingId,
    agent_source: '07_system_health_agent',
    event_type: 'AUDIT_EVENT',
    severity: Object.values(byComponent).some((item) => item.status === 'DOWN') ? 'WARNING' : 'INFO',
    timestamp: now,
    system_mode: 'NORMAL',
    risk_score: 0,
    payload: {
      system_health: {
        ditto: byComponent.ditto?.status || 'UNKNOWN',
        mqtt: byComponent.mqtt?.status || 'UNKNOWN',
        postgres: byComponent.postgres?.status || 'UNKNOWN',
        n8n: byComponent.n8n?.status || 'UP',
        simulator: byComponent.simulator?.status || 'UNKNOWN',
        dashboard: byComponent.dashboard?.status || 'UNKNOWN',
        last_check_at: now,
        details: byComponent
      }
    },
    risk_analysis: {},
    triggered_action: {},
    metadata: {
      workflow: '07_system_health_agent',
      node: 'Aggregate Health Status',
      schema_version: '1.0',
      source: 'scheduler'
    }
  }
}];

