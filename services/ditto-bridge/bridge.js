const mqtt = require("mqtt");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const log = require("./logger");

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.resolve(__dirname, "../../.env"));
loadEnvFile(path.resolve(__dirname, "../../.env.local"), { override: true });

const MQTT_URL = process.env.MQTT_BROKER_URL || process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
// Broker auth (anonymous is disabled on the broker). Empty => anonymous connect
// (preserved for any local setup that still allows it).
const MQTT_USERNAME = process.env.MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "";

// Canonical MQTT topic helpers. Ditto Thing IDs use ':' (e.g.
// "building:floor1:elevator"); inside MQTT we use the safe form
// "building-floor1-elevator". The Ditto Thing ID itself is unchanged.
const thingIdToMqttId = (id) => String(id || "").replace(/:/g, "-");
const mqttIdToThingId = (id) => String(id || "").replace(/-/g, ":");
const buildTelemetryTopic = (id) => `elevator/${thingIdToMqttId(id)}/telemetry`;
const buildEventsTopic    = (id) => `elevator/${thingIdToMqttId(id)}/events`;
const buildCommandsTopic  = (id) => `elevator/${thingIdToMqttId(id)}/commands`;
const buildStatusTopic    = (id) => `elevator/${thingIdToMqttId(id)}/status`;

const TELEMETRY_SUBSCRIPTION =
  process.env.MQTT_TELEMETRY_SUBSCRIPTION || "elevator/+/telemetry";
const EVENTS_SUBSCRIPTION =
  process.env.MQTT_EVENTS_SUBSCRIPTION || "elevator/+/events";
const STATUS_SUBSCRIPTION =
  process.env.MQTT_STATUS_SUBSCRIPTION || "elevator/+/status";

// Allow MQTT_TOPIC / MQTT_TELEMETRY_TOPIC / NEXT_PUBLIC_MQTT_TOPIC overrides
// to remain effective, but the canonical default is the fleet-wide
// subscription set (telemetry / events / status). Deduplicated.
const configuredMqttTopics =
  process.env.MQTT_TOPIC ||
  process.env.MQTT_TELEMETRY_TOPIC ||
  process.env.NEXT_PUBLIC_MQTT_TOPIC ||
  "";
const MQTT_TOPICS = `${configuredMqttTopics},${TELEMETRY_SUBSCRIPTION},${EVENTS_SUBSCRIPTION},${STATUS_SUBSCRIPTION}`
  .split(",")
  .map((topic) => topic.trim())
  .filter((topic, index, topics) => topic && topics.indexOf(topic) === index);

