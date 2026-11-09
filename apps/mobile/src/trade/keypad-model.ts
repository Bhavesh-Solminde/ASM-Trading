import { currencySymbol, grossReturnMinor, profitForStake, stakeToMinor } from "@asm/client-core";
import { amountInWords, type WordsLocale } from "@/money/words";
import { stakeAmountOpts, stakeDisplay } from "./stake-input";

export interface KeypadModel {
  /** "₹ 2,500": the figure on the cheque. */
  figure: string;
  /** Amount in words (INR only); "" when nothing should be spelled. */
  words: string;
  /** What a win pays back (stake + profit) in minor units, or null when unknown or the stake is not usable. */
  winMinor: number | null;
}

/**
 * What the amount sheet shows for a stored stake. A stake this app typed is digits (and one point on decimal
 * currencies) within the safe-integer range. Anything else (a corrupt "1e308" or "1e22") is shown as stored,
 * with the symbol, like the dock's stake tile: regrouping it would strip the "e" and show a wrong number.
 */
export function keypadModel(value: string, currency: string, payoutPct: number | null, locale: WordsLocale): KeypadModel {
  const symbol = currencySymbol(currency);
  const minor = stakeToMinor(value);
  const typed = stakeAmountOpts(currency).decimals ? /^\d*\.?\d*$/ : /^\d*$/;
  const usable = typed.test(value) && Number.isSafeInteger(minor);
  if (!usable) return { figure: `${symbol} ${value.trim()}`, words: "", winMinor: null };

  const profit = profitForStake(minor, payoutPct);
  return {
    figure: `${symbol} ${stakeDisplay(value, currency)}`,
    // amountInWords takes RUPEES; `minor` is paise.
    words: currency === "INR" ? amountInWords(Math.floor(minor / 100), locale) : "",
    winMinor: profit === null ? null : grossReturnMinor(minor, profit),
  };
}
