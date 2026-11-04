/** Failures after which the banner appears: one blip reconnects silently, a second means it is not coming back right away. */
export const OFFLINE_BANNER_FAILURES = 2;

/** `isConnected` is null until NetInfo's first reading; that is not "offline". */
export function shouldShowOffline(consecutiveFailures: number, isConnected: boolean | null): boolean {
  return isConnected === false || consecutiveFailures >= OFFLINE_BANNER_FAILURES;
}
