/** The rows of an infinite payments query, flattened across pages (newest first), optionally capped. */
export function paymentRows<R>(data: { pages: ReadonlyArray<{ rows: readonly R[] }> } | undefined, limit?: number): R[] {
  const rows = (data?.pages ?? []).flatMap((page) => page.rows);
  return limit === undefined ? rows : rows.slice(0, limit);
}
