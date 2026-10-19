const pad = (n: number) => String(n).padStart(2, "0");

/** Ledger time column: "HH:MM", plus "dd/mm" when the trade closed on an earlier day (device time zone). */
export function ledgerStamp(expiryTs: number, nowMs: number): { time: string; date: string | null } {
  const d = new Date(expiryTs * 1000);
  const n = new Date(nowMs);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: sameDay ? null : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` };
}
