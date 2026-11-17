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
import { PORTAL_PATHS, withPortal, type AuthPortal } from "@/components/auth/portal";

const GOOGLE_ERROR = "Google sign-in didn't go through. Try again, or log in with your email.";

export function LoginForm({
  googleEnabled,
  googleError,
  notice,
  portal = "user",
}: {
  googleEnabled: boolean;
  googleError: boolean;
  notice: string | null;
  portal?: AuthPortal;
}) {
  const paths = PORTAL_PATHS[portal];
  const affiliate = portal === "affiliate";
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
      body: JSON.stringify(withPortal(portal, { email, password })),
    });

    if (res.ok) {
      trackLogin("email");
      router.push(paths.home);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <AuthShell
      eyebrow={affiliate ? "Affiliate partners" : "Welcome back"}
      title={affiliate ? "Log in to your affiliate account." : "Log in to IndianxTrade."}
      subtitle={
        affiliate
          ? "Your affiliate account is separate from any regular trading account, with its own password."
          : "The markets don't stop. Neither should you."
      }
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>
          {affiliate ? "New affiliate?" : "New here?"}{" "}
          <Link href={paths.register} className="font-semibold text-brand hover:underline">
            {affiliate ? "Create an affiliate account" : "Create an account"}
          </Link>
          <span className="mt-3 block text-xs text-ink-3">
            {affiliate ? "Trading with a regular account? " : "Affiliate partner? "}
            <Link
              href={affiliate ? PORTAL_PATHS.user.login : PORTAL_PATHS.affiliate.login}
              className="font-semibold text-ink-2 hover:text-brand hover:underline"
            >
              Log in here
            </Link>
          </span>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {googleEnabled && !affiliate ? (
          <>
            <GoogleButton />
            <OrDivider />
          </>
        ) : null}
        <EmailInput value={email} onChange={setEmail} autoFocus={!googleEnabled || affiliate} />
        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="current-password"
          placeholder="Your password"
          showForgot
          forgotHref={paths.forgot}
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
