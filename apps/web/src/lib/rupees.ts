/**
 * Typed rupees → exact paise: "1999", "19.99", "₹1,999.50" (₹, commas and
 * spaces ignored). Up to 12 rupee digits and 2 decimals; a sign only with
 * `signed`. Null for anything else. Shared by the user and admin money forms.
 */
export function rupeesToPaise(input: string, { signed = false } = {}): number | null {
  const m = /^([+-])?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(input.replace(/[₹,\s]/g, ""));
  if (!m || (m[1] && !signed)) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" ? -paise : paise;
}
