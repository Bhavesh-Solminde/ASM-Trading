/** A day heading as data, so the screen words it in the user's language: "Today", "Yesterday", "12 Oct" or "31 Dec 2025". */
export type DayHeading =
  | { kind: "today" }
  | { kind: "yesterday" }
  /** `month` is 0-based (0 = January); `year` is null for the current year. */
  | { kind: "date"; day: number; month: number; year: number | null };

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The heading for the local calendar day of `atMs`, as seen on `nowMs` (the same day rule as client-core's `groupByDay`). */
export function dayHeading(atMs: number, nowMs: number): DayHeading {
  const d = new Date(atMs);
  const now = new Date(nowMs);
  if (sameDay(d, now)) return { kind: "today" };
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return { kind: "yesterday" };
  return { kind: "date", day: d.getDate(), month: d.getMonth(), year: d.getFullYear() === now.getFullYear() ? null : d.getFullYear() };
}
