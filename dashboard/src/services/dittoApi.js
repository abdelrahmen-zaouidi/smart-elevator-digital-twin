import { env } from "../config/env";

const encodeBasicAuth = (username, password) => {
  const value = `${username}:${password}`;
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return `Basic ${window.btoa(value)}`;
  }

  if (typeof globalThis !== "undefined" && globalThis.Buffer?.from) {
    return `Basic ${globalThis.Buffer.from(value).toString("base64")}`;
  }

  throw new Error("Unable to encode Ditto credentials");
};

const AUTH_HEADER = encodeBasicAuth(env.DITTO_USERNAME, env.DITTO_PASSWORD);
const API_BASE = env.DITTO_PROXY_BASE;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withThingId = (thingId = env.THING_ID) => encodeURIComponent(thingId);

function buildFeaturePath(featurePath) {
  return String(featurePath)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function request(path, options = {}, retries = 3) {
  const url = `${API_BASE}${path}`;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: AUTH_HEADER,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ditto API ${response.status} ${response.statusText}: ${body}`);
      }

      if (response.status === 204) return null;
      return response.json();
    } catch (error) {
      lastError = error;
      const message = error?.message || "";
      const log = /Ditto API 5\d\d|timeout|Failed to fetch|NetworkError|fetch failed|ECONNRESET|ECONNREFUSED/i.test(message)
        ? console.warn
        : console.error;
      log(`[Ditto] request failed (attempt ${attempt}/${retries})`, error);
      if (attempt < retries) {
        await sleep(300 * attempt);
      }
    }
  }

  throw lastError;
}

export function getThing(thingId = env.THING_ID) {
  return request(`/api/2/things/${withThingId(thingId)}`, { method: "GET" });
}

export function updateFeature(featurePath, payload, thingId = env.THING_ID) {
  return request(
    `/api/2/things/${withThingId(thingId)}/features/${buildFeaturePath(featurePath)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function updateAttributes(payload, thingId = env.THING_ID) {
  return request(`/api/2/things/${withThingId(thingId)}/attributes`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getThingEventsPath(thingId = env.THING_ID) {
  // Ditto SSE: same URL as the REST thing endpoint, but the browser's EventSource
  // sends Accept: text/event-stream, which Ditto uses to switch to event-stream mode.
  return `${env.DITTO_PROXY_BASE}/api/2/things/${withThingId(thingId)}`;
}

export function getDittoAuthHeader() {
  return AUTH_HEADER;
}
