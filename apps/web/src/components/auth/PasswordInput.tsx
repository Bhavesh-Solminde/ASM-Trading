"use client";

import { forwardRef, useId, useState, type KeyboardEvent } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  /** When true, renders a 5-step strength meter below the input. */
  showStrength?: boolean;
  /** When true, renders "Forgot password?" link on the label row. */
  showForgot?: boolean;
  label: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { value, onChange, placeholder, autoComplete = "current-password", required, minLength, showStrength, showForgot, label },
  ref,
) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function onKeyEvent(e: KeyboardEvent<HTMLInputElement>) {
    // getModifierState works on both keydown and keyup — track continuously.
    const on = e.getModifierState?.("CapsLock") ?? false;
    setCapsLock(on);
  }

  const strength = showStrength ? scorePassword(value) : null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-widest text-ink-2">
          {label}
        </label>
        {showForgot ? (
          <a href="#" className="text-[11px] font-semibold text-ink-3 hover:text-brand">
            Forgot password?
          </a>
        ) : null}
      </div>
      <div className="relative mt-2">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyEvent}
          onKeyUp={onKeyEvent}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="h-12 w-full rounded-lg border border-rule bg-panel/70 pl-4 pr-11 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:bg-panel"
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink-2 transition hover:bg-tile hover:text-ink"
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {capsLock ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand">
          <span aria-hidden>⇪</span> Caps Lock is on
        </p>
      ) : null}

      {strength && value.length > 0 ? <StrengthMeter score={strength.score} label={strength.label} /> : null}
    </div>
  );
});

function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a19.79 19.79 0 0 1 4.22-5.58" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a19.79 19.79 0 0 1-3.16 4.36" />
      <path d="M1 1l22 22" />
      <path d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
    </svg>
  );
}

const STRENGTH_LABELS = ["Weak", "Weak", "Fair", "Good", "Strong"] as const;
const STRENGTH_COLORS = [
  "var(--color-down)",
  "var(--color-down)",
  "var(--color-brand)",
  "var(--color-brand)",
  "var(--color-up)",
] as const;

function StrengthMeter({ score, label }: { score: number; label: string }) {
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{
              backgroundColor: i < score ? STRENGTH_COLORS[Math.max(0, score - 1)] : "var(--color-rule)",
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        <span className="font-semibold" style={{ color: STRENGTH_COLORS[Math.max(0, score - 1)] }}>
          {label}
        </span>
        <span className="mx-1.5 text-ink-3">·</span>
        <span>12+ chars with a mix of upper, lower, number and symbol scores strongest.</span>
      </p>
    </div>
  );
}

function scorePassword(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: STRENGTH_LABELS[0] };
  let s = 0;
  if (value.length >= 8) s++;
  if (value.length >= 12) s++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) s++;
  if (/\d/.test(value)) s++;
  if (/[^A-Za-z0-9]/.test(value)) s++;
  s = Math.min(5, s);
  const idx = Math.min(STRENGTH_LABELS.length - 1, Math.max(0, s - 1));
  return { score: s, label: STRENGTH_LABELS[idx]! };
}
