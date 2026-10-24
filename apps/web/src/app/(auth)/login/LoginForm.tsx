"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailInput } from "@/components/auth/EmailInput";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { GoogleButton, OrDivider } from "@/components/auth/GoogleButton";
import { trackLogin } from "@/components/seo/MetaPixel";
import { Spinner } from "@/components/auth/Spinner";

const GOOGLE_ERROR = "Google sign-in didn't go through. Try again, or log in with your email.";

export function LoginForm({
  googleEnabled,
  googleError,
  notice,
}: {
  googleEnabled: boolean;
  googleError: boolean;
  notice: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(googleError ? GOOGLE_ERROR : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      trackLogin("email");
      router.push("/trade");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to IndianxTrade."
      subtitle="The markets don't stop. Neither should you."
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="font-semibold text-brand hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {googleEnabled ? (
          <>
            <GoogleButton />
            <OrDivider />
          </>
        ) : null}
        <EmailInput value={email} onChange={setEmail} autoFocus={!googleEnabled} />
        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="current-password"
          placeholder="Your password"
          showForgot
        />

        {notice && !error ? (
          <div role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-sm text-up">
            {notice}
          </div>
        ) : null}

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
          disabled={busy || !email || !password}
          className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-black text-brand-ink shadow-[0_20px_50px_-20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
        >
          {busy ? (
            <>
              <Spinner /> Signing in…
            </>
          ) : (
            <>
              Log in <span aria-hidden>→</span>
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
