"use client";

import { useState } from "react";

export function SignOutSection() {
  const [busy, setBusy] = useState<null | "one" | "all">(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut(scope: "one" | "all") {
    if (busy) return;
    setBusy(scope);
    setError(null);
    const url =
      scope === "all" ? "/api/auth/logout?all=1" : "/api/auth/logout";
    const res = await fetch(url, { method: "POST" });
    if (res.ok || res.status === 204) {
      // Full document navigation so any client caches (React state, RSC
      // cache) drop with the session.
      window.location.href = "/login";
      return;
    }
    setBusy(null);
    setError("Could not sign out. Try again.");
  }

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--color-rule)] pt-5">
      <h2 className="text-sm font-semibold">Sign out</h2>
      <p className="text-xs text-[var(--color-ink-2)]">
        Signing out ends this session. Signing out everywhere revokes every
        active session on every device.
      </p>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void signOut("one")}
          disabled={busy !== null}
          className="rounded bg-[var(--color-tile)] px-5 py-2.5 text-sm font-semibold text-ink ring-1 ring-[var(--color-rule)] transition hover:bg-[var(--color-tile-2,var(--color-tile))] disabled:cursor-not-allowed disabled:opacity-60 phone:py-3"
        >
          {busy === "one" ? "Signing out…" : "Log out"}
        </button>
        <button
          type="button"
          onClick={() => void signOut("all")}
          disabled={busy !== null}
          className="rounded bg-[color-mix(in_srgb,var(--color-down)_15%,transparent)] px-5 py-2.5 text-sm font-semibold text-[var(--color-down)] ring-1 ring-[color-mix(in_srgb,var(--color-down)_40%,transparent)] transition hover:bg-[color-mix(in_srgb,var(--color-down)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-60 phone:py-3"
        >
          {busy === "all" ? "Signing out everywhere…" : "Log out everywhere"}
        </button>
      </div>
    </section>
  );
}
