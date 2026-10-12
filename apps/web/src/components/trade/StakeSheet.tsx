"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { currencySymbol, formatMinor } from "@/lib/format-money";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { grossReturnMinor } from "./pnl-display";
import { groupAmount, profitForStake, stakePresets, stakeToMinor } from "./stake";

const MAX_LEN = 7;

/** Delete-key glyph (the icon set has no backspace; a left chevron would read as "back"). */
function BackspaceGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6 text-ink-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" />
      <path d="M13 10l4 4M17 10l-4 4" />
    </svg>
  );
}
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"] as const;

/**
 * Phone stake keypad: a bottom sheet with a big amount, a hint line (balance or
 * minimum), the payout it would earn, quick chips and a 3x4 keypad. It never
 * raises the native keyboard. "Set" writes the amount to the ticket; Esc, the
 * close button and a backdrop tap leave the stake untouched.
 */
export function StakeSheet({
  currency,
  initial,
  balanceMinor,
  minStakeMinor,
  payoutPct,
  accountLabel,
  onSet,
  onClose,
}: {
  currency: string;
  /** The ticket's current stake text, e.g. "100". */
  initial: string;
  /** Spendable balance (real + bonus) of the active account; null while unknown. */
  balanceMinor: number | null;
  minStakeMinor: number;
  payoutPct: number | null;
  accountLabel: "Demo" | "Live";
  onSet: (stake: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(initial === "" ? "0" : initial);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const amountMinor = stakeToMinor(amount);
  const tooLow = amountMinor < minStakeMinor;
  const tooHigh = balanceMinor !== null && amountMinor > balanceMinor;
  const profit = profitForStake(amountMinor, payoutPct);
  const symbol = currencySymbol(currency);
  const maxMajor = balanceMinor === null ? 0 : Math.floor(balanceMinor / 100);
  const maxUsable = maxMajor >= minStakeMinor / 100;

  const press = useCallback((key: (typeof KEYS)[number]) => {
    setAmount((prev) => {
      if (key === "back") return prev.slice(0, -1) || "0";
      const cur = prev === "0" ? "" : prev;
      if ((cur + key).length > MAX_LEN) return prev;
      return (cur + key).replace(/^0+(?=\d)/, "") || "0";
    });
  }, []);

  function commit(): void {
    if (tooLow) return;
    // Normalise "0250" / trailing "." noise before it reaches the ticket field.
    onSet(String(Number(amount)));
  }

  // Focus the dialog on open (no input is focused, so no native keyboard) and
  // trap Tab inside it; the parent returns focus to the investment tile.
  useScrollLock();
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    // A hardware keyboard (tablets, desktop in a narrow window) types too.
    if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number]);
    else if (e.key === "Backspace") press("back");
  }

  const chipBase = "h-10 min-w-0 rounded-full text-[12px] font-bold tabular-nums transition-colors min-[360px]:text-[13px]";

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stake-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="sheet sheet-in absolute inset-x-0 bottom-0 mx-auto grid max-h-dvh w-full max-w-[560px] gap-3.5 overflow-y-auto overscroll-contain px-4 outline-none land:gap-2"
      >
        <div aria-hidden className="sheet-handle" />
        <div className="-mt-1 flex items-center justify-between">
          <h2 id="stake-title" className="text-base font-bold text-ink">
            Investment
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 grid size-11 place-items-center rounded-xl text-ink-2 hover:bg-tile hover:text-ink"
          >
            <Icon name="close" className="size-5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid justify-items-center gap-1 pt-1.5">
          <div className="flex items-baseline gap-1.5" aria-live="polite" aria-atomic="true">
            <span className="text-[26px] font-bold leading-none text-ink-3">{symbol}</span>
            <span className="text-[52px] font-extrabold leading-none tracking-[-0.03em] text-ink land:text-[36px]">
              {groupAmount(amount)}
            </span>
            <span aria-hidden className="h-10 w-0.5 self-center bg-brand" />
          </div>
          <p className={`text-[13px] ${tooLow || tooHigh ? "text-down" : "text-ink-2"}`}>
            {tooLow
              ? `Minimum investment is ${formatMinor(minStakeMinor, currency)}`
              : tooHigh
                ? "More than your available balance"
                : balanceMinor === null
                  ? " "
                  : `${accountLabel} balance ${formatMinor(balanceMinor, currency)}`}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-[14px] bg-tile px-3.5 py-3">
          <span className="text-[13px] text-ink-2">Payout if right · {payoutPct === null ? "—" : `${payoutPct}%`}</span>
          <span className="text-[17px] font-extrabold tabular-nums text-up">
            {profit === null ? "—" : formatMinor(grossReturnMinor(amountMinor, profit), currency)}
          </span>
        </div>

        <div className="grid grid-cols-6 gap-1.5">
          {stakePresets(currency).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={Number(amount) === value}
              onClick={() => setAmount(String(value))}
              className={`${chipBase} ${
                Number(amount) === value ? "bg-brand-fill text-white" : "bg-tile text-ink-2 hover:text-ink"
              }`}
            >
              {symbol}
              {value.toLocaleString("en-US")}
            </button>
          ))}
          <button
            type="button"
            disabled={!maxUsable}
            aria-pressed={maxUsable && Number(amount) === maxMajor}
            onClick={() => setAmount(String(maxMajor))}
            className={`${chipBase} disabled:opacity-40 ${
              maxUsable && Number(amount) === maxMajor ? "bg-brand-fill text-white" : "bg-tile text-ink-2 hover:text-ink"
            }`}
          >
            Max
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={key === "back" ? "Delete" : key}
              onClick={() => press(key)}
              className="grid h-[54px] place-items-center rounded-[14px] text-2xl font-semibold text-ink transition-colors hover:bg-tile active:bg-tile-hi land:h-9"
            >
              {key === "back" ? <BackspaceGlyph /> : key}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={tooLow}
          onClick={commit}
          className="h-[54px] rounded-2xl bg-brand-fill text-base font-bold text-white transition-colors hover:bg-brand-fill-hi disabled:opacity-40 land:h-11"
        >
          Set {symbol}
          {groupAmount(amount)}
        </button>
      </div>
    </div>
  );
}
