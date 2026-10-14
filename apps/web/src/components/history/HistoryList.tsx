"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatMinor } from "@asm/client-core";
import { Icon, type IconName } from "@/components/shell/Icon";
import { usePlatform } from "@/components/shell/PlatformProvider";
import {
  EMPTY_COPY,
  FILTER_LABEL,
  TONE_PILL,
  durationLabel,
  groupByDay,
  itemMatchesFilter,
  parseFilter,
  paymentAmountText,
  paymentItem,
  paymentMovedNoMoney,
  paymentTitle,
  statusLabel,
  statusTone,
  timeOfDay,
  tradeAmount,
  tradePairName,
  tradeTitle,
  type HistoryFilter,
  type HistoryItem,
  type PaymentRow,
  type Tone,
} from "./history-model";
import { TransactionDetailSheet } from "./TransactionDetailSheet";

const TILE_TONE: Record<Tone, string> = {
  up: "bg-up/12 text-up",
  down: "bg-down/12 text-down",
  caution: "bg-caution/12 text-caution",
  neutral: "bg-tile text-ink-2",
};
const AMOUNT_TONE: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  caution: "text-caution",
  neutral: "text-ink",
};

const EMPTY_CTA: Record<HistoryFilter, { href: string; label: string }> = {
  all: { href: "/deposit", label: "Make a deposit" },
  trades: { href: "/trade", label: "Go to Trade" },
  deposits: { href: "/deposit", label: "Make a deposit" },
  withdrawals: { href: "/withdrawal", label: "Withdraw funds" },
};

interface RowView {
  icon: IconName;
  tile: Tone;
  title: string;
  sub: string;
  amount: string;
  amountClass: string;
  status: string;
  statusTone: Tone;
}

function rowView(item: HistoryItem): RowView {
  if (item.kind === "trade") {
    const { trade, currency, pair } = item;
    const amount = tradeAmount(trade, currency);
    return {
      icon: trade.direction === "UP" ? "up" : "down",
      tile: amount.tone,
      title: tradeTitle(trade, pair),
      sub: `${timeOfDay(new Date(item.atMs))} · ${durationLabel(trade.entryTs, trade.expiryTs)} · ${formatMinor(trade.stake, currency)}`,
      amount: amount.text,
      amountClass: AMOUNT_TONE[amount.tone],
      status: statusLabel(trade.status),
      statusTone: statusTone(trade.status),
    };
  }
  const p = item.payment;
  const deposit = p.kind === "deposit";
  const noMoney = paymentMovedNoMoney(p.status);
  const credited = deposit && p.status === "COMPLETED";
  return {
    icon: deposit ? "down" : "up",
    tile: noMoney ? "neutral" : credited ? "up" : "neutral",
    title: paymentTitle(p),
    sub: `${timeOfDay(new Date(item.atMs))} · ${p.destination ?? p.methodLabel}`,
    amount: paymentAmountText(p),
    amountClass: noMoney ? "text-ink-3 line-through decoration-1" : credited ? "text-up" : "text-ink",
    status: statusLabel(p.status),
    statusTone: statusTone(p.status),
  };
}

function HistoryRow({ item, onOpen }: { item: HistoryItem; onOpen: (key: string) => void }) {
  const v = rowView(item);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.key)}
      aria-haspopup="dialog"
      className="flex min-h-16 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-tile/50 focus-visible:bg-tile/50"
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TILE_TONE[v.tile]}`}>
        <Icon name={v.icon} className="size-[18px]" strokeWidth={2.2} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-[15px] font-semibold">{v.title}</span>
        <span className="truncate text-xs text-ink-2">{v.sub}</span>
      </span>
      <span className="ml-auto grid shrink-0 justify-items-end gap-[3px]">
        <span className={`text-[15px] font-bold tabular-nums ${v.amountClass}`}>{v.amount}</span>
        <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold ${TONE_PILL[v.statusTone]}`}>
          {v.status}
        </span>
      </span>
    </button>
  );
}

