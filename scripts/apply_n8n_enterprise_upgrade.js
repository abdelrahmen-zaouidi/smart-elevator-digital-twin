const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workflowsDir = path.join(root, 'workflows/n8n');
const codeDir = path.join(workflowsDir, 'enterprise-upgrade-code');

const readCode = (name) => fs.readFileSync(path.join(codeDir, name), 'utf8').replace(/^\uFEFF/, '');

const ditto = (suffix) =>
  `={{ ($env.DITTO_BASE_URL || 'http://docker-nginx-1') + ${suffix} }}`;

const maintenanceEngineOutput = "$('Predictive Maintenance Engine').item.json";

const workflowPath = (file) => path.join(workflowsDir, file);

const updateWorkflow = (file, updateNode) => {
  const filePath = workflowPath(file);
  const wf = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  for (const node of wf.nodes) {
    updateNode(node);

    if (node.type === 'n8n-nodes-base.httpRequest') {
      node.retryOnFail = true;
      node.maxTries = 3;
      node.waitBetweenTries = 1000;
      node.parameters.options = node.parameters.options || {};
      node.parameters.options.timeout = node.parameters.options.timeout || 5000;
    }
  }

  fs.writeFileSync(filePath, `${JSON.stringify(wf, null, 2)}\n`, 'utf8');
};

updateWorkflow('01_ingestion_surveillance_agent.json', (node) => {
  if (node.name === 'Canonicalize Twin Event') node.parameters.jsCode = readCode('01_canonicalize_twin_event.js');
  if (node.name === 'Dedupe & Update Timeline') node.parameters.jsCode = readCode('01_dedupe_update_timeline.js');
  if (node.name === 'Prepare DB Row') node.parameters.jsCode = readCode('01_prepare_telemetry_params.js');
  if (node.name === 'Archive Telemetry to Postgres') {
    node.parameters.query = '{{ $json._db_query }}';
    node.parameters.options = node.parameters.options || {};
    node.parameters.options.queryReplacement = '={{ $json._db_params }}';
  }
  if (node.name === 'GET Current Thing from Ditto') {
    node.parameters.url = ditto("'/api/2/things/' + ($env.PRIMARY_THING_ID || 'building:floor1:elevator')");
  }
});

updateWorkflow('02_analysis_ai_brain_agent.json', (node) => {
  if (node.name === 'LLM Context Analyzer') node.parameters.jsCode = readCode('02_ollama_context_analyzer.js');
  if (node.name === 'Deterministic Risk Engine') node.parameters.jsCode = readCode('02_deterministic_risk_engine.js');
  if (node.name === 'Action Router') node.parameters.jsCode = readCode('02_action_router.js');
  if (node.name === 'Finalize Risk Analysis') node.parameters.jsCode = readCode('02_finalize_risk_analysis.js');
  if (node.name === 'Write Risk Score to Ditto') {
    node.parameters.url = ditto("'/api/2/things/' + $json.thing_id + '/attributes/risk_score'");
  }
  if (node.name === 'Write AI Analysis to Ditto') {
    node.parameters.url = ditto("'/api/2/things/' + $json.thing_id + '/features/ai_analysis/properties'");
    // Ditto PUT to /features/{id}/properties expects the properties object directly
    // (no { properties: {...} } wrapper). The dashboard reads
    // state.features.ai_analysis.properties; wrapping again would nest under
    // .properties.properties and the dashboard would never see the fields.
    node.parameters.jsonBody = "={{ JSON.stringify({ analyzed_at: $json.risk_analysis.analyzed_at, severity: $json.risk_analysis.severity, risk_score: $json.risk_analysis.risk_score, flags: $json.risk_analysis.flags, llm_analysis: $json.llm_analysis, recommended_action: ($json.risk_analysis.triggered_action && $json.risk_analysis.triggered_action.command) || '', explanation: $json.risk_analysis.explanation, requires_human_review: $json.risk_analysis.requires_human_review, source: 'n8n', updated_at: $json.risk_analysis.analyzed_at }) }}";
  }
});

