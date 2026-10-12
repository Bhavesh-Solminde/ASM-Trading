"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "asm.favouriteMarkets";

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    // Private mode, blocked storage or corrupt JSON — favourites are a
    // convenience, so fall back to "none" rather than breaking the picker.
    return [];
  }
}

/**
 * Per-browser starred markets. Deliberately client-only: it is a convenience,
 * not account state, so it never round-trips to the server. Reads happen after
 * mount so the server and first client render agree (no hydration mismatch).
 */
export function useFavouriteMarkets(): {
  favourites: ReadonlySet<string>;
  toggle: (symbol: string) => void;
} {
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(() => new Set<string>());

  useEffect(() => {
    setFavourites(new Set(read()));
  }, []);

  const toggle = useCallback((symbol: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (!next.delete(symbol)) next.add(symbol);
      try {
        window.localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Storage unavailable — keep the in-memory toggle for this session.
      }
      return next;
    });
  }, []);

  return { favourites, toggle };
}
