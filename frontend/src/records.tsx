import { useEffect, useRef, useState } from "react";
import { api } from "./model";
export function useRecordPages<T>(
  kind: string,
  query: string | null,
  active: boolean,
) {
  const key = `${kind}?${query}`;
  const [state, setState] = useState<{
    key: string;
    pages: { items: T[]; nextCursor: string | null }[];
    index: number;
    loading: boolean;
    error: string;
  }>({ key: "", pages: [], index: 0, loading: false, error: "" });
  const flight = useRef<AbortController | null>(null);
  const current = useRef(state);
  current.current = state;
  async function load(cursor?: string, reset = false) {
    if (query === null || !active) return;
    flight.current?.abort();
    const abort = new AbortController();
    flight.current = abort;
    setState((s) => ({
      ...s,
      key,
      pages: reset || s.key !== key ? [] : s.pages,
      index: reset ? 0 : s.index,
      loading: true,
      error: "",
    }));
    try {
      const params = new URLSearchParams(query);
      params.set("limit", "25");
      params.set("page", "true");
      if (cursor) params.set("cursor", cursor);
      const page = await api(`/api/${kind}?${params}`, undefined, abort.signal);
      if (!abort.signal.aborted)
        setState((s) => ({
          key,
          pages: reset || s.key !== key ? [page] : [...s.pages, page],
          index: reset || s.key !== key ? 0 : s.pages.length,
          loading: false,
          error: "",
        }));
    } catch (e) {
      if (!abort.signal.aborted)
        setState((s) => ({
          ...s,
          loading: false,
          error: (e as Error).message,
        }));
    }
  }
  useEffect(() => {
    if (
      active &&
      query !== null &&
      (current.current.key !== key || !current.current.pages.length)
    )
      void load(undefined, true);
    else setState((s) => (s.loading ? { ...s, loading: false } : s));
    return () => flight.current?.abort();
  }, [key, active]);
  const valid = state.key === key;
  const page = valid ? state.pages[state.index] : undefined;
  return {
    items: page?.items ?? [],
    index: valid ? state.index : 0,
    loading: valid && state.loading,
    error: valid ? state.error : "",
    hasPrevious: valid && state.index > 0,
    hasNext: !!page?.nextCursor,
    refresh: () => void load(undefined, true),
    previous: () => {
      if (!state.loading)
        setState((s) => ({ ...s, index: Math.max(0, s.index - 1) }));
    },
    next: () => {
      if (state.loading) return;
      if (state.pages[state.index + 1])
        setState((s) => ({ ...s, index: s.index + 1 }));
      else if (page?.nextCursor) void load(page.nextCursor);
    },
  };
}