const DITTO_URL = (
  process.env.DITTO_URL ||
  process.env.NEXT_PUBLIC_DITTO_URL ||
  process.env.DITTO_PUBLIC_BASE_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");
const THING_ID = process.env.THING_ID || process.env.PRIMARY_THING_ID || process.env.NEXT_PUBLIC_THING_ID || "building:floor1:elevator";
const PRIMARY_MQTT_ID =
  process.env.PRIMARY_MQTT_ID ||
  process.env.NEXT_PUBLIC_MQTT_ID ||
  thingIdToMqttId(THING_ID);
const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || process.env.NEXT_PUBLIC_DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || process.env.NEXT_PUBLIC_DITTO_PASSWORD || "ditto";
const DITTO_TIMEOUT_MS = Number.parseInt(process.env.DITTO_TIMEOUT_MS || "12000", 10);
const DITTO_WRITE_INTERVAL_MS = Number.parseInt(process.env.DITTO_WRITE_INTERVAL_MS || "1000", 10);
const DITTO_RETRY_DELAY_MS = Number.parseInt(process.env.DITTO_RETRY_DELAY_MS || "500", 10);
const MQTT_COMMAND_QOS = Number.parseInt(process.env.MQTT_COMMAND_QOS || "1", 10);
const COMMAND_INTENT_POLL_INTERVAL_MS = Number.parseInt(
  process.env.BRIDGE_COMMAND_INTENT_POLL_INTERVAL_MS || "500",
  10,
);
const COMMAND_INTENT_MAX_AGE_MS = Number.parseInt(
  process.env.BRIDGE_COMMAND_INTENT_MAX_AGE_MS || "300000",
  10,
);
const COMMAND_ACK_TIMEOUT_MS = Number.parseInt(
  process.env.BRIDGE_COMMAND_ACK_TIMEOUT_MS || "45000",
  10,
);
const LEGACY_LEAF_COMMAND_FORWARDING_ENABLED =
  String(process.env.BRIDGE_LEGACY_LEAF_COMMAND_FORWARDING || "false").toLowerCase() === "true";
const MICROCONTROLLER_TELEMETRY_HEARTBEAT_MS = Number.parseInt(
  process.env.MICROCONTROLLER_TELEMETRY_HEARTBEAT_MS || "5000",
  10,
);
const MICROCONTROLLER_OFFLINE_AFTER_MS = Number.parseInt(
  process.env.MICROCONTROLLER_OFFLINE_AFTER_MS || "15000",
  10,
);
// RFID access-control event mirroring. When the firmware/simulator reports an
// RFID scan (a decision counter increases), the bridge appends an entry to the
// Ditto accessControl.recentAccessLog ring buffer so any SCADA consumer sees it
// live. If BRIDGE_ACCESS_LOG_URL points at the dashboard /api/access-control/logs
// endpoint, the same event is also mirrored to durable Postgres storage.
const ACCESS_LOG_RING_MAX = Number.parseInt(process.env.ACCESS_LOG_RING_MAX || "100", 10);
const ACCESS_LOG_POST_URL = (process.env.BRIDGE_ACCESS_LOG_URL || "").trim();

const dittoClient = axios.create({
  baseURL: DITTO_URL,
  auth: {
    username: DITTO_USER,
    password: DITTO_PASSWORD,
  },
  timeout: DITTO_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const lastSerializedByPath = new Map();
const lastMicrocontrollerHeartbeatByThingId = new Map();
const lastMicrocontrollerStatusByThingId = new Map();
const lastMicrocontrollerSeenAtByThingId = new Map();
const microcontrollerOfflineTimersByThingId = new Map();
const FEATURE_PROPERTY_ALIASES = {
  cabin: {
    payload_weight_kg: "load_kg",
    payloadWeightKg: "load_kg",
    weight_kg: "load_kg",
    currentFloor: "current_floor",
    targetFloor: "target_floor",
    speedMs: "speed_ms",
    emergencyStop: "emergency_stop",
  },
  door: {
    door_state: "state",
    doorState: "state",
    forced_entry: "door_forced_entry",
    forcedEntry: "door_forced_entry",
  },
  motor: {
    vibration_g: "vibration_level",
    vibrationG: "vibration_level",
    vibration: "vibration_level",
    motor_temperature_c: "temperature_c",
    motorTemperatureC: "temperature_c",
    hoursOperated: "hours_operated",
    healthStatus: "health_status",
  },
  security: {
    audio_distress_detected: "audio_distress_active",
    audioDistressDetected: "audio_distress_active",
    unauthorized_access_count: "unauthorized_access_attempts",
    unauthorizedAccessCount: "unauthorized_access_attempts",
    rfidLastCard: "rfid_last_card",
    rfidAccessGranted: "rfid_access_granted",
    alertLevel: "alert_level",
  },
  fan: {
    fan_state: "state",
    fanState: "state",
    fan_mode: "mode",
    fanMode: "mode",
    on: "state",
    enabled: "state",
  },
  microcontroller: {
    mqttId: "mqtt_id",
    mqttTopic: "mqtt_topic",
    lastSeenAt: "last_seen_at",
    lastStatusAt: "last_status_at",
    lastDisconnectedAt: "last_disconnected_at",
  },
};
const FEATURE_PROPERTY_KEYS = {
  cabin: [
    "current_floor",
    "target_floor",
    "direction",
    "load_kg",
    "temperature_c",
    "speed_ms",
    "emergency_stop",
    "trips_today",
  ],
  door: ["state", "door_forced_entry", "cycle_count", "obstruction_events"],
  motor: [
    "vibration_level",
    "hours_operated",
    "health_status",
    "temperature_c",
    "current_draw_a",
    "power_kw",
  ],
  security: [
    "audio_distress_active",
    "unauthorized_access_attempts",
    "rfid_last_card",
    "rfid_access_granted",
    "alert_level",
  ],
  fan: [
    "state",
    "mode",
    "reason",
    "duty_cycle_pct",
    "runtime_today_min",
    "last_changed_at",
  ],
  microcontroller: [
    "board",
    "connected",
    "status",
    "source",
    "transport",
    "mqtt_id",
    "mqtt_topic",
    "telemetry_topic",
    "last_seen_at",
    "last_telemetry_at",
    "last_status_at",
    "last_disconnected_at",
  ],
};

function decodePathSegment(value) {
  try {
    return decodeURIComponent(String(value).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return String(value);
  }
}

function hasKeys(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function applyPropertyAliases(featureId, properties) {
  if (!isObject(properties)) return properties;

  const aliases = FEATURE_PROPERTY_ALIASES[featureId] || {};
  const normalized = { ...properties };

  Object.entries(aliases).forEach(([sourceKey, targetKey]) => {
    if (normalized[sourceKey] !== undefined && normalized[targetKey] === undefined) {
      normalized[targetKey] = normalized[sourceKey];
    }

    if (sourceKey !== targetKey && normalized[sourceKey] !== undefined) {
      delete normalized[sourceKey];
    }
  });

  return normalized;
}

function normalizeFeaturePayload(featureId, featurePayload) {
  if (!isObject(featurePayload)) return featurePayload;

  if (isObject(featurePayload.properties)) {
    return {
      ...featurePayload,
      properties: applyPropertyAliases(featureId, featurePayload.properties),
    };
  }

  const knownKeys = [
    ...(FEATURE_PROPERTY_KEYS[featureId] || []),
    ...Object.keys(FEATURE_PROPERTY_ALIASES[featureId] || {}),
  ];
  if (knownKeys.some((key) => featurePayload[key] !== undefined)) {
    return {
      properties: applyPropertyAliases(featureId, featurePayload),
    };
  }

  return featurePayload;
}

function normalizeFeatureTree(features) {
  if (!isObject(features)) return {};

  return Object.entries(features).reduce((accumulator, [featureId, featurePayload]) => {
    accumulator[featureId] = normalizeFeaturePayload(featureId, featurePayload);
    return accumulator;
  }, {});
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function featureProperties(features, featureId) {
  const feature = isObject(features?.[featureId]) ? features[featureId] : {};
  return isObject(feature.properties) ? feature.properties : feature;
}

function deriveRiskAttributesFromFeatures(features) {
  if (!isObject(features)) return null;

  const cabin = featureProperties(features, "cabin");
  const door = featureProperties(features, "door");
  const motor = featureProperties(features, "motor");
  const security = featureProperties(features, "security");
  let risk = 0;
  let hasSignal = false;

  const vibration = finiteNumber(motor.vibration_level);
  if (vibration != null) {
    hasSignal = true;
    if (vibration > 0.25) risk = Math.max(risk, 90);
    else if (vibration > 0.12) risk = Math.max(risk, 58);
    else if (vibration > 0.06) risk = Math.max(risk, 35);
  }

  const temperature = finiteNumber(motor.temperature_c);
  if (temperature != null) {
    hasSignal = true;
    if (temperature > 85) risk = Math.max(risk, 90);
    else if (temperature > 70) risk = Math.max(risk, 58);
    else if (temperature > 55) risk = Math.max(risk, 32);
  }

  const loadKg = finiteNumber(cabin.load_kg);
  if (loadKg != null) {
    hasSignal = true;
    if (loadKg > 800) risk = Math.max(risk, 88);
    else if (loadKg > 640) risk = Math.max(risk, 48);
    else if (loadKg > 520) risk = Math.max(risk, 30);
  }

  const healthStatus = String(motor.health_status || "").toUpperCase();
  if (healthStatus === "CRITICAL") {
    hasSignal = true;
    risk = Math.max(risk, 90);
  } else if (healthStatus === "WARNING") {
    hasSignal = true;
    risk = Math.max(risk, 58);
  }

  const alertLevel = String(security.alert_level || "").toUpperCase();
  if (cabin.emergency_stop || cabin.movement_locked || motor.safety_interlock) {
    hasSignal = true;
    risk = Math.max(risk, 88);
  }
  if (door.door_forced_entry || security.audio_distress_active || alertLevel === "CRITICAL") {
    hasSignal = true;
    risk = Math.max(risk, 92);
  } else if (alertLevel === "HIGH" || finiteNumber(security.unauthorized_access_attempts) > 0) {
    hasSignal = true;
    risk = Math.max(risk, 45);
  }

  if (!hasSignal) return null;

  const temperaturePenalty = temperature == null ? 0 : Math.max(0, temperature - 45) * 0.45;
  const systemHealthIndex = Math.max(10, Math.round(100 - risk * 0.65 - temperaturePenalty));

  return {
    risk_score: Math.min(100, Math.max(0, Math.round(risk))),
    maintenance_priority: risk >= 76 ? "CRITICAL" : risk >= 41 ? "MEDIUM" : "LOW",
    system_health_index: systemHealthIndex,
  };
}

function attachDerivedRiskAttributes(normalized) {
  if (!isObject(normalized)) return normalized;

  const riskAttributes = deriveRiskAttributesFromFeatures(normalized.features);
  if (!riskAttributes) return normalized;

  return {
    ...normalized,
    attributes: {
      ...riskAttributes,
      ...(normalized.attributes || {}),
    },
  };
}

function buildNestedPatch(segments, value) {
  const root = {};
  let cursor = root;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }

    cursor[segment] = {};
    cursor = cursor[segment];
  });

  return root;
}

function normalizeDittoPathEnvelope(message) {
  const rawPath = message.path || message.resource;
  if (typeof rawPath !== "string" || !Object.prototype.hasOwnProperty.call(message, "value")) {
    return null;
  }

  const segments = rawPath
    .split("/")
    .filter(Boolean)
    .map(decodePathSegment);
  const value = message.value;

  if (segments[0] === "features") {
    if (segments.length === 1) {
      return isObject(value)
        ? attachDerivedRiskAttributes({ features: normalizeFeatureTree(value), attributes: {} })
        : null;
    }

    const featureId = segments[1];
    if (!featureId) return null;

    if (segments.length === 2) {
      return isObject(value)
        ? { features: { [featureId]: normalizeFeaturePayload(featureId, value) }, attributes: {} }
        : null;
    }

    if (segments[2] === "properties") {
      if (segments.length === 3) {
        return isObject(value)
          ? {
              features: {
                [featureId]: { properties: applyPropertyAliases(featureId, value) },
              },
              attributes: {},
            }
          : null;
      }

      const propertiesPatch = buildNestedPatch(segments.slice(3), value);
      return {
        features: {
          [featureId]: { properties: applyPropertyAliases(featureId, propertiesPatch) },
        },
        attributes: {},
      };
    }
  }

  if (segments[0] === "attributes") {
    if (segments.length === 1) {
      return isObject(value) ? { attributes: value, features: {} } : null;
    }

    return {
      attributes: buildNestedPatch(segments.slice(1), value),
      features: {},
    };
  }

  return null;
}

function unwrapTelemetryMessage(message) {
  if (!isObject(message)) return message;

  if (isObject(message.payload)) {
    return {
      ...message.payload,
      __mqtt_topic: message.__mqtt_topic,
    };
  }

  if (isObject(message.data)) {
    return {
      ...message.data,
      __mqtt_topic: message.__mqtt_topic,
    };
  }

  return message;
}

function extractThingId(message) {
  // Highest-priority sources: explicit envelope fields populated by the simulator.
  if (message.value?.thingId) return message.value.thingId;
  if (message.thingId) return message.thingId;
  if (message.mqttId) return mqttIdToThingId(message.mqttId);

  // Then the Ditto protocol envelope topic, e.g. "building/floor1:elevator/things/..."
  const dittoTopic = message.topic;
  if (typeof dittoTopic === "string") {
    const match = dittoTopic.match(/^([^/]+)\/(.+?)\/things\//);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
  }

  // Finally, the MQTT topic that carried this message:
  //   elevator/{mqtt_safe_thing_id}/(telemetry|events|commands|status)
  const mqttTopic = message.__mqtt_topic;
  if (typeof mqttTopic === "string") {
    const match = mqttTopic.match(/^elevator\/([^/]+)\/(?:telemetry|events|commands|status)$/);
    if (match) {
      return mqttIdToThingId(match[1]);
    }
  }

  return THING_ID;
}

function parseMqttPayload(rawMessage) {
  const text = rawMessage.toString().trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function parseStatusTopic(topic) {
  if (typeof topic !== "string") return null;
  const match = topic.match(/^elevator\/([^/]+)\/status$/);
  if (!match) return null;

  const mqttId = match[1];
  return {
    mqttId,
    thingId: mqttIdToThingId(mqttId),
  };
}

function parseTelemetryTopic(topic) {
  if (typeof topic !== "string") return null;
  const match = topic.match(/^elevator\/([^/]+)\/telemetry$/);
  if (!match) return null;

  const mqttId = match[1];
  return {
    mqttId,
    thingId: mqttIdToThingId(mqttId),
  };
}

function parseEventsTopic(topic) {
  if (typeof topic !== "string") return null;
  const match = topic.match(/^elevator\/([^/]+)\/events$/);
  if (!match) return null;

  const mqttId = match[1];
  return {
    mqttId,
    thingId: mqttIdToThingId(mqttId),
  };
}

function normalizeMicrocontrollerStatus(payload, topic) {
  const topicInfo = parseStatusTopic(topic);
  if (!topicInfo) return null;

  const source = isObject(payload) ? payload : { status: payload };
  const rawStatus = String(
    source.status ??
    source.state ??
    source.connection ??
    source.connected ??
    "unknown",
  ).trim().toUpperCase();
  const onlineValues = new Set(["ONLINE", "CONNECTED", "TRUE", "1", "UP", "READY"]);
  const offlineValues = new Set(["OFFLINE", "DISCONNECTED", "FALSE", "0", "DOWN", "LOST"]);
  const status = onlineValues.has(rawStatus)
    ? "ONLINE"
    : offlineValues.has(rawStatus)
      ? "OFFLINE"
      : "UNKNOWN";
  const connected = status === "ONLINE";
  const now = new Date().toISOString();

  const properties = {
    board: source.board || source.device || "ESP32-S3",
    connected,
    status,
    source: "mqtt_status",
    transport: "MQTT",
    mqtt_id: topicInfo.mqttId,
    mqtt_topic: topic,
    telemetry_topic: buildTelemetryTopic(topicInfo.thingId),
    last_status_at: now,
  };

  if (connected) {
    properties.last_seen_at = now;
  } else {
    properties.last_disconnected_at = now;
  }

  return {
    thingId: topicInfo.thingId,
    properties,
  };
}

function normalizeMicrocontrollerTelemetryHeartbeat(payload, topic) {
  const topicInfo = parseTelemetryTopic(topic);
  if (!topicInfo) return null;

  const message = isObject(payload)
    ? {
        ...payload,
        __mqtt_topic: topic,
      }
    : {
        __mqtt_topic: topic,
      };
  const thingId = extractThingId(message) || topicInfo.thingId;
  const mqttId = thingIdToMqttId(thingId) || topicInfo.mqttId;
  const now = new Date().toISOString();

  return {
    thingId,
    properties: {
      board: "ESP32-S3",
      connected: true,
      status: "ONLINE",
      source: "mqtt_telemetry",
      transport: "MQTT",
      mqtt_id: mqttId,
      mqtt_topic: buildStatusTopic(thingId),
      telemetry_topic: topic,
      last_seen_at: now,
      last_telemetry_at: now,
    },
  };
}

function pickDefined(source, keys) {
  return keys.reduce((accumulator, key) => {
    if (source[key] !== undefined) {
      accumulator[key] = source[key];
    }
    return accumulator;
  }, {});
}

function normalizeTelemetry(message) {
  if (!isObject(message)) return null;

  const telemetry = unwrapTelemetryMessage(message);
  const dittoPathPatch = normalizeDittoPathEnvelope(telemetry);
  if (dittoPathPatch) return dittoPathPatch;

  if (isObject(telemetry.value) && (telemetry.value.features || telemetry.value.attributes)) {
    return {
      attributes: telemetry.value.attributes || {},
      features: normalizeFeatureTree(telemetry.value.features || {}),
    };
  }

  if (telemetry.features || telemetry.attributes) {
    return {
      attributes: telemetry.attributes || {},
      features: normalizeFeatureTree(telemetry.features || {}),
    };
  }

  const cabinSource = applyPropertyAliases("cabin", isObject(telemetry.cabin?.properties)
    ? telemetry.cabin.properties
    : isObject(telemetry.cabin)
      ? telemetry.cabin
      : telemetry);
  const motorSource = applyPropertyAliases("motor", isObject(telemetry.motor?.properties)
    ? telemetry.motor.properties
    : isObject(telemetry.motor)
      ? telemetry.motor
      : telemetry);
  const doorSource = applyPropertyAliases("door", isObject(telemetry.door?.properties)
    ? telemetry.door.properties
    : isObject(telemetry.door)
      ? telemetry.door
      : telemetry);
  const securitySource = applyPropertyAliases("security", isObject(telemetry.security?.properties)
    ? telemetry.security.properties
    : isObject(telemetry.security)
      ? telemetry.security
      : telemetry);
  const fanSource = applyPropertyAliases("fan", isObject(telemetry.fan?.properties)
    ? telemetry.fan.properties
    : isObject(telemetry.fan)
      ? telemetry.fan
      : telemetry);
  const energySource = isObject(telemetry.energy?.properties)
    ? telemetry.energy.properties
    : isObject(telemetry.energy)
      ? telemetry.energy
      : telemetry;
  const performanceSource = isObject(telemetry.performance?.properties)
    ? telemetry.performance.properties
    : isObject(telemetry.performance)
      ? telemetry.performance
      : telemetry;

  const features = {};
  const attributes = pickDefined(telemetry, [
    "system_mode",
    "risk_score",
    "maintenance_priority",
    "system_health_index",
    "energy_efficiency",
    "uptime_pct",
    "location",
  ]);

  const cabinProperties = pickDefined(cabinSource, [
    "current_floor",
    "target_floor",
    "direction",
    "load_kg",
    "temperature_c",
    "speed_ms",
    "emergency_stop",
    "trips_today",
  ]);
  if (Object.keys(cabinProperties).length > 0) {
    features.cabin = { properties: cabinProperties };
  }

  const doorProperties = pickDefined(doorSource, [
    "state",
    "door_forced_entry",
    "cycle_count",
    "obstruction_events",
  ]);
  if (Object.keys(doorProperties).length > 0) {
    features.door = { properties: doorProperties };
  }

  const motorProperties = pickDefined(motorSource, [
    "vibration_level",
    "hours_operated",
    "health_status",
    "temperature_c",
    "current_draw_a",
    "power_kw",
  ]);
  if (Object.keys(motorProperties).length > 0) {
    features.motor = { properties: motorProperties };
  }

  const securityProperties = pickDefined(securitySource, [
    "audio_distress_active",
    "unauthorized_access_attempts",
    "rfid_last_card",
    "rfid_access_granted",
    "alert_level",
  ]);
  if (Object.keys(securityProperties).length > 0) {
    features.security = { properties: securityProperties };
  }

  const fanProperties = pickDefined(fanSource, [
    "state",
    "mode",
    "reason",
    "duty_cycle_pct",
    "runtime_today_min",
    "last_changed_at",
  ]);
  if (Object.keys(fanProperties).length > 0) {
    features.fan = { properties: fanProperties };
  }

  const energyProperties = pickDefined(energySource, [
    "kwh_today",
    "kwh_month",
    "kwh_baseline",
    "co2_kg",
    "regen_kwh",
  ]);
  if (Object.keys(energyProperties).length > 0) {
    features.energy = { properties: energyProperties };
  }

  const performanceProperties = pickDefined(performanceSource, [
    "avg_wait_s",
    "avg_trip_s",
    "availability_pct",
    "door_cycle_efficiency",
  ]);
  if (Object.keys(performanceProperties).length > 0) {
    features.performance = { properties: performanceProperties };
  }

  const riskAttributes = deriveRiskAttributesFromFeatures(features);
  if (riskAttributes && attributes.risk_score === undefined) {
    Object.assign(attributes, riskAttributes);
  }

  if (!hasKeys(features) && !hasKeys(attributes)) {
    return null;
  }

  return { attributes, features };
}

function isDittoNotFound(error) {
  return error?.response?.status === 404;
}

async function mergeThingWithRetry(path, patch, retries = 3) {
  const serializedPatch = JSON.stringify(patch);
  if (lastSerializedByPath.get(path) === serializedPatch) {
    return "skipped";
  }

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await dittoClient.patch(path, patch, {
        headers: { "Content-Type": "application/merge-patch+json" },
      });
      lastSerializedByPath.set(path, serializedPatch);
      return "written";
    } catch (error) {
      // Merge requires the thing to already exist. On a fresh twin, create it
      // once with a plain PUT of the same body so the environment self-heals.
      if (isDittoNotFound(error)) {
        await dittoClient.put(path, patch);
        lastSerializedByPath.set(path, serializedPatch);
        return "written";
      }
      lastError = error;
      log.error(`[Bridge] Ditto MERGE failed (${attempt}/${retries})`, path, error.message);
      if (attempt < retries) {
        await sleep(DITTO_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

// One telemetry tick -> one thing-level merge-patch -> one Ditto revision.
// Previously each property leaf was written as its own ModifyFeatureProperty,
// fanning a single tick into ~20 commands that overwhelmed the thing's
// persistence actor. RFC-7396 merge collapses that into a single write while
// still creating any missing features/properties.
async function pushToDitto(telemetry) {
  const normalized = normalizeTelemetry(telemetry);

  if (!normalized) {
    log.warn("[Bridge] Ignoring telemetry payload with no twin-mappable fields", {
      topic: telemetry.__mqtt_topic,
      path: telemetry.path,
      keys: Object.keys(telemetry || {}).slice(0, 12),
    });
    return;
  }

  const thingId = extractThingId(telemetry);
  const encodedThingId = encodeURIComponent(thingId);

  const patch = {};
  if (hasKeys(normalized.features)) patch.features = normalized.features;
  if (hasKeys(normalized.attributes)) patch.attributes = normalized.attributes;

  if (!hasKeys(patch)) {
    log.warn("[Bridge] Telemetry normalized but produced no Ditto writes", {
      topic: telemetry.__mqtt_topic,
      path: telemetry.path,
      featureCount: Object.keys(normalized.features || {}).length,
      attributeCount: Object.keys(normalized.attributes || {}).length,
    });
    return;
  }

  // Detect RFID scans BEFORE the merge-dedup early return: a scan is recognized
  // by an increase in a firmware decision counter, which self-guards against
  // duplicate emission, so it is safe to evaluate on every full telemetry tick.
  const securityProps = normalized.features?.security?.properties;
  if (isObject(securityProps)) {
    void emitAccessEventsFromSecurity(thingId, securityProps);
  }

  const result = await mergeThingWithRetry(`/api/2/things/${encodedThingId}`, patch);
  if (result === "skipped") return;

  log.info(`[Bridge] Ditto twin merged for ${thingId} (${Object.keys(patch).join("+")})`);
}

// ---------------------------------------------------------------------------
// RFID access-control event emission.
// The firmware publishes monotonically increasing decision counters under the
// `security` feature. When any counter increases between telemetry ticks, a
// scan happened: we classify it and append an access-log entry to the Ditto
// accessControl ring buffer (always) and to durable Postgres (when configured).
// ---------------------------------------------------------------------------
const RFID_DECISION_COUNTERS = [
  ["rfid_granted_count", "GRANTED"],
  ["rfid_denied_count", "DENIED"],
  ["rfid_unknown_count", "UNKNOWN"],
  ["rfid_revoked_count", "REVOKED"],
  ["rfid_floor_denied_count", "DENIED"],
];
const lastRfidCountersByThingId = new Map();

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function appendAccessLogRing(thingId, entry) {
  const encodedThingId = encodeURIComponent(thingId);
  let props = {};
  try {
    const res = await dittoClient.get(
      `/api/2/things/${encodedThingId}/features/accessControl/properties`,
      { timeout: DITTO_TIMEOUT_MS },
    );
    if (isObject(res.data)) props = res.data;
  } catch (error) {
    if (!isDittoNotFound(error)) {
      log.warn("[Bridge] accessControl read failed:", error.message);
    }
  }

  const ring = Array.isArray(props.recentAccessLog) ? props.recentAccessLog : [];
  const nextSeq = Number.isFinite(props.log_seq) ? props.log_seq + 1 : 1;
  const next = [...ring, { ...entry, seq: nextSeq }].slice(-ACCESS_LOG_RING_MAX);

  try {
    await dittoClient.put(
      `/api/2/things/${encodedThingId}/features/accessControl/properties/recentAccessLog`,
      next,
    );
    await dittoClient.put(
      `/api/2/things/${encodedThingId}/features/accessControl/properties/log_seq`,
      nextSeq,
    );
  } catch (error) {
    if (isDittoNotFound(error)) {
      await dittoClient.put(`/api/2/things/${encodedThingId}/features/accessControl`, {
        properties: { recentAccessLog: next, log_seq: nextSeq, authorizedTags: {} },
      });
    } else {
      log.warn("[Bridge] accessControl ring write failed:", error.message);
    }
  }
}

async function postAccessLogDurable(thingId, entry) {
  if (!ACCESS_LOG_POST_URL) return;
  try {
    await axios.post(ACCESS_LOG_POST_URL, { ...entry, thing_id: thingId }, { timeout: 4000 });
  } catch (error) {
    log.warn("[Bridge] durable access-log POST failed:", error.message);
  }
}

async function emitAccessEventsFromSecurity(thingId, security) {
  const prev = lastRfidCountersByThingId.get(thingId);
  const initialized = prev !== undefined;
  const curr = {};
  const decisions = [];

  for (const [counterKey, decision] of RFID_DECISION_COUNTERS) {
    const current = finiteOrNull(security[counterKey]);
    if (current == null) {
      curr[counterKey] = prev?.[counterKey];
      continue;
    }
    curr[counterKey] = current;
    const previous = finiteOrNull(prev?.[counterKey]);
    if (initialized && previous != null && current > previous) {
      // One event per unit increase, but cap to avoid a flood after a restart.
      const delta = Math.min(current - previous, 5);
      for (let i = 0; i < delta; i += 1) decisions.push(decision);
    }
  }

  lastRfidCountersByThingId.set(thingId, curr);
  if (decisions.length === 0) return;

  const uid = String(security.rfid_uid || security.rfid_session_uid || "").toUpperCase();
  const role = security.rfid_role || security.rfid_session_role || "";
  const sessionUser =
    security.rfid_session_user && security.rfid_session_user !== "NONE"
      ? security.rfid_session_user
      : "";
  const reason = security.rfid_reason || "";
  const ts = new Date().toISOString();

  for (const decision of decisions) {
    const entry = {
      ts,
      uid: uid || "UNKNOWN",
      label: sessionUser,
      role: String(role || ""),
      decision,
      reason: String(reason || ""),
      elevator_id: thingId,
      source: "device",
    };
    try {
      await appendAccessLogRing(thingId, entry);
      await postAccessLogDurable(thingId, entry);
    } catch (error) {
      log.warn("[Bridge] access event emission failed:", error.message);
    }
  }
}

async function pushMicrocontrollerStatusToDitto(topic, payload) {
  const normalizedStatus = normalizeMicrocontrollerStatus(payload, topic);
  if (!normalizedStatus) return false;

  await writeMicrocontrollerProperties(normalizedStatus.thingId, normalizedStatus.properties, topic);

  lastMicrocontrollerStatusByThingId.set(
    normalizedStatus.thingId,
    normalizedStatus.properties.status,
  );
  if (normalizedStatus.properties.status === "ONLINE") {
    markMicrocontrollerSeen(
      normalizedStatus.thingId,
      normalizedStatus.properties.mqtt_id,
    );
  } else {
    clearMicrocontrollerOfflineTimer(normalizedStatus.thingId);
  }
  log.info("[Bridge] ESP32-S3 status synchronized", {
    thingId: normalizedStatus.thingId,
    status: normalizedStatus.properties.status,
    mqttId: normalizedStatus.properties.mqtt_id,
  });
  return true;
}

async function writeMicrocontrollerProperties(thingId, properties, sourceTopic) {
  await pushToDitto({
    __mqtt_topic: sourceTopic,
    thingId,
    features: {
      microcontroller: {
        properties,
      },
    },
  });
}

function clearMicrocontrollerOfflineTimer(thingId) {
  const timer = microcontrollerOfflineTimersByThingId.get(thingId);
  if (timer) {
    clearTimeout(timer);
    microcontrollerOfflineTimersByThingId.delete(thingId);
  }
}

function markMicrocontrollerSeen(thingId, mqttId) {
  lastMicrocontrollerSeenAtByThingId.set(thingId, Date.now());
  scheduleMicrocontrollerOfflineWatchdog(thingId, mqttId);
}

function scheduleMicrocontrollerOfflineWatchdog(thingId, mqttId) {
  if (!Number.isFinite(MICROCONTROLLER_OFFLINE_AFTER_MS) || MICROCONTROLLER_OFFLINE_AFTER_MS <= 0) {
    return;
  }

  clearMicrocontrollerOfflineTimer(thingId);
  const timeoutMs = Math.max(5000, MICROCONTROLLER_OFFLINE_AFTER_MS);
  const timer = setTimeout(() => {
    void markMicrocontrollerOfflineIfStale(thingId, mqttId);
  }, timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  microcontrollerOfflineTimersByThingId.set(thingId, timer);
}

async function markMicrocontrollerOfflineIfStale(thingId, mqttId) {
  const lastSeenAtMs = lastMicrocontrollerSeenAtByThingId.get(thingId) || 0;
  const ageMs = Date.now() - lastSeenAtMs;
  if (lastSeenAtMs > 0 && ageMs < Math.max(5000, MICROCONTROLLER_OFFLINE_AFTER_MS)) {
    scheduleMicrocontrollerOfflineWatchdog(thingId, mqttId);
    return;
  }

  const safeMqttId = mqttId || thingIdToMqttId(thingId);
  const now = new Date().toISOString();
  try {
    await writeMicrocontrollerProperties(
      thingId,
      {
        board: "ESP32-S3",
        connected: false,
        status: "OFFLINE",
        source: "bridge_watchdog",
        transport: "MQTT",
        mqtt_id: safeMqttId,
        mqtt_topic: buildStatusTopic(thingId),
        telemetry_topic: buildTelemetryTopic(thingId),
        last_status_at: now,
        last_disconnected_at: now,
      },
      buildStatusTopic(thingId),
    );
    lastMicrocontrollerStatusByThingId.set(thingId, "OFFLINE");
    log.warn("[Bridge] ESP32-S3 marked OFFLINE by telemetry/status watchdog", {
      thingId,
      mqttId: safeMqttId,
      staleForMs: ageMs,
    });
  } catch (error) {
    log.error("[Bridge] Failed to mark ESP32-S3 offline by watchdog", {
      thingId,
      error: error.message,
    });
    scheduleMicrocontrollerOfflineWatchdog(thingId, safeMqttId);
  }
}

async function pushMicrocontrollerTelemetryHeartbeatToDitto(topic, payload) {
  const heartbeat = normalizeMicrocontrollerTelemetryHeartbeat(payload, topic);
  if (!heartbeat) return false;

  const nowMs = Date.now();
  markMicrocontrollerSeen(heartbeat.thingId, heartbeat.properties.mqtt_id);
  const lastHeartbeatMs = lastMicrocontrollerHeartbeatByThingId.get(heartbeat.thingId) || 0;
  const lastStatus = lastMicrocontrollerStatusByThingId.get(heartbeat.thingId);
  const heartbeatDue =
    lastStatus !== "ONLINE" ||
    nowMs - lastHeartbeatMs >= Math.max(1000, MICROCONTROLLER_TELEMETRY_HEARTBEAT_MS);

  if (!heartbeatDue) return true;

  await writeMicrocontrollerProperties(heartbeat.thingId, heartbeat.properties, topic);

  lastMicrocontrollerHeartbeatByThingId.set(heartbeat.thingId, nowMs);
  lastMicrocontrollerStatusByThingId.set(heartbeat.thingId, "ONLINE");
  log.info("[Bridge] ESP32-S3 telemetry heartbeat synchronized", {
    thingId: heartbeat.thingId,
    mqttId: heartbeat.properties.mqtt_id,
  });
  return true;
}

let latestTelemetry = null;
let bridgeDrainRunning = false;

// MQTT client is created in startBridge() but referenced by the Ditto->MQTT
// command forwarder, which lives at module scope.
let mqttClient = null;

async function drainLatestTelemetry() {
  if (bridgeDrainRunning) return;
  bridgeDrainRunning = true;

  try {
    while (latestTelemetry) {
      const telemetry = latestTelemetry;
      latestTelemetry = null;

      try {
        await pushToDitto(telemetry);
      } catch (error) {
        log.error("[Bridge] Failed to process telemetry", error);
      }

      if (latestTelemetry) {
        await sleep(DITTO_WRITE_INTERVAL_MS);
      }
    }
  } finally {
    bridgeDrainRunning = false;
  }
}

function enqueueTelemetry(telemetry) {
  latestTelemetry = telemetry;
  void drainLatestTelemetry();
}

// ---------------------------------------------------------------------------
// Ditto -> MQTT command forwarder.
//
// The dashboard writes operator-command intent to Ditto feature paths (e.g.
// features/cabin/properties/target_floor). Without a forwarder nothing
// republishes those writes onto the ESP32's commands topic, so the device
// never sees them. This block subscribes to the Ditto Thing event stream
// (Server-Sent Events) and republishes safety-gate-approved writes as the
// matching MQTT command payloads the firmware already understands.
//
// Loop prevention: only paths matching features/<id>/properties/<leaf> are
// forwarded; telemetry-driven bridge writes go through a thing-level merge
// (event path "/") so they are naturally filtered out. In addition we
// remember the last value forwarded per leaf and skip echoes.
// ---------------------------------------------------------------------------

const COMMAND_FORWARDING_ENABLED =
  String(process.env.BRIDGE_COMMAND_FORWARDING || "true").toLowerCase() === "true";

const lastForwardedValue = new Map();   // key: "<featureId>/<leaf>"  value: JSON-serialized last sent
const forwardedCommandIds = [];
const forwardedCommandIdSet = new Set();
const forwardingCommandIdSet = new Set();
const commandAckTimers = new Map();

function rememberForwardedCommandId(commandId) {
  if (!commandId) return;
  forwardedCommandIdSet.add(commandId);
  forwardedCommandIds.push(commandId);

  while (forwardedCommandIds.length > 500) {
    const stale = forwardedCommandIds.shift();
    forwardedCommandIdSet.delete(stale);
  }
}

function publishMqttCommand(thingId, command, onPublished, onError) {
  const commandId = command && command.command_id ? String(command.command_id) : null;
  if (!mqttClient || !mqttClient.connected) {
    log.warn("MQTT not connected, dropping command", {
      event: "command_dropped", thing_id: thingId, command_id: commandId, command,
    });
    if (typeof onError === "function") onError(new Error("MQTT not connected"));
    return false;
  }
  const topic = buildCommandsTopic(thingId);
  const payload = JSON.stringify(command);
  mqttClient.publish(topic, payload, { qos: MQTT_COMMAND_QOS }, (err) => {
    if (err) {
      log.warn("MQTT publish failed", {
        event: "command_publish_failed", thing_id: thingId, command_id: commandId, topic, detail: err.message,
      });
      if (typeof onError === "function") onError(err);
    } else {
      log.info("command published to device", {
        event: "command_mqtt_published", thing_id: thingId, command_id: commandId, topic,
      });
      if (typeof onPublished === "function") onPublished();
    }
  });
  return true;
}

function clearCommandAckTimer(commandId) {
  const timer = commandAckTimers.get(commandId);
  if (timer) clearTimeout(timer);
  commandAckTimers.delete(commandId);
}

async function readPendingCommandIntent(thingId) {
  try {
    const response = await dittoClient.get(
      `/api/2/things/${encodeURIComponent(thingId)}/features/control/properties/pending_command`,
      { timeout: DITTO_TIMEOUT_MS },
    );
    return isObject(response.data) ? response.data : null;
  } catch (error) {
    if (!isDittoNotFound(error)) {
      log.warn("[Bridge] Failed to read pending command:", error.message);
    }
    return null;
  }
}

async function markCommandTimedOut(thingId, commandId) {
  clearCommandAckTimer(commandId);
  const pending = await readPendingCommandIntent(thingId);
  if (!pending || String(pending.command_id || "") !== String(commandId)) return;

  const status = String(pending.status || "").toUpperCase();
  if (["COMPLETED", "REJECTED", "FAILED", "TIMED_OUT"].includes(status)) return;

  const timedOutAt = new Date().toISOString();
  const result = {
    command_id: pending.command_id,
    correlation_id: pending.correlation_id,
    command: pending.command,
    status: "TIMED_OUT",
    reason: "No terminal acknowledgement received from device",
    target_floor: pending.target_floor,
    timed_out_at: timedOutAt,
    updated_at: timedOutAt,
    source: "ditto-bridge",
  };

  try {
    await Promise.all([
      dittoClient.put(
        `/api/2/things/${encodeURIComponent(thingId)}/features/control/properties/pending_command`,
        { ...pending, ...result },
      ),
      dittoClient.put(
        `/api/2/things/${encodeURIComponent(thingId)}/features/control/properties/last_command_result`,
        result,
      ),
    ]);
    log.warn("command acknowledgement timed out", {
      event: "command_ack_timeout",
      thing_id: thingId,
      command_id: commandId,
    });
  } catch (error) {
    log.warn("[Bridge] Failed to persist command timeout:", error.message);
  }
}

function scheduleCommandAckTimeout(thingId, intent) {
  const commandId = String(intent?.command_id || "");
  if (!commandId || commandAckTimers.has(commandId)) return;

  const startedAt = Date.parse(intent.forwarded_at || intent.queued_at || intent.requested_at || "");
  const elapsed = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
  const remaining = Math.max(1, COMMAND_ACK_TIMEOUT_MS - elapsed);
  const timer = setTimeout(() => {
    void markCommandTimedOut(thingId, commandId);
  }, remaining);
  commandAckTimers.set(commandId, timer);
}

function isTrustedCommandIntent(intent) {
  const authorization = intent?.authorization_context;
  if (!isObject(authorization) || authorization.verified !== true) return false;
  if (authorization.issuer !== "dashboard-command-gate" && authorization.issuer !== "n8n-control-gate") {
    return false;
  }
  return Boolean(intent.command_id && intent.correlation_id && intent.safety_gate_version);
}

// Translate a feature-property write into the MQTT command the firmware speaks.
// Returns null if the path is not a device-actionable control.
function buildCommandForLeaf(featureId, leaf, value) {
  if (featureId === "cabin" && leaf === "target_floor") {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return { command: "MOVE_TO_FLOOR", target_floor: Math.round(n) };
  }
  if (featureId === "cabin" && leaf === "emergency_stop") {
    if (value === true)  return { command: "EMERGENCY_STOP" };
    if (value === false) return { command: "RESET" };
    return null;
  }
  if (featureId === "fan" && leaf === "state") {
    const v = String(value).toUpperCase();
    if (v === "ON")  return { command: "FAN_ON" };
    if (v === "OFF") return { command: "FAN_OFF" };
    return null;
  }
  if (featureId === "fan" && leaf === "mode") {
    if (String(value).toUpperCase() === "AUTO") return { command: "FAN_AUTO" };
    // MANUAL mode arrives alongside the fan/state event; that one drives the relay.
    return null;
  }
  return null;
}

function buildCommandFromIntent(intent) {
  if (!isObject(intent)) return null;

  const command = String(intent.command || "").toUpperCase();
  const base = {
    command,
    command_id: intent.command_id,
    correlation_id: intent.correlation_id,
    thing_id: intent.thing_id || THING_ID,
    source: "ditto_command_intent",
    authorization_origin: intent.authorization_context?.issuer,
    authorized_subject: intent.authorization_context?.subject,
    authorized_role: intent.authorization_context?.role,
    requested_at: intent.requested_at || intent.queued_at,
  };

  if (command === "MOVE_TO_FLOOR") {
    const n = Number(intent.target_floor);
    if (!Number.isFinite(n)) return null;
    return { ...base, target_floor: Math.round(n) };
  }

  if (command === "SET_FAN") {
    return {
      ...base,
      fan_state: intent.fan_state,
      fan_mode: intent.fan_mode || "MANUAL",
    };
  }

  if (command === "EMERGENCY_STOP") {
    return base;
  }

  if (command === "OPEN_DOOR") {
    return { ...base, command: "OPEN_DOOR" };
  }

  if (command === "CLOSE_DOOR") {
    return { ...base, command: "CLOSE_DOOR" };
  }

  if (command === "CLEAR_QUEUE") {
    return { ...base, command: "CLEAR_QUEUE" };
  }

  if (command === "SOFT_STOP") {
    return base;
  }

  if (command === "HOME") {
    return base;
  }

  if (command === "FRESH_START_RESET") {
    return {
      ...base,
      command: "FRESH_START",
      requested_command: command,
    };
  }

  if (command === "REQUEST_STATUS_REFRESH") {
    return base;
  }

  if (command === "DEVICE_DIAGNOSTIC") {
    const action = intent.device_action || intent.action;
    if (!action) return null;
    return {
      ...base,
      device_action: String(action).toUpperCase(),
    };
  }

  if (["RESET_EMERGENCY", "RESUME_NORMAL_MODE", "RESET_ACTIVE_PROBLEMS"].includes(command)) {
    return {
      ...base,
      command: "RESET",
      requested_command: command,
    };
  }

  if (command === "LOCKDOWN") {
    return {
      ...base,
      command: "SECURITY_LOCK",
      requested_command: command,
    };
  }

  if (command === "RELEASE_LOCKDOWN") {
    return {
      ...base,
      command: "SECURITY_UNLOCK",
      requested_command: command,
    };
  }

  if (command === "SET_DISPATCH_POLICY" || command === "DISPATCH_POLICY") {
    const policyId = intent.policy_id
      || (isObject(intent.dispatch_params) && intent.dispatch_params.policy_id);
    if (!policyId) return null;
    const params = isObject(intent.dispatch_params) ? intent.dispatch_params
      : isObject(intent.params) ? intent.params : {};
    return {
      ...base,
      command: "DISPATCH_POLICY",
      requested_command: command,
      policy_id: String(policyId).toUpperCase(),
      params,
    };
  }

  return null;
}

function isFreshCommandIntent(intent) {
  const timestamp = Date.parse(intent.queued_at || intent.requested_at || "");
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp <= COMMAND_INTENT_MAX_AGE_MS;
}

async function markCommandIntentForwarded(thingId, intent, command) {
  const encodedThingId = encodeURIComponent(thingId);
  const forwardedAt = new Date().toISOString();
  const updatedIntent = {
    ...intent,
    forwarded_at: forwardedAt,
    forwarded_command: command.command,
  };

  try {
    // Write forwarding metadata on dedicated paths instead of replacing the
    // whole pending object. A fast device acknowledgement can otherwise race
    // this write and be overwritten back to FORWARDED/PENDING.
    await Promise.all([
      dittoClient.put(
        `/api/2/things/${encodedThingId}/features/control/properties/pending_command/forwarded_at`,
        forwardedAt,
      ),
      dittoClient.put(
        `/api/2/things/${encodedThingId}/features/control/properties/pending_command/forwarded_command`,
        command.command,
      ),
      dittoClient.put(
        `/api/2/things/${encodedThingId}/features/control/properties/last_forwarded_command`,
        {
          command_id: intent.command_id,
          correlation_id: intent.correlation_id,
          command: command.command,
          requested_command: intent.command,
          forwarded_at: forwardedAt,
        },
      ),
    ]);
    scheduleCommandAckTimeout(thingId, updatedIntent);
  } catch (error) {
    log.warn("[Bridge] Failed to mark command intent as forwarded:", error.message);
  }
}

async function markUntrustedCommandIntent(thingId, intent) {
  const rejectedAt = new Date().toISOString();
  const result = {
    command_id: intent?.command_id || null,
    correlation_id: intent?.correlation_id || null,
    command: intent?.command || null,
    status: "REJECTED",
    reason: "Command intent missing trusted server authorization context",
    rejected_at: rejectedAt,
    updated_at: rejectedAt,
    source: "ditto-bridge",
  };

  try {
    await Promise.all([
      dittoClient.put(
        `/api/2/things/${encodeURIComponent(thingId)}/features/control/properties/pending_command`,
        { ...intent, ...result },
      ),
      dittoClient.put(
        `/api/2/things/${encodeURIComponent(thingId)}/features/control/properties/last_command_result`,
        result,
      ),
    ]);
  } catch (error) {
    log.warn("[Bridge] Failed to persist untrusted command rejection:", error.message);
  }
}

function publishCommandIntent(thingId, intent, source) {
  const commandId = String(intent?.command_id || "");
  if (!commandId) return false;

  const status = String(intent.status || "").toUpperCase();
  if (["COMPLETED", "REJECTED", "FAILED", "TIMED_OUT", "EXECUTED", "ACKED", "EXPIRED"].includes(status)) {
    rememberForwardedCommandId(commandId);
    return false;
  }

  if (["FORWARDED", "ACCEPTED", "EXECUTING"].includes(status)) {
    rememberForwardedCommandId(commandId);
    scheduleCommandAckTimeout(intent.thing_id || thingId, intent);
    return false;
  }

  if (intent.forwarded_at) {
    rememberForwardedCommandId(commandId);
    scheduleCommandAckTimeout(intent.thing_id || thingId, intent);
    return false;
  }

  if (forwardedCommandIdSet.has(commandId) || forwardingCommandIdSet.has(commandId)) return false;
  if (!isFreshCommandIntent(intent)) {
    log.warn("[Bridge] Skipping stale command intent", {
      command_id: commandId,
      command: intent.command,
      queued_at: intent.queued_at,
    });
    rememberForwardedCommandId(commandId);
    return false;
  }
  if (!isTrustedCommandIntent(intent)) {
    log.warn("[Bridge] Rejecting unverified Ditto command intent", {
      command_id: commandId,
      source,
      issuer: intent?.authorization_context?.issuer || null,
    });
    void markUntrustedCommandIntent(intent.thing_id || thingId, intent);
    return false;
  }

  const command = buildCommandFromIntent(intent);
  if (!command) return false;

  const targetThingId = intent.thing_id || thingId;
  forwardingCommandIdSet.add(commandId);
  const published = publishMqttCommand(targetThingId, command, () => {
    forwardingCommandIdSet.delete(commandId);
    rememberForwardedCommandId(commandId);
    void markCommandIntentForwarded(targetThingId, intent, command);
  }, () => {
    forwardingCommandIdSet.delete(commandId);
  });
  if (!published) {
    forwardingCommandIdSet.delete(commandId);
    return false;
  }

  log.info("Ditto command intent forwarded", {
    event: "command_intent_forwarded",
    source,
    command_id: commandId,
    command: command.command,
  });
  return true;
}

async function pushDeviceCommandResultToDitto(topic, payload) {
  const topicInfo = parseEventsTopic(topic);
  if (!topicInfo || !isObject(payload)) return false;

  const eventType = String(payload.event_type || payload.type || "").toUpperCase();
  if (eventType !== "COMMAND_RESULT") return false;

  const commandId = String(payload.command_id || "");
  if (!commandId) {
    log.warn("[Bridge] Ignoring command result without command_id", { topic });
    return true;
  }

  const pending = await readPendingCommandIntent(topicInfo.thingId);
  const receivedAt = new Date().toISOString();
  const rawStatus = String(payload.status || "FAILED").toUpperCase();
  const status = rawStatus === "SUCCEEDED" || rawStatus === "EXECUTED" ? "COMPLETED" : rawStatus;
  const result = {
    command_id: commandId,
    correlation_id: payload.correlation_id || null,
    command: payload.command || pending?.command || null,
    status,
    reason: payload.reason || null,
    target_floor: payload.target_floor ?? pending?.target_floor ?? null,
    current_floor: payload.current_floor ?? null,
    device_uptime_ms: payload.device_uptime_ms ?? null,
    received_at: receivedAt,
    updated_at: receivedAt,
    source: payload.source || "esp32",
  };

  if (!pending || String(pending.command_id || "") !== commandId) {
    await dittoClient.put(
      `/api/2/things/${encodeURIComponent(topicInfo.thingId)}/features/control/properties/last_ignored_command_result`,
      {
        ...result,
        ignored_reason: "STALE_OR_MISMATCHED_COMMAND_ID",
        active_command_id: pending?.command_id || null,
      },
    );
    log.warn("[Bridge] Ignored stale/mismatched device acknowledgement", {
      command_id: commandId,
      active_command_id: pending?.command_id || null,
    });
    return true;
  }

  const timestampField = status === "COMPLETED"
    ? "completed_at"
    : status === "REJECTED"
      ? "rejected_at"
      : status === "FAILED"
        ? "failed_at"
        : "acknowledged_at";
  result[timestampField] = receivedAt;

  if (["COMPLETED", "REJECTED", "FAILED", "TIMED_OUT"].includes(status)) {
    clearCommandAckTimer(commandId);
  } else {
    scheduleCommandAckTimeout(topicInfo.thingId, pending);
  }

  await Promise.all([
    dittoClient.put(
      `/api/2/things/${encodeURIComponent(topicInfo.thingId)}/features/control/properties/pending_command`,
      { ...pending, ...result },
    ),
    dittoClient.put(
      `/api/2/things/${encodeURIComponent(topicInfo.thingId)}/features/control/properties/last_command_result`,
      result,
    ),
  ]);

  log.info("device command result persisted", {
    event: "command_ack_received",
    command_id: commandId,
    status,
  });
  return true;
}

function handleDittoEvent(thingId, event) {
  const path = event && event.path;
  if (typeof path !== "string") return;
  if (!Object.prototype.hasOwnProperty.call(event, "value")) return;

  // Expect features/<featureId>/properties/<leaf>. Bridge echoes write at the
  // higher features/<featureId> level so they have a different path shape.
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 4) return;
  if (segments[0] !== "features" || segments[2] !== "properties") return;

  const featureId = segments[1];
  const leaf = segments[3];

  if (featureId === "control" && leaf === "pending_command") {
    publishCommandIntent(thingId, event.value, "sse");
    return;
  }

  // Production path: device commands are forwarded only from the correlated
  // pending_command control-plane object. Direct feature-leaf forwarding can
  // race ahead of that intent and creates an uncorrelated duplicate command.
  if (!LEGACY_LEAF_COMMAND_FORWARDING_ENABLED) return;

  const key = `${featureId}/${leaf}`;
  const serialized = JSON.stringify(event.value);

  if (lastForwardedValue.get(key) === serialized) return;

  const command = buildCommandForLeaf(featureId, leaf, event.value);
  if (!command) return;

  // Record BEFORE publishing so the echo from Ditto (when the device telemetry
  // mirrors the same value back) does not produce a second forward.
  lastForwardedValue.set(key, serialized);
  publishMqttCommand(thingId, command);
}

let commandIntentPollInFlight = false;

async function reconcilePendingCommandIntent(thingId, source = "poll") {
  if (commandIntentPollInFlight) return;
  commandIntentPollInFlight = true;

  try {
    const encodedThingId = encodeURIComponent(thingId);
    const response = await dittoClient.get(
      `/api/2/things/${encodedThingId}/features/control/properties/pending_command`,
      { timeout: DITTO_TIMEOUT_MS },
    );
    publishCommandIntent(thingId, response.data, source);
  } catch (error) {
    if (!isDittoNotFound(error)) {
      log.warn("[Bridge] Command intent poll failed:", error.message);
    }
  } finally {
    commandIntentPollInFlight = false;
  }
}

function startCommandIntentPoller(thingId) {
  if (!COMMAND_FORWARDING_ENABLED) return;

  void reconcilePendingCommandIntent(thingId, "startup");
  setInterval(() => {
    void reconcilePendingCommandIntent(thingId, "poll");
  }, COMMAND_INTENT_POLL_INTERVAL_MS);

  log.info("[Bridge] Ditto command intent poller enabled", {
    thingId,
    intervalMs: COMMAND_INTENT_POLL_INTERVAL_MS,
    maxAgeMs: COMMAND_INTENT_MAX_AGE_MS,
  });
}

async function startDittoCommandForwarder(thingId) {
  if (!COMMAND_FORWARDING_ENABLED) {
    log.info("[Bridge] Ditto->MQTT command forwarding disabled (BRIDGE_COMMAND_FORWARDING=false)");
    return;
  }
  const url = `/api/2/things/${encodeURIComponent(thingId)}`;
  try {
    const response = await dittoClient.get(url, {
      headers: { Accept: "text/event-stream" },
      responseType: "stream",
      timeout: 0,             // long-lived; no per-request timeout
    });
    log.info("[Bridge] Subscribed to Ditto SSE for", thingId);

    let buffer = "";
    response.data.setEncoding("utf8");
    response.data.on("data", (chunk) => {
      buffer += chunk;
      let boundary;
      // SSE event boundary is a blank line ("\n\n"). Process whole events.
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "{}") continue;
          try {
            const event = JSON.parse(data);
            handleDittoEvent(thingId, event);
          } catch (err) {
            log.warn("[Bridge] SSE parse error:", err.message);
          }
        }
      }
    });
    response.data.on("end", () => {
      log.warn("[Bridge] Ditto SSE ended, reconnecting in 5s");
      setTimeout(() => startDittoCommandForwarder(thingId), 5000);
    });
    response.data.on("error", (err) => {
      log.warn("[Bridge] Ditto SSE stream error:", err.message);
      // 'end' fires too; reconnect happens there
    });
  } catch (err) {
    log.warn(`[Bridge] Ditto SSE connect failed (${err.message}), retry in 5s`);
    setTimeout(() => startDittoCommandForwarder(thingId), 5000);
  }
}

async function startBridge() {
  log.info("[Bridge] Runtime configuration", {
    mqtt: MQTT_URL,
    topics: MQTT_TOPICS,
    canonicalTopics: {
      telemetry: buildTelemetryTopic(THING_ID),
      events: buildEventsTopic(THING_ID),
      commands: buildCommandsTopic(THING_ID),
      status: buildStatusTopic(THING_ID),
    },
    ditto: DITTO_URL,
    thingId: THING_ID,
    mqttId: PRIMARY_MQTT_ID,
    writeIntervalMs: DITTO_WRITE_INTERVAL_MS,
    timeoutMs: DITTO_TIMEOUT_MS,
    commandAckTimeoutMs: COMMAND_ACK_TIMEOUT_MS,
    legacyLeafCommandForwarding: LEGACY_LEAF_COMMAND_FORWARDING_ENABLED,
  });

  mqttClient = mqtt.connect(MQTT_URL, {
    reconnectPeriod: 2000,
    connectTimeout: 15000,
    protocolVersion: 4,
    clean: true,
    resubscribe: true,
    keepalive: 30,
    clientId: `elevator-bridge-${process.pid}-${Math.random().toString(16).slice(2)}`,
    ...(MQTT_USERNAME ? { username: MQTT_USERNAME, password: MQTT_PASSWORD } : {}),
  });

  mqttClient.on("connect", () => {
    log.info("[Bridge] Connected to MQTT", MQTT_URL);
    mqttClient.subscribe(MQTT_TOPICS, (error) => {
      if (error) {
        log.error("[Bridge] MQTT subscription error", error);
        return;
      }

      log.info("[Bridge] Subscribed to", MQTT_TOPICS.join(", "));
    });
  });

  mqttClient.on("reconnect", () => {
    log.warn("[Bridge] reconnecting to MQTT...");
  });

  mqttClient.on("error", (error) => {
    log.error("[Bridge] MQTT error", error);
  });

  mqttClient.on("message", async (topic, rawMessage) => {
    try {
      const payload = parseMqttPayload(rawMessage);
      if (await pushDeviceCommandResultToDitto(topic, payload)) {
        return;
      }
      if (await pushMicrocontrollerStatusToDitto(topic, payload)) {
        return;
      }

      if (!isObject(payload)) {
        log.warn("[Bridge] Ignoring non-JSON MQTT payload outside status topic", { topic });
        return;
      }

      await pushMicrocontrollerTelemetryHeartbeatToDitto(topic, payload);

      const telemetry = payload;
      telemetry.__mqtt_topic = topic;
      enqueueTelemetry(telemetry);
    } catch (error) {
      log.error("[Bridge] Failed to process MQTT message", {
        topic,
        error: error.message,
      });
    }
  });

  // Start the Ditto -> MQTT command forwarder so dashboard operator commands
  // actually reach the ESP32. Runs concurrently with the MQTT subscription.
  startCommandIntentPoller(THING_ID);
  startDittoCommandForwarder(THING_ID);
}

startBridge().catch((error) => {
  log.error("[Bridge] Fatal startup error", error);
  process.exit(1);
});
