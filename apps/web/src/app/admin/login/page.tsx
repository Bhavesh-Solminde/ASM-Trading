"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });

    if (res.ok) {
      router.push("/admin/messages");
      return;
    }
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin access</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          required
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Admin secret"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        {error ? <p className="text-sm text-[var(--color-down)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
