const input = $input.first().json || {};
const command = input.control_command || {};

if (command.status !== 'VALIDATED') {
  return [];
}

return (command.writes || []).map((write, index) => ({
  json: {
    ...input,
    write_index: index,
    thing_id: command.thing_id,
    correlation_id: command.correlation_id,
    command_id: command.command_id,
    command_name: command.command,
    command_label: command.label,
    command_status: 'DISPATCHED',
    path: write.path,
    value: write.value,
    issued_at: command.issued_at,
    audit_payload: {
      command_id: command.command_id,
      correlation_id: command.correlation_id,
      thing_id: command.thing_id,
      command: command.command,
      requested_by: command.requested_by,
      source_agent: command.source_agent,
      reason: command.reason,
      risk_score: command.risk_score,
      ditto_path: write.path,
      value: write.value
    }
  }
}));

