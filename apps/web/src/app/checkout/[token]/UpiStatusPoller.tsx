"use client";

import { useEffect, useState } from "react";
import { ClaimForm } from "./ClaimForm";

interface StatusResponse {
  status?: string;
}

const POLL_MS = 3000;

/**
 * UPI equivalent of UsdtStatusPoller. Hides the manual-UTR form behind a
 * countdown so the overwhelming majority of users (where the SMS pipeline
 * matches in 2-10s) see the clean "Deposit credited" screen without ever
 * being asked to type a reference. The countdown is anchored on the
 * deposit's own createdAt — not when this page mounted — so a user who
 * closes and reopens the tab doesn't restart the clock, and a user who
 * opens the page after the window has already elapsed sees the manual form
 * immediately.
 *
 * On a terminal status (COMPLETED / REJECTED / EXPIRED) the page reloads so
 * the server component re-renders into DepositResult. The ClaimForm is kept
 * visible after the countdown even once polling continues — a user who's
 * already decided to type a UTR shouldn't have the form disappear underneath
 * them when the auto-match finally fires; the resolved-race branch inside
 * ClaimForm already handles that case with a friendly success state.
 */
export function UpiStatusPoller({
  token,
  depositId,
  createdAtMs,
  revealAfterSec,
}: {
  token: string;
  depositId: string;
  createdAtMs: number;
  revealAfterSec: number;
}) {
  const [failed, setFailed] = useState(false);
  // Null until mounted so SSR and the first client render agree. Once set,
  // ticks every second to drive the countdown and the reveal flip.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
        if (
          data.status === "COMPLETED" ||
          data.status === "REJECTED" ||
          data.status === "EXPIRED"
        ) {
          // The server component's resolvedStatus branch renders
          // DepositResult on this reload — the full "Deposit credited"
          // screen with the Back to trading button.
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

  // Countdown display and reveal flip. elapsedSec is >= 0; remainingSec >= 0.
  const elapsedSec = now === null ? 0 : Math.floor((now - createdAtMs) / 1000);
  const remainingSec = Math.max(0, revealAfterSec - elapsedSec);
  // Default to false during SSR so the manual form is never flashed to
  // first-paint. Once mounted, remainingSec drives it.
  const showManual = now !== null && remainingSec === 0;

  const mm = Math.floor(remainingSec / 60);
  const ss = String(remainingSec % 60).padStart(2, "0");
  const countdown = `${mm}:${ss}`;

  return (
    <>
      {showManual ? null : (
        <section
          className="rounded-xl bg-white p-5 text-center shadow-sm"
          role="status"
          aria-live="polite"
        >
          <p className="flex items-center justify-center gap-2 text-sm font-semibold text-[var(--ck-text,#241436)]">
            <span
              className="inline-block size-2 animate-pulse rounded-full bg-[var(--ck-primary,#5b2d9e)]"
              aria-hidden
            />
            Waiting for payment confirmation…
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--ck-muted,#6b5a8a)]">
            UPI credits usually arrive within a few seconds. This page updates
            automatically — no need to refresh.
          </p>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-muted,#8a7aa8)]">
            Manual entry available in{" "}
            <span className="tabular-nums text-[var(--ck-primary,#5b2d9e)]">{countdown}</span>
          </p>
          {failed ? (
            <p className="mt-2 text-[11px] text-[#b8384c]">
              Couldn&rsquo;t reach the status check just now — retrying.
            </p>
          ) : null}
        </section>
      )}

      {showManual ? (
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-3 text-center">
            <span className="inline-block rounded-full bg-[var(--ck-primary,#5b2d9e)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-primary-ink,#ffffff)]">
              Step 2
            </span>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--ck-muted,#6b5a8a)]">
              Haven&rsquo;t been auto-detected? Enter your UTR below — our team
              will confirm it shortly.
            </p>
          </div>
          <ClaimForm depositId={depositId} />
        </section>
      ) : null}
    </>
  );
}
