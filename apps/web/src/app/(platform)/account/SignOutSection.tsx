"use client";

import { useState } from "react";
import { ButtonRow, ListGroup } from "@/components/account/SettingsList";

/**
 * Sign-out rows for the Account hub. "Log out" ends this session; "Log out
 * everywhere" revokes every session on every device. Same endpoints and
 * full-page redirect as before, only the presentation is list rows.
 */
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
    <div className="grid gap-2">
      <ListGroup>
        <ButtonRow
          icon="logout"
          tone="danger"
          label={busy === "one" ? "Signing out…" : "Log out"}
          disabled={busy !== null}
          onClick={() => void signOut("one")}
        />
        <ButtonRow
          icon="logout"
          label={busy === "all" ? "Signing out everywhere…" : "Log out everywhere"}
          disabled={busy !== null}
          onClick={() => void signOut("all")}
        />
      </ListGroup>
      <p className="px-1 text-xs leading-relaxed text-ink-3">
        Logging out everywhere revokes every active session on every device.
      </p>
      {error ? (
        <p role="alert" className="px-1 text-xs text-down">
          {error}
        </p>
      ) : null}
    </div>
  );
}
