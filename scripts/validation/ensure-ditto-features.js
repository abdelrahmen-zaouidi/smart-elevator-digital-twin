#!/usr/bin/env node
/*
 * Ensure the Smart Elevator Ditto Thing contains the required feature surface.
 *
 * This is a non-destructive repair helper for validation/demo environments. It
 * reads the current Thing, creates only missing features, and leaves existing
 * feature properties untouched. Use it when an n8n workflow fails with
 * things:feature.notfound for ai_analysis, maintenance_schedule, or another
 * seeded feature.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_THING_ID = "building:floor1:elevator";

const FEATURE_SEEDS = {
  cabin: {
    properties: {
      current_floor: 0,
      target_floor: 0,
      direction: "idle",
      load_kg: 0,
      temperature_c: 20,
      speed_ms: 0,
      emergency_stop: false,
    },
  },
  door: {
    properties: {
      state: "CLOSED",
      door_forced_entry: false,
    },
  },
  motor: {
    properties: {
      vibration_level: 0,
      hours_operated: 0,
      health_status: "GOOD",
      temperature_c: 35,
    },
  },
  security: {
    properties: {
      audio_distress_active: false,
      unauthorized_access_attempts: 0,
      rfid_last_card: "",
      rfid_access_granted: true,
      alert_level: "NORMAL",
    },
  },
  microcontroller: {
    properties: {
      board: "ESP32-S3",
      connected: false,
      status: "OFFLINE",
      source: "mqtt_status",
      transport: "MQTT",
      mqtt_id: "building-floor1-elevator",
      mqtt_topic: "elevator/building-floor1-elevator/status",
      telemetry_topic: "elevator/building-floor1-elevator/telemetry",
      last_seen_at: null,
      last_telemetry_at: null,
      last_status_at: null,
      last_disconnected_at: null,
    },
  },
  control: {
    properties: {
      pending_command: null,
      last_forwarded_command: null,
      last_command_result: null,
      last_ignored_command_result: null,
    },
  },
  incident_log: {
    properties: {
      entries: [],
      open_incidents: 0,
    },
  },
  energy: {
    properties: {
      kwh_today: 0,
      kwh_month: 0,
      kwh_baseline: 0,
      co2_kg: 0,
      regen_kwh: 0,
    },
  },
  performance: {
    properties: {
      avg_wait_s: 0,
      avg_trip_s: 0,
      availability_pct: 100,
      door_cycle_efficiency: 100,
    },
  },
  predicted_failures: {
    properties: {
      bearing_days: null,
      door_motor_days: null,
      brake_days: null,
      overall_risk: 0,
    },
  },
  ai_analysis: {
    properties: {
      last_analysis_at: null,
      analyzed_at: null,
      severity: "OK",
      risk_score: 0,
      risk_label: "LOW",
      flags: [],
      summary: "",
      explanation: "",
      recommended_action: "",
      recommended_actions: [],
      requires_human_review: false,
      source: "provisioning",
      updated_at: null,
    },
  },
  maintenance_schedule: {
    properties: {
      next_service_date: null,
      last_service_date: null,
      open_work_orders: 0,
      priority: "NORMAL",
    },
  },
};

function readEnvFile(relativePath) {
  const filePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}

const env = {
  ...readEnvFile(".env"),
  ...readEnvFile(path.join("dashboard", ".env.local")),
  ...process.env,
};

function valueFor(key, fallback = "") {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function urlJoin(base, suffix) {
  return `${stripTrailingSlash(base)}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function requestJson(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = transport.request(
      parsed,
      {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
        timeout: options.timeoutMs || 5000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ statusCode: response.statusCode, body: text });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`timeout after ${options.timeoutMs || 5000}ms`));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function main() {
  const dittoUrl = stripTrailingSlash(
    valueFor("DITTO_CHECK_URL", valueFor("DITTO_URL", valueFor("DITTO_PUBLIC_BASE_URL", "http://localhost:8080"))),
  );
  const thingId = valueFor("PRIMARY_THING_ID", valueFor("NEXT_PUBLIC_THING_ID", DEFAULT_THING_ID));
  const username = valueFor("DITTO_USERNAME", valueFor("DITTO_USER", valueFor("NEXT_PUBLIC_DITTO_USERNAME", "ditto")));
  const password = valueFor("DITTO_PASSWORD", valueFor("DITTO_PASS", valueFor("NEXT_PUBLIC_DITTO_PASSWORD", "ditto")));
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };
  const thingUrl = urlJoin(dittoUrl, `/api/2/things/${encodeURIComponent(thingId)}`);

  console.log("Ditto Feature Repair Check");
  console.log(`URL      : ${dittoUrl}`);
  console.log(`Thing ID : ${thingId}`);
  console.log(`User     : ${username}`);
  console.log("");

  const response = await requestJson(thingUrl, { headers });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Thing GET failed with HTTP ${response.statusCode}: ${response.body.slice(0, 300)}`);
  }

  const thing = JSON.parse(response.body);
  const features = thing.features && typeof thing.features === "object" ? thing.features : {};
  let created = 0;
  let failed = 0;

  for (const [featureId, seed] of Object.entries(FEATURE_SEEDS)) {
    if (Object.prototype.hasOwnProperty.call(features, featureId)) {
      console.log(`SKIP    ${featureId} - already present`);
      continue;
    }

    const featureUrl = urlJoin(dittoUrl, `/api/2/things/${encodeURIComponent(thingId)}/features/${encodeURIComponent(featureId)}`);
    const put = await requestJson(featureUrl, {
      method: "PUT",
      headers,
      body: seed,
    });

    if (put.statusCode >= 200 && put.statusCode < 300) {
      created += 1;
      console.log(`PASS    ${featureId} - created`);
    } else {
      failed += 1;
      console.log(`FAIL    ${featureId} - HTTP ${put.statusCode}: ${put.body.slice(0, 200)}`);
    }
  }

  console.log("");
  console.log(`Created ${created} missing feature(s).`);
  console.log(`Failed  ${failed} feature repair(s).`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL    ${error.message}`);
  process.exitCode = 1;
});