updateWorkflow('03_control_agent.json', (node) => {
  if (node.name === 'Build Control Command' || node.name === 'Control Safety Gate') {
    node.name = 'Control Safety Gate';
    node.parameters.jsCode = readCode('03_control_safety_gate.js');
  }
  if (node.name === 'Explode Ditto Writes') node.parameters.jsCode = readCode('03_explode_ditto_writes.js');
  if (node.name === 'PUT Desired State to Ditto') {
    node.parameters.url = ditto("'/api/2/things/' + $json.thing_id + '/' + $json.path");
  }
});

updateWorkflow('04_security_maintenance_agents.json', (node) => {
  if (node.name === 'Security State Machine') node.parameters.jsCode = readCode('04_security_state_machine.js');
  if (node.name === 'Predictive Maintenance Engine') node.parameters.jsCode = readCode('04_predictive_maintenance_engine.js');
  if (node.name === 'Write Security State to Ditto') {
    node.parameters.url = ditto("'/api/2/things/' + $json.thing_id + '/features/security/properties'");
    node.parameters.jsonBody = "={{ JSON.stringify({ ...($json.payload.security || {}), state: $json.security_analysis.state, alert_level: $json.security_analysis.alert_level, blacklisted_cards: $json.security_analysis.blacklisted_cards, last_review_at: $json.security_analysis.analyzed_at, active_security_incident: $json.security_analysis.active_security_incident, security_recommendation: $json.security_analysis.security_recommendation }) }}";
  }
  if (node.name === 'GET Current Thing for Maintenance') {
    node.parameters.url = ditto("'/api/2/things/' + ($env.PRIMARY_THING_ID || 'building:floor1:elevator')");
  }
  if (node.name === 'Write Maintenance Schedule to Ditto') {
    node.parameters.url = ditto(`'/api/2/things/' + ${maintenanceEngineOutput}.work_order.thing_id + '/features/maintenance_schedule'`);
    node.parameters.sendHeaders = true;
    node.parameters.headerParameters = {
      parameters: [
        { name: 'accept', value: 'application/json' },
        { name: 'content-type', value: 'application/json' },
      ],
    };
    node.parameters.jsonBody = `={{ JSON.stringify({ properties: { work_order_id: ${maintenanceEngineOutput}.work_order?.work_order_id, priority: ${maintenanceEngineOutput}.work_order?.priority, wear_index: ${maintenanceEngineOutput}.work_order?.wear_index, estimated_failure_days: ${maintenanceEngineOutput}.work_order?.estimated_failure_days, next_service_date: ${maintenanceEngineOutput}.work_order?.next_service_date, tasks: ${maintenanceEngineOutput}.work_order?.tasks, generated_at: ${maintenanceEngineOutput}.work_order?.generated_at } }) }}`;
  }
  if (node.name === 'Ensure Maintenance Feature Exists') {
    node.parameters.url = ditto("'/api/2/things/' + $json.work_order.thing_id + '/features/maintenance_schedule'");
    node.parameters.sendHeaders = true;
    node.parameters.headerParameters = {
      parameters: [
        { name: 'accept', value: 'application/json' },
        { name: 'content-type', value: 'application/json' },
      ],
    };
    node.parameters.jsonBody = '={{ JSON.stringify({ properties: {} }) }}';
  }
  if (node.name === 'Route: Notify Maintenance?') {
    node.parameters.conditions = {
      boolean: [
        {
          value1: `={{ ${maintenanceEngineOutput}.work_order.notify_required }}`,
          value2: true,
        },
      ],
    };
  }
  if (node.name === 'Queue Maintenance Notification') {
    node.parameters.jsonBody = `={{ JSON.stringify({ thing_id: ${maintenanceEngineOutput}.work_order.thing_id, severity: 'WARNING', work_order: ${maintenanceEngineOutput}.work_order, event: ${maintenanceEngineOutput}, title: 'Predictive maintenance required', message: 'Priority ' + ${maintenanceEngineOutput}.work_order.priority + ' work order for ' + ${maintenanceEngineOutput}.work_order.thing_id }) }}`;
  }
});

