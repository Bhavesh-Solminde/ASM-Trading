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
