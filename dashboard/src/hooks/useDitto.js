"use client";

import { useEffect, useRef, useState } from "react";
import { env } from "../config/env";
import { getThing, getThingEventsPath } from "../services/dittoApi";

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

function deepMerge(base, patch) {
  if (!isObject(patch)) return patch;

  const result = { ...(isObject(base) ? base : {}) };

  Object.entries(patch).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      result[key] = value;
      return;
    }

    if (isObject(value)) {
      result[key] = deepMerge(base?.[key], value);
      return;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
}

function cloneForPathUpdate(value) {
  if (Array.isArray(value)) return [...value];
  if (isObject(value)) return { ...value };
  return {};
}

function applyValueAtPath(currentThing, path, value) {
  if (!path || path === "/") return value;

  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment.replace(/~1/g, "/").replace(/~0/g, "~"));
      } catch {
        return segment;
      }
    });

  if (segments.length === 0) return value;

  const root = cloneForPathUpdate(currentThing);
  let cursor = root;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    cursor[segment] = cloneForPathUpdate(cursor[segment]);
    cursor = cursor[segment];
  }

  cursor[segments[segments.length - 1]] = value;
  return root;
}

function applyDittoEvent(currentThing, eventPayload) {
  if (!eventPayload || typeof eventPayload !== "object") {
    return null;
  }

  if (eventPayload.value && (eventPayload.value.features || eventPayload.value.attributes)) {
    return deepMerge(currentThing || {}, eventPayload.value);
  }

  if (eventPayload.thingId && eventPayload.features) {
    return deepMerge(currentThing || {}, eventPayload);
  }

  const path = eventPayload.path || eventPayload.resource;
  if (typeof path === "string" && Object.prototype.hasOwnProperty.call(eventPayload, "value")) {
    return applyValueAtPath(currentThing || {}, path, eventPayload.value);
  }

  return null;
}

export function useDitto(options = {}) {
  const {
    enabled = true,
    thingId = env.THING_ID,
    onThingUpdate,
    pollIntervalMs = env.DITTO_POLL_INTERVAL_MS,
  } = options;

  const onThingUpdateRef = useRef(onThingUpdate);
  const thingRef = useRef(null);
  const lastSuccessfulRefreshRef = useRef(0);
  const [thing, setThing] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState("idle");
  const [error, setError] = useState(null);

  onThingUpdateRef.current = onThingUpdate;

  useEffect(() => {
    if (!enabled) {
      thingRef.current = null;
      setThing(null);
      setIsConnected(false);
      setMode("idle");
      setError(null);
      return undefined;
    }

    let stopped = false;
    let eventSource;
    let pollingTimer;

    const publishThing = (nextThing) => {
      lastSuccessfulRefreshRef.current = Date.now();
      thingRef.current = nextThing;
      setThing(nextThing);
      onThingUpdateRef.current?.(nextThing);
    };

    const refreshThing = async () => {
      try {
        const nextThing = await getThing(thingId);
        if (stopped) return;

        publishThing(nextThing);
        setIsConnected(true);
        setError(null);
      } catch (nextError) {
        if (stopped) return;

        const staleAfterMs = Math.max(pollIntervalMs * 3, 10000);
        const hasFreshThing = Date.now() - lastSuccessfulRefreshRef.current < staleAfterMs;
        console.warn("[Ditto] thing refresh degraded", nextError);
        setIsConnected(hasFreshThing);
        setError(nextError.message || "Ditto refresh failed");
      }
    };

    const startPollingFallback = (reason = "SSE unavailable") => {
      if (stopped || pollingTimer) return;

      console.warn(`[Ditto] ${reason}, using REST polling`);
      setMode("polling");
      void refreshThing();
      pollingTimer = window.setInterval(() => {
        void refreshThing();
      }, pollIntervalMs);
    };

    const startPollingHeartbeat = () => {
      if (stopped || pollingTimer) return;

      pollingTimer = window.setInterval(() => {
        void refreshThing();
      }, pollIntervalMs);
    };

    if (!env.DITTO_SSE_ENABLED) {
      startPollingFallback("SSE disabled by configuration");
      return () => {
        stopped = true;
        if (pollingTimer) {
          window.clearInterval(pollingTimer);
        }
      };
    }

    try {
      const eventsUrl = new URL(getThingEventsPath(thingId), window.location.origin);
      eventSource = new EventSource(eventsUrl.toString());
      setMode("sse");

      eventSource.onopen = async () => {
        console.info("[Ditto] SSE connected");
        setIsConnected(true);
        setError(null);
        await refreshThing();
        // Ditto SSE can stay open without emitting every twin update behind proxies.
        // Keep polling as a heartbeat so SCADA state cannot freeze.
        startPollingHeartbeat();
      };

      eventSource.onmessage = async (event) => {
        if (!event?.data) return;

        try {
          const payload = JSON.parse(event.data);
          const nextThing = applyDittoEvent(thingRef.current, payload);

          if (nextThing) {
            publishThing(nextThing);
            setIsConnected(true);
            setError(null);
            return;
          }

          await refreshThing();
        } catch (nextError) {
          console.error("[Ditto] SSE payload parsing failed", nextError);
          setError(nextError.message || "Failed to parse Ditto event");
          await refreshThing();
        }
      };

      eventSource.onerror = (nextError) => {
        if (stopped) return;

        console.warn("[Ditto] SSE transport error", nextError);
        setIsConnected(Date.now() - lastSuccessfulRefreshRef.current < Math.max(pollIntervalMs * 3, 10000));
        setError("Ditto SSE unavailable");
        eventSource?.close();
        startPollingFallback("SSE transport unavailable");
      };
    } catch (nextError) {
      console.error("[Ditto] failed to initialize SSE", nextError);
      setError(nextError.message || "Ditto SSE initialization failed");
      startPollingFallback("SSE initialization failed");
    }

    return () => {
      stopped = true;
      eventSource?.close();
      if (pollingTimer) {
        window.clearInterval(pollingTimer);
      }
    };
  }, [enabled, pollIntervalMs, thingId]);

  return {
    thing,
    isConnected,
    mode,
    error,
  };
}
