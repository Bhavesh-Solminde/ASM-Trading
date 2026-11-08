/** Campaign boundaries are absolute instants; the end is midnight in India. */
export const DIWALI_START = Date.parse("2026-11-08T00:00:00+05:30");
export const DIWALI_END = Date.parse("2026-11-13T00:00:00+05:30");
export const DIWALI_SEEN_KEY = "indianxtrade:diwali:2026:seen";

export function isDiwali(now = Date.now()) {
  return now >= DIWALI_START && now < DIWALI_END;
}

