"use client";

import { useState } from "react";

export function TicketForm() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });

    if (res.ok) {
      setDone(true);
      setSubject("");
      setBody("");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not submit that ticket.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        required
        className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Describe the problem"
        required
        rows={5}
        className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
      />
      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}
      {done ? (
        <p className="text-xs text-[var(--color-up)]">
          Ticket submitted. There is no support team in this build.
        </p>
      ) : null}
      <button
        type="submit"
        className="self-start rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Create request
      </button>
    </form>
  );
}
