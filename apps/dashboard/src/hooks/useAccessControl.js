"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../config/env.js";
import * as api from "../services/accessControlClient.js";

/**
 * React hook backing the Access-Control page.
 *
 * - Tags are loaded from Ditto (via /api/access-control/tags) and refreshed
 *   after every mutation so the UI reflects the twin's source of truth.
 * - Access logs are polled from /api/access-control/logs (Postgres-backed,
 *   with a Ditto ring-buffer fallback) so live device scans appear without a
 *   manual refresh.
 *
 * All mutations return the API result envelope ({ ok, error, ... }) so callers
 * can surface toasts / inline errors. The hook never throws.
 */
export function useAccessControl({ thingId = env.THING_ID, logPollMs = 5000, enabled = true } = {}) {
  const [tags, setTags] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logSource, setLogSource] = useState(null);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const refreshTags = useCallback(async () => {
    setLoadingTags(true);
    const result = await api.listTags(thingId);
    if (!mountedRef.current) return result;
    if (result.ok) {
      setTags(Array.isArray(result.tags) ? result.tags : []);
      setError(null);
    } else {
      setError(result.error || "Failed to load tags");
    }
    setLoadingTags(false);
    return result;
  }, [thingId]);

  const refreshLogs = useCallback(async () => {
    setLoadingLogs(true);
    const result = await api.listAccessLogs({ thingId, limit: 100 });
    if (!mountedRef.current) return result;
    if (result.ok) {
      setLogs(Array.isArray(result.data) ? result.data : []);
      setLogSource(result.source || null);
    }
    setLoadingLogs(false);
    return result;
  }, [thingId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return undefined;
    void refreshTags();
    void refreshLogs();
    const timer = setInterval(() => {
      void refreshLogs();
    }, Math.max(2000, logPollMs));
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, logPollMs, refreshTags, refreshLogs]);

  const createTag = useCallback(async (tag) => {
    const result = await api.createTag(tag, thingId);
    if (result.ok) await refreshTags();
    return result;
  }, [thingId, refreshTags]);

  const updateTag = useCallback(async (tag) => {
    const result = await api.updateTag(tag, thingId);
    if (result.ok) await refreshTags();
    return result;
  }, [thingId, refreshTags]);

  const toggleTag = useCallback(async (uid, enabled2) => {
    const result = await api.setTagEnabled(uid, enabled2, thingId);
    if (result.ok) await refreshTags();
    return result;
  }, [thingId, refreshTags]);

  const deleteTag = useCallback(async (uid) => {
    const result = await api.deleteTag(uid, thingId);
    if (result.ok) await refreshTags();
    return result;
  }, [thingId, refreshTags]);

  const recordEvent = useCallback(async (event) => {
    const result = await api.recordAccessEvent(event, thingId);
    if (result.ok) await refreshLogs();
    return result;
  }, [thingId, refreshLogs]);

  return {
    tags,
    logs,
    logSource,
    loadingTags,
    loadingLogs,
    error,
    refreshTags,
    refreshLogs,
    createTag,
    updateTag,
    toggleTag,
    deleteTag,
    recordEvent,
  };
}