updateWorkflow('05_notification_agent.json', (node) => {
  if (node.name === 'Build Notification Outbox Rows') node.parameters.jsCode = readCode('05_build_notification_outbox_rows.js');
  if (node.name === 'Format Delivery Payload') node.parameters.jsCode = readCode('05_format_delivery_payload.js');
  if (node.name === 'Route Telegram') {
    node.parameters.conditions = {
      string: [
        { value1: '={{ $json.channel }}', value2: 'telegram' },
        { value1: '={{ $json.delivery?.telegramChatId || "" }}', operation: 'isNotEmpty' },
      ],
    };
  }
  if (node.name === 'Route Email') {
    node.parameters.conditions = {
      string: [
        { value1: '={{ $json.channel }}', value2: 'email' },
        { value1: '={{ $json.delivery?.emailTo || "" }}', operation: 'isNotEmpty' },
      ],
    };
  }
  if (node.name === 'Route SMS') {
    node.parameters.conditions = {
      string: [
        { value1: '={{ $json.channel }}', value2: 'sms' },
        { value1: '={{ $json.delivery?.smsWebhookUrl || "" }}', operation: 'isNotEmpty' },
        { value1: '={{ $json.delivery?.alertPhone || "" }}', operation: 'isNotEmpty' },
      ],
    };
  }
  if (node.name === 'Route Voice') {
    node.parameters.conditions = {
      string: [
        { value1: '={{ $json.channel }}', value2: 'voice' },
        { value1: '={{ $json.delivery?.voiceWebhookUrl || "" }}', operation: 'isNotEmpty' },
        { value1: '={{ $json.delivery?.alertPhone || "" }}', operation: 'isNotEmpty' },
      ],
    };
  }
  if (node.name === 'Send Telegram') {
    node.parameters.chatId = '={{ $json.delivery.telegramChatId }}';
  }
  if (node.name === 'Send Email') {
    node.parameters.fromEmail = '={{ $json.delivery.emailFrom }}';
    node.parameters.toEmail = '={{ $json.delivery.emailTo }}';
    node.parameters.subject = '={{ $json.formatted.emailSubject }}';
    node.parameters.text = '={{ $json.formatted.sms }}';
    node.parameters.html = '={{ $json.formatted.emailHtml }}';
  }
  if (node.name === 'Send SMS') {
    node.parameters.url = '={{ $json.delivery.smsWebhookUrl }}';
    node.parameters.jsonBody = '={{ JSON.stringify({ to: $json.delivery.alertPhone, message: $json.formatted.sms }) }}';
  }
  if (node.name === 'Send Voice Escalation') {
    node.parameters.url = '={{ $json.delivery.voiceWebhookUrl }}';
    node.parameters.jsonBody = '={{ JSON.stringify({ to: $json.delivery.alertPhone, title: $json.payload.title, message: $json.formatted.voice || $json.formatted.sms }) }}';
  }
  if (node.name === 'Insert Notification Outbox Row') {
    node.parameters.query = "INSERT INTO notification_outbox (correlation_id, thing_id, severity, priority, channel, dedupe_key, payload, status, next_attempt_at, attempts, max_attempts, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($9::text,'PENDING'),NOW(),0,$8,CASE WHEN COALESCE($9::text,'PENDING') = 'SENT' THEN NOW() ELSE NULL END) ON CONFLICT (dedupe_key) DO NOTHING;";
    node.parameters.options = node.parameters.options || {};
    node.parameters.options.queryReplacement = "={{ [$json.correlation_id, $json.thing_id, $json.severity, $json.priority || 'MEDIUM', $json.channel, $json.dedupe_key, JSON.stringify($json.payload || {}), $json.max_attempts || 5, $json.status || 'PENDING'] }}";
  }
  if (node.name === 'Claim Due Notifications') {
    node.parameters.query = "UPDATE notification_outbox o SET status = 'SENDING', locked_at = NOW(), attempts = attempts + 1 WHERE o.id IN (SELECT id FROM notification_outbox WHERE status IN ('PENDING','RETRY') AND channel <> 'dashboard' AND next_attempt_at <= NOW() AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes') ORDER BY priority DESC, created_at LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING o.id, o.correlation_id, o.thing_id, o.severity, o.priority, o.channel, o.payload, o.attempts, o.max_attempts, o.escalation_level;";
  }
  if (node.name === 'Mark Notification Sent') {
    node.parameters.query = "UPDATE notification_outbox SET status = 'SENT', sent_at = NOW(), locked_at = NULL, last_error = NULL WHERE id = $1;";
    node.parameters.options = node.parameters.options || {};
    node.parameters.options.queryReplacement = '={{ [$json.id] }}';
  }
});

