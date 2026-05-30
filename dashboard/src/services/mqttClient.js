import mqtt from "mqtt";
import { env } from "../config/env";

let client;
const listeners = new Set();
const statusListeners = new Set();
let status = {
  connected: false,
  reconnecting: false,
  error: null,
  topic: env.MQTT_TOPIC,
};

function getMqttTopics() {
  return String(env.MQTT_TOPIC)
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

function notify(payload) {
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error("[MQTT] listener error", error);
    }
  });
}

function notifyStatus() {
  const snapshot = { ...status };
  statusListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("[MQTT] status listener error", error);
    }
  });
}

function updateStatus(patch) {
  status = {
    ...status,
    ...patch,
    topic: getMqttTopics().join(", "),
  };
  notifyStatus();
}

function ensureClient() {
  if (client) return client;

  client = mqtt.connect(env.MQTT_URL, {
    reconnectPeriod: 1000,
    connectTimeout: 15000,
    protocolVersion: 4,
    clean: true,
    resubscribe: true,
    // 60s keepalive: Mosquitto's 1.5× timeout becomes 90s, safely above the
    // ~60s browser timer-throttle window that caused the 1-min drop.
    keepalive: 60,
    clientId: `elevator-dashboard-${Math.random().toString(16).slice(2)}`,
    // Broker auth (anonymous disabled). Read-only 'dashboard' identity per ACL.
    ...(env.MQTT_USERNAME
      ? { username: env.MQTT_USERNAME, password: env.MQTT_PASSWORD }
      : {}),
  });

  client.on("connect", () => {
    console.info("[MQTT] connected", env.MQTT_URL);
    updateStatus({ connected: true, reconnecting: false, error: null });
    client.subscribe(getMqttTopics(), (error) => {
      if (error) {
        console.error("[MQTT] subscribe failed", error);
        updateStatus({ error: error.message || "Subscription failed" });
      }
    });
  });

  client.on("reconnect", () => {
    console.warn("[MQTT] reconnecting...");
    updateStatus({ connected: false, reconnecting: true });
  });

  client.on("error", (error) => {
    console.error("[MQTT] error", error);
    updateStatus({ connected: false, error: error.message || "MQTT error" });
  });

  client.on("offline", () => {
    console.warn("[MQTT] offline");
    updateStatus({ connected: false, reconnecting: true });
  });

  client.on("close", () => {
    // Keep reconnecting:true so the UI shows "RECONNECTING" while mqtt.js retries.
    // The cleanup unsubscribe path calls updateStatus({reconnecting:false}) after end().
    updateStatus({ connected: false, reconnecting: true });
  });

  client.on("message", (topic, message) => {
    try {
      const parsed = JSON.parse(message.toString());
      parsed.__mqtt_topic = topic;
      notify(parsed);
    } catch (error) {
      console.error("[MQTT] invalid telemetry payload", error);
    }
  });

  // When the browser tab comes back into focus after being hidden, the JS
  // timer for keepalive PINGREQ may have been throttled to zero while hidden.
  // Reconnect immediately so the UI doesn't wait out the full reconnectPeriod.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && client && !client.connected) {
        console.info("[MQTT] tab visible, forcing reconnect");
        client.reconnect();
      }
    });
  }

  return client;
}

export function subscribe(callback) {
  const mqttClient = ensureClient();
  listeners.add(callback);

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && statusListeners.size === 0 && mqttClient) {
      mqttClient.end(false);
      client = undefined;
      updateStatus({ connected: false, reconnecting: false, error: null });
    }
  };
}

export function subscribeStatus(callback) {
  statusListeners.add(callback);
  callback({ ...status });
  ensureClient();

  return () => {
    statusListeners.delete(callback);
    if (listeners.size === 0 && statusListeners.size === 0 && client) {
      client.end(false);
      client = undefined;
      updateStatus({ connected: false, reconnecting: false, error: null });
    }
  };
}

export function getMqttConnectionStatus() {
  return { ...status };
}

/**
 * Publish a command payload to the canonical commands topic.
 *   elevator/{mqtt_safe_thing_id}/commands
 * thingId may be either a Ditto Thing ID ("building:floor1:elevator") or
 * an MQTT-safe id ("building-floor1-elevator"); both are normalised.
 * Returns true on enqueue, false if the client is not connected.
 */
export function publishCommand(thingId, payload, { qos = 1, retain = false } = {}) {
  const mqttClient = ensureClient();
  if (!mqttClient || !mqttClient.connected) return false;
  const safeId = String(thingId || env.THING_ID).replace(/:/g, "-");
  const topic = `elevator/${safeId}/commands`;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  mqttClient.publish(topic, body, { qos, retain });
  return true;
}
