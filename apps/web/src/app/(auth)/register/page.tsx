"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      router.push("/trade");
      return;
    }
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <input
          type="password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password — at least 12 characters"
          className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        {error ? <p className="text-sm text-[var(--color-down)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-[var(--color-up)] px-4 py-2.5 text-sm font-semibold text-[var(--color-up-ink)] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
