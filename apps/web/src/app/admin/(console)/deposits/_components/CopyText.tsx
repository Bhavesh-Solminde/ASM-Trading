"use client";

import { useEffect, useRef, useState } from "react";

/** Truncated monospace value with a tiny "copy" button that copies the FULL value. */
export function CopyText({ value, display, label }: { value: string; display: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span title={value}>{display}</span>
      <button
        type="button"
        onClick={copy}
        className="admin-btn admin-btn--subtle"
        aria-label={`Copy full ${label}`}
        title={`Copy full ${label}`}
        style={{ padding: "1px 6px", fontSize: 10.5, fontWeight: 500, fontFamily: "inherit" }}
      >
        {state === "copied" ? "copied" : state === "failed" ? "failed" : "copy"}
      </button>
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {state === "copied" ? `${label} copied` : ""}
      </span>
    </span>
  );
}
