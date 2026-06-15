import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const dashboardDir = path.resolve(path.dirname(__filename), "..");
const projectRoot = path.resolve(dashboardDir, "../..");

const OPERATIONAL_TABLES = [
  "telemetry_raw",
  "audit_log",
  "notification_outbox",
  "agent_state",
  "control_command_log",
  "maintenance_work_orders",
  "system_health_history",
];

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

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function thingIdToMqttId(thingId) {
  return String(thingId || "").replace(/:/g, "-");
}

function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function existingTables(client, tableNames) {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
    `,
    [tableNames],
  );
  return result.rows.map((row) => row.table_name);
}

async function countRows(client, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(tableName)}`);
    counts[tableName] = result.rows[0]?.count ?? 0;
  }
  return counts;
}

async function resetPostgres() {
  const pool = new Pool({
    host: readEnv("POSTGRES_HOST", "127.0.0.1"),
    port: Number.parseInt(readEnv("POSTGRES_PORT", "5432"), 10),
    database: readEnv("POSTGRES_DB", "smart_building"),
    user: readEnv("POSTGRES_USER", "admin"),
    password: readEnv("POSTGRES_PASSWORD", "change_me_local_only"),
    max: 1,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 1000,
  });

  const client = await pool.connect();
  try {
    const tables = await existingTables(client, OPERATIONAL_TABLES);
    if (tables.length === 0) {
      console.log("[db] No operational tables found to truncate.");
      return {};
    }

    const tableList = tables.map(quoteIdentifier).join(", ");
    await client.query("BEGIN");
    await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    await client.query("COMMIT");

    const counts = await countRows(client, tables);
    console.log("[db] Operational tables truncated:", counts);
    return counts;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function freshAttributes(currentThing, thingId) {
  return {
    location: currentThing?.attributes?.location || "Building A / Shaft 1",
    thing_id: thingId,
    system_mode: "NORMAL",
    risk_score: 0,
    maintenance_priority: "LOW",
    system_health_index: 100,
    energy_efficiency: 100,
    uptime_pct: 100,
  };
}

function freshFeatureProperties(thingId = "building:floor1:elevator") {
  const mqttId = readEnv("PRIMARY_MQTT_ID") || readEnv("NEXT_PUBLIC_MQTT_ID") || thingIdToMqttId(thingId);

  return {
    cabin: {
      current_floor: 0,
      target_floor: 0,
      direction: "IDLE",
      load_kg: 0,
      temperature_c: 0,
      speed_ms: 0,
      emergency_stop: false,
      trips_today: 0,
    },
    door: {
      state: "OPEN",
      door_forced_entry: false,
      cycle_count: 0,
      obstruction_events: 0,
    },
    motor: {
      vibration_level: 0,
      hours_operated: 0,
      health_status: "GOOD",
      temperature_c: 0,
      current_draw_a: 0,
      power_kw: 0,
    },
    security: {
      audio_distress_active: false,
      unauthorized_access_attempts: 0,
      rfid_last_card: "",
      rfid_access_granted: true,
      alert_level: "NORMAL",
      active_security_incident: false,
      human_review_required: false,
      last_review_at: null,
    },
    microcontroller: {
      board: "ESP32-S3",
      connected: false,
      status: "OFFLINE",
      source: "mqtt_status",
      transport: "MQTT",
      mqtt_id: mqttId,
      mqtt_topic: `elevator/${mqttId}/status`,
      telemetry_topic: `elevator/${mqttId}/telemetry`,
      last_seen_at: null,
      last_telemetry_at: null,
      last_status_at: null,
      last_disconnected_at: null,
    },
    incident_log: {
      entries: [],
      open_incidents: 0,
      last_acknowledged_id: null,
      last_acknowledged_at: null,
      last_resolved_id: null,
      last_resolved_at: null,
      last_reset_at: new Date().toISOString(),
    },
    energy: {
      kwh_today: 0,
      kwh_month: 0,
      kwh_baseline: 0,
      co2_kg: 0,
      regen_kwh: 0,
    },
    performance: {
      avg_wait_s: 0,
      avg_trip_s: 0,
      availability_pct: 100,
      door_cycle_efficiency: 100,
    },
    predicted_failures: {
      motor_rul_hours: 10000,
      bearing_health_pct: 100,
      door_mechanism_pct: 100,
      rope_tension_pct: 100,
      next_service_date: "",
    },
    ai_analysis: {},
    maintenance_schedule: {},
  };
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

  throw new Error(`All Ditto reset paths failed: ${errors.join(" | ")}`);
}

async function resetDitto() {
  return withDittoEndpoint(async ({ name, root, headers, thingId }) => {
    let currentThing = null;
    try {
      currentThing = await requestJson(root, { method: "GET", headers });
    } catch (error) {
      console.warn(`[ditto] Could not read current thing through ${name}; continuing with default baseline. ${error.message}`);
    }

    await requestJson(`${root}/attributes`, {
      method: "PUT",
      headers,
      body: JSON.stringify(freshAttributes(currentThing, thingId)),
    });

    const features = freshFeatureProperties(thingId);
    for (const [featureId, properties] of Object.entries(features)) {
      await requestJson(`${root}/features/${encodePathSegment(featureId)}/properties`, {
        method: "PUT",
        headers,
        body: JSON.stringify(properties),
      });
    }

    const verify = await requestJson(root, { method: "GET", headers });
    const summary = {
      endpoint: name,
      thing_id: thingId,
      risk_score: verify?.attributes?.risk_score,
      system_mode: verify?.attributes?.system_mode,
      current_floor: verify?.features?.cabin?.properties?.current_floor,
      esp32_status: verify?.features?.microcontroller?.properties?.status,
      open_incidents: verify?.features?.incident_log?.properties?.open_incidents,
      unauthorized_access_attempts: verify?.features?.security?.properties?.unauthorized_access_attempts,
    };
    console.log("[ditto] Thing reset:", summary);
    return summary;
  });
}

async function main() {
  loadEnvFile(path.join(projectRoot, ".env"));
  loadEnvFile(path.join(dashboardDir, ".env.local"), true);

  const mode = process.argv.includes("--db-only")
    ? "db"
    : process.argv.includes("--ditto-only")
      ? "ditto"
      : "all";

  const result = {};
  if (mode === "all" || mode === "db") {
    result.database = await resetPostgres();
  }
  if (mode === "all" || mode === "ditto") {
    result.ditto = await resetDitto();
  }

  console.log("[reset] Fresh-start reset completed.");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("[reset] Fresh-start reset failed:", error);
  process.exitCode = 1;
});
