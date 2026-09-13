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
}): string {
  const rupees = (input.amountInr / 100).toFixed(2);
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.payeeName,
    am: rupees,
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}
