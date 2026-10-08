"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { BONUS_TIERS, bonusPercentForDeposit, ordinal } from "@/lib/bonus";
import { useDismiss } from "@/lib/use-dismiss";
import { Icon } from "./Icon";
import { usePlatform } from "./PlatformProvider";

/** "On your first 2 deposits" while the next deposit starts a run of equal tiers, else that one deposit. */
function offerSubline(next: number): string {
  const pct = bonusPercentForDeposit(next);
  let last = next;
  while (bonusPercentForDeposit(last + 1) === pct) last += 1;
  if (next === 1 && last > 1) return `On your first ${last} deposits`;
  if (last > next) return `On your ${ordinal(next)} & ${ordinal(last)} deposits`;
  return `On your ${ordinal(next)} deposit`;
}

/**
 * Deposit-bonus offer: `card` is the phone banner row under the top bar,
 * `bar` the slim desktop pill. Both open the offer sheet with every tier and
 * where the user is. Renders nothing once every tier has been used.
 */
export function PromoBanner({ variant }: { variant: "card" | "bar" }) {
  const { completedDeposits } = usePlatform();
  const [open, setOpen] = useState(false);
  const next = completedDeposits + 1;
  const pct = bonusPercentForDeposit(next);
  if (pct === 0) return null;

  const sheet = open ? <BonusOfferSheet completedDeposits={completedDeposits} onClose={() => setOpen(false)} /> : null;

  if (variant === "card") {
    return (
      <>
        <div className="flex h-full items-center gap-2.5 border-b border-rule bg-ground px-2 py-1.5">
          <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-up/45 bg-[linear-gradient(100deg,color-mix(in_srgb,var(--color-up)_16%,transparent),color-mix(in_srgb,var(--color-up)_4%,transparent)_60%)] py-1 pl-2 pr-1.5">
            <GiftIcon className="size-9 flex-none" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[15px] font-black uppercase tracking-[0.02em] text-ink">
                <span className="text-up">{pct}%</span> Deposit bonus
              </p>
              <p className="truncate text-[12px] text-ink-2">{offerSubline(next)}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-9 flex-none items-center gap-1 rounded-md bg-up px-3 text-[13px] font-bold text-up-ink transition hover:brightness-110"
            >
              View offer <span aria-hidden>→</span>
            </button>
          </div>
        </div>
        {sheet}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2.5 rounded border border-up/40 bg-up/5 px-3 text-xs text-ink-2 transition-colors hover:border-up"
      >
        <span className="led led-lit text-[15px] text-up">+{pct}%</span>
        <span>
          <span className="font-semibold text-ink">Deposit bonus</span> {offerSubline(next).toLowerCase()}
        </span>
        <span aria-hidden className="font-bold text-up">
          →
        </span>
      </button>
      {sheet}
    </>
  );
}

/**
 * Every tier, with the user's progress: claimed tiers ticked, the next one
 * highlighted. Bottom sheet on phones, centred dialog on desktop.
 */
export function BonusOfferSheet({
  completedDeposits,
  onClose,
}: {
  completedDeposits: number;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(panelRef, true, close);
  const next = completedDeposits + 1;
  const offerLeft = bonusPercentForDeposit(next) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 phone:items-end">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bonus-offer-title"
        className="w-[420px] max-w-[calc(100vw-24px)] rounded-xl border border-rule bg-ground p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,.85)] phone:w-full phone:max-w-none phone:rounded-b-none phone:border-x-0 phone:border-b-0 phone:pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start gap-3">
          <GiftIcon className="size-11 flex-none" />
          <div className="min-w-0 flex-1">
            <h2 id="bonus-offer-title" className="text-lg font-black uppercase tracking-[0.02em]">
              Deposit bonus
            </h2>
            <p className="text-[13px] text-ink-2">Extra trading balance on each of your first {BONUS_TIERS.length} deposits.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="grid size-9 flex-none place-items-center rounded text-ink-2 hover:bg-panel hover:text-ink"
          >
            <Icon name="close" className="size-[18px]" />
          </button>
        </div>

        <ol className="mt-4 grid gap-2">
          {BONUS_TIERS.map((pct, i) => {
            const n = i + 1;
            const claimed = n <= completedDeposits;
            const isNext = n === next;
            return (
              <li
                key={n}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 ${
                  isNext
                    ? "border-up bg-up/10 shadow-[0_0_0_1px_var(--color-up)]"
                    : claimed
                      ? "border-rule bg-panel/40 opacity-70"
                      : "border-rule bg-panel"
                }`}
              >
                <span className={`led text-[22px] leading-none ${claimed ? "text-ink-3" : "text-up"}`}>{pct}%</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{ordinal(n)} deposit</span>
                  <span className="block truncate text-[12px] text-ink-2">
                    ₹1,000 → ₹{(1000 + (1000 * pct) / 100).toLocaleString("en-IN")} balance
                  </span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    claimed ? "bg-tile text-ink-3" : isNext ? "bg-up text-up-ink" : "bg-tile text-ink-2"
                  }`}
                >
                  {claimed ? "✓ Claimed" : isNext ? "Next" : "Upcoming"}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          The bonus is added automatically when your deposit is credited. It is for trading only and
          can&apos;t be withdrawn — only your real balance can.
        </p>

        {offerLeft ? (
          <Link
            href="/deposit"
            onClick={close}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-up text-sm font-black text-up-ink transition hover:brightness-110"
          >
            Deposit now · get {bonusPercentForDeposit(next)}% <span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="gift-box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffcf5a" />
          <stop offset="1" stopColor="#d98a12" />
        </linearGradient>
      </defs>
      <rect x="7" y="20" width="34" height="23" rx="3" fill="url(#gift-box)" />
      <rect x="5" y="14" width="38" height="9" rx="2.5" fill="#ffd970" />
      <rect x="21" y="14" width="6" height="29" fill="var(--color-up)" />
      <path d="M24 14c-3-6-11-8-12-3-1 4 6 4 12 3zm0 0c3-6 11-8 12-3 1 4-6 4-12 3z" fill="var(--color-up)" />
    </svg>
  );
}