function Skeleton() {
  return (
    <div aria-hidden className="grid gap-2 motion-safe:animate-pulse">
      {[3, 2].map((rows, g) => (
        <div key={g}>
          <div className="mb-2 mt-3 h-3.5 w-16 rounded bg-tile" />
          <div className="divide-y divide-rule overflow-hidden rounded-2xl bg-panel">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex h-16 items-center gap-3 px-3.5">
                <span className="size-10 rounded-xl bg-tile" />
                <span className="grid gap-2">
                  <span className="h-3.5 w-28 rounded bg-tile" />
                  <span className="h-3 w-36 rounded bg-tile" />
                </span>
                <span className="ml-auto grid justify-items-end gap-2">
                  <span className="h-3.5 w-16 rounded bg-tile" />
                  <span className="h-4 w-14 rounded-full bg-tile" />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rewrites the query string without a navigation, so no server round-trip. */
function replaceQuery(mutate: (params: URLSearchParams) => void): void {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}

/**
 * The shared History list: day-grouped rows, filter chips (synced to
 * `?filter=`), skeleton while client data loads, per-filter empty states and
 * the detail sheet (`?tx=d:<id>` / `w:<id>` / `t:<id>`, so a row can be linked).
 *
 * Deposits and withdrawals arrive as props from the server page. Trades come
 * from the platform context (the active account's settled trades) when
 * `includeTrades` is set; /balance (Payments) leaves them out.
 */
export function HistoryList({
  payments,
  includeTrades,
}: {
  payments: PaymentRow[];
  includeTrades: boolean;
}) {
  const allowed = useMemo<HistoryFilter[]>(
    () => (includeTrades ? ["all", "trades", "deposits", "withdrawals"] : ["all", "deposits", "withdrawals"]),
    [includeTrades],
  );
  const { activeAccount, tradesByAccount, assets, status } = usePlatform();
  const searchParams = useSearchParams();
  const filter = parseFilter(searchParams.get("filter"), allowed);
  const txKey = searchParams.get("tx");

  // Local times and "Today" depend on the viewer's clock and zone, so the list
  // renders after mount; the server HTML is the skeleton.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const accountId = activeAccount?.id;
  const currency = activeAccount?.currency ?? "INR";
  const accountTrades = accountId ? tradesByAccount[accountId] : undefined;
  const tradesLoading = includeTrades && accountTrades === undefined && status === "connecting";

  const items = useMemo<HistoryItem[]>(() => {
    const list: HistoryItem[] = payments.map(paymentItem);
    if (includeTrades) {
      for (const trade of accountTrades ?? []) {
        if (trade.status === "OPEN") continue;
        const asset = assets.find((a) => a.symbol === trade.symbol);
        list.push({
          kind: "trade",
          key: `t:${trade.id}`,
          atMs: trade.entryTs * 1000,
          trade,
          currency,
          pair: tradePairName(trade, asset?.displayName),
        });
      }
    }
    return list;
  }, [payments, includeTrades, accountTrades, assets, currency]);

  const visible = useMemo(() => items.filter((i) => itemMatchesFilter(i, filter)), [items, filter]);
  const groups = useMemo(() => (now ? groupByDay(visible, now) : []), [visible, now]);
  // Resolved only after mount: the sheet renders Date.now() countdowns, which
  // must never be part of the server HTML for a `?tx=` deep link.
  const selected = now && txKey ? (items.find((i) => i.key === txKey) ?? null) : null;
  // `?tx=` names a row that isn't in the loaded list (older than the window, or
  // not this account's). Wait for trades to load before saying so.
  const awaitingTrade = txKey?.startsWith("t:") === true && includeTrades && accountTrades === undefined && status === "connecting";
  const missingTx = now !== null && txKey !== null && txKey !== "" && !selected && !tradesLoading && !awaitingTrade;

  const setFilter = useCallback((next: HistoryFilter) => {
    replaceQuery((p) => {
      p.delete("tx");
      if (next === "all") p.delete("filter");
      else p.set("filter", next);
    });
  }, []);
  const open = useCallback((key: string) => replaceQuery((p) => p.set("tx", key)), []);
  const close = useCallback(() => replaceQuery((p) => p.delete("tx")), []);

  const empty =
    !includeTrades && filter === "all"
      ? { title: "No transactions yet", body: "Deposits and withdrawals will show up here." }
      : EMPTY_COPY[filter];
  const cta = EMPTY_CTA[filter];
  const showSkeleton = now === null || (tradesLoading && (filter === "trades" || visible.length === 0));

  return (
    <div className="grid gap-1">
      <div
        role="group"
        aria-label="Filter history"
        className="edge-fade-x -mx-4 flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
      >
        {allowed.map((f) => {
          const on = f === filter;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f)}
              className={`relative h-9 shrink-0 rounded-full px-3.5 text-[13px] font-bold after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] ${
                on ? "bg-ink text-ground" : "bg-tile text-ink-2 hover:text-ink"
              }`}
            >
              {FILTER_LABEL[f]}
            </button>
          );
        })}
      </div>

      {missingTx ? (
        <div role="status" className="mb-2 flex items-center gap-3 rounded-xl bg-tile px-4 py-3 text-sm text-ink-2">
          <span className="min-w-0 flex-1">That transaction isn&apos;t in your recent history.</span>
          <button
            type="button"
            onClick={close}
            className="relative h-9 shrink-0 rounded-lg px-3 text-[13px] font-bold text-ink hover:bg-tile-hi after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {showSkeleton ? (
        <Skeleton />
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-panel px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-tile text-ink-2">
            <Icon name="history" className="size-6" />
          </span>
          <h2 className="text-base font-semibold">{empty.title}</h2>
          <p className="max-w-[40ch] text-balance text-sm text-ink-2">{empty.body}</p>
          <Link
            href={cta.href}
            className="mt-1 grid h-11 place-items-center rounded-xl bg-brand-fill px-5 text-sm font-bold text-white hover:bg-brand-fill-hi"
          >
            {cta.label}
          </Link>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="sticky top-0 z-[1] bg-ground px-0.5 pb-2 pt-3 text-[13px] font-bold text-ink-2">{g.label}</h2>
              <div className="divide-y divide-rule overflow-hidden rounded-2xl bg-panel">
                {g.items.map((item) => (
                  <HistoryRow key={item.key} item={item} onOpen={open} />
                ))}
              </div>
            </section>
          ))}
          {includeTrades && (filter === "all" || filter === "trades") ? (
            <p className="px-1 pt-3 text-center text-xs text-ink-3">
              Trades are from your {activeAccount?.type === "DEMO" ? "Demo" : "Live"} account · latest 50.
            </p>
          ) : null}
        </>
      )}

      {selected ? <TransactionDetailSheet item={selected} onClose={close} /> : null}
    </div>
  );
}
