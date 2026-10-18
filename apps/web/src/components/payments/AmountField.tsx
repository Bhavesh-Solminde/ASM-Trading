"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { KeypadSheet } from "./KeypadSheet";
import { groupAmountInput, sanitizeAmount, type AmountOpts } from "@asm/client-core";

export interface AmountFieldHandle {
  /** Focuses whichever control is on screen (the field on desktop, the display button on a phone). */
  focus: () => void;
}

/**
 * The big centred amount of a money flow. Desktop: a large numeric field.
 * Phone: the figure is a button that opens a keypad sheet, so the soft
 * keyboard never covers the page. Both render; CSS shows the right one.
 */
export function AmountField({
  id,
  label,
  symbol,
  value,
  onChange,
  decimals,
  error,
  errorId,
  hint,
  handle,
}: {
  id: string;
  label: string;
  symbol: string;
  value: string;
  onChange: (next: string) => void;
  decimals: boolean;
  error?: string | null;
  /** id the error element carries, for aria-describedby. */
  errorId: string;
  hint?: string;
  handle?: Ref<AmountFieldHandle>;
}) {
  const opts: AmountOpts = { decimals };
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useImperativeHandle(handle, () => ({
    focus() {
      // The hidden twin has no layout box, so offsetParent is null.
      const visible = inputRef.current && inputRef.current.offsetParent !== null ? inputRef.current : triggerRef.current;
      visible?.focus();
      visible?.scrollIntoView({ block: "center" });
    },
  }));

  function close() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const describedBy = error ? errorId : hint ? `${id}-hint` : undefined;
  const invalid = error ? true : undefined;

  return (
    <div className="grid justify-items-center gap-1.5 text-center">
      <label htmlFor={id} className="text-[13px] text-ink-2">
        {label}
      </label>

      {/* Desktop */}
      <div className="flex items-baseline justify-center gap-1.5 phone:hidden">
        <span aria-hidden className="text-3xl font-bold text-ink-3">
          {symbol}
        </span>
        <input
          ref={inputRef}
          id={id}
          inputMode={decimals ? "decimal" : "numeric"}
          autoComplete="off"
          placeholder="0"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          // Shown grouped ("1,000") like the chips; sanitizeAmount strips the commas back out.
          value={value === "" ? "" : groupAmountInput(value)}
          onChange={(e) => onChange(sanitizeAmount(e.target.value, opts))}
          style={{ width: `${Math.max(value === "" ? 1 : groupAmountInput(value).length, 1) + 0.3}ch` }}
          className="min-w-[1ch] max-w-full bg-transparent text-center text-6xl font-extrabold tabular-nums tracking-[-0.035em] outline-none placeholder:text-ink-3"
        />
      </div>

      {/* Phone */}
      <button
        ref={triggerRef}
        type="button"
        id={`${id}-trigger`}
        aria-haspopup="dialog"
        aria-label={`${label} ${symbol}${groupAmountInput(value)}. Edit amount`}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
        className="hidden items-baseline justify-center gap-1.5 rounded-2xl px-3 py-1 phone:flex"
      >
        <span aria-hidden className="text-[28px] font-bold text-ink-3">
          {symbol}
        </span>
        <span aria-hidden className="text-6xl font-extrabold leading-none tabular-nums tracking-[-0.035em]">
          {groupAmountInput(value)}
        </span>
      </button>

      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-down">
          {error}
        </p>
      ) : null}

      {open ? (
        <KeypadSheet title={label} symbol={symbol} value={value} onChange={onChange} onClose={close} opts={opts} error={error} />
      ) : null}
    </div>
  );
}
