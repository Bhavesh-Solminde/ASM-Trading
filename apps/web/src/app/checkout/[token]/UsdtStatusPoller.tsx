"use client";

import { useEffect, useRef, useState } from "react";

interface StatusResponse {
  status?: string;
  chainCredit?: { finalityState: string; processingStatus: string } | null;
}

const POLL_MS = 4000;

/**
 * Client-side polling only — no server push exists for this. A blockchain
 * transfer genuinely takes time to confirm (unlike the instant SMS-fed UPI
 * credit), so the checkout page needs to show that progress live rather than
 * the one-shot render the UPI flow gets away with.
 */
export function UsdtStatusPoller({ token, expiresAtMs }: { token: string; expiresAtMs: number }) {
  const [state, setState] = useState<StatusResponse>({});
  const [failed, setFailed] = useState(false);
  const [polled, setPolled] = useState(false);
  // null until mounted, so the server-rendered HTML and first client render agree.
  const [now, setNow] = useState<number | null>(null);
  const expiryHandled = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const detected = Boolean(state.chainCredit);
  const remainingMs = now === null ? null : Math.max(0, expiresAtMs - now);

  // Window over with nothing detected -> back to the method picker. A payment
  // already detected is never abandoned: the countdown just stops mattering.
  useEffect(() => {
    if (remainingMs !== 0 || detected || !polled || expiryHandled.current) return;
    expiryHandled.current = true;
    void (async () => {
      // One last check, so a transfer seen in the final seconds isn't walked away from.
      try {
        const res = await fetch(`/api/deposits/${token}/status`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as StatusResponse;
          if (data.chainCredit) {
            setState(data);
            return;
          }
        }
      } catch {
        // Fall through to the redirect — a transfer sent in time is still
        // credited by its on-chain timestamp even if this page has moved on.
      }
      window.location.href = `/deposit?expired=${encodeURIComponent(token)}`;
    })();
  }, [remainingMs, detected, polled, token]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/deposits/${token}/status`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setFailed(false);
        setState(data);
        setPolled(true);

        if (data.status === "COMPLETED" || data.status === "REJECTED" || data.status === "EXPIRED") {
          // Reload so the server component re-renders into its "resolved" branch.
          window.location.reload();
          return;
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const step = (() => {
    const credit = state.chainCredit;
    if (!credit) return { label: "Waiting for your transfer", index: 0 };
    if (credit.finalityState === "FAILED_ON_CHAIN" || credit.finalityState === "REORGED") {
      return { label: "Transfer failed on-chain — it will not be credited", index: 1 };
    }
    if (credit.processingStatus === "DISMISSED") {
      return { label: "Payment reviewed — please contact support", index: 2 };
    }
    if (credit.processingStatus === "MANUAL_REVIEW" || credit.processingStatus === "UNMATCHED") {
      return { label: "Payment received — under review by our team", index: 2 };
    }
    if (credit.finalityState === "FINAL") return { label: "Confirmed on-chain — crediting your account", index: 2 };
    return { label: "Payment detected — confirming on-chain", index: 1 };
  })();

  const urgent = remainingMs !== null && remainingMs < 60_000;
  const countdown =
    remainingMs === null
      ? "–:––"
      : `${Math.floor(remainingMs / 60_000)}:${String(Math.floor((remainingMs % 60_000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      {detected ? null : (
        <div
          className={`mb-4 flex items-center justify-between rounded-lg px-4 py-3 ${urgent ? "bg-[#fdecef]" : "bg-[var(--ck-soft-bg,#f6f1ff)]"}`}
          role="timer"
          aria-live="off"
        >
          <span className={`text-xs font-semibold ${urgent ? "text-[#b8384c]" : "text-[var(--ck-primary,#5b2d9e)]"}`}>
            {remainingMs === 0 ? "Time's up — returning to deposit options…" : "Send your payment within"}
          </span>
          <span className={`text-2xl font-bold tabular-nums ${urgent ? "text-[#b8384c]" : "text-[var(--ck-text,#241436)]"}`}>
            {countdown}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--ck-muted,#8a7aa8)]">
        {["Detected", "Confirmed", "Credited"].map((label, i) => (
          <span key={label} className={i < step.index ? "text-[var(--ck-primary,#5b2d9e)]" : undefined}>
            {label}
          </span>
        ))}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--ck-soft-bg,#efe7fb)]">
        <div
          className="h-full rounded-full bg-[var(--ck-primary,#5b2d9e)] transition-all duration-500"
          style={{ width: `${(step.index / 3) * 100}%` }}
        />
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[var(--ck-text,#241436)]">
        <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--ck-primary,#5b2d9e)]" aria-hidden />
        {step.label}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--ck-muted,#8a7aa8)]">
        This page updates automatically — no need to refresh. On-chain
        confirmation can take a few minutes depending on network conditions.
      </p>
      {failed ? (
        <p className="mt-2 text-[11px] text-[#b8384c]">
          Couldn&rsquo;t reach the status check just now — retrying.
        </p>
      ) : null}
    </div>
  );
}
