/**
 * Deterministic, movement-based cabin speed estimator.
 *
 * Motivation: the firmware reports a *constant* cruise approximation
 * (FLOOR_HEIGHT_M / secPerFloor) whenever it is moving, which is not the real
 * instantaneous speed. The physics simulator reports a true integrated speed.
 * To present a correct, source-independent figure, the dashboard derives speed
 * from the observable facts it actually has: floor transitions and the wall-clock
 * time between them, given the configured floor height.
 *
 *   speed (m/s) = floorsCrossed * FLOOR_HEIGHT_M / (arrivalMs - departureMs) * 1000
 *
 * The estimator is a small deterministic state machine. It is pure with respect
 * to wall-clock only through the timestamp passed into update() (callers pass an
 * explicit `nowMs`), so it never reads Date.now() during React render.
 *
 * Impossible values are rejected: a non-positive interval, or a speed outside
 * (0, MAX_PLAUSIBLE_SPEED_MS], yields `valid: false` and leaves the live speed
 * untouched (we keep the last good value rather than emit a spike).
 */

export const DEFAULT_FLOOR_HEIGHT_M = 3.0;
// Hard physical ceiling. A passenger elevator in this class never exceeds a few
// m/s; anything above is a timing artifact (paused tab, clock jump) and is
// rejected as impossible.
export const MAX_PLAUSIBLE_SPEED_MS = 4.0;

export function createSpeedEstimator(options = {}) {
  const floorHeightM = Number(options.floorHeightM) > 0 ? Number(options.floorHeightM) : DEFAULT_FLOOR_HEIGHT_M;
  const maxSpeedMs = Number(options.maxSpeedMs) > 0 ? Number(options.maxSpeedMs) : MAX_PLAUSIBLE_SPEED_MS;

  // Mutable state machine.
  let prevFloor = null;          // last observed floor
  let lastCrossingMs = null;     // wall-clock of the last floor boundary crossing
  let departureFloor = null;     // floor where the current trip started
  let departureMs = null;        // wall-clock when the current trip started moving
  let liveSpeedMs = 0;           // current best estimate
  let lastSegmentSpeedMs = 0;    // average speed of the most recently completed trip

  function isMoving(direction) {
    const d = String(direction || "").toUpperCase();
    return d === "UP" || d === "DOWN";
  }

  function reset() {
    prevFloor = null;
    lastCrossingMs = null;
    departureFloor = null;
    departureMs = null;
    liveSpeedMs = 0;
    lastSegmentSpeedMs = 0;
  }

  /**
   * Feed one telemetry observation.
   * @param {object} obs { currentFloor, direction, nowMs }
   * @returns {object} { liveSpeedMs, lastSegmentSpeedMs, valid, event }
   */
  function update(obs = {}) {
    const currentFloor = Number(obs.currentFloor);
    const nowMs = Number(obs.nowMs);
    const moving = isMoving(obs.direction);
    let valid = true;
    let event = "none";

    if (!Number.isFinite(currentFloor) || !Number.isFinite(nowMs)) {
      return { liveSpeedMs, lastSegmentSpeedMs, valid: false, event: "bad-input" };
    }

    // First observation: just anchor.
    if (prevFloor === null) {
      prevFloor = currentFloor;
      lastCrossingMs = nowMs;
      return { liveSpeedMs: 0, lastSegmentSpeedMs, valid: true, event: "init" };
    }

    // Trip start: transitioned into a moving direction.
    if (moving && departureMs === null) {
      departureFloor = prevFloor;
      departureMs = nowMs;
      lastCrossingMs = nowMs;
      event = "depart";
    }

    // A floor boundary was crossed since the last observation.
    if (currentFloor !== prevFloor) {
      const floorsCrossed = Math.abs(currentFloor - prevFloor);
      const dtMs = nowMs - (lastCrossingMs ?? nowMs);
      const speed = dtMs > 0 ? (floorsCrossed * floorHeightM) / (dtMs / 1000) : Infinity;

      if (speed > 0 && speed <= maxSpeedMs) {
        liveSpeedMs = speed;
        event = "crossing";
      } else {
        valid = false; // impossible value — keep last good live speed
        event = "rejected";
      }
      lastCrossingMs = nowMs;
      prevFloor = currentFloor;
    }

    // Arrival: stopped moving. Close out the trip and compute its average speed.
    if (!moving && departureMs !== null) {
      const floorsTraveled = Math.abs(currentFloor - (departureFloor ?? currentFloor));
      const tripMs = nowMs - departureMs;
      if (floorsTraveled > 0 && tripMs > 0) {
        const avg = (floorsTraveled * floorHeightM) / (tripMs / 1000);
        if (avg > 0 && avg <= maxSpeedMs) {
          lastSegmentSpeedMs = avg;
          event = "arrive";
        }
      }
      departureMs = null;
      departureFloor = null;
      liveSpeedMs = 0;
    }

    // Idle and not in a trip: speed is unambiguously zero.
    if (!moving && departureMs === null) {
      liveSpeedMs = 0;
    }

    prevFloor = currentFloor;
    return { liveSpeedMs, lastSegmentSpeedMs, valid, event };
  }

  return {
    update,
    reset,
    get floorHeightM() {
      return floorHeightM;
    },
    get maxSpeedMs() {
      return maxSpeedMs;
    },
  };
}
