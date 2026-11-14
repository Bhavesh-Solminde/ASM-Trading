"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailInput } from "@/components/auth/EmailInput";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { GoogleButton, OrDivider } from "@/components/auth/GoogleButton";
import { trackPixelEvent } from "@/components/seo/MetaPixel";
import { PORTAL_PATHS, withPortal, type AuthPortal } from "@/components/auth/portal";

const MIN_PASSWORD_LEN = 12;
/** Server error codes shown on the invitation-code field rather than the form banner. */
const REFERRAL_ERRORS = new Set(["invalid_referral", "self_referral"]);

export function RegisterForm({
  googleEnabled,
  portal = "user",
}: {
  googleEnabled: boolean;
  portal?: AuthPortal;
}) {
  const paths = PORTAL_PATHS[portal];
  const affiliate = portal === "affiliate";
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const referralRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only flag a mismatch once the confirmation is at least as long as the
  // password — not on every keystroke while it's still being typed.
  const mismatch = confirm.length >= password.length && confirm.length > 0 && confirm !== password;
  const canSubmit =
    !busy &&
    name.trim().length >= 2 &&
    email.length > 0 &&
    password.length >= MIN_PASSWORD_LEN &&
    confirm === password &&
    terms;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setReferralError(null);

    // API uses strictObject — pass ONLY name, email and password (plus the
    // affiliate portal flag, or a typed invitation code): no ToS field, and the
    // confirmation is checked here, never sent. Without a typed code, referral
    // credit comes from the /invite link cookie.
    const code = affiliate ? "" : referralCode.trim();
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withPortal(portal, { name: name.trim(), email, password, ...(code ? { referralCode: code } : {}) }),
      ),
    });

    if (res.ok) {
      trackPixelEvent("CompleteRegistration");
      router.push(paths.home);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    setBusy(false);
    if (data.code && REFERRAL_ERRORS.has(data.code)) {
      setReferralError(data.error ?? "That invitation code isn't valid.");
      referralRef.current?.focus();
      return;
    }
    setError(data.error ?? "Something went wrong. Try again.");
  }

  return (
    <AuthShell
      eyebrow={affiliate ? "Affiliate program" : "Get started"}
      title={affiliate ? "Open your affiliate account." : "Open your IndianxTrade account."}
      subtitle={
        affiliate
          ? "A separate account from any regular one. You can use the same email. We'll send a link to verify it."
          : "30 seconds. $10,000 in demo funds. No card required."
      }
      imageCaption="Fixed risk. Real prices. From $1."
      footer={
        <>
          {affiliate ? "Already an affiliate?" : "Already have an account?"}{" "}
          <Link href={paths.login} className="font-semibold text-brand hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {googleEnabled && !affiliate ? (
          <>
            <GoogleButton label="Sign up with Google" />
            <OrDivider />
          </>
        ) : null}
        <div>
          <label htmlFor="full-name" className="text-[11px] font-semibold uppercase tracking-widest text-ink-2">
            Full name
          </label>
          <input
            id="full-name"
            type="text"
            required
            autoComplete="name"
            autoFocus={!googleEnabled || affiliate}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="mt-2 h-12 w-full rounded-lg border border-rule bg-panel/70 px-4 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:bg-panel"
          />
        </div>
        <EmailInput value={email} onChange={setEmail} />
        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          required
          minLength={MIN_PASSWORD_LEN}
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD_LEN} characters`}
          showStrength
        />
        <div>
          <PasswordInput
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            required
            autoComplete="new-password"
            placeholder="Type it again"
          />
          {mismatch ? (
            <p role="alert" className="mt-2 text-[11px] text-down">
              Passwords don&apos;t match.
            </p>
          ) : null}
        </div>

        {affiliate ? null : (
          <div>
            <label htmlFor="referral-code" className="text-[11px] font-semibold uppercase tracking-widest text-ink-2">
              Invitation code (optional)
            </label>
            <input
              ref={referralRef}
              id="referral-code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              value={referralCode}
              onChange={(e) => {
                setReferralCode(e.target.value);
                setReferralError(null);
              }}
              placeholder="If a friend gave you a code"
              aria-invalid={referralError ? true : undefined}
              aria-describedby={referralError ? "referral-code-error" : undefined}
              className={`mt-2 h-12 w-full rounded-lg border bg-panel/70 px-4 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:bg-panel ${referralError ? "border-down focus:border-down" : "border-rule focus:border-brand"}`}
            />
            {referralError ? (
              <p id="referral-code-error" role="alert" className="mt-2 text-[11px] text-down">
                {referralError}
              </p>
            ) : null}
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-brand)]"
          />
          <span>
            I agree to the{" "}
            <a href="#" className="font-semibold text-ink hover:text-brand">
              terms of service
            </a>{" "}
            and the{" "}
            <a href="#" className="font-semibold text-ink hover:text-brand">
              risk disclosure
            </a>
            .
          </span>
        </label>

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-sm text-down"
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-up text-sm font-black text-up-ink shadow-[0_20px_50px_-20px_color-mix(in_srgb,var(--color-up)_50%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
        >
          {busy ? (
            <>
              <Spinner /> Creating…
            </>
          ) : (
            <>
              Create account <span aria-hidden>→</span>
            </>
          )}
        </button>

        <div className="mt-2 flex items-center gap-3 text-[11px] uppercase tracking-widest text-ink-3">
          <span aria-hidden className="h-px flex-1 bg-rule" />
          {affiliate ? "Verify your email to activate" : "$10,000 demo · switch to live any time"}
          <span aria-hidden className="h-px flex-1 bg-rule" />
        </div>
      </form>
    </AuthShell>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
