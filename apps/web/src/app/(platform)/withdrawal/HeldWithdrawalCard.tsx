"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlatform } from "@/components/shell/PlatformProvider";

/**
 * Server-rendered card for a HELD withdrawal — shows the processing date, a
 * live-ticking cancel countdown, and a "Cancel withdrawal" button that calls
 * the cancel API. The countdown updates every second via a plain setInterval
 * so the card doesn't need any extra data fetching.
 *
 * Once `cancelableUntil` has passed, the button disappears and the card shows
 * the "can no longer be cancelled" line.
 */
export function HeldWithdrawalCard({
  id,
  amountLabel,
  holdUntilIso,
  cancelableUntilIso,
}: {
  id: string;
  amountLabel: string;
  holdUntilIso: string | null;
  cancelableUntilIso: string | null;
}) {
  const router = useRouter();
  const { applyBalanceUpdate } = usePlatform();
  const [now, setNow] = useState<number>(() => Date.now());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cancelableUntilMs = cancelableUntilIso ? new Date(cancelableUntilIso).getTime() : null;
  const canCancel = cancelableUntilMs !== null && cancelableUntilMs > now;
  const msLeft = cancelableUntilMs !== null ? Math.max(0, cancelableUntilMs - now) : 0;

  const holdLabel = holdUntilIso
    ? new Date(holdUntilIso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "soon";

  async function submit() {
    setError(null);
    setWorking(true);
    try {
      const res = await fetch(`/api/withdrawals/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        accountId?: string | null;
        balance?: { realBalance: number; bonusBalance: number } | null;
      };
      if (res.ok) {
        // Refund landed server-side; push the fresh balance into the
        // platform context so the TopBar bumps back up immediately.
        if (data.accountId && data.balance)
          applyBalanceUpdate(data.accountId, data.balance);
        setToast(`Withdrawal cancelled — ${amountLabel} returned to your balance.`);
        router.refresh();
        return;
      }
      setError(data.error ?? "Could not cancel that withdrawal.");
    } catch {
      setError("Could not cancel that withdrawal.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
      <h2 className="text-sm font-semibold">Withdrawal on hold</h2>
      <p className="mt-1 text-sm">
        Your withdrawal of {amountLabel} is pending. It will be processed on {holdLabel}.
      </p>

      {toast ? (
        <p className="mt-3 rounded border border-[var(--color-up)] bg-[var(--color-up)]/10 p-2 text-xs text-[var(--color-up)]">
          {toast}
        </p>
      ) : null}

      {canCancel ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={working}
            className="rounded bg-[var(--color-brand)] px-4 py-2.5 text-sm font-bold text-[var(--color-brand-ink)] disabled:opacity-60"
          >
            Cancel withdrawal
          </button>
          <span className="tabular-nums text-xs text-[var(--color-ink-2)]">
            Cancel window: {formatHms(msLeft)}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-ink-2)]">
          This withdrawal can no longer be cancelled.
        </p>
      )}

      {error ? <p className="mt-2 text-xs text-[var(--color-down)]">{error}</p> : null}
    </section>
  );
}

function formatHms(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
