/** Push taps can only open the app's receipt/history or verification screens. */
export function pushTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  if (value === "/history" || value === "/account/verify") return value;
  return /^\/history\?tx=[dw]:[a-zA-Z0-9_-]+$/.test(value) ? value : null;
}
