/**
 * Money is stored as integer minor units everywhere — cents for USD, paise for
 * INR. No balance is ever a float. These helpers are the only sanctioned way to
 * cross between display values and stored values.
 */

const MINOR_PER_MAJOR = 100;

/** 100.5 -> 10050. Rounds half away from zero. */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) {
    throw new Error(`toMinor: expected a finite number, received ${major}`);
  }
  const scaled = major * MINOR_PER_MAJOR;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** 10050 -> 100.5. Only for display; never feed the result back into arithmetic. */
export function toMajor(minor: number): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`toMajor: expected an integer, received ${minor}`);
  }
  return minor / MINOR_PER_MAJOR;
}

const SYMBOLS: Record<string, string> = { USD: "$", INR: "₹", EUR: "€" };

export function formatMoney(minor: number, currency: string): string {
  const symbol = SYMBOLS[currency] ?? "";
  const value = toMajor(minor).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}
