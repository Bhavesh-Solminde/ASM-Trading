const STEPS = [500, 1000, 2000, 4000, 8000];
const CAP = 15_000;

/**
 * Reconnect delay for the nth consecutive failure (0-based): 0.5s, 1s, 2s, 4s, 8s, then 15s,
 * each jittered ±20%. `random` is injected (returns [0, 1)) so the schedule is deterministic in tests.
 */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = attempt < STEPS.length ? STEPS[attempt]! : CAP;
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Maps 4 random bytes to a uniform number in [0, 1). */
export function unitFromBytes(bytes: Uint8Array): number {
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return n / 0x1_0000_0000;
}
