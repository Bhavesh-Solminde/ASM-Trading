export interface ParsedSms {
  amountInr: number;
  utr: string | null;
  isCredit: boolean;
}

// Matches either a currency-prefixed amount (Rs./INR/₹, decimals optional) or
// a bare two-decimal number (e.g. "debited by 1.00" — common on SBI alerts
// that omit a currency prefix entirely). A bare integer is never treated as
// an amount, since that would also match account digits and reference
// numbers.
const AMOUNT_RE =
  /(?:(?:rs\.?|inr|₹)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?))|\b([0-9]+\.[0-9]{2})\b/gi;

const REF_LABEL_RE =
  /(?:ref(?:erence)?\s*(?:no\.?|number)?|utr|txn\s*id)\s*[:\-]?\s*([a-z0-9]{6,22})/i;
const BARE_REF_RE = /\b([0-9]{9,22})\b/;

const CREDIT_RE = /\b(credited|credit|received|deposited)\b/i;
const DEBIT_RE = /\b(debited|debit|spent|withdrawn|paid|purchase)\b/i;

/**
 * Bank SMS commonly list the transaction amount before a trailing "Avl Bal"
 * figure, so the first candidate wins — a real disambiguation choice, not
 * just "whatever the regex found."
 */
export function parseSms(body: string): ParsedSms | null {
  const amounts = [...body.matchAll(AMOUNT_RE)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => value != null);

  if (amounts.length === 0) return null;

  const amountInr = Math.round(Number(amounts[0].replace(/,/g, "")) * 100);

  const labeled = REF_LABEL_RE.exec(body);
  const bare = BARE_REF_RE.exec(body);
  const utr = labeled?.[1] ?? bare?.[1] ?? null;

  const isCredit = CREDIT_RE.test(body) && !DEBIT_RE.test(body);

  return { amountInr, utr, isCredit };
}
