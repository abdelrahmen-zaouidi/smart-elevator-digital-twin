#!/usr/bin/env node
/*
 * Local validation health check for the Smart Elevator Digital Twin.
 *
 * This script intentionally uses only Node.js built-ins so it can run without
 * paid tools or additional npm packages. It checks local development services,
 * environment configuration, canonical MQTT topics, Ditto Thing access, and
 * basic PostgreSQL readiness through Docker.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const net = require("net");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_THING_ID = "building:floor1:elevator";
const DEFAULT_MQTT_ID = "building-floor1-elevator";
const REQUIRED_DITTO_FEATURES = [
  "cabin",
  "door",
  "motor",
  "security",
  "incident_log",
  "energy",
  "performance",
  "predicted_failures",
  "ai_analysis",
  "maintenance_schedule",
];

const results = [];

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

function mergeEnv() {
  return {
    ...readEnvFile(".env"),
    ...readEnvFile(path.join("dashboard", ".env.local")),
    ...process.env,
  };
}

const env = mergeEnv();

function isSecretKey(key) {
  return /(PASSWORD|TOKEN|SECRET|KEY|CHAT_ID|WEBHOOK_URL)$/i.test(key);
}

function valueFor(key, fallback = "") {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function add(status, name, detail = "") {
  results.push({ status, name, detail });
  const padded = status.padEnd(7, " ");
  console.log(`${padded} ${name}${detail ? ` - ${detail}` : ""}`);
}

function pass(name, detail) {
  add("PASS", name, detail);
}

function warn(name, detail) {
  add("WARNING", name, detail);
}

function fail(name, detail) {
  add("FAIL", name, detail);
}

function errorMessage(error) {
  if (!error) return "unknown error";
  return error.message || error.code || String(error);
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function urlJoin(base, suffix) {
  return `${stripTrailingSlash(base)}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function normalizeHostForLocalCheck(host) {
  if (!host || host === "0.0.0.0" || host === "mosquitto" || host === "postgres" || host === "docker-nginx-1") {
    return "127.0.0.1";
  }
  return host;
}

function httpRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.request(
      parsed,
      {
        method: options.method || "GET",
        headers: options.headers || {},
        timeout: options.timeoutMs || 5000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`timeout after ${options.timeoutMs || 5000}ms`));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    const done = (ok, error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ ok, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, `timeout after ${timeoutMs}ms`));
    socket.once("error", (error) => done(false, error.message));
    socket.connect(port, host);
  });
}

function execDocker(args, options = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync("docker", args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.timeoutMs || 10000,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout).trim() : "",
      stderr: error.stderr ? String(error.stderr).trim() : error.message,
    };
  }
}

function checkEnvironment() {
  console.log("\nEnvironment");
  const required = [
    "PRIMARY_THING_ID",
    "PRIMARY_MQTT_ID",
    "MQTT_TELEMETRY_TOPIC",
    "MQTT_EVENTS_TOPIC",
    "MQTT_COMMANDS_TOPIC",
    "MQTT_STATUS_TOPIC",
    "MQTT_TELEMETRY_SUBSCRIPTION",
    "DITTO_URL",
    "POSTGRES_DB",
    "POSTGRES_USER",
  ];

  for (const key of required) {
    if (valueFor(key)) {
      pass(`env ${key}`, isSecretKey(key) ? "configured" : "configured");
    } else {
      warn(`env ${key}`, "not set; runtime may rely on code or compose defaults");
    }
  }
}

function checkTopics() {
  console.log("\nMQTT topic configuration");
  const topicKeys = [
    "MQTT_TELEMETRY_TOPIC",
    "MQTT_EVENTS_TOPIC",
    "MQTT_COMMANDS_TOPIC",
    "MQTT_STATUS_TOPIC",
    "NEXT_PUBLIC_MQTT_TELEMETRY_TOPIC",
    "NEXT_PUBLIC_MQTT_COMMANDS_TOPIC",
  ];
  const subscriptionKeys = [
    "MQTT_TELEMETRY_SUBSCRIPTION",
    "MQTT_EVENTS_SUBSCRIPTION",
    "MQTT_COMMANDS_SUBSCRIPTION",
    "MQTT_STATUS_SUBSCRIPTION",
    "NEXT_PUBLIC_MQTT_TELEMETRY_SUBSCRIPTION",
  ];
  const topicRegex = /^elevator\/[^/]+\/(telemetry|events|commands|status)$/;
  const subscriptionRegex = /^elevator\/(\+|[^/]+)\/(telemetry|events|commands|status)$/;

  for (const key of topicKeys) {
    const configured = valueFor(key);
    if (!configured) {
      warn(`topic ${key}`, "not set");
    } else if (topicRegex.test(configured)) {
      pass(`topic ${key}`, "canonical");
    } else {
      fail(`topic ${key}`, "does not match elevator/{id}/{telemetry|events|commands|status}");
    }
  }

  for (const key of subscriptionKeys) {
    const configured = valueFor(key);
    if (!configured) {
      warn(`subscription ${key}`, "not set");
    } else if (subscriptionRegex.test(configured)) {
      pass(`subscription ${key}`, "canonical");
    } else {
      fail(`subscription ${key}`, "does not match elevator/+/{telemetry|events|commands|status}");
    }
  }
}

function parseComposePs(output) {
  if (!output) return [];
  const trimmed = output.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Docker Compose often emits one JSON object per line.
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

function checkDockerServices() {
  console.log("\nDocker services");
  const ps = execDocker(["compose", "ps", "--format", "json"]);
  if (!ps.ok) {
    warn("docker compose ps", ps.stderr || "Docker Compose not available");
    return;
  }

  const services = parseComposePs(ps.stdout);
  const required = ["mosquitto", "bridge", "n8n", "postgres"];
  const optional = ["simulator", "ollama", "adminer", "grafana"];

  for (const service of required) {
    const row = services.find((item) => item.Service === service || item.Name === service || String(item.raw || "").includes(service));
    if (!row) {
      fail(`compose service ${service}`, "not listed");
      continue;
    }

    const state = String(row.State || row.Status || row.raw || "").toLowerCase();
    if (state.includes("running") || state.includes("healthy")) {
      pass(`compose service ${service}`, state || "running");
    } else {
      fail(`compose service ${service}`, state || "not running");
    }
  }

  for (const service of optional) {
    const row = services.find((item) => item.Service === service || item.Name === service || String(item.raw || "").includes(service));
    if (!row) {
      warn(`optional service ${service}`, "not listed; this can be acceptable");
    } else {
      const state = String(row.State || row.Status || row.raw || "").toLowerCase();
      warn(`optional service ${service}`, state || "listed");
    }
  }
}

async function checkTcpServices() {
  console.log("\nTCP service reachability");
  const mqttHost = normalizeHostForLocalCheck(valueFor("MQTT_CHECK_HOST", valueFor("MQTT_HOST", "127.0.0.1")));
  const mqttPort = Number(valueFor("MQTT_PORT", "1883"));
  const mqttWsPort = Number(valueFor("MQTT_WS_PORT", "9001"));
  const pgHost = normalizeHostForLocalCheck(valueFor("POSTGRES_CHECK_HOST", valueFor("POSTGRES_HOST", "127.0.0.1")));
  const pgPort = Number(valueFor("POSTGRES_PORT", "5432"));

  for (const [name, host, port] of [
    ["Mosquitto TCP", mqttHost, mqttPort],
    ["Mosquitto WebSocket TCP", mqttHost, mqttWsPort],
    ["PostgreSQL TCP", pgHost, pgPort],
  ]) {
    const result = await tcpCheck(host, port);
    if (result.ok) pass(name, `${host}:${port}`);
    else fail(name, `${host}:${port} unreachable: ${result.error}`);
  }
}

async function checkHttpServices() {
  console.log("\nHTTP service reachability");
  const dashboardUrl = stripTrailingSlash(valueFor("DASHBOARD_URL", "http://localhost:3000"));
  const n8nPort = valueFor("N8N_PORT", "5678");
  const n8nUrl = stripTrailingSlash(valueFor("N8N_CHECK_URL", `http://localhost:${n8nPort}`));
  const dittoUrl = stripTrailingSlash(
    valueFor(
      "DITTO_CHECK_URL",
      valueFor("DITTO_URL", valueFor("NEXT_PUBLIC_DITTO_URL", valueFor("DITTO_PUBLIC_BASE_URL", "http://localhost:8080"))),
    ),
  );

  const dashboard = await httpRequest(dashboardUrl, { timeoutMs: 5000 }).catch((error) => ({ error }));
  if (dashboard.error) fail("Dashboard HTTP", errorMessage(dashboard.error));
  else if (dashboard.statusCode >= 200 && dashboard.statusCode < 400) pass("Dashboard HTTP", `${dashboardUrl} returned ${dashboard.statusCode}`);
  else if (dashboard.statusCode >= 400 && dashboard.statusCode < 500) warn("Dashboard HTTP", `${dashboardUrl} returned ${dashboard.statusCode}`);
  else fail("Dashboard HTTP", `${dashboardUrl} returned ${dashboard.statusCode}`);

  const n8nHealth = await httpRequest(urlJoin(n8nUrl, "/healthz"), { timeoutMs: 5000 }).catch((error) => ({ error }));
  if (!n8nHealth.error && n8nHealth.statusCode >= 200 && n8nHealth.statusCode < 400) {
    pass("n8n HTTP", `${n8nUrl}/healthz returned ${n8nHealth.statusCode}`);
  } else {
    const n8nRoot = await httpRequest(n8nUrl, { timeoutMs: 5000 }).catch((error) => ({ error }));
    if (n8nRoot.error) fail("n8n HTTP", errorMessage(n8nRoot.error));
    else if (n8nRoot.statusCode >= 200 && n8nRoot.statusCode < 400) pass("n8n HTTP", `${n8nUrl} returned ${n8nRoot.statusCode}`);
    else if (n8nRoot.statusCode >= 400 && n8nRoot.statusCode < 500) warn("n8n HTTP", `${n8nUrl} returned ${n8nRoot.statusCode}`);
    else fail("n8n HTTP", `${n8nUrl} returned ${n8nRoot.statusCode}`);
  }

  const dittoHealth = await httpRequest(urlJoin(dittoUrl, "/health"), { timeoutMs: 5000 }).catch((error) => ({ error }));
  if (!dittoHealth.error && dittoHealth.statusCode >= 200 && dittoHealth.statusCode < 400) {
    pass("Ditto health", `${dittoUrl}/health returned ${dittoHealth.statusCode}`);
  } else {
    const actuatorHealth = await httpRequest(urlJoin(dittoUrl, "/actuator/health"), { timeoutMs: 5000 }).catch((error) => ({ error }));
    if (actuatorHealth.error) fail("Ditto health", errorMessage(actuatorHealth.error));
    else if (actuatorHealth.statusCode >= 200 && actuatorHealth.statusCode < 400) pass("Ditto health", `${dittoUrl}/actuator/health returned ${actuatorHealth.statusCode}`);
    else warn("Ditto health", `${dittoUrl} health endpoints returned ${dittoHealth.statusCode || "error"} and ${actuatorHealth.statusCode}`);
  }

  const thingId = valueFor("PRIMARY_THING_ID", valueFor("NEXT_PUBLIC_THING_ID", DEFAULT_THING_ID));
  const username = valueFor("DITTO_USERNAME", valueFor("DITTO_USER", valueFor("NEXT_PUBLIC_DITTO_USERNAME", "ditto")));
  const password = valueFor("DITTO_PASSWORD", valueFor("DITTO_PASS", valueFor("NEXT_PUBLIC_DITTO_PASSWORD", "ditto")));
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const thing = await httpRequest(urlJoin(dittoUrl, `/api/2/things/${encodeURIComponent(thingId)}`), {
    timeoutMs: 5000,
    headers: { Authorization: `Basic ${auth}` },
  }).catch((error) => ({ error }));

  if (thing.error) {
    fail("Ditto Thing", thing.error.message);
  } else if (thing.statusCode >= 200 && thing.statusCode < 300) {
    pass("Ditto Thing", `${thingId} reachable`);
    try {
      const parsedThing = JSON.parse(thing.body);
      const features = parsedThing && parsedThing.features && typeof parsedThing.features === "object"
        ? parsedThing.features
        : {};
      for (const featureId of REQUIRED_DITTO_FEATURES) {
        if (Object.prototype.hasOwnProperty.call(features, featureId)) {
          pass(`Ditto feature ${featureId}`, "present");
        } else {
          fail(`Ditto feature ${featureId}`, "missing; re-run scripts/init-ditto.ps1 or upsert the feature before n8n workflows write to it");
        }
      }
    } catch (error) {
      warn("Ditto Thing feature inventory", `could not parse Thing JSON: ${error.message}`);
    }
  } else {
    fail("Ditto Thing", `${thingId} returned ${thing.statusCode}`);
  }
}

function checkPostgresThroughDocker() {
  console.log("\nPostgreSQL validation");
  const user = valueFor("POSTGRES_USER", "admin");
  const db = valueFor("POSTGRES_DB", "smart_building");

  const ready = execDocker(["exec", "elevator_db", "pg_isready", "-U", user, "-d", db]);
  if (!ready.ok) {
    fail("PostgreSQL pg_isready", ready.stderr || ready.stdout || "not ready");
    return;
  }
  pass("PostgreSQL pg_isready", ready.stdout || "ready");

  const query = execDocker(["exec", "elevator_db", "psql", "-U", user, "-d", db, "-tAc", "SELECT 1"]);
  if (!query.ok || query.stdout.trim() !== "1") {
    fail("PostgreSQL SELECT 1", query.stderr || query.stdout || "query failed");
    return;
  }
  pass("PostgreSQL SELECT 1", "database connection works");

  const schemaQuery = [
    "SELECT table_name",
    "FROM information_schema.tables",
    "WHERE table_schema = 'public'",
    "AND table_name IN ('telemetry_raw','audit_log','notification_outbox','control_command_log','maintenance_work_orders','system_health_history')",
    "ORDER BY table_name;",
  ].join(" ");
  const schema = execDocker(["exec", "elevator_db", "psql", "-U", user, "-d", db, "-tAc", schemaQuery]);
  if (!schema.ok) {
    fail("PostgreSQL schema check", schema.stderr || "query failed");
    return;
  }

  const found = new Set(schema.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const expected = ["telemetry_raw", "audit_log", "notification_outbox", "control_command_log", "maintenance_work_orders", "system_health_history"];
  for (const table of expected) {
    if (found.has(table)) pass(`table ${table}`, "exists");
    else fail(`table ${table}`, "missing");
  }
}

function checkSourceFiles() {
  console.log("\nRepository validation helpers");
  const files = [
    "docker-compose.yml",
    "dashboard/backend/bridge.js",
    "esp32_simulator.py",
    "scripts/init-ditto.ps1",
    "scripts/validation/ensure-ditto-features.js",
    "scripts/validate_mqtt_topics.py",
    "N8n workflows/03_control_agent.json",
    "postgres/init/001_timescaledb.sql",
  ];

  for (const relativePath of files) {
    if (fs.existsSync(path.join(REPO_ROOT, relativePath))) {
      pass(`file ${relativePath}`, "present");
    } else {
      fail(`file ${relativePath}`, "missing");
    }
  }

  const thingId = valueFor("PRIMARY_THING_ID", valueFor("NEXT_PUBLIC_THING_ID", DEFAULT_THING_ID));
  const mqttId = valueFor("PRIMARY_MQTT_ID", valueFor("NEXT_PUBLIC_MQTT_ID", DEFAULT_MQTT_ID));
  const expectedMqttId = thingId.replace(/:/g, "-");
  if (mqttId === expectedMqttId) {
    pass("Thing ID to MQTT ID mapping", `${thingId} -> ${mqttId}`);
  } else {
    fail("Thing ID to MQTT ID mapping", `expected ${expectedMqttId}, found ${mqttId}`);
  }
}

async function main() {
  console.log("Smart Elevator Validation Health Check");
  console.log(`Repository: ${REPO_ROOT}`);

  checkEnvironment();
  checkTopics();
  checkSourceFiles();
  checkDockerServices();
  await checkTcpServices();
  await checkHttpServices();
  checkPostgresThroughDocker();

  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  console.log("\nSummary");
  console.log(`PASS    ${counts.PASS || 0}`);
  console.log(`WARNING ${counts.WARNING || 0}`);
  console.log(`FAIL    ${counts.FAIL || 0}`);

  if ((counts.FAIL || 0) > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAIL    health check crashed -", error.message);
  process.exitCode = 1;
});
