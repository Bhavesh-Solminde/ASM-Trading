"use client";

import { useState } from "react";

export function ClaimForm({ depositId }: { depositId: string }) {
  const [utr, setUtr] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);

    const res = await fetch(`/api/deposits/${depositId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utr }),
    });

    if (res.ok) {
      setState("done");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not submit that reference.");
    setState("idle");
  }

  if (state === "done") {
    return (
      <div className="rounded-lg bg-[#efe7fb] p-4 text-center">
        <p className="text-sm font-semibold text-[#4b2d86]">Reference received</p>
        <p className="mt-1 text-xs text-[#6b5a8a]">
          Your deposit is being confirmed. This can take up to 48 hours.
        </p>
        <a
          href="/trade"
          className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
        >
          Back to trading
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label
        htmlFor="utr"
        className="text-center text-xs font-bold uppercase tracking-wide text-[#5b2d9e]"
      >
        UTR / UPI Reference No.
      </label>
      <input
        id="utr"
        inputMode="numeric"
        required
        value={utr}
        onChange={(e) => setUtr(e.target.value)}
        placeholder="12-digit reference"
        className="rounded-lg border border-[#d8cdf0] bg-white px-4 py-2.5 text-center text-sm tabular-nums text-[#241436] outline-none focus:border-[#5b2d9e]"
      />
      {error ? <p className="text-center text-xs text-[#b8384c]">{error}</p> : null}
      <button
        type="submit"
        disabled={state === "busy"}
        className="rounded-lg bg-[#5b2d9e] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {state === "busy" ? "Submitting…" : "Confirm"}
      </button>
    </form>
  );
}
