"use client";

import { useEffect, useRef, useState } from "react";
import { getMqttConnectionStatus, subscribe, subscribeStatus } from "../services/mqttClient";

export function useMqtt(optionsOrCallback) {
  const options = typeof optionsOrCallback === "function"
    ? { onTelemetry: optionsOrCallback }
    : (optionsOrCallback || {});

  const { enabled = true, onTelemetry } = options;
  const callbackRef = useRef(onTelemetry);
  const [status, setStatus] = useState(getMqttConnectionStatus());
  const [lastMessage, setLastMessage] = useState(null);

  callbackRef.current = onTelemetry;

  useEffect(() => {
    if (!enabled) {
      setStatus((current) => ({
        ...current,
        connected: false,
        reconnecting: false,
      }));
      return undefined;
    }

    const unsubscribe = subscribe((payload) => {
      setLastMessage(payload);
      callbackRef.current?.(payload);
    });

    const unsubscribeStatus = subscribeStatus((nextStatus) => {
      setStatus(nextStatus);
    });

    return () => {
      unsubscribe();
      unsubscribeStatus();
    };
  }, [enabled]);

  return {
    isConnected: status.connected,
    isReconnecting: status.reconnecting,
    error: status.error,
    lastMessage,
    topic: status.topic,
  };
}
