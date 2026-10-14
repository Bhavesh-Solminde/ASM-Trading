import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { historyRetryDelay, isSameKey } from "./live";
import type { PriceRange } from "./types";

interface Commit {
  range: PriceRange;
  /** The structural inputs the range was committed for. */
  key: readonly unknown[];
}

/**
 * The price range the history layer is drawn with. A change to `key` (pan, zoom, resize, chart type,
 * a new candle) commits the live range in the same render, so the history never lags the viewport.
 * A change to the range alone (a tick moved the forming candle or last price) is committed by a timer
 * at most once per HISTORY_INTERVAL_MS, and still lands when the market goes quiet.
 *
 * Render stays pure: it only compares `key` and sets state; clock reads, the commit timestamp and the
 * timer all live in effects.
 */
export function useHistoryCommit(live: PriceRange, key: readonly unknown[]): PriceRange {
  const [commit, setCommit] = useState<Commit>(() => ({ range: live, key }));
  let current = commit;
  if (!isSameKey(commit.key, key)) {
    current = { range: live, key };
    setCommit(current);
  }

  const latest = useRef({ live, key });
  useLayoutEffect(() => {
    latest.current = { live, key };
  });

  const committedAt = useRef(0);
  useEffect(() => {
    committedAt.current = Date.now();
  }, [commit]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current !== null) return;
    const delay = historyRetryDelay(commit.range, committedAt.current, live, Date.now());
    if (delay === null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      // Forced: the delay was computed to reach the interval, and structural changes already
      // committed in render, so `latest` carries the key `commit` holds.
      setCommit({ range: latest.current.live, key: latest.current.key });
    }, delay);
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return current.range;
}
