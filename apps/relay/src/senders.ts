export function parseSenderList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Pre-filter only. The server parses authoritatively; this exists so the phone
 * does not ship every OTP and delivery notification over the network.
 *
 * Fails closed on an empty allowlist: unconfigured must mean "forward nothing",
 * never "forward everything".
 */
export function isAllowedSender(
  sender: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.length === 0) return false;
  const upper = sender.trim().toUpperCase();
  if (upper.length === 0) return false;
  return allowlist.some((fragment) => upper.includes(fragment));
}
