/**
 * Calls `clear` each time `locked` flips to true. A "Won ₹…" toast keeps its 3.5s timer while the app is
 * backgrounded (Android pauses JS timers), so without this it could be drawn over the lock screen after a relock.
 * The store is injected so this stays free of native imports. Returns the unsubscribe.
 */
export function clearOnLock<S extends { locked: boolean }>(
  store: { subscribe: (listener: (state: S, prev: S) => void) => () => void },
  clear: () => void,
): () => void {
  return store.subscribe((s, prev) => {
    if (s.locked && !prev.locked) clear();
  });
}
