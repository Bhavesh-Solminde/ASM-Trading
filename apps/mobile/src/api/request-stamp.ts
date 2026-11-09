/**
 * The later of two request-start times. A refetch that was cancelled or superseded can resolve after a
 * newer one; its (older) start must never move the "last bootstrap started" stamp backwards.
 */
export function latestStamp(current: number, next: number): number {
  return Math.max(current, next);
}
