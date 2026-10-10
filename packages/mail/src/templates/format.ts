const IST = "Asia/Kolkata";

/** "11 Oct 2026", in India time regardless of the server's timezone. */
export function formatDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: IST }).format(d);
}

/** "11 Oct 2026, 01:30 IST". */
export function formatDateTimeLabel(d: Date): string {
  const s = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  }).format(d);
  return `${s} IST`;
}

/** The 8-character reference shown on receipts ("8F3A21C9"). */
export function shortRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const METHOD_LABEL: Record<string, string> = { BANK: "Bank account", UPI: "UPI", USDT: "USDT" };

/** "UPI · asha@okhdfc". `destination` comes from contracts' payoutDestinationLabel. */
export function payToLabel(method: string, destination: string | null): string {
  const label = METHOD_LABEL[method] ?? method;
  return destination ? `${label} · ${destination}` : label;
}
