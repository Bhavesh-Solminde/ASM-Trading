const pad = (n: number) => String(n).padStart(2, "0");

/** A length of time as "HH:MM:SS" — 90 → "00:01:30". */
export function hms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Time remaining, rounded up: "MM:SS" under an hour, "HH:MM:SS" beyond. */
export function countdown(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  if (s >= 3600) return hms(s);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Local wall-clock time of an epoch-seconds instant, "HH:MM:SS". */
export function clockTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
