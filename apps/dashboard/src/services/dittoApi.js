import { env } from "../config/env";

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

async function request(path, options = {}, retries = 3, timeoutMs = 8000) {
  const url = `${API_BASE}${path}`;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ditto API ${response.status} ${response.statusText}: ${body}`);
      }

      if (response.status === 204) return null;
      return response.json();
    } catch (error) {
      clearTimeout(timer);
      lastError = error?.name === "AbortError" ? new Error(`Ditto request timeout after ${timeoutMs}ms`) : error;
      const message = lastError?.message || "";
      const log = /Ditto API 5\d\d|timeout|aborted|Failed to fetch|NetworkError|fetch failed|ECONNRESET|ECONNREFUSED/i.test(message)
        ? console.warn
        : console.error;
      log(`[Ditto] request failed (attempt ${attempt}/${retries})`, lastError);
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
