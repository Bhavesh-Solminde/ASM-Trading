import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HistoryFlusher, commitOnKeyChange, sameRange, type RangeCommit } from "./live";
import type { PriceRange } from "./types";

/**
 * The price range the history layer is drawn with. A change to `key` (pan, zoom, resize, chart type,
 * a new candle) commits the live range in the same render, so the history never lags the viewport.
 * A change to the range alone (a tick moved the forming candle or last price) is committed by a timer
 * at most once per HISTORY_INTERVAL_MS, and still lands when the market goes quiet.
 *
 * Render stays pure: it only compares `key` and sets state when that key changed (the next render sees
 * the same key, so it cannot loop); clock reads, the commit timestamp and the timer live in effects.
 */
export function useHistoryCommit(live: PriceRange, key: readonly unknown[]): PriceRange {
  const [commit, setCommit] = useState<RangeCommit>(() => ({ range: live, key }));
  const current = commitOnKeyChange(commit, live, key);
  if (current !== commit) setCommit(current);

  const latest = useRef({ live, key });
  useLayoutEffect(() => {
    latest.current = { live, key };
  });

  const committedAt = useRef(0);
  useEffect(() => {
    committedAt.current = Date.now();
  }, [commit]);

  const flusher = useRef<HistoryFlusher | null>(null);
  flusher.current ??= new HistoryFlusher();
  useEffect(() => {
    // Forced commit of the latest range (the delay was computed to reach the interval); an unchanged
    // range returns the same state object, so nothing re-renders.
    flusher.current?.schedule(commit.range, committedAt.current, live, Date.now(), () =>
      setCommit((c) =>
        sameRange(c.range, latest.current.live) ? c : { range: latest.current.live, key: latest.current.key },
      ),
    );
  });
  useEffect(() => {
    const f = flusher.current;
    return () => f?.cancel();
  }, []);

  return current.range;
}
