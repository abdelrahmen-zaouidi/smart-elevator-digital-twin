import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const dashboardDir = path.resolve(path.dirname(__filename), "..");
const projectRoot = path.resolve(dashboardDir, "..");

function loadEnvFile(filePath, override = false) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }

  return fallback;
}

function argNumber(name, fallback) {
  const value = argValue(name, null);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --${name} value: ${value}`);
  }
  return parsed;
}

function argChoice(name, fallback, choices) {
  const value = String(argValue(name, fallback)).toUpperCase();
  if (!choices.includes(value)) {
    throw new Error(`Invalid --${name} value: ${value}. Allowed: ${choices.join(", ")}`);
  }
  return value;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function maintenancePriority(riskScore) {
  if (riskScore >= 76) return "CRITICAL";
  if (riskScore >= 41) return "MEDIUM";
  return "LOW";
}

function motorHealth(tempC, vibrationLevel) {
  if (tempC > 85 || vibrationLevel > 0.25) return "CRITICAL";
  if (tempC > 70 || vibrationLevel > 0.12) return "WARNING";
  return "GOOD";
}

function deriveRiskScore(thing, motorTempC) {
  const attrs = thing?.attributes || {};
  const cabin = thing?.features?.cabin?.properties || {};
  const door = thing?.features?.door?.properties || {};
  const motor = thing?.features?.motor?.properties || {};
  const security = thing?.features?.security?.properties || {};
  const maxLoadKg = Number(readEnv("MAX_LOAD_KG", "800"));

  const vibration = numberOrNull(motor.vibration_level);
  const loadKg = numberOrNull(cabin.load_kg ?? cabin.payload_weight_kg);
  const alertLevel = String(security.alert_level || "").toUpperCase();
  const mode = String(attrs.system_mode || "").toUpperCase();

  let risk = 0;

  if (vibration != null) {
    if (vibration > 0.25) risk = Math.max(risk, 90);
    else if (vibration > 0.12) risk = Math.max(risk, 58);
    else if (vibration > 0.06) risk = Math.max(risk, 35);
  }

  if (motorTempC > 85) risk = Math.max(risk, 90);
  else if (motorTempC > 70) risk = Math.max(risk, 58);
  else if (motorTempC > 55) risk = Math.max(risk, 32);

  if (loadKg != null) {
    if (loadKg > maxLoadKg) risk = Math.max(risk, 88);
    else if (loadKg > maxLoadKg * 0.8) risk = Math.max(risk, 48);
    else if (loadKg > maxLoadKg * 0.65) risk = Math.max(risk, 30);
  }

  if (cabin.emergency_stop === true || mode === "LOCKDOWN" || mode === "MAINTENANCE") {
    risk = Math.max(risk, 82);
  }
  if (door.door_forced_entry === true || security.audio_distress_active === true || alertLevel === "CRITICAL") {
    risk = Math.max(risk, 92);
  } else if (alertLevel === "HIGH" || Number(security.unauthorized_access_attempts || 0) > 0) {
    risk = Math.max(risk, 45);
  }

  return Math.min(100, Math.max(0, Math.round(risk)));
}

function dittoCandidates() {
  const directBase = (
    readEnv("DITTO_URL") ||
    readEnv("DITTO_PUBLIC_BASE_URL") ||
    readEnv("NEXT_PUBLIC_DITTO_URL") ||
    "http://127.0.0.1:8080"
  ).replace(/\/+$/, "");

  const dashboardBase = (
    readEnv("DASHBOARD_URL") ||
    readEnv("NEXT_PUBLIC_DASHBOARD_URL") ||
    "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");

  return [
    {
      name: "direct-ditto",
      baseUrl: directBase,
      pathPrefix: "",
      usesProxyAuth: false,
    },
    {
      name: "dashboard-proxy",
      baseUrl: dashboardBase,
      pathPrefix: "/api/ditto",
      usesProxyAuth: true,
    },
  ];
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }

  if (!body) return null;
  return JSON.parse(body);
}

async function withDittoEndpoint(callback) {
  const thingId = readEnv("PRIMARY_THING_ID") || readEnv("NEXT_PUBLIC_THING_ID", "building:floor1:elevator");
  const username = readEnv("DITTO_USER") || readEnv("DITTO_USERNAME") || readEnv("NEXT_PUBLIC_DITTO_USERNAME", "ditto");
  const password = readEnv("DITTO_PASSWORD") || readEnv("NEXT_PUBLIC_DITTO_PASSWORD", "ditto");
  const errors = [];

  for (const candidate of dittoCandidates()) {
    const root = `${candidate.baseUrl}${candidate.pathPrefix}/api/2/things/${encodePathSegment(thingId)}`;
    const headers = candidate.usesProxyAuth
      ? {}
      : { Authorization: basicAuthHeader(username, password) };

    try {
      return await callback({ ...candidate, root, headers, thingId });
    } catch (error) {
      errors.push(`${candidate.name}: ${error.message}`);
    }
  }

  throw new Error(`All Ditto recovery paths failed: ${errors.join(" | ")}`);
}

async function putPath(root, headers, pathName, value, dryRun) {
  const encodedPath = pathName.split("/").filter(Boolean).map(encodePathSegment).join("/");
  if (dryRun) {
    console.log(`[dry-run] PUT ${pathName} = ${JSON.stringify(value)}`);
    return;
  }

  await requestJson(`${root}/${encodedPath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(value),
  });
}

