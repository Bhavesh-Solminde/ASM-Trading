"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailInput } from "@/components/auth/EmailInput";
import { Spinner } from "@/components/auth/Spinner";

const PRIMARY =
  "mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-black text-brand-ink shadow-[0_20px_50px_-20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (res.ok) setSent(data.message ?? "If that email has an account, we've sent a reset link.");
    else setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <AuthShell
      eyebrow="Forgot password"
      title="Reset your password."
      subtitle="Enter the email you signed up with and we'll send you a link to set a new password."
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <div role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-sm text-up">
            {sent}
          </div>
          <p className="text-sm text-ink-2">
            The link works for 30 minutes. Not in your inbox? Check your spam folder, or send it again.
          </p>
          <button
            type="button"
            onClick={() => setSent(null)}
            className="inline-flex h-11 items-center justify-center rounded-full border border-rule text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
          >
            Send it again
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <EmailInput value={email} onChange={setEmail} autoFocus />
          {error ? (
            <div role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-sm text-down">
              {error}
            </div>
          ) : null}
          <button type="submit" disabled={busy || !email} className={PRIMARY}>
            {busy ? (
              <>
                <Spinner /> Sending…
              </>
            ) : (
              <>
                Send reset link <span aria-hidden>→</span>
              </>
            )}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
