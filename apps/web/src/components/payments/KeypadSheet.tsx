"use client";

import { useEffect, useId, useRef } from "react";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { applyKey, groupAmount, type AmountOpts } from "./amount-input";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/**
 * Numeric keypad in a bottom sheet (phone). Edits `value` live; "Done" closes.
 * Focus moves to Done on open and back to the opener on close; Tab is trapped
 * inside, Escape and the backdrop dismiss.
 */
export function KeypadSheet({
  title,
  symbol,
  value,
  onChange,
  onClose,
  opts,
  error,
}: {
  title: string;
  symbol: string;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
  opts: AmountOpts;
  error?: string | null | undefined;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  useScrollLock();

  useEffect(() => {
    doneRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="sheet sheet-in w-full max-w-[34rem] overflow-y-auto overscroll-contain px-4 pb-3"
      >
        <div aria-hidden className="sheet-handle" />
        <p id={titleId} className="mt-3 text-center text-[13px] text-ink-2">
          {title}
        </p>
        <p className="mt-1 flex items-baseline justify-center gap-1.5 tabular-nums" aria-live="polite">
          <span className="text-2xl font-bold text-ink-3">{symbol}</span>
          <span className="text-5xl font-extrabold tracking-[-0.035em]">{groupAmount(value)}</span>
        </p>
        <p role="alert" className="mt-1 min-h-5 text-center text-xs text-down">
          {error ?? ""}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {KEYS.map((k) => {
            if (k === "." && !opts.decimals) return <span key={k} aria-hidden />;
            return (
              <button
                key={k}
                type="button"
                aria-label={k === "back" ? "Delete last digit" : k === "." ? "Decimal point" : undefined}
                onClick={() => onChange(applyKey(value, k, opts))}
                className="grid h-14 place-items-center rounded-2xl bg-tile text-2xl font-bold tabular-nums active:bg-tile-hi"
              >
                {k === "back" ? (
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12z" />
                    <path d="M13 9.5l4 5M17 9.5l-4 5" />
                  </svg>
                ) : (
                  k
                )}
              </button>
            );
          })}
        </div>
        <button
          ref={doneRef}
          type="button"
          onClick={onClose}
          className="mt-3 h-14 w-full rounded-2xl bg-brand-fill text-base font-bold text-white hover:bg-brand-fill-hi"
        >
          Done
        </button>
      </div>
    </div>
  );
}
