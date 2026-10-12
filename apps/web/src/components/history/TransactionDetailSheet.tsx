"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatMinor } from "@/lib/format-money";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { Icon } from "@/components/shell/Icon";
import { usePlatform } from "@/components/shell/PlatformProvider";
import {
  TONE_PILL,
  durationLabel,
  paymentAmountText,
  paymentMovedNoMoney,
  paymentTitle,
  shortDate,
  statusLabel,
  statusTone,
  timeOfDay,
  tradeAmount,
  tradeTitle,
  type HistoryItem,
  type PaymentRow,
  type Tone,
} from "./history-model";
import { referenceFor } from "./payment-rows";
import { StatusTimeline } from "./StatusTimeline";

const AMOUNT_TONE: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  caution: "text-caution",
  neutral: "text-ink",
};

function when(d: Date, now: Date): string {
  return `${shortDate(d, now)} · ${timeOfDay(d)}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function ReferenceRow({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions): the reference stays selectable on screen.
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-tile px-4 py-3">
      <span className="grid min-w-0 gap-0.5">
        <span className="text-xs text-ink-2">Reference</span>
        <span className="select-all text-sm font-bold tracking-[0.04em]">{reference}</span>
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-xl bg-tile-hi px-4 text-[13px] font-bold text-brand hover:brightness-110"
      >
        <Icon name={copied ? "check" : "copy"} className="size-4" />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}

/**
 * Cancels a HELD withdrawal through the same endpoint the Withdrawal page's
 * held-withdrawal card uses (POST /api/withdrawals/:id/cancel), then refreshes
 * the server data so the row flips to Cancelled and the balance is restored.
 */
function CancelWithdrawal({ row }: { row: PaymentRow }) {
  const router = useRouter();
  const { applyBalanceUpdate } = usePlatform();
  const [now, setNow] = useState(() => Date.now());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const until = row.cancelableUntil ? new Date(row.cancelableUntil).getTime() : null;
  const canCancel = until !== null && until > now;

  async function cancel() {
    setError(null);
    setWorking(true);
    try {
      const res = await fetch(`/api/withdrawals/${encodeURIComponent(row.id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        accountId?: string | null;
        balance?: { realBalance: number; bonusBalance: number } | null;
      };
      if (res.ok) {
        if (data.accountId && data.balance) applyBalanceUpdate(data.accountId, data.balance);
        setDone(true);
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

  if (done) {
    return (
      <p role="status" className="rounded-2xl bg-up/10 px-4 py-3 text-center text-sm font-semibold text-up">
        Cancelled. {formatMinor(row.amountMinor, row.currency)} is back in your balance.
      </p>
    );
  }
  if (!canCancel) return null;

  return (
    <div className="grid gap-2.5">
      <button
        type="button"
        onClick={() => void cancel()}
        disabled={working}
        className="h-12 rounded-2xl bg-tile text-[15px] font-semibold text-ink hover:bg-tile-hi disabled:cursor-not-allowed disabled:opacity-60"
      >
        {working ? "Cancelling…" : "Cancel request"}
      </button>
      <p className="text-center text-xs text-ink-3">
        Cancelling returns the full amount to your balance. <span className="tabular-nums">Window closes in {formatHms(until! - now)}.</span>
      </p>
      {error ? (
        <p role="alert" className="text-center text-xs text-down">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PaymentBody({ row, now }: { row: PaymentRow; now: Date }) {
  const created = new Date(row.createdAt);
  const updated = row.updatedAt ? new Date(row.updatedAt) : null;
  const deposit = row.kind === "deposit";
  const tone = statusTone(row.status);
  const amountClass =
    paymentMovedNoMoney(row.status) ? "text-ink-3 line-through decoration-1" : deposit && row.status === "COMPLETED" ? "text-up" : "text-ink";

  return (
    <>
      <div className="grid justify-items-center gap-1.5 pt-1 text-center">
        <span className={`inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-extrabold ${TONE_PILL[tone]}`}>
          {statusLabel(row.status)}
        </span>
        <span className={`text-[40px] font-extrabold leading-tight tracking-[-0.03em] tabular-nums ${amountClass}`}>
          {paymentAmountText(row)}
        </span>
        <span className="text-sm text-ink-2">
          {deposit ? `via ${row.methodLabel}` : row.destination ? `to ${row.destination}` : `via ${row.methodLabel}`}
        </span>
      </div>

      <StatusTimeline
        kind={row.kind}
        status={row.status}
        createdAt={row.createdAt}
        updatedAt={row.updatedAt}
        now={now}
        className="bg-tile"
      />

      {deposit && row.status === "PENDING_CONFIRMATION" ? (
        <p className="rounded-2xl bg-tile px-4 py-3 text-xs leading-relaxed text-ink-2">
          Payments with this method can take up to 48 hours. The status may appear as “Failed” until the funds are
          received on our side.
        </p>
      ) : null}
      {!deposit && row.status === "HELD" && row.holdUntil ? (
        <p className="rounded-2xl bg-tile px-4 py-3 text-xs leading-relaxed text-ink-2">
          First withdrawals are held briefly. This one will be reviewed from{" "}
          <span suppressHydrationWarning className="font-semibold text-ink">
            {when(new Date(row.holdUntil), now)}
          </span>
          .
        </p>
      ) : null}

      <dl className="divide-y divide-rule rounded-2xl bg-tile px-4">
        <Row label="Method">{row.methodLabel}</Row>
        {!deposit && row.destination ? <Row label="Destination">{row.destination}</Row> : null}
        <Row label={deposit ? "Started" : "Requested"}>
          <span suppressHydrationWarning>{when(created, now)}</span>
        </Row>
        {deposit && updated && row.status !== "AWAITING_PAYMENT" ? (
          <Row label="Last update">
            <span suppressHydrationWarning>{when(updated, now)}</span>
          </Row>
        ) : null}
        {deposit && row.expiresAt ? (
          <Row label="Pay before">
            <span suppressHydrationWarning>{when(new Date(row.expiresAt), now)}</span>
          </Row>
        ) : null}
      </dl>

      <ReferenceRow reference={referenceFor(row)} />

      {!deposit && row.status === "HELD" ? <CancelWithdrawal row={row} /> : null}
    </>
  );
}

function TradeBody({ item, now }: { item: Extract<HistoryItem, { kind: "trade" }>; now: Date }) {
  const { assets } = usePlatform();
  const { trade, currency, pair } = item;
  const precision = assets.find((a) => a.symbol === trade.symbol)?.precision ?? 5;
  const amount = tradeAmount(trade, currency);
  const tone = statusTone(trade.status);
  const up = trade.direction === "UP";
  const opened = new Date(trade.entryTs * 1000);
  const closed = new Date(trade.expiryTs * 1000);
  const open = trade.status === "OPEN";
  const profit = Math.floor((trade.stake * trade.payoutPct) / 100);

  return (
    <>
      <div className="grid justify-items-center gap-1.5 pt-1 text-center">
        <span className={`inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-extrabold ${TONE_PILL[tone]}`}>
          {statusLabel(trade.status)}
        </span>
        <span className={`text-[40px] font-extrabold leading-tight tracking-[-0.03em] tabular-nums ${AMOUNT_TONE[amount.tone]}`}>
          {amount.text}
        </span>
        <span className="text-sm text-ink-2">{tradeTitle(trade, pair)}</span>
      </div>

      <dl className="divide-y divide-rule rounded-2xl bg-tile px-4">
        <Row label="Direction">
          <span className={up ? "text-up" : "text-down"}>{up ? "Buy (higher)" : "Sell (lower)"}</span>
        </Row>
        <Row label="Asset">{pair}</Row>
        <Row label="Stake">{formatMinor(trade.stake, currency)}</Row>
        <Row label={trade.status === "LOST" ? "Payout if right" : "Payout"}>
          {trade.payoutPct}% · {formatMinor(trade.stake + profit, currency)}
        </Row>
        <Row label="Entry price">{trade.entryPrice.toFixed(precision)}</Row>
        <Row label="Close price">{trade.exitPrice !== null ? trade.exitPrice.toFixed(precision) : "—"}</Row>
        <Row label="Duration">{durationLabel(trade.entryTs, trade.expiryTs)}</Row>
        <Row label="Opened">
          <span suppressHydrationWarning>{when(opened, now)}</span>
        </Row>
        <Row label={open ? "Closes" : "Closed"}>
          <span suppressHydrationWarning>{when(closed, now)}</span>
        </Row>
      </dl>

      <ReferenceRow reference={`TR-${trade.id.slice(0, 8).toUpperCase()}`} />
    </>
  );
}

/**
 * Detail view for one history row. Bottom sheet on phone and tablet (capped at
 * ~34rem and centred), a centred dialog on desktop. Escape, the backdrop and
 * the close button dismiss it; focus is trapped inside and returns to the row
 * that opened it.
 */
export function TransactionDetailSheet({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [now] = useState(() => new Date());
  useScrollLock();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const title = item.kind === "trade" ? "Trade" : paymentTitle(item.payment);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 phone:items-end"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="sheet-phone flex max-h-[min(92dvh,46rem)] w-full max-w-[34rem] flex-col overflow-hidden rounded-2xl border border-rule bg-panel shadow-[0_24px_64px_rgb(0_0_0/0.7)]"
      >
        <div aria-hidden className="sheet-handle hidden phone:block" />
        <div className="flex items-center gap-2 px-4 pb-1 pt-2">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid size-11 place-items-center rounded-xl text-ink-2 hover:bg-tile hover:text-ink"
          >
            <Icon name="close" className="size-5" />
          </button>
        </div>
        <div className="grid gap-3.5 overflow-y-auto overscroll-contain px-4 pb-5 pt-2">
          {item.kind === "trade" ? (
            <TradeBody item={item} now={now} />
          ) : (
            <PaymentBody row={item.payment} now={now} />
          )}
        </div>
      </div>
    </div>
  );
}
