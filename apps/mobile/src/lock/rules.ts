export const LOCK_AFTER_MS = 5 * 60 * 1000;
export const MAX_PIN_ATTEMPTS = 5;

export function shouldLock(input: {
  enabled: boolean;
  coldStart: boolean;
  backgroundedAt: number | null;
  now: number;
}): boolean {
  if (!input.enabled) return false;
  if (input.coldStart) return true;
  return input.backgroundedAt !== null && input.now - input.backgroundedAt >= LOCK_AFTER_MS;
}

/** The wrong-PIN count after one more miss, and whether that miss ends the session. */
export function nextAttempt(attempts: number, max: number = MAX_PIN_ATTEMPTS): { attempts: number; logout: boolean } {
  const next = attempts + 1;
  return { attempts: next, logout: next >= max };
}

/** Reads the persisted wrong-PIN count; anything missing or corrupt counts as zero. */
export function parseAttempts(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : 0;
}
