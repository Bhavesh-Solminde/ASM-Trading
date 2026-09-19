"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailInput } from "@/components/auth/EmailInput";
import { PasswordInput } from "@/components/auth/PasswordInput";

const MIN_PASSWORD_LEN = 12;

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    !busy && email.length > 0 && password.length >= MIN_PASSWORD_LEN && terms;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    // API uses strictObject — pass ONLY email and password, no ToS field.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      router.push("/trade");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Open your ASM account."
      subtitle="30 seconds. $10,000 in demo funds. No card required."
      imageCaption="Fixed risk. Real prices. From $1."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <EmailInput value={email} onChange={setEmail} autoFocus />
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
          $10,000 demo · switch to live any time
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
