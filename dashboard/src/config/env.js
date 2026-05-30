const stripTrailingSlash = (value = "") => value.replace(/\/+$/, "");

const asBool = (value, fallback = false) => {
  if (value == null) return fallback;
  return String(value).toLowerCase() === "true";
};

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DITTO_URL = stripTrailingSlash(
  process.env.NEXT_PUBLIC_DITTO_URL ||
  process.env.VITE_DITTO_URL ||
  process.env.DITTO_URL ||
  "http://localhost:8080",
);

const THING_ID =
  process.env.NEXT_PUBLIC_THING_ID ||
  process.env.VITE_THING_ID ||
  process.env.THING_ID ||
  "building:floor1:elevator";

// Canonical MQTT topic helpers. The Ditto Thing ID is unchanged
// ("building:floor1:elevator"); inside MQTT topics we use the safe form
// ("building-floor1-elevator") because ':' is awkward in topic ACLs.
export const thingIdToMqttId = (id) => String(id || "").replace(/:/g, "-");
export const mqttIdToThingId = (id) => String(id || "").replace(/-/g, ":");
export const buildTelemetryTopic = (id) => `elevator/${thingIdToMqttId(id)}/telemetry`;
export const buildEventsTopic    = (id) => `elevator/${thingIdToMqttId(id)}/events`;
export const buildCommandsTopic  = (id) => `elevator/${thingIdToMqttId(id)}/commands`;
export const buildStatusTopic    = (id) => `elevator/${thingIdToMqttId(id)}/status`;

const MQTT_ID =
  process.env.NEXT_PUBLIC_MQTT_ID ||
  process.env.VITE_MQTT_ID ||
  process.env.PRIMARY_MQTT_ID ||
  thingIdToMqttId(THING_ID);

// Subscription (fleet-wide single-level wildcard) and per-device publish topics.
const MQTT_TELEMETRY_SUBSCRIPTION =
  process.env.NEXT_PUBLIC_MQTT_TELEMETRY_SUBSCRIPTION ||
  process.env.MQTT_TELEMETRY_SUBSCRIPTION ||
  "elevator/+/telemetry";
const MQTT_TELEMETRY_TOPIC =
  process.env.NEXT_PUBLIC_MQTT_TELEMETRY_TOPIC ||
  process.env.MQTT_TELEMETRY_TOPIC ||
  buildTelemetryTopic(THING_ID);
const MQTT_COMMANDS_TOPIC =
  process.env.NEXT_PUBLIC_MQTT_COMMANDS_TOPIC ||
  process.env.MQTT_COMMANDS_TOPIC ||
  buildCommandsTopic(THING_ID);
const MQTT_STATUS_TOPIC =
  process.env.NEXT_PUBLIC_MQTT_STATUS_TOPIC ||
  process.env.MQTT_STATUS_TOPIC ||
  buildStatusTopic(THING_ID);

export const env = {
  DITTO_URL,
  DITTO_PROXY_BASE: "/api/ditto",
  DITTO_EVENTS_PATH: `/api/ditto/api/2/things/${encodeURIComponent(THING_ID)}`,
  MQTT_URL:
    process.env.NEXT_PUBLIC_MQTT_URL ||
    process.env.VITE_MQTT_URL ||
    process.env.MQTT_URL ||
    "ws://127.0.0.1:9001",
  // Comma-separated subscription list consumed by mqttClient.js. The canonical
  // single subscription is the fleet-wide wildcard; the legacy
  // NEXT_PUBLIC_MQTT_TOPIC override still wins when set so existing local
  // configs do not break.
  MQTT_TOPIC:
    process.env.NEXT_PUBLIC_MQTT_TOPIC ||
    process.env.VITE_MQTT_TOPIC ||
    process.env.MQTT_TOPIC ||
    MQTT_TELEMETRY_SUBSCRIPTION,
  MQTT_TELEMETRY_SUBSCRIPTION,
  MQTT_TELEMETRY_TOPIC,
  MQTT_COMMANDS_TOPIC,
  MQTT_STATUS_TOPIC,
  MQTT_ID,
  // Broker credentials for the read-only 'dashboard' identity. These reach the
  // browser bundle (NEXT_PUBLIC_*), which is acceptable because the broker ACL
  // restricts this identity to subscribe-only on telemetry/events/status.
  MQTT_USERNAME:
    process.env.NEXT_PUBLIC_MQTT_USERNAME ||
    process.env.VITE_MQTT_USERNAME ||
    "",
  MQTT_PASSWORD:
    process.env.NEXT_PUBLIC_MQTT_PASSWORD ||
    process.env.VITE_MQTT_PASSWORD ||
    "",
  THING_ID,
  DITTO_USERNAME:
    process.env.NEXT_PUBLIC_DITTO_USERNAME ||
    process.env.VITE_DITTO_USERNAME ||
    process.env.DITTO_USER ||
    "ditto",
  DITTO_PASSWORD:
    process.env.NEXT_PUBLIC_DITTO_PASSWORD ||
    process.env.VITE_DITTO_PASSWORD ||
    process.env.DITTO_PASSWORD ||
    "ditto",
  DITTO_POLL_INTERVAL_MS: asInt(
    process.env.NEXT_PUBLIC_DITTO_POLL_INTERVAL_MS ||
      process.env.VITE_DITTO_POLL_INTERVAL_MS,
    2000,
  ),
  DITTO_SSE_ENABLED: asBool(
    process.env.NEXT_PUBLIC_DITTO_SSE_ENABLED ||
      process.env.VITE_DITTO_SSE_ENABLED,
    true,
  ),
};
