/**
 * Pure helpers behind the big amount field and its keypad. Amounts are held as
 * strings (what the user typed) and only turned into minor units at submit.
 */
export interface AmountOpts {
  /** Allow a decimal point (up to two places). Deposits are whole currency units. */
  decimals: boolean;
  /** Longest whole part, so the figure can't outgrow the screen. */
  maxInt?: number;
}

/** Cleans arbitrary input (typing or paste) down to a valid amount string. */
export function sanitizeAmount(raw: string, { decimals, maxInt = 9 }: AmountOpts): string {
  let s = raw.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  const [int = "", frac] = s.split(".");
  let whole = int.replace(/^0+(?=\d)/, "").slice(0, maxInt);
  if (whole === "" && frac !== undefined) whole = "0";
  return frac === undefined ? whole : `${whole}.${frac}`;
}

/** One keypad press: a digit, ".", or "back". */
export function applyKey(current: string, key: string, opts: AmountOpts): string {
  if (key === "back") return current.slice(0, -1);
  if (key === ".") return opts.decimals && !current.includes(".") ? sanitizeAmount(`${current || "0"}.`, opts) : current;
  if (/^\d$/.test(key)) return sanitizeAmount(current + key, opts);
  return current;
}

/** "1,00,000" style is for display only; the app writes en-US grouping ("100,000"). */
export function groupAmount(value: string): string {
  if (value === "") return "0";
  const [int = "0", frac] = value.split(".");
  const grouped = Number(int).toLocaleString("en-US");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}
