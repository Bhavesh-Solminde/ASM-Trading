/**
 * Builds a `upi://pay` deep link with the exact reserved amount pre-filled.
 * Most UPI apps (GPay, PhonePe, Paytm, BHIM) auto-fill this so the user
 * doesn't retype it — the main real-world source of a wrong-amount payment.
 * Some UPI apps still let the user edit it before paying; the matching
 * engine, not this link, is the backstop for that case.
 */
export function buildUpiDeepLink(input: {
  vpa: string;
  payeeName: string;
  amountInr: number;
  /** `mc` — a merchant account's category code, copied from its own QR. */
  merchantCode?: string | null;
  /** `tn` — the note the payer's app shows against the payment. */
  note?: string;
}): string {
  const rupees = (input.amountInr / 100).toFixed(2);
  // `encodeURIComponent`, not `URLSearchParams` — `upi://` is a custom
  // scheme parsed by banking apps, not an HTML form submission, so a space
  // must be percent-encoded as `%20` (standard RFC 3986 URI encoding).
  // `URLSearchParams` encodes spaces as `+` (the `application/
  // x-www-form-urlencoded` convention), which some UPI apps' deep-link
  // parsers may not decode back to a space, garbling the payee name.
  const params = [
    `pa=${encodeURIComponent(input.vpa)}`,
    `pn=${encodeURIComponent(input.payeeName)}`,
    ...(input.merchantCode ? [`mc=${encodeURIComponent(input.merchantCode)}`] : []),
    `am=${encodeURIComponent(rupees)}`,
    `cu=${encodeURIComponent("INR")}`,
    ...(input.note ? [`tn=${encodeURIComponent(input.note)}`] : []),
  ].join("&");
  return `upi://pay?${params}`;
}
