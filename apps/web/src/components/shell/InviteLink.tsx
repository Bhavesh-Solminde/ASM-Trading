"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/** Copies `value` to the clipboard and says so, for sighted and screen-reader users alike. */
export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // Clipboard blocked (permissions, insecure context): the value stays visible to copy by hand.
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex flex-none items-center justify-center gap-2 rounded-lg bg-brand-fill px-5 py-2.5 text-xs font-semibold text-white transition-transform hover:bg-brand-fill-hi active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 phone:h-11 phone:py-0"
    >
      {state === "copied" ? (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span aria-live="polite">{state === "copied" ? "Copied!" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}

/** A personal invitation link with its code, as shown to regular users and affiliates. */
export function InviteLink({ code, url }: { code: string; url: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-rule bg-ground/80 px-3.5 py-2.5 text-xs phone:min-h-11">
          <span className="truncate font-mono text-ink-2 select-all">{url}</span>
        </div>
        <CopyButton value={url} />
      </div>
      <p className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>Invitation code:</span>
        <span className="font-mono font-bold tracking-wider text-ink-2 select-all">{code}</span>
      </p>
    </div>
  );
}
