/**
 * N8n control safety gate — Code node script.
 *
 * Kept self-contained (n8n Code nodes cannot require external modules).
 * The rule SET in this file is intentionally aligned with the canonical
 * packages/shared/commandSafetyGate.js module, so a command rejected by
 * one gate would be rejected by the other.
 *
 * The dashboard now routes commands through its own POST /api/commands
 * gate; this n8n gate remains the enforcement point for n8n-originated
 * commands (the analysis agent's risk-triggered actions). Both gates write
 * to the same control_command_log table.
 *
 * SAFETY PRINCIPLE: the LLM is non-authoritative. Risk explanations may
 * be LLM-generated, but command admission is purely rule-based.
 */

const rawInput = $input.first().json || {};
const input = (rawInput.body && typeof rawInput.body === 'object' && (rawInput.body.triggered_action || rawInput.body.control_command)) ? rawInput.body : rawInput;
const action = input.triggered_action || input.control_command || {};
const payload = input.payload || {};
const cabin = payload.cabin || {};
const door = payload.door || {};
const security = payload.security || {};
const maintenance = payload.maintenance || {};
const now = new Date().toISOString();
const nowMs = Date.now();

// -----------------------------------------------------------------------------
// Config (env-driven, with defaults matching the canonical module).
// -----------------------------------------------------------------------------
const minFloor                = Number($env.MIN_FLOOR ?? 0);
const maxFloor                = Number($env.MAX_FLOOR ?? 3);
const groundFloor             = Number($env.GROUND_FLOOR ?? 0);
const maxRiskAutoControl      = Number($env.MAX_RISK_AUTO_CONTROL ?? 70);
const maxRiskOperatorControl  = Number($env.MAX_RISK_OPERATOR_CONTROL ?? 85);
const maxTwinAgeSeconds       = Number($env.MAX_TWIN_AGE_SECONDS ?? 10);
const requireReason           = String($env.COMMAND_REQUIRE_REASON ?? 'true').toLowerCase() === 'true';

const thingId = input.thing_id || action.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator';
const rawCommand = String(action.command || '').toUpperCase();
const riskScore = Number(action.risk_score ?? input.risk_analysis?.risk_score ?? input.risk_score ?? 0);
const sourceAgent = action.source_agent || input.agent_source || input.metadata?.workflow || null;
const providedSource = String(action.source || 'n8n').toLowerCase();
const reasonInput = Array.isArray(action.reason) ? action.reason
                  : (action.reason ? [action.reason] : []);
const reason = reasonInput.map((r) => String(r).trim()).filter(Boolean);
// Coalesce repeated identical autonomous commands within a short window onto a
// single command_id, so a sustained condition UPDATEs one control_command_log
// row (via ON CONFLICT) instead of inserting a new row + Ditto write every tick.
const coalesceSeconds = Number($env.COMMAND_COALESCE_SECONDS ?? 30);
const coalesceBucket = coalesceSeconds > 0 ? Math.floor(nowMs / (coalesceSeconds * 1000)) : nowMs;
const commandId = action.command_id || `CMD-${thingId.replace(/[^a-zA-Z0-9]/g, '-')}-${(rawCommand || 'CMD').replace(/[^a-zA-Z0-9]/g, '-')}-${coalesceBucket}`;
const providedCorrelationId = action.correlation_id || input.correlation_id;
// Always supply a correlation_id so control_command_log (NOT NULL) accepts the row,
// even when an autonomous source agent forgot to attach one. The MISSING_CORRELATION_ID
// rejection reason below still flags the upstream issue for audit.
const correlationId = providedCorrelationId || `CID-CTL-FALLBACK-${commandId}`;
const requestedBy = action.requested_by || sourceAgent || providedSource;
const humanApproved = action.human_approved === true || !!action.approved_by;
const confirmation = action.confirmation === true;

