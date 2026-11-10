export type BrandKey = "PhonePe" | "Gpay" | "PayTM" | "UPI" | "USDT";

/**
 * Which brand logo a payment method label gets, or `null` (a bank transfer has none). Reads the first word, so
 * "USDT (TRC-20)" is USDT and an old "UPI Intent" label is still UPI. The "any" UPI app uses the UPI logo.
 */
export function brandKey(label: string): BrandKey | null {
  const word = (label.trim().split(/[\s(]/)[0] ?? "").toLowerCase();
  switch (word) {
    case "phonepe":
      return "PhonePe";
    case "gpay":
      return "Gpay";
    case "paytm":
      return "PayTM";
    case "upi":
    case "any":
      return "UPI";
    case "usdt":
      return "USDT";
    default:
      return null;
  }
}
