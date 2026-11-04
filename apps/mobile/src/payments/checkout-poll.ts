/** The three states a deposit never leaves. Polling stops there and the screen shows the result. */
export const FINAL_STATUSES = ["COMPLETED", "REJECTED", "EXPIRED"] as const;

export const isFinalStatus = (status: string | null | undefined): boolean => !!status && (FINAL_STATUSES as readonly string[]).includes(status);

/** How often the open pay screen asks the server for the payment's status. */
export const POLL_INTERVAL_MS = 4000;

/** A visible-again refetch is skipped when the data is newer than this, so a flicker of focus cannot stack requests. */
export const MIN_REFETCH_GAP_MS = 1500;

/**
 * `refetchInterval` for the checkout query. `poll` is true only while the screen is focused, the app is in front and
 * the session is live (not locked, not signed out): anything else stops the clock. It also stops once the status is
 * final, and on a 4xx answer (the same request would be answered the same way, and a 429 toasts on every tick).
 * A dropped connection, a timeout (`ApiError.status` 0) or a 5xx keeps polling: those clear by themselves.
 */
export function pollIntervalMs(input: { poll: boolean; status: string | undefined; errorStatus: number | null }): number | false {
  if (!input.poll || isFinalStatus(input.status)) return false;
  if (input.errorStatus !== null && input.errorStatus >= 400 && input.errorStatus < 500) return false;
  return POLL_INTERVAL_MS;
}

/**
 * Whether to refetch once, right now, because the screen has just become visible again (the user came back from
 * their UPI app, unlocked, or returned from the claim screen) instead of waiting out the interval. At most one: not
 * while a fetch is running and not when the data is only just in.
 */
export function visibleRefetchDue(input: { wasVisible: boolean; visible: boolean; isFetching: boolean; lastFetchAtMs: number; nowMs: number }): boolean {
  if (!input.visible || input.wasVisible || input.isFetching) return false;
  const age = input.nowMs - input.lastFetchAtMs;
  return age >= MIN_REFETCH_GAP_MS || input.lastFetchAtMs === 0;
}

/**
 * What to do when the status reaches a final value: refresh the money queries and forget the pending checkout, once
 * (`handled` is set by the caller after). The success buzz is only for a payment that landed while the user watched.
 */
export function finalEffects(input: { prev: string | null; next: string | null; handled: boolean }): { run: boolean; haptic: boolean } {
  if (input.handled || !isFinalStatus(input.next)) return { run: false, haptic: false };
  const watchedItLand = input.prev !== null && !isFinalStatus(input.prev);
  return { run: true, haptic: input.next === "COMPLETED" && watchedItLand };
}
