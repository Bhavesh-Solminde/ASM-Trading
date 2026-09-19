/** The thirteen durations the platform offers, in seconds. */
export const DURATIONS_SEC = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
] as const;

const ALLOWED = new Set<number>(DURATIONS_SEC);

export function isValidDuration(seconds: number): boolean {
  return ALLOWED.has(seconds);
}
