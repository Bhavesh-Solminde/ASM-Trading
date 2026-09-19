"use client";

import { forwardRef, useId } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
};

/** Matching-styled email input. Kept alongside PasswordInput so both fields
 *  share the same visual system (h-12, panel bg, brand focus). */
export const EmailInput = forwardRef<HTMLInputElement, Props>(function EmailInput(
  { value, onChange, autoFocus },
  ref,
) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-widest text-ink-2">
        Email
      </label>
      <input
        ref={ref}
        id={id}
        type="email"
        required
        autoComplete="email"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="you@example.com"
        className="mt-2 h-12 w-full rounded-lg border border-rule bg-panel/70 px-4 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:bg-panel"
      />
    </div>
  );
});
