export interface ParsedBankSms {
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

// PhonePe references are alphanumeric with a leading letter (e.g.
// "T2610070152259856476787", 23 chars). Their SMS and notification both
// include this ref without any "ref/utr/txn" label — the SMS has "...for
// T26..." and the notification "...for txn T26...". The old digit-only bare
// fallback missed them entirely, so credits arrived with null UTR and the
// matcher fell back to amount-only, which silently misassigns payments
// between two users at the same stake. The letter-prefix form in BARE_REF_RE
// is deliberately narrow: a letter followed by ≥11 digits (so ≥12 chars
// total). That matches PhonePe-shaped refs but not account suffixes like
// "A/c XX1234" or "X8126", not words, not promotional codes.
const REF_LABEL_RE =
  /(?:ref(?:erence)?\s*(?:no\.?|number)?|utr|txn(?:\s*id)?)\s*[:-]?\s*([a-z0-9]{6,32})/i;
const BARE_REF_RE = /\b([0-9]{9,32}|[A-Z][0-9]{11,31})\b/;

const CREDIT_RE = /\b(credited|credit|received|deposited)\b/i;
const DEBIT_RE = /\b(debited|debit|spent|withdrawn|paid|purchase)\b/i;

/**
 * Bank SMS commonly list the transaction amount before a trailing "Avl Bal"
 * figure, so the first candidate wins — a real disambiguation choice, not
 * just "whatever the regex found."
 */
export function parseBankSms(body: string): ParsedBankSms | null {
  const amounts = [...body.matchAll(AMOUNT_RE)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => value != null);

  const [firstAmount] = amounts;
  if (firstAmount === undefined) return null;

  const amountInr = Math.round(Number(firstAmount.replace(/,/g, "")) * 100);

  const labeled = REF_LABEL_RE.exec(body);
  const bare = BARE_REF_RE.exec(body);
  const utr = labeled?.[1] ?? bare?.[1] ?? null;

  const isCredit = CREDIT_RE.test(body) && !DEBIT_RE.test(body);

  return { amountInr, utr, isCredit };
}
