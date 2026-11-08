type Result = { id: string; status: string; pnl: number };
let handler: ((trade: Result) => boolean) | undefined;
/** Only the existing server-confirmed settlement path calls this. No price feed. */
export function registerFestivalSettlement(next: (trade: Result) => boolean) {
  handler = next;
  return () => { if (handler === next) handler = undefined; };
}
export function celebrateFestivalSettlement(trade: Result) {
  return handler?.(trade) ?? false;
}

const SEEN = "indianxtrade:diwali:2026:wins";
const seen = new Set<string>();
/** Bounded session persistence prevents reconnect, remount and refresh replays. */
export function claimFestivalWin(id: string) {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(SEEN) ?? "[]");
    if (Array.isArray(saved)) saved.slice(-100).forEach(value => { if (typeof value === "string") seen.add(value); });
  } catch { /* In-memory deduplication still works. */ }
  if (seen.has(id)) return false;
  seen.add(id);
  while (seen.size > 100) seen.delete(seen.values().next().value!);
  try { sessionStorage.setItem(SEEN, JSON.stringify([...seen])); } catch { /* Storage optional. */ }
  return true;
}
