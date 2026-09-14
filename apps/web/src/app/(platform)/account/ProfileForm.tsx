"use client";

import { useState } from "react";

type Profile = {
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  aadhaar: string | null;
  address: string | null;
  country: string | null;
  kycStatus: string;
  twoFaForLogin: boolean;
  twoFaForWithdrawal: boolean;
};

const FIELDS = [
  { key: "nickname", label: "Nickname", type: "text" },
  { key: "firstName", label: "First name", type: "text" },
  { key: "lastName", label: "Last name", type: "text" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "aadhaar", label: "Aadhaar", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "country", label: "Country", type: "text" },
] as const;

export function ProfileForm({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setMessage(null);
    setError(null);

    const body: Record<string, string> = {};
    for (const field of FIELDS) {
      const value = profile[field.key];
      if (value) body[field.key] = value;
    }

    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setMessage("Saved");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not save.");
  }

  async function toggleTwoFa(key: "twoFaForLogin" | "twoFaForWithdrawal") {
    const next = { ...profile, [key]: !profile[key] };
    setProfile(next);
    await fetch("/api/account/two-factor", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        forLogin: next.twoFaForLogin,
        forWithdrawal: next.twoFaForWithdrawal,
      }),
    });
  }

  async function sendTestCode() {
    await fetch("/api/account/two-factor?purpose=login", { method: "POST" });
    setMessage("Code written to the server log");
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Personal data</h2>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: profile.kycStatus === "VERIFIED" ? "#14301f" : "#2a2213",
              color: profile.kycStatus === "VERIFIED" ? "#4fc08d" : "#e0ac50",
            }}
          >
            {profile.kycStatus === "VERIFIED" ? "Verified" : "Not verified"}
          </span>
        </div>

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
            Email
          </label>
          <p className="mt-1 flex items-center gap-2 text-sm">
            {profile.email}
            {!profile.emailVerified ? (
              <span className="text-[10px] font-semibold text-[#e0ac50]">Unverified</span>
            ) : null}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={field.key}
                className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
              >
                {field.label}
              </label>
              <input
                id={field.key}
                type={field.type}
                value={profile[field.key] ?? ""}
                onChange={(e) => setProfile({ ...profile, [field.key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          ))}
        </div>

        {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}
        {message ? <p className="text-xs text-[var(--color-up)]">{message}</p> : null}

        <button
          type="button"
          onClick={() => void save()}
          className="self-start rounded-lg bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Save
        </button>

        <p className="text-xs text-[var(--color-ink-2)]">
          Identity fields are stored but never verified in this build — there is no identity check
          and no document upload.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-[var(--color-edge)] pt-5">
        <h2 className="text-sm font-semibold">Security</h2>

        {(
          [
            ["twoFaForLogin", "To enter the platform"],
            ["twoFaForWithdrawal", "To withdraw funds"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={profile[key]}
              onChange={() => void toggleTwoFa(key)}
              className="h-4 w-4 accent-[var(--color-brand)]"
            />
            {label}
          </label>
        ))}

        <button
          type="button"
          onClick={() => void sendTestCode()}
          className="self-start text-xs font-semibold text-[var(--color-brand)] underline underline-offset-4"
        >
          Send a test code
        </button>
        <p className="text-xs text-[var(--color-ink-2)]">
          Codes are written to the server log rather than emailed — no provider is configured.
        </p>
      </section>
    </div>
  );
}
