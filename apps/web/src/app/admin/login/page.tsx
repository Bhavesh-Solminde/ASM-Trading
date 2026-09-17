"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../_lib/icons";

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
      router.push("/admin");
      router.refresh();
      return;
    }
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <div className="admin-login">
      <aside className="admin-login__aside">
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 1 }}>
          <div className="admin-logo">A</div>
          <div>
            <div className="admin-brand-name" style={{ color: "#F6EFDF" }}>
              ASM Trading
            </div>
            <div className="admin-brand-sub" style={{ color: "#A99C82" }}>
              Operations Console
            </div>
          </div>
        </div>

        <div className="admin-login__pitch">
          <h1>The control room behind the exchange.</h1>
          <p>
            Approve settlements, manage listings, and monitor liquidity across every ASM market —
            in one operator console.
          </p>
        </div>

        <div className="admin-login__stats">
          <div className="admin-login__stat">
            <div className="k">Secured</div>
            <div className="l">Shared-secret gate</div>
          </div>
          <div className="admin-login__stat">
            <div className="k">Audited</div>
            <div className="l">Every action logged</div>
          </div>
          <div className="admin-login__stat">
            <div className="k">Live</div>
            <div className="l">Real-time data</div>
          </div>
        </div>
      </aside>

      <main className="admin-login__main">
        <form className="admin-login__card" onSubmit={onSubmit} noValidate>
          <h2>Sign in to the console</h2>
          <p className="sub">Operator access is restricted and fully audited.</p>

          {error ? (
            <div className="admin-form-error">
              <Icon name="ban" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="admin-field">
            <label htmlFor="admin-secret">Admin secret</label>
            <input
              id="admin-secret"
              className="admin-input"
              type="password"
              required
              autoFocus
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••••••"
            />
          </div>

          <button type="submit" className="admin-btn admin-btn--primary admin-btn--block" disabled={busy}>
            {busy ? "Checking…" : "Enter console"}
          </button>

          <div className="admin-demo-hint">
            Access is gated by a single shared secret (<code>ADMIN_PANEL_SECRET</code>), independent
            of any user account. Sessions last 24 hours.
          </div>
        </form>
      </main>
    </div>
  );
}
