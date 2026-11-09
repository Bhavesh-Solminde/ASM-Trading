export function readNumber(key: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const n = raw?.trim() ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
export function writeNumber(key: string, value: number): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    /* private browsing */
  }
}
export function readFlag(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}
export function writeFlag(key: string): void {
  try {
    globalThis.localStorage?.setItem(key, "1");
  } catch {
    /* private browsing */
  }
}
