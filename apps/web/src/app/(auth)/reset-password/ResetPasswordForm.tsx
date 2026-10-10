"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Spinner } from "@/components/auth/Spinner";

const PRIMARY =
  "mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-black text-brand-ink shadow-[0_20px_50px_-20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The token stays in React state; take it out of the address bar and history.
  useEffect(() => {
    if (token) window.history.replaceState(null, "", "/reset-password");
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (res.ok) {
      router.push("/login?reset=1");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  const footer = (
    <>
      Link not working?{" "}
      <Link href="/forgot-password" className="font-semibold text-brand hover:underline">
        Get a new one
      </Link>
    </>
  );

  if (!token) {
    return (
      <AuthShell
        eyebrow="Reset password"
        title="This link is incomplete."
        subtitle="Open the link from your email again, or request a new one."
        imageCaption="Every tick settles on a real ledger."
        footer={footer}
      >
        <Link href="/forgot-password" className={PRIMARY}>
          Request a new link <span aria-hidden>→</span>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Set a new password."
      subtitle="Choose a password you don't use anywhere else. You'll be signed out on every device."
      imageCaption="Every tick settles on a real ledger."
      footer={footer}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          required
          minLength={12}
          autoComplete="new-password"
          placeholder="At least 12 characters"
          showStrength
        />
        <PasswordInput
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          required
          minLength={12}
          autoComplete="new-password"
          placeholder="Type it again"
        />
        {error ? (
          <div role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-sm text-down">
            {error}
          </div>
        ) : null}
        <button type="submit" disabled={busy || !password || !confirm} className={PRIMARY}>
          {busy ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            <>
              Save new password <span aria-hidden>→</span>
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
