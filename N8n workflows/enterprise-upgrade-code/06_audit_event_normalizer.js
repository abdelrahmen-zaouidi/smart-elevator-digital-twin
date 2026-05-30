const input = $input.first().json || {};
const now = new Date().toISOString();
const auditId = input.audit_id || `AUD-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const details = input.details || input.payload || input;

return [{
  json: {
    audit_id: auditId,
    correlation_id: input.correlation_id || details.correlation_id || `CID-AUDIT-${Date.now()}`,
    agent_name: input.agent_name || input.agent || input.agent_source || 'unknown_agent',
    workflow_name: input.workflow_name || input.metadata?.workflow || input.workflow || 'unknown_workflow',
    node_name: input.node_name || input.metadata?.node || input.node || 'unknown_node',
    event_type: input.event_type || 'AUDIT_EVENT',
    thing_id: input.thing_id || details.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator',
    action: input.action || input.command || input.triggered_action?.command || 'OBSERVE',
    trigger: input.trigger || input.reason || '',
    risk_score: Number(input.risk_score || details.risk_score || details.risk_analysis?.risk_score || 0),
    status: input.status || (input.error_message ? 'FAILED' : 'SUCCESS'),
    details,
    error_message: input.error_message || '',
    duration_ms: Number(input.duration_ms || 0),
    created_at: input.created_at || input.timestamp || now
  }
}];

