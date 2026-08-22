"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const DATA_REFRESH_INTERVAL_MS = 20_000;

export function useBackgroundRefresh(
  load: (signal: AbortSignal) => Promise<void>,
  refreshKey: string,
  intervalMs = DATA_REFRESH_INTERVAL_MS,
) {
  const loadRef = useRef(load);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    controllerRef.current = controller;
    setRefreshing(true);
    try {
      await loadRef.current(controller.signal);
    } finally {
      if (requestId === requestIdRef.current) {
        controllerRef.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestIdRef.current += 1;
    void refresh();
    const interval = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearInterval(interval);
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestIdRef.current += 1;
    };
  }, [intervalMs, refresh, refreshKey]);

  return { refresh, refreshing };
}