// -----------------------------------------------------------------------------
// Canonical command catalogue (mirrors packages/shared/commandSafetyGate.js).
// Each canonical entry knows its aliases, write plan, and admission rules.
// -----------------------------------------------------------------------------
const ALIAS = {
  'REPOSITION': 'MOVE_TO_FLOOR',
  'SEND_TO_FLOOR': 'MOVE_TO_FLOOR',
  'DOOR_HOLD_OPEN': 'OPEN_DOOR',
  'DOOR_CLOSE_SAFE': 'CLOSE_DOOR',
  'RESUME_NORMAL': 'RESET_EMERGENCY',
  'RESET_NORMAL': 'RESET_EMERGENCY',
  'RESUME_NORMAL_MODE': 'RESUME_NORMAL_MODE',
  'CLEAR_SECURITY_ALERT': 'RELEASE_LOCKDOWN',
  'MAINTENANCE_MODE': 'SET_MAINTENANCE_MODE',
  'ACKNOWLEDGE_INCIDENT': 'ACKNOWLEDGE_ALERT',
  // Pass-through for n8n-specific extensions that the dashboard catalogue does
  // not yet model. They are kept in the allow-list so the existing automation
  // continues to work, but they share the same audit / persistence path.
  'FIRE_RECALL_TO_GROUND': 'FIRE_RECALL_TO_GROUND',
  'RESTRICT_LOAD': 'RESTRICT_LOAD',
  'SET_ENERGY_SAVING_MODE': 'SET_ENERGY_SAVING_MODE',
};

const canonical = ALIAS[rawCommand] || (
  rawCommand && [
    'MOVE_TO_FLOOR','OPEN_DOOR','CLOSE_DOOR','EMERGENCY_STOP','RESET_EMERGENCY',
    'LOCKDOWN','RELEASE_LOCKDOWN','SET_MAINTENANCE_MODE','RESUME_NORMAL_MODE',
    'ACKNOWLEDGE_ALERT','CLEAR_RESOLVED_INCIDENT','REQUEST_STATUS_REFRESH',
  ].includes(rawCommand) ? rawCommand : null
);

const CRITICAL_COMMANDS = new Set([
  'EMERGENCY_STOP','LOCKDOWN','FIRE_RECALL_TO_GROUND','SET_MAINTENANCE_MODE',
]);
const MOVEMENT_COMMANDS = new Set([
  'MOVE_TO_FLOOR','FIRE_RECALL_TO_GROUND',
]);
const RECOVERY_COMMANDS = new Set([
  'RESET_EMERGENCY','RELEASE_LOCKDOWN','RESUME_NORMAL_MODE',
]);

// -----------------------------------------------------------------------------
// Build the safety snapshot (mirror of extractSafetySnapshot).
// -----------------------------------------------------------------------------
const safetySnapshot = {
  current_floor: cabin.current_floor ?? null,
  target_floor: cabin.target_floor ?? null,
  door_state: door.state ?? null,
  emergency_stop: cabin.emergency_stop ?? null,
  load_kg: cabin.load_kg ?? cabin.payload_weight_kg ?? null,
  alert_level: security.alert_level ?? null,
  system_mode: input.system_mode ?? payload.system_mode ?? null,
  risk_score: riskScore,
  forced_entry: door.door_forced_entry ?? door.forced_entry ?? null,
  active_security_incident: security.active_security_incident ?? null,
  last_telemetry_at: payload.last_telemetry_at ?? input.last_telemetry_at ?? null,
};

// -----------------------------------------------------------------------------
// Rejection rules.
// -----------------------------------------------------------------------------
const rejectionReasons = [];

if (!canonical) {
  rejectionReasons.push(`REJECTED: command not in allow-list (${rawCommand || 'missing'})`);
}
if (!thingId) rejectionReasons.push('REJECTED: missing thing_id');
if (!providedCorrelationId) rejectionReasons.push('REJECTED: missing correlation_id');
if (!sourceAgent) rejectionReasons.push('REJECTED: missing source_agent');
if (canonical !== 'EMERGENCY_STOP' && requireReason && reason.length === 0) {
  rejectionReasons.push('REJECTED: missing operator reason');
}

// Movement during LOCKDOWN or with emergency stop active is blocked.
if (canonical && MOVEMENT_COMMANDS.has(canonical)) {
  if (safetySnapshot.system_mode === 'LOCKDOWN') {
    rejectionReasons.push('REJECTED: system in LOCKDOWN');
  }
  if (safetySnapshot.emergency_stop === true) {
    rejectionReasons.push('REJECTED: emergency stop active');
  }
}

// Recovery commands require human authority + clear of active critical incident.
if (canonical && RECOVERY_COMMANDS.has(canonical) && !humanApproved) {
  rejectionReasons.push('REJECTED: recovery requires human/operator source');
}
if (canonical && RECOVERY_COMMANDS.has(canonical)) {
  const criticalActive = safetySnapshot.active_security_incident === true ||
    String(safetySnapshot.alert_level || '').toUpperCase() === 'CRITICAL' ||
    maintenance.active_critical_issue === true ||
    String(input.risk_analysis?.severity || '').toUpperCase() === 'CRITICAL';
  if (criticalActive && !humanApproved) {
    rejectionReasons.push('REJECTED: recovery requires human review of active critical incident');
  }
}

