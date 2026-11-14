"use client";

import { useState } from "react";
import { Spinner } from "@/components/auth/Spinner";

export function ResendVerificationButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/auth/verify-email/resend", { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { message?: string; error?: string } | undefined;
    setResult(
      res?.ok
        ? { ok: true, text: data?.message ?? "Verification email sent. Check your inbox and spam folder." }
        : { ok: false, text: data?.error ?? "Couldn't send the email. Try again in a moment." },
    );
    setBusy(false);
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={() => void resend()}
        disabled={busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-rule px-5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <Spinner /> Sending…
          </>
        ) : (
          "Resend verification email"
        )}
      </button>
      <p
        role={result?.ok === false ? "alert" : "status"}
        className={`text-sm ${result?.ok ? "text-up" : "text-down"}`}
      >
        {result?.text}
      </p>
    </div>
  );
}
