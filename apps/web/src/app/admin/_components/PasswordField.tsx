"use client";

import { useState } from "react";
import { Icon } from "../_lib/icons";

// No look-alike characters (0/O, 1/l/I), so a password read out on a call
// or typed from a screenshot comes out right.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generate(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

/** Plain-text password input with Generate and Copy, for sharing a sign-in with a streamer. */
export function PasswordField({ id, name, minLength = 8 }: { id: string; name: string; minLength?: number }) {
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the value is still visible to copy by hand */
    }
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        id={id}
        name={name}
        type="text"
        required
        minLength={minLength}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="new-password"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="admin-input mono"
        style={{ flex: 1, minWidth: 0, fontSize: 14 }}
      />
      <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setValue(generate())} style={{ height: "auto" }}>
        Generate
      </button>
      <button
        type="button"
        className="admin-btn admin-btn--ghost"
        onClick={copy}
        disabled={!value}
        aria-label={copied ? "Password copied" : "Copy password"}
        title={copied ? "Copied" : "Copy password"}
        style={{ height: "auto", color: copied ? "var(--admin-pos)" : undefined }}
      >
        <Icon name={copied ? "check" : "copy"} size={16} />
      </button>
    </div>
  );
}
