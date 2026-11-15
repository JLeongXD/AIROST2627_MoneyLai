"use client";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "./domain";
export function useLoad<T>(
  load: () => Promise<T>,
  dependencies: unknown[] = [],
) {
  const loader = useRef(load);
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (active) setState((s) => ({ ...s, error: "", loading: true }));
        return loader.current();
      })
      .then((data) => {
        if (active) setState({ data, error: "", loading: false });
      })
      .catch((error) => {
        if (active)
          setState({ data: null, error: errorMessage(error), loading: false });
      });
    return () => {
      active = false;
    };
    // Callers specify the data identity; the latest loader is kept in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);
  return { ...state, reload: () => setRevision((n) => n + 1) };
}
