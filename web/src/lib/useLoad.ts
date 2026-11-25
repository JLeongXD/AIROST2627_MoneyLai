"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./domain";
import { createLiveQuery } from "./live-query";
import { reportSyncFailure, subscribeToRefresh } from "./live-sync";

export function useLoad<T>(load: () => Promise<T>, dependencies: unknown[] = []) {
  const loader = useRef(load);
  const query = useRef<ReturnType<typeof createLiveQuery<T>> | null>(null);
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: "", loading: true });
  useEffect(() => { loader.current = load; });
  useEffect(() => {
    let active = true;
    let hasData = false;
    const identity = {};
    const current = createLiveQuery(
      () => loader.current(),
      (data) => {
        hasData = true;
        setState({ data, error: "", loading: false });
        reportSyncFailure(identity, false);
      },
      (error) => {
        // Keep the last successful view and mounted forms during transient outages.
        if (!hasData) setState({ data: null, error: errorMessage(error), loading: false });
        reportSyncFailure(identity, true);
      },
    );
    query.current = current;
    const unsubscribe = subscribeToRefresh(() => { void current.refresh(); });
    void Promise.resolve().then(() => {
      if (!active) return;
      setState({ data: null, error: "", loading: true });
      void current.refresh();
    });
    return () => {
      active = false;
      current.stop();
      unsubscribe();
      reportSyncFailure(identity, false);
      if (query.current === current) query.current = null;
    };
    // Callers specify data identity; refreshes use the latest committed loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  const reload = useCallback(() => { void query.current?.refresh(); }, []);
  return { ...state, reload };
}
