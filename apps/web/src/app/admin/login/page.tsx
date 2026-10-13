"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../_lib/icons";

export default function AdminLoginPage() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
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
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <div className="admin-login">
      <main className="admin-login__card">
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div className="admin-login__brand">
            <img src="/brand/indianxtrade-wordmark.png" alt="IndianxTrade" />
            <span className="admin-tagline">Admin</span>
          </div>
          <div>
            <h1>Sign in to the console</h1>
            <p className="sub">Use the operator secret. Every action is logged.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="admin-secret" className="admin-label">
              Operator secret
            </label>
            <div className="admin-secret">
              <input
                id="admin-secret"
                type={show ? "text" : "password"}
                required
                autoFocus
                autoComplete="current-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "admin-login-error" : undefined}
              />
              <button
                type="button"
                className="admin-icon-btn"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide secret" : "Show secret"}
                aria-pressed={show}
              >
                <Icon name={show ? "eyeOff" : "eye"} />
              </button>
            </div>
          </div>

          {error ? (
            <div className="admin-form-error" id="admin-login-error" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            className="admin-btn admin-btn--primary admin-btn--block admin-btn--lg"
            disabled={busy || secret.length === 0}
          >
            {busy ? "Checking…" : "Sign in"}
            {busy ? null : <Icon name="arrowRight" size={18} />}
          </button>
        </form>

        <p className="admin-login__foot" style={{ margin: 0 }}>
          Sessions last 24 hours. Lost the secret? Ask the platform owner to rotate it.
        </p>
      </main>
    </div>
  );
}