async function recoverThermalFan() {
  const motorTempC = argNumber("motor-temp", Number(readEnv("THERMAL_RECOVERY_MOTOR_TEMP_C", "45")));
  const cabinTempC = argNumber("cabin-temp", Number(readEnv("THERMAL_RECOVERY_CABIN_TEMP_C", "24")));
  const fanState = argChoice("fan-state", readEnv("THERMAL_RECOVERY_FAN_STATE", "OFF"), ["ON", "OFF"]);
  const fanMode = argChoice("fan-mode", readEnv("THERMAL_RECOVERY_FAN_MODE", "AUTO"), ["AUTO", "MANUAL"]);
  const reason = String(argValue("reason", readEnv("THERMAL_RECOVERY_REASON", "SIMULATOR_FALSE_THERMAL_RECOVERY")));
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date().toISOString();

  if (motorTempC < -20 || motorTempC > 140) {
    throw new Error(`Refusing unrealistic motor temperature: ${motorTempC}`);
  }
  if (cabinTempC < -20 || cabinTempC > 80) {
    throw new Error(`Refusing unrealistic cabin temperature: ${cabinTempC}`);
  }

  return withDittoEndpoint(async ({ name, root, headers, thingId }) => {
    const thing = await requestJson(root, { method: "GET", headers });
    const vibration = numberOrNull(thing?.features?.motor?.properties?.vibration_level) ?? 0;
    const riskScore = deriveRiskScore(thing, motorTempC);
    const healthStatus = motorHealth(motorTempC, vibration);
    const writes = [
      ["features/motor/properties/temperature_c", motorTempC],
      ["features/motor/properties/health_status", healthStatus],
      ["features/cabin/properties/temperature_c", cabinTempC],
      ["features/fan/properties/state", fanState],
      ["features/fan/properties/mode", fanMode],
      ["features/fan/properties/reason", reason],
      ["features/fan/properties/duty_cycle_pct", fanState === "ON" ? 100 : 0],
      ["features/fan/properties/last_changed_at", now],
      ["attributes/risk_score", riskScore],
      ["attributes/maintenance_priority", maintenancePriority(riskScore)],
    ];

    for (const [pathName, value] of writes) {
      await putPath(root, headers, pathName, value, dryRun);
    }

    const verify = dryRun ? thing : await requestJson(root, { method: "GET", headers });
    const summary = {
      endpoint: name,
      thing_id: thingId,
      motor_temperature_c: dryRun ? motorTempC : verify?.features?.motor?.properties?.temperature_c,
      cabin_temperature_c: dryRun ? cabinTempC : verify?.features?.cabin?.properties?.temperature_c,
      motor_health_status: dryRun ? healthStatus : verify?.features?.motor?.properties?.health_status,
      fan_state: dryRun ? fanState : verify?.features?.fan?.properties?.state,
      fan_mode: dryRun ? fanMode : verify?.features?.fan?.properties?.mode,
      risk_score: dryRun ? riskScore : verify?.attributes?.risk_score,
      maintenance_priority: dryRun ? maintenancePriority(riskScore) : verify?.attributes?.maintenance_priority,
    };

    console.log("[recover] Thermal/fan recovery completed:");
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  });
}

async function main() {
  loadEnvFile(path.join(projectRoot, ".env"));
  loadEnvFile(path.join(dashboardDir, ".env.local"), true);
  await recoverThermalFan();
}

main().catch((error) => {
  console.error("[recover] Thermal/fan recovery failed:", error);
  process.exitCode = 1;
});
