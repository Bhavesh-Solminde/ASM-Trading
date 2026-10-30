import { groupByDay, itemMatchesFilter, paymentItem, type PaymentRow } from "@asm/client-core";
import { dayHeading, type DayHeading } from "./day-label";
import type { PaymentsFilter } from "./history-params";

export interface PaymentSection {
  /** The local calendar day: stable across refetches, so the list keeps its place. */
  key: string;
  heading: DayHeading;
  /** SectionList reads the rows from `data`. */
  data: PaymentRow[];
}

/** The rows that pass `filter`, newest first, grouped by day. A day with no matching row has no section. */
export function paymentSections(rows: readonly PaymentRow[], filter: PaymentsFilter, now: Date): PaymentSection[] {
  const items = rows.map(paymentItem).filter((item) => itemMatchesFilter(item, filter));
  return groupByDay(items, now).map((group) => ({
    key: group.key,
    heading: dayHeading(group.items[0]!.atMs, now.getTime()),
    data: group.items.flatMap((item) => (item.kind === "trade" ? [] : [item.payment])),
  }));
}

/** Fewer rows than this on screen and a filtered list may be too short to scroll, so the next page is fetched without a scroll. */
export const MIN_SHOWN_ROWS = 8;

/**
 * Whether to fetch the next page of payments: never when there is none, while one is loading, or after one failed (the
 * list shows a Retry instead, so a dead network is not hammered in a loop). Otherwise when the user scrolled to the end
 * (`end`), or when the filtered list is too short to scroll (`short`).
 */
export function shouldLoadMore(input: { hasNextPage: boolean; fetching: boolean; failed: boolean; shown: number; reason: "end" | "short" }): boolean {
  if (!input.hasNextPage || input.fetching || input.failed) return false;
  return input.reason === "end" || input.shown < MIN_SHOWN_ROWS;
}
