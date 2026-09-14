const SYMBOLS: Record<string, string> = { USD: "$", INR: "₹", EUR: "€" };

/**
 * Client-safe twin of `formatMoney` in @asm/db. A client component cannot
 * import @asm/db — its barrel constructs the Prisma client — so these few
 * lines are duplicated rather than dragging a database driver toward the
 * browser bundle. Keep the two in step.
 */
export function formatMinor(minor: number, currency: string): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`formatMinor: expected an integer, received ${minor}`);
  }
  const symbol = SYMBOLS[currency] ?? "";
  const value = (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}
