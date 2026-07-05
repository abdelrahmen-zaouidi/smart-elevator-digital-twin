import { describe, it, expect } from "vitest";
import {
  createSpeedEstimator,
  DEFAULT_FLOOR_HEIGHT_M,
  MAX_PLAUSIBLE_SPEED_MS,
} from "./speedEstimator.js";

describe("createSpeedEstimator", () => {
  it("defaults floor height and max speed when options are invalid", () => {
    const est = createSpeedEstimator({ floorHeightM: -1, maxSpeedMs: 0 });
    expect(est.floorHeightM).toBe(DEFAULT_FLOOR_HEIGHT_M);
    expect(est.maxSpeedMs).toBe(MAX_PLAUSIBLE_SPEED_MS);
  });

  it("honours valid option overrides", () => {
    const est = createSpeedEstimator({ floorHeightM: 2.5, maxSpeedMs: 3 });
    expect(est.floorHeightM).toBe(2.5);
    expect(est.maxSpeedMs).toBe(3);
  });

  it("anchors on the first observation and reports zero speed", () => {
    const est = createSpeedEstimator();
    const r = est.update({ currentFloor: 0, direction: "IDLE", nowMs: 1000 });
    expect(r.event).toBe("init");
    expect(r.liveSpeedMs).toBe(0);
    expect(r.valid).toBe(true);
  });

  it("rejects non-finite input without disturbing state", () => {
    const est = createSpeedEstimator();
    est.update({ currentFloor: 0, direction: "IDLE", nowMs: 0 });
    const r = est.update({ currentFloor: NaN, direction: "UP", nowMs: 1000 });
    expect(r.valid).toBe(false);
    expect(r.event).toBe("bad-input");
  });

  it("computes a plausible live speed on a floor crossing", () => {
    const est = createSpeedEstimator({ floorHeightM: 3 });
    est.update({ currentFloor: 0, direction: "IDLE", nowMs: 0 });
    est.update({ currentFloor: 0, direction: "UP", nowMs: 1000 }); // depart
    // cross one floor (3 m) in 2 s -> 1.5 m/s
    const r = est.update({ currentFloor: 1, direction: "UP", nowMs: 3000 });
    expect(r.event).toBe("crossing");
    expect(r.liveSpeedMs).toBeCloseTo(1.5, 5);
    expect(r.valid).toBe(true);
  });

  it("rejects an impossible (too-fast) crossing and keeps the last good speed", () => {
    const est = createSpeedEstimator({ floorHeightM: 3, maxSpeedMs: 4 });
    est.update({ currentFloor: 0, direction: "IDLE", nowMs: 0 });
    est.update({ currentFloor: 0, direction: "UP", nowMs: 1000 });
    // 3 m in 10 ms -> 300 m/s, impossible
    const r = est.update({ currentFloor: 1, direction: "UP", nowMs: 1010 });
    expect(r.valid).toBe(false);
    expect(r.event).toBe("rejected");
    expect(r.liveSpeedMs).toBe(0); // no prior good live speed was set
  });

  it("closes out a trip with an average segment speed on arrival", () => {
    const est = createSpeedEstimator({ floorHeightM: 3 });
    est.update({ currentFloor: 0, direction: "IDLE", nowMs: 0 });
    est.update({ currentFloor: 0, direction: "UP", nowMs: 1000 });   // depart @1s
    est.update({ currentFloor: 1, direction: "UP", nowMs: 3000 });   // crossing
    est.update({ currentFloor: 2, direction: "UP", nowMs: 5000 });   // crossing
    // arrival at floor 2: 2 floors (6 m) over 4 s (1s->5s) -> 1.5 m/s
    const r = est.update({ currentFloor: 2, direction: "IDLE", nowMs: 5000 });
    expect(r.event).toBe("arrive");
    expect(r.lastSegmentSpeedMs).toBeCloseTo(1.5, 5);
    expect(r.liveSpeedMs).toBe(0); // idle after arrival
  });

  it("reports zero live speed while idle and not in a trip", () => {
    const est = createSpeedEstimator();
    est.update({ currentFloor: 2, direction: "IDLE", nowMs: 0 });
    const r = est.update({ currentFloor: 2, direction: "IDLE", nowMs: 1000 });
    expect(r.liveSpeedMs).toBe(0);
  });

  it("reset() returns to the anchor state", () => {
    const est = createSpeedEstimator();
    est.update({ currentFloor: 0, direction: "UP", nowMs: 0 });
    est.update({ currentFloor: 1, direction: "UP", nowMs: 2000 });
    est.reset();
    const r = est.update({ currentFloor: 3, direction: "IDLE", nowMs: 9999 });
    expect(r.event).toBe("init");
    expect(r.liveSpeedMs).toBe(0);
  });
});
