"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../_lib/icons";

/** Monospace value (optionally truncated) with an icon button that copies the FULL value. */
export function CopyText({ value, display, label }: { value: string; display?: string; label: string }) {
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <span className="mono" title={value}>
        {display ?? value}
      </span>
      <button
        type="button"
        onClick={copy}
        className="admin-icon-btn"
        aria-label={`Copy ${label}`}
        title={state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : `Copy ${label}`}
        style={{ width: 28, height: 28, color: state === "copied" ? "var(--admin-pos)" : undefined }}
      >
        <Icon name={state === "copied" ? "check" : "copy"} size={14} />
      </button>
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {state === "copied" ? `${label} copied` : state === "failed" ? `Couldn't copy ${label}` : ""}
      </span>
    </span>
  );
}
