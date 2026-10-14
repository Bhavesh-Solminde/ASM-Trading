import { clockTime } from "@asm/client-core";

const pad = (n: number) => String(n).padStart(2, "0");

/** When a trade closed: the clock time if that was today (device time zone), else "dd/mm" in front of it. */
export function closedStamp(expiryTs: number, nowMs: number): string {
  const d = new Date(expiryTs * 1000);
  const n = new Date(nowMs);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const time = clockTime(expiryTs);
  return sameDay ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}
