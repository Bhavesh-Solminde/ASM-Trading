import { currencySymbol, formatMinor, groupAmountInput } from "@asm/client-core";

/** "999600" -> "9,99,600": the last three digits, then pairs (thousand, lakh, crore). Digits only, no sign. */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const pairs: string[] = [];
  while (rest.length > 2) {
    pairs.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest !== "") pairs.unshift(rest);
  return `${pairs.join(",")},${last3}`;
}

export interface MoneyOpts {
  /** Drop ".00" on a whole amount ("₹1,930"), as on the Up/Down buttons and quick amounts. */
  trim?: boolean;
}

/**
 * The app's money text. INR uses Indian grouping (₹9,99,600.00); other currencies keep @asm/client-core's
 * formatMinor ($1,234.56). A negative amount leads with "−". The website never imports this.
 */
export function money(minor: number, currency: string, opts: MoneyOpts = {}): string {
  if (!Number.isInteger(minor)) throw new Error(`money: expected an integer, received ${minor}`);
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = abs % 100 === 0;
  if (currency !== "INR") {
    const text = formatMinor(abs, currency);
    return sign + (opts.trim && whole ? text.replace(/\.00$/, "") : text);
  }
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const paise = String(abs % 100).padStart(2, "0");
  return `${sign}${currencySymbol(currency)}${opts.trim && whole ? rupees : `${rupees}.${paise}`}`;
}

/** The keypad's typed amount: Indian grouping for INR (whole rupees only), client-core grouping elsewhere. */
export function groupTyped(text: string, currency: string): string {
  if (currency !== "INR") return groupAmountInput(text);
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits === "" ? "0" : groupIndian(digits);
}
