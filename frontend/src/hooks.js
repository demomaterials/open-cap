import { useCallback, useEffect, useRef, useState } from 'react';

/** Load data from an async fn; re-runs when deps change. Optional polling. */
export function useLoad(fn, deps = [], { poll } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);
  useEffect(() => {
    reload();
    if (!poll) return undefined;
    const t = setInterval(() => reload(true), poll);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload };
}
