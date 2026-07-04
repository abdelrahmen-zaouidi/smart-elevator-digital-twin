export const COMMAND_TERMINAL_STATUSES = Object.freeze([
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "TIMED_OUT",
]);

export const COMMAND_ACTIVE_STATUSES = Object.freeze([
  "PENDING",
  "FORWARDED",
  "ACCEPTED",
  "EXECUTING",
]);

const TERMINAL = new Set(COMMAND_TERMINAL_STATUSES);
const ACTIVE = new Set(COMMAND_ACTIVE_STATUSES);

export function normalizeCommandStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "SUCCEEDED" || normalized === "EXECUTED" || normalized === "ACKED") {
    return "COMPLETED";
  }
  if (normalized === "EXPIRED" || normalized === "TIMEOUT") {
    return "TIMED_OUT";
  }
  return normalized || "UNKNOWN";
}

export function isTerminalCommandStatus(value) {
  return TERMINAL.has(normalizeCommandStatus(value));
}

export function isActiveCommandStatus(value) {
  return ACTIVE.has(normalizeCommandStatus(value));
}

export function getControlProperties(thing) {
  const control = thing?.features?.control;
  if (!control || typeof control !== "object") return {};
  return control.properties && typeof control.properties === "object"
    ? control.properties
    : control;
}

export function getPendingCommand(thing) {
  const pending = getControlProperties(thing).pending_command;
  return pending && typeof pending === "object" ? pending : null;
}

export function getLastCommandResult(thing) {
  const result = getControlProperties(thing).last_command_result;
  return result && typeof result === "object" ? result : null;
}

export function commandResultForId(thing, commandId) {
  if (!commandId) return null;

  const lastResult = getLastCommandResult(thing);
  if (
    lastResult?.command_id === commandId
    && isTerminalCommandStatus(lastResult.status)
  ) {
    return {
      ...lastResult,
      status: normalizeCommandStatus(lastResult.status),
    };
  }

  const pending = getPendingCommand(thing);
  if (
    pending?.command_id === commandId
    && isTerminalCommandStatus(pending.status)
  ) {
    return {
      ...pending,
      status: normalizeCommandStatus(pending.status),
    };
  }

  return null;
}

export function activeCommandFromThing(thing) {
  const pending = getPendingCommand(thing);
  if (!pending || !isActiveCommandStatus(pending.status)) return null;
  return {
    ...pending,
    status: normalizeCommandStatus(pending.status),
  };
}

export function commandOutcomeMessage(result, fallback = "Command completed") {
  if (!result) return fallback;
  const reason = result.reason || result.message || result.error;
  if (reason) return String(reason);

  switch (normalizeCommandStatus(result.status)) {
    case "COMPLETED":
      return "Device confirmed command completion";
    case "REJECTED":
      return "Device rejected the command";
    case "FAILED":
      return "Device failed to execute the command";
    case "TIMED_OUT":
      return "No terminal device acknowledgement before timeout";
    default:
      return fallback;
  }
}