// MOVE_TO_FLOOR target validation.
const writes = [];
let label = canonical || rawCommand || 'UNKNOWN';

if (canonical === 'MOVE_TO_FLOOR') {
  const targetFloor = Number(action.target_floor);
  if (!Number.isInteger(targetFloor) || targetFloor < minFloor || targetFloor > maxFloor) {
    rejectionReasons.push('REJECTED: target floor outside allowed range');
  } else {
    label = `Move elevator to floor ${targetFloor}`;
    writes.push({ path: 'features/cabin/properties/target_floor', value: targetFloor });
  }
}

// Risk-threshold gating. Critical safety commands bypass risk caps.
if (canonical && !CRITICAL_COMMANDS.has(canonical)) {
  const isAutonomous = (providedSource === 'n8n' || providedSource === 'system');
  const isHuman = (providedSource === 'dashboard' || providedSource === 'operator');
  if (isAutonomous && riskScore > maxRiskAutoControl && !humanApproved) {
    rejectionReasons.push('REJECTED: risk score above autonomous-control threshold');
  } else if (isHuman && riskScore > maxRiskOperatorControl) {
    rejectionReasons.push('REJECTED: risk score above allowed threshold');
  }
}

// Stale twin (non-emergency commands only).
const nonEmergency = canonical && !CRITICAL_COMMANDS.has(canonical) && !RECOVERY_COMMANDS.has(canonical);
if (nonEmergency && safetySnapshot.last_telemetry_at) {
  const ageS = (nowMs - Date.parse(safetySnapshot.last_telemetry_at)) / 1000;
  if (!Number.isFinite(ageS) || ageS > maxTwinAgeSeconds) {
    rejectionReasons.push('REJECTED: stale Digital Twin state');
  }
}

// -----------------------------------------------------------------------------
// Ditto write plan for accepted commands.
// -----------------------------------------------------------------------------
if (rejectionReasons.length === 0 && canonical) {
  switch (canonical) {
    case 'EMERGENCY_STOP':
      label = 'Emergency stop asserted';
      writes.push({ path: 'features/cabin/properties/emergency_stop', value: true });
      writes.push({ path: 'attributes/system_mode', value: 'MAINTENANCE' });
      break;
    case 'LOCKDOWN':
      label = 'Security lockdown asserted';
      writes.push({ path: 'features/cabin/properties/emergency_stop', value: true });
      writes.push({ path: 'features/security/properties/alert_level', value: 'CRITICAL' });
      writes.push({ path: 'features/security/properties/active_security_incident', value: true });
      writes.push({ path: 'attributes/system_mode', value: 'LOCKDOWN' });
      break;
    case 'RELEASE_LOCKDOWN':
      label = 'Lockdown released';
      writes.push({ path: 'features/security/properties/active_security_incident', value: false });
      writes.push({ path: 'features/security/properties/alert_level', value: 'NORMAL' });
      writes.push({ path: 'attributes/system_mode', value: 'NORMAL' });
      break;
    case 'RESTRICT_LOAD':
      label = 'Restrict load pending manual clearance';
      writes.push({ path: 'features/cabin/properties/emergency_stop', value: true });
      writes.push({ path: 'features/cabin/properties/load_restricted', value: true });
      writes.push({ path: 'attributes/system_mode', value: 'MAINTENANCE' });
      break;
    case 'SET_MAINTENANCE_MODE':
      label = 'Maintenance mode';
      writes.push({ path: 'features/cabin/properties/emergency_stop', value: true });
      writes.push({ path: 'attributes/system_mode', value: 'MAINTENANCE' });
      break;
    case 'RESET_EMERGENCY':
    case 'RESUME_NORMAL_MODE':
      label = 'Resume normal service';
      writes.push({ path: 'features/cabin/properties/emergency_stop', value: false });
      writes.push({ path: 'attributes/system_mode', value: 'NORMAL' });
      break;
    case 'FIRE_RECALL_TO_GROUND':
      label = `Fire recall to floor ${groundFloor}`;
      writes.push({ path: 'features/cabin/properties/target_floor', value: groundFloor });
      writes.push({ path: 'features/fire_safety/properties/recall_active', value: true });
      writes.push({ path: 'attributes/system_mode', value: 'DEGRADED' });
      break;
    case 'OPEN_DOOR':
      label = 'Hold door open';
      writes.push({ path: 'features/door/properties/hold_open', value: true });
      break;
    case 'CLOSE_DOOR':
      label = 'Request safe door close';
      writes.push({ path: 'features/door/properties/close_requested', value: true });
      writes.push({ path: 'features/door/properties/hold_open', value: false });
      break;
    case 'SET_ENERGY_SAVING_MODE':
      label = 'Energy saving mode';
      writes.push({ path: 'features/optimization/properties/energy_mode', value: 'SAVING' });
      break;
    case 'ACKNOWLEDGE_ALERT':
      label = 'Acknowledge active incident';
      writes.push({ path: 'features/security/properties/last_review_at', value: now });
      writes.push({ path: 'features/security/properties/human_review_required', value: false });
      break;
    case 'CLEAR_RESOLVED_INCIDENT':
      label = 'Clear resolved incident';
      writes.push({ path: 'features/incident_log/properties/last_resolved_id', value: String(action.incident_id || '') });
      writes.push({ path: 'features/incident_log/properties/last_resolved_at', value: now });
      break;
    case 'REQUEST_STATUS_REFRESH':
      label = 'Status refresh';
      // No twin mutation: this is a ping for the device to publish status.
      break;
    case 'MOVE_TO_FLOOR':
      // writes already pushed above during target-floor validation.
      break;
  }
}

