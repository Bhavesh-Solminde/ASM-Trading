/**
 * Epoch ms of the most recent midnight in `timeZone` at or before `nowMs`.
 * Used for "of the day" windows (e.g. the leaderboard) so the boundary is the
 * product's timezone, not the server's. Pure and host-tz independent via
 * Intl parts rather than a timezone library.
 */
export function startOfDayMs(nowMs: number, timeZone = "Asia/Kolkata"): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(nowMs);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // 24:00 is emitted by some engines for midnight; normalise to 0.
  const hour = get("hour") % 24;
  const secondsIntoDay = hour * 3600 + get("minute") * 60 + get("second");
  return nowMs - secondsIntoDay * 1000;
}
