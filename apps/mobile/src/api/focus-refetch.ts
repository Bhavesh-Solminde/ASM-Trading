/** How long fetched data counts as fresh when a tab gains focus (the same 15 s as the query client's `staleTime`). */
export const FOCUS_STALE_MS = 15_000;

/**
 * Whether gaining focus should refetch a list. `refetch()` ignores `staleTime`, and on an infinite query it re-requests
 * every loaded page in turn, so a tab switch must only do it when the data has actually gone stale (or was never fetched).
 * Never while the session is not live.
 */
export function shouldRefetchOnFocus(input: { live: boolean; dataUpdatedAt: number; now: number }): boolean {
  return input.live && input.now - input.dataUpdatedAt > FOCUS_STALE_MS;
}
