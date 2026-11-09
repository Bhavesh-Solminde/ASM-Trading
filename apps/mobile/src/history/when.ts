/** i18n `history.month.<key>` names, January first. */
export const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** A moment as data for "21 Oct, 10:32": the local day, 0-based month, a year only when it is not the current one, and a 24-hour time. */
export function whenParts(atMs: number, nowMs: number): { day: number; month: number; year: number | null; time: string } {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: d.getDate(),
    month: d.getMonth(),
    year: d.getFullYear() === new Date(nowMs).getFullYear() ? null : d.getFullYear(),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
