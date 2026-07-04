#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  activeCommandFromThing,
  commandResultForId,
  isTerminalCommandStatus,
} from "../../packages/shared/commandLifecycle.js";
import {
  LCD_COLUMNS,
  LCD_ROWS,
  LCD_STATE_MATRIX,
  lcdCenter,
  lcdLeft,
  lcdLeftRight,
  validateLcdStateMatrix,
} from "../../packages/shared/lcd16x4.js";
import { authorizeFloorRequest } from "../../packages/shared/deviceAuthorization.js";

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const thingWith = (pending, result = null) => ({
  features: {
    control: {
      properties: {
        pending_command: pending,
        last_command_result: result,
      },
    },
  },
});

test("successful command completion matches the active command id", () => {
  const thing = thingWith(
    { command_id: "CMD-1", status: "FORWARDED" },
    { command_id: "CMD-1", status: "COMPLETED", reason: "ARRIVED" },
  );
  assert.equal(commandResultForId(thing, "CMD-1")?.status, "COMPLETED");
});

test("rejected command is terminal", () => {
  assert.equal(isTerminalCommandStatus("REJECTED"), true);
});

test("command timeout is terminal", () => {
  assert.equal(isTerminalCommandStatus("TIMED_OUT"), true);
});

test("stale or mismatched acknowledgement does not clear active command", () => {
  const thing = thingWith(
    { command_id: "CMD-NEW", status: "FORWARDED" },
    { command_id: "CMD-OLD", status: "COMPLETED" },
  );
  assert.equal(commandResultForId(thing, "CMD-NEW"), null);
  assert.equal(activeCommandFromThing(thing)?.command_id, "CMD-NEW");
});

test("active command detection prevents duplicate submission", () => {
  const thing = thingWith({ command_id: "CMD-1", status: "ACCEPTED" });
  assert.equal(activeCommandFromThing(thing)?.command_id, "CMD-1");
});

test("authorized dashboard request can reach restricted floor 3", () => {
  const decision = authorizeFloorRequest({
    floor: 3,
    source: "TRUSTED_REMOTE",
    restrictedFloor: true,
    doorSafe: true,
  });
  assert.deepEqual(decision, { accepted: true, reason: "REMOTE_AUTHORIZED" });
});

test("untrusted remote request cannot claim floor 3 authority", () => {
  const decision = authorizeFloorRequest({
    floor: 3,
    source: "UNTRUSTED_REMOTE",
    restrictedFloor: true,
    doorSafe: true,
  });
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, "UNTRUSTED_REMOTE_SOURCE");
});

test("physical restricted-floor request requires RFID", () => {
  const decision = authorizeFloorRequest({
    floor: 3,
    source: "PHYSICAL_CABIN",
    restrictedFloor: true,
    rfidReady: true,
    rfidSessionActive: false,
    doorSafe: true,
  });
  assert.deepEqual(decision, { accepted: false, reason: "CARD_REQUIRED" });
});

test("safety interlock rejects even an authorized dashboard request", () => {
  const decision = authorizeFloorRequest({
    floor: 3,
    source: "TRUSTED_REMOTE",
    restrictedFloor: true,
    safetyInterlock: true,
    doorSafe: true,
  });
  assert.deepEqual(decision, { accepted: false, reason: "SAFETY_INTERLOCK" });
});

test("every LCD state has exactly four rows of sixteen cells", () => {
  assert.deepEqual(validateLcdStateMatrix(), []);
  for (const rows of Object.values(LCD_STATE_MATRIX)) {
    assert.equal(rows.length, LCD_ROWS);
    rows.forEach((row) => assert.equal(row.length, LCD_COLUMNS));
  }
});

test("every production LCD row starts at column zero", () => {
  for (const [state, rows] of Object.entries(LCD_STATE_MATRIX)) {
    rows.forEach((row, index) => {
      assert.notEqual(row[0], " ", `${state}[${index}] has unintended left padding`);
    });
  }
});

test("long LCD text truncates deterministically", () => {
  assert.equal(lcdLeft("12345678901234567890"), "1234567890123456");
});

test("LCD centering uses floor-left padding", () => {
  assert.equal(lcdCenter("ABC"), "      ABC       ");
});

test("LCD left/right alignment fills the exact available gap", () => {
  assert.equal(lcdLeftRight("F:0", "Q:02"), "F:0         Q:02");
});

test("shorter LCD updates overwrite stale characters with spaces", () => {
  assert.equal(lcdLeft("OK"), "OK              ");
});

if (!process.exitCode) {
  console.log(`\n${passed} lifecycle/LCD validation tests passed.`);
}
