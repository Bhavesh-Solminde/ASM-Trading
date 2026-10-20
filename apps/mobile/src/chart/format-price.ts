/**
 * A market price for the chart's tags and readout: the symbol's precision with Western thousands separators
 * ("94,553.62", not Indian lakh grouping: these are quotes, not rupee amounts). Non-finite input gives "—".
 */
export function fmtPrice(n: number, precision: number): string {
  if (!Number.isFinite(n)) return "—";
  const fixed = n.toFixed(precision);
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(fixed);
  if (!m) return fixed; // exponent form for huge values: show as is rather than mangle it
  return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+$)/g, ",")}${m[3] ?? ""}`;
}
