import type { DayHeading } from "./day-label";
import { MONTH_KEYS, whenParts } from "./when";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const monthName = (t: Translate, month: number) => t(`history.month.${MONTH_KEYS[month]}`);

/** A day heading in the user's language: "Today", "Yesterday", "12 Oct", "31 Dec 2025". */
export function headingText(t: Translate, heading: DayHeading): string {
  if (heading.kind === "today") return t("history.day.today");
  if (heading.kind === "yesterday") return t("history.day.yesterday");
  const month = monthName(t, heading.month);
  return heading.year === null ? t("history.day.date", { day: heading.day, month }) : t("history.day.dateYear", { day: heading.day, month, year: heading.year });
}

/** "21 Oct, 10:32" (with the year when it is not the current one), in the user's language. */
export function whenText(t: Translate, atMs: number, nowMs: number): string {
  const w = whenParts(atMs, nowMs);
  const month = monthName(t, w.month);
  const date = w.year === null ? t("history.day.date", { day: w.day, month }) : t("history.day.dateYear", { day: w.day, month, year: w.year });
  return t("history.when", { date, time: w.time });
}
