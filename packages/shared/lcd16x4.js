export const LCD_COLUMNS = 16;
export const LCD_ROWS = 4;

const ABBREVIATIONS = Object.freeze([
  ["COMMUNICATION", "COMMS"],
  ["DISCONNECTED", "DISCONNECT"],
  ["RECONNECTING", "RECONNECT"],
  ["AUTHORIZATION", "AUTH"],
  ["TEMPERATURE", "TEMP"],
  ["MAINTENANCE", "MAINT"],
  ["EMERGENCY", "EMERGENCY"],
]);

function abbreviate(value) {
  let result = String(value ?? "").replace(/[^\x20-\x7E]/g, "?");
  for (const [longForm, shortForm] of ABBREVIATIONS) {
    result = result.replace(new RegExp(longForm, "gi"), shortForm);
  }
  return result;
}

export function lcdLeft(value) {
  const text = abbreviate(value).slice(0, LCD_COLUMNS);
  return text.padEnd(LCD_COLUMNS, " ");
}

export function lcdCenter(value) {
  const text = abbreviate(value).slice(0, LCD_COLUMNS);
  const leftPadding = Math.floor((LCD_COLUMNS - text.length) / 2);
  const rightPadding = LCD_COLUMNS - text.length - leftPadding;
  return `${" ".repeat(leftPadding)}${text}${" ".repeat(rightPadding)}`;
}

export function lcdLeftRight(left, right) {
  let leftText = abbreviate(left);
  let rightText = abbreviate(right);

  if (rightText.length > LCD_COLUMNS) rightText = rightText.slice(-LCD_COLUMNS);
  const maxLeftLength = Math.max(0, LCD_COLUMNS - rightText.length - 1);
  leftText = leftText.slice(0, maxLeftLength);

  const availableGap = LCD_COLUMNS - leftText.length - rightText.length;
  if (availableGap <= 0) {
    return `${leftText}${rightText}`.slice(0, LCD_COLUMNS).padEnd(LCD_COLUMNS, " ");
  }
  return `${leftText}${" ".repeat(availableGap)}${rightText}`;
}

export function lcdScreen(...rows) {
  // Production LCD screens are consistently anchored at column 0. Padding is
  // added only on the right so no row appears unintentionally indented.
  return Array.from({ length: LCD_ROWS }, (_, index) => lcdLeft(rows[index] || ""));
}

export const LCD_STATE_MATRIX = Object.freeze({
  booting: lcdScreen("SMART ELEVATOR", "ESP32-S3", "BOOTING", "PLEASE WAIT"),
  wifi_connecting: lcdScreen("CONNECTING", "WI-FI", "NETWORK START", "PLEASE WAIT"),
  wifi_failure: lcdScreen("WI-FI FAILED", "CHECK NETWORK", "RETRY ACTIVE", "LOCAL MODE"),
  mqtt_connecting: lcdScreen("CONNECTING", "MQTT BROKER", "SECURE LINK", "PLEASE WAIT"),
  mqtt_reconnecting: lcdScreen("MQTT RECONNECT", "LINK LOST", "RETRY ACTIVE", "CONTROL LOCAL"),
  backend_unavailable: lcdScreen("BACKEND OFFLINE", "DITTO UNAVAIL", "MQTT CONNECTED", "CONTROL LOCAL"),
  idle: lcdScreen("SYSTEM READY", "CABIN IDLE", "DOOR CLOSED", "SELECT FLOOR"),
  cabin_at_floor: lcdScreen("CABIN POSITION", "AT FLOOR 2", "DOOR CLOSED", "SYSTEM READY"),
  moving_up: lcdScreen("MOVING UP", "FLOOR 1 TO 3", "DOOR LOCKED", "PLEASE WAIT"),
  moving_down: lcdScreen("MOVING DOWN", "FLOOR 3 TO 0", "DOOR LOCKED", "PLEASE WAIT"),
  arriving: lcdScreen("ARRIVING", "FLOOR 3", "STOPPING", "PLEASE WAIT"),
  door_opening: lcdScreen("DOOR OPENING", "AT FLOOR 3", "STAND CLEAR", "PLEASE WAIT"),
  door_open: lcdScreen("DOOR OPEN", "AT FLOOR 3", "ENTER OR EXIT", "CLOSE SOON"),
  door_closing: lcdScreen("DOOR CLOSING", "AT FLOOR 3", "STAND CLEAR", "PLEASE WAIT"),
  floor_selected: lcdScreen("FLOOR SELECTED", "TARGET FLOOR 3", "REQUEST QUEUED", "PLEASE WAIT"),
  command_accepted: lcdScreen("CMD ACCEPTED", "REMOTE CONTROL", "SAFETY CLEAR", "EXECUTING"),
  command_completed: lcdScreen("CMD COMPLETED", "DEVICE CONFIRMED", "STATE UPDATED", "SYSTEM READY"),
  command_failed: lcdScreen("COMMAND FAILED", "DEVICE ERROR", "CHECK SYSTEM", "RETRY SAFELY"),
  command_timed_out: lcdScreen("COMMAND TIMEOUT", "NO DEVICE ACK", "STATE UNKNOWN", "CHECK SYSTEM"),
  card_required: lcdScreen("CARD REQUIRED", "RESTRICTED FLOOR", "SCAN RFID TAG", "ACCESS PENDING"),
  card_accepted: lcdScreen("CARD ACCEPTED", "ACCESS GRANTED", "REQUEST ACTIVE", "PLEASE WAIT"),
  card_rejected: lcdScreen("CARD REJECTED", "ACCESS DENIED", "CHECK CARD", "TRY AGAIN"),
  remote_authorized: lcdScreen("REMOTE AUTH OK", "SCADA OPERATOR", "POLICY VERIFIED", "REQUEST ACTIVE"),
  invalid_floor: lcdScreen("INVALID FLOOR", "VALID RANGE 0-3", "REQUEST REJECT", "CHECK COMMAND"),
  overload: lcdScreen("OVERLOAD", "MOVEMENT BLOCK", "REDUCE LOAD", "THEN RETRY"),
  obstruction: lcdScreen("OBSTRUCTION", "DOOR BLOCKED", "CLEAR OPENING", "STAND CLEAR"),
  emergency_stop: lcdScreen("EMERGENCY STOP", "SYSTEM HALTED", "MOTION LOCKED", "RESET REQUIRED"),
  maintenance_mode: lcdScreen("MAINT MODE", "SERVICE ACTIVE", "CALLS DISABLED", "TECHNICIAN ONLY"),
  sensor_fault: lcdScreen("SENSOR FAULT", "MOTION LOCKED", "CHECK WIRING", "SERVICE REQUIRED"),
  communication_fault: lcdScreen("COMMS FAULT", "LINK UNAVAILABLE", "CONTROL LOCAL", "CHECK NETWORK"),
});

export function validateLcdStateMatrix(matrix = LCD_STATE_MATRIX) {
  const errors = [];
  for (const [state, rows] of Object.entries(matrix)) {
    if (!Array.isArray(rows) || rows.length !== LCD_ROWS) {
      errors.push(`${state}: expected ${LCD_ROWS} rows`);
      continue;
    }
    rows.forEach((row, index) => {
      if (row.length !== LCD_COLUMNS) {
        errors.push(`${state}[${index}]: expected ${LCD_COLUMNS}, got ${row.length}`);
      }
    });
  }
  return errors;
}
