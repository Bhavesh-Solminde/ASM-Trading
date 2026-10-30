import { describe, expect, it } from "vitest";
import type { PaymentRow } from "@asm/client-core";
import { MAX_AUTO_PAGES, paymentSections, shouldLoadMore, showLoadMore } from "./payment-sections";

const row = (id: string, kind: "deposit" | "withdrawal", at: Date): PaymentRow => ({
  key: `${kind === "deposit" ? "d" : "w"}:${id}`,
  id,
  kind,
  createdAt: at.toISOString(),
  updatedAt: null,
  status: "COMPLETED",
  methodLabel: "UPI",
  amountMinor: 100,
  currency: "INR",
  destination: null,
  expiresAt: null,
  holdUntil: null,
  cancelableUntil: null,
});
const now = new Date(2026, 9, 21, 15);
const rows = [
  row("a", "deposit", new Date(2026, 9, 21, 9)),
  row("b", "withdrawal", new Date(2026, 9, 21, 8)),
  row("c", "deposit", new Date(2026, 9, 20, 22)),
  row("d", "deposit", new Date(2026, 8, 3, 10)),
];

describe("paymentSections", () => {
  it("groups by day, newest first, one section per day with a stable key", () => {
    const sections = paymentSections(rows, "all", now);
    expect(sections.map((s) => s.data.map((r) => r.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(sections.map((s) => s.heading)).toEqual([{ kind: "today" }, { kind: "yesterday" }, { kind: "date", day: 3, month: 8, year: null }]);
    expect(new Set(sections.map((s) => s.key)).size).toBe(3);
  });
  it("sorts rows that arrive out of order", () => {
    expect(paymentSections([...rows].reverse(), "all", now).map((s) => s.data.map((r) => r.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
  it("filters to deposits or withdrawals and drops empty days", () => {
    expect(paymentSections(rows, "deposits", now).map((s) => s.data.map((r) => r.id))).toEqual([["a"], ["c"], ["d"]]);
    expect(paymentSections(rows, "withdrawals", now).map((s) => s.data.map((r) => r.id))).toEqual([["b"]]);
  });
  it("is empty for no rows", () => {
    expect(paymentSections([], "all", now)).toEqual([]);
  });
});

describe("shouldLoadMore", () => {
  const base = { hasNextPage: true, fetching: false, failed: false, shown: 3, autoPagesUsed: 0, userScrolled: true };
  it("loads the next page when the list is short, and when the user reaches the end", () => {
    expect(shouldLoadMore({ ...base, reason: "short" })).toBe(true);
    expect(shouldLoadMore({ ...base, reason: "end" })).toBe(true);
  });
  it("does not load when the list is already long enough to scroll, unless the user reached the end", () => {
    expect(shouldLoadMore({ ...base, shown: 12, reason: "short" })).toBe(false);
    expect(shouldLoadMore({ ...base, shown: 12, reason: "end" })).toBe(true);
  });
  it("never loads with no next page, while a fetch is running, or after a failed one (no retry loop)", () => {
    expect(shouldLoadMore({ ...base, hasNextPage: false, reason: "end" })).toBe(false);
    expect(shouldLoadMore({ ...base, fetching: true, reason: "short" })).toBe(false);
    expect(shouldLoadMore({ ...base, failed: true, reason: "short" })).toBe(false);
    expect(shouldLoadMore({ ...base, failed: true, reason: "end" })).toBe(false);
  });
  it("stops loading by itself after MAX_AUTO_PAGES, but a user who scrolled to the end still loads", () => {
    expect(shouldLoadMore({ ...base, autoPagesUsed: MAX_AUTO_PAGES - 1, reason: "short" })).toBe(true);
    expect(shouldLoadMore({ ...base, autoPagesUsed: MAX_AUTO_PAGES, reason: "short" })).toBe(false);
    expect(shouldLoadMore({ ...base, autoPagesUsed: MAX_AUTO_PAGES, reason: "end", userScrolled: true })).toBe(true);
  });
  it("ignores an end event the layout fired (no user scroll): a list too short to scroll is always 'at the end'", () => {
    // RN re-fires onEndReached on every content-size change, so a short list would page forever through "end".
    expect(shouldLoadMore({ ...base, autoPagesUsed: 0, reason: "end", userScrolled: false })).toBe(false);
    expect(shouldLoadMore({ ...base, autoPagesUsed: MAX_AUTO_PAGES, reason: "end", userScrolled: false })).toBe(false);
  });
  it("a run of layout-fired end events plus the budgeted short loads stops at the cap", () => {
    let used = 0;
    let loads = 0;
    for (let step = 0; step < 50; step++) {
      // Each page: the layout fires "end" (ignored), then the short rule may fetch within budget.
      if (shouldLoadMore({ ...base, autoPagesUsed: used, reason: "end", userScrolled: false })) loads++;
      if (shouldLoadMore({ ...base, autoPagesUsed: used, reason: "short" })) { loads++; used++; }
    }
    expect(loads).toBe(MAX_AUTO_PAGES);
  });
});

describe("showLoadMore", () => {
  const base = { hasNextPage: true, fetching: false, failed: false, shown: 3, autoPagesUsed: MAX_AUTO_PAGES, userScrolled: false };
  it("offers Load more when the list is still short, more exists and automatic paging has used its budget", () => {
    expect(showLoadMore(base)).toBe(true);
  });
  it("does not while automatic paging may still run, when the list is long enough, or when nothing can load", () => {
    expect(showLoadMore({ ...base, autoPagesUsed: MAX_AUTO_PAGES - 1 })).toBe(false);
    expect(showLoadMore({ ...base, shown: 12 })).toBe(false);
    expect(showLoadMore({ ...base, hasNextPage: false })).toBe(false);
    expect(showLoadMore({ ...base, fetching: true })).toBe(false);
    expect(showLoadMore({ ...base, failed: true })).toBe(false);
  });
});