// F9: optional autonomous actuation. When AUTONOMOUS_ACTUATION_ENABLED=true, also
// publish a durable command intent that the ditto-bridge fans out to firmware over
// MQTT (mirrors the dashboard /api/commands pending_command pattern). Default OFF —
// the twin-state writes above remain the only effect, so this is opt-in.
const DEVICE_ACTIONS = new Set([
  'MOVE_TO_FLOOR', 'OPEN_DOOR', 'CLOSE_DOOR', 'EMERGENCY_STOP', 'RESET_EMERGENCY',
  'LOCKDOWN', 'RELEASE_LOCKDOWN', 'SET_MAINTENANCE_MODE', 'FIRE_RECALL_TO_GROUND',
]);
const actuationEnabled = String($env.AUTONOMOUS_ACTUATION_ENABLED ?? 'false').toLowerCase() === 'true';
if (rejectionReasons.length === 0 && canonical && actuationEnabled && DEVICE_ACTIONS.has(canonical)) {
  const pendingCommand = {
    command_id: commandId,
    correlation_id: correlationId,
    command: canonical,
    thing_id: thingId,
    source: providedSource,
    source_agent: sourceAgent,
    requested_at: action.issued_at || now,
    queued_at: now,
    status: 'PENDING',
    reason: reason.join('; '),
    safety_gate_version: 'n8n-control-gate-1.0.0',
    authorization_context: {
      verified: true,
      issuer: 'n8n-control-gate',
      subject: sourceAgent,
      role: 'AGENT',
      source: providedSource,
    },
  };
  if (canonical === 'MOVE_TO_FLOOR') pendingCommand.target_floor = Number(action.target_floor);
  writes.push({ path: 'features/control/properties/pending_command', value: pendingCommand });
}

const status = rejectionReasons.length > 0 ? 'REJECTED' : 'VALIDATED';

return [{
  json: {
    ...input,
    control_command: {
      command_id: commandId,
      correlation_id: correlationId,
      thing_id: thingId,
      command: canonical || rawCommand,
      raw_command_name: rawCommand,
      canonical_command: canonical,
      label,
      priority: action.priority || 'MEDIUM',
      requested_by: requestedBy,
      source_agent: sourceAgent,
      source: providedSource,
      reason,
      human_approved: humanApproved,
      confirmation,
      risk_score: riskScore,
      status,
      decision: status === 'VALIDATED' ? 'ACCEPTED' : 'REJECTED',
      accepted: status === 'VALIDATED',
      issued_at: action.issued_at || now,
      validated_at: now,
      rejection_reasons: rejectionReasons,
      safety_snapshot: safetySnapshot,
      writes: status === 'VALIDATED' ? writes : [],
      audit_required: true,
    },
    control_rejected: status === 'REJECTED',
  },
}];