updateWorkflow('06_optimization_audit_agents.json', (node) => {
  if (node.name === 'Energy Optimization Engine') node.parameters.jsCode = readCode('06_energy_optimization_engine.js');
  if (node.name === 'GET Current Thing for Dispatch') {
    node.parameters.url = ditto("'/api/2/things/' + ($env.PRIMARY_THING_ID || 'building:floor1:elevator')");
  }
  if (node.name === 'GET Current Thing for Energy') {
    node.parameters.url = ditto("'/api/2/things/' + ($env.PRIMARY_THING_ID || 'building:floor1:elevator')");
  }
  if (node.name === 'Query Demand Floor') {
    node.parameters.options = node.parameters.options || {};
    node.parameters.options.queryReplacement = "={{ [$json.thing_id || $json.thingId || $env.PRIMARY_THING_ID || 'building:floor1:elevator', $json.current_floor || 0, $json.system_mode || 'NORMAL', $json.risk_score || 0, $json.direction || 'NONE', $json.door_state || 'CLOSED', $json.current_hour || new Date().getHours(), $json.weekday || new Date().getDay()] }}";
  }
  if (node.name === 'Query Energy Baseline') {
    node.parameters.options = node.parameters.options || {};
    node.parameters.options.queryReplacement = "={{ [$json.thing_id || $json.thingId || $env.PRIMARY_THING_ID || 'building:floor1:elevator', $json.power_kw || 0, $json.current_draw_a || 0, $json.vibration_g || 0, $json.system_mode || 'NORMAL', $json.load_kg || 0] }}";
  }
  if (node.name === 'Send Compliance Email') {
    // Avoid hardcoded personal addresses; resolve from container env so deployments
    // can override via .env without editing workflow JSON.
    node.parameters.fromEmail = "={{ $env.EMAIL_FROM || 'elevator-alerts@localhost' }}";
    node.parameters.toEmail = "={{ $env.EMAIL_TO || 'operator@localhost' }}";
  }
  if (node.name === 'Insert Audit Log') {
    node.parameters.query = "INSERT INTO audit_log (audit_id, correlation_id, created_at, agent_name, workflow_name, node_name, event_type, thing_id, action, trigger, risk_score, status, details, error_message, duration_ms) VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15) ON CONFLICT (audit_id) DO NOTHING;";
    node.parameters.options = node.parameters.options || {};
    node.parameters.options.queryReplacement = "={{ [$json.audit_id || `AUD-${Date.now()}`, $json.correlation_id || $json.details?.correlation_id || `CID-AUDIT-${Date.now()}`, $json.created_at || $json.timestamp || new Date().toISOString(), $json.agent_name || $json.agent || 'unknown_agent', $json.workflow_name || $json.workflow || $json.metadata?.workflow || 'unknown_workflow', $json.node_name || $json.node || $json.metadata?.node || 'unknown_node', $json.event_type || 'AUDIT_EVENT', $json.thing_id || $json.details?.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator', $json.action || $json.command || 'OBSERVE', $json.trigger || '', Number($json.risk_score || $json.details?.risk_score || 0), $json.status || ($json.error_message ? 'FAILED' : 'SUCCESS'), JSON.stringify($json.details || $json), $json.error_message || '', Number($json.duration_ms || 0)] }}";
  }
});

const controlPath = workflowPath('03_control_agent.json');
const controlWf = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
if (controlWf.connections['Build Control Command']) {
  controlWf.connections['Control Safety Gate'] = controlWf.connections['Build Control Command'];
  delete controlWf.connections['Build Control Command'];
}
for (const connection of Object.values(controlWf.connections)) {
  for (const outputs of Object.values(connection)) {
    for (const output of outputs) {
      for (const link of output) {
        if (link.node === 'Build Control Command') link.node = 'Control Safety Gate';
      }
    }
  }
}
fs.writeFileSync(controlPath, `${JSON.stringify(controlWf, null, 2)}\n`, 'utf8');

console.log('Applied enterprise n8n workflow upgrades.');

