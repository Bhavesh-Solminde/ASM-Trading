/** The rows of an infinite payments query, flattened across pages (newest first), optionally capped. */
export function paymentRows<R>(data: { pages: ReadonlyArray<{ rows: readonly R[] }> } | undefined, limit?: number): R[] {
  const rows = (data?.pages ?? []).flatMap((page) => page.rows);
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** A row of an infinite payments query by its key, if its page has been loaded. */
export function findPaymentRow<R extends { key: string }>(data: { pages: ReadonlyArray<{ rows: readonly R[] }> } | undefined, key: string): R | undefined {
  for (const page of data?.pages ?? []) {
    const hit = page.rows.find((row) => row.key === key);
    if (hit) return hit;
  }
  return undefined;
}
