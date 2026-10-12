"use client";

import { useId, useState } from "react";

const FIELD =
  "mt-1 w-full rounded border border-rule bg-tile px-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand";

export function TicketForm() {
  const uid = useId();
  const subjectId = `${uid}-subject`;
  const bodyId = `${uid}-body`;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setDone(false);
    setBusy(true);

    try {
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
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label htmlFor={subjectId} className="legend">
          Subject
        </label>
        <input
          id={subjectId}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What do you need help with?"
          required
          className={`${FIELD} h-10`}
        />
      </div>
      <div>
        <label htmlFor={bodyId} className="legend">
          Message
        </label>
        <textarea
          id={bodyId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe the problem"
          required
          rows={5}
          className={`${FIELD} py-2`}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-down">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="rounded border border-up/30 bg-up/10 px-3 py-2 text-xs text-up">
          Ticket submitted. There is no support team in this build.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded bg-brand-fill px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-60 phone:self-stretch phone:py-3"
      >
        {busy ? "Sending…" : "Create request"}
      </button>
    </form>
  );
}
