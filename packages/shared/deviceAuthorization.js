/**
 * Pure mirror of the device-side floor authorization contract. Firmware keeps
 * the same ordering: validate safety first, then distinguish trusted remote
 * control from RFID-gated physical calls.
 */
export function authorizeFloorRequest(input = {}) {
  const floor = Number(input.floor);
  const minFloor = Number.isInteger(input.minFloor) ? input.minFloor : 0;
  const maxFloor = Number.isInteger(input.maxFloor) ? input.maxFloor : 3;
  const source = String(input.source || "UNTRUSTED_REMOTE").toUpperCase();

  if (!Number.isInteger(floor) || floor < minFloor || floor > maxFloor) {
    return { accepted: false, reason: "INVALID_FLOOR" };
  }
  if (input.emergencyStop) return { accepted: false, reason: "EMERGENCY_STOP" };
  if (input.maintenanceMode) return { accepted: false, reason: "MAINTENANCE_MODE" };
  if (input.securityLocked) return { accepted: false, reason: "SECURITY_LOCK" };
  if (input.safetyInterlock) return { accepted: false, reason: "SAFETY_INTERLOCK" };
  if (input.overload) return { accepted: false, reason: "OVERLOAD" };
  if (input.doorSafe === false) return { accepted: false, reason: "DOOR_INTERLOCK" };

  const physicalCabin = source === "PHYSICAL_CABIN";
  const physicalHall = source === "PHYSICAL_HALL";
  const trustedRemote = source === "TRUSTED_REMOTE";
  const restrictedFloor = Boolean(input.restrictedFloor);

  if (trustedRemote) {
    return { accepted: true, reason: "REMOTE_AUTHORIZED" };
  }

  if (source === "UNTRUSTED_REMOTE") {
    return { accepted: false, reason: "UNTRUSTED_REMOTE_SOURCE" };
  }

  const panelRequiresAuth =
    (physicalCabin && input.requireCabinAuth !== false)
    || (physicalHall && input.requireHallAuth !== false);
  const authRequired = panelRequiresAuth || restrictedFloor;
  if (!authRequired) return { accepted: true, reason: "PHYSICAL_REQUEST_ALLOWED" };

  if (!input.rfidReady) {
    return input.degradeOpen
      ? { accepted: true, reason: "RFID_DEGRADED_OPEN" }
      : { accepted: false, reason: "RFID_UNAVAILABLE" };
  }
  if (!input.rfidSessionActive) return { accepted: false, reason: "CARD_REQUIRED" };
  if (!input.rfidFloorAllowed) return { accepted: false, reason: "RFID_FLOOR_DENIED" };
  return { accepted: true, reason: "CARD_AUTHORIZED" };
}
