"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { BalancesDto } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";
import { clockTime } from "@/lib/format-time";
import { useDismiss } from "@/lib/use-dismiss";
import { useNowSec } from "@/lib/use-now";
import { Icon } from "./Icon";
import { PromoBanner } from "./PromoBanner";
import { usePlatform, type AccountView } from "./PlatformProvider";

const FEED_LABEL = {
  open: { text: "Live feed", dot: "bg-up shadow-[0_0_0_3px_rgba(59,229,132,.12)]" },
  connecting: { text: "Connecting", dot: "bg-brand blink" },
  closed: { text: "Reconnecting", dot: "bg-down blink" },
  unauthorised: { text: "Signed out", dot: "bg-down" },
} as const;

function totalBalance(account: AccountView | undefined, balances: Readonly<Record<string, BalancesDto>>) {
  const b = account ? balances[account.id] : undefined;
  return account && b ? formatMinor(b.realBalance + b.bonusBalance, account.currency) : "—";
}

function AccountPlate({ type, small = false }: { type: AccountView["type"]; small?: boolean }) {
  const live = type === "LIVE";
  return (
    <span
      className={`grid auto-cols-max grid-flow-col place-content-center items-center gap-[5px] rounded-[2px] px-[9px] font-extrabold tracking-[0.12em] ${
        small ? "h-[26px] text-[10px]" : "h-[30px] text-[11px]"
      } ${live ? "bg-brand text-brand-ink" : "border border-dotted border-[#555] text-ink-2"}`}
    >
      <span
        aria-hidden
        className={`size-[5px] rounded-full ${live ? "bg-up shadow-[0_0_5px_var(--color-up)]" : "bg-ink-3"}`}
      />
      {live ? "LIVE" : "DEMO"}
    </span>
  );
}

/** Ticks every second on its own, so the rest of the top bar does not re-render. */
function FeedClock() {
  const now = useNowSec();
  return <span className="led text-[13px]">{now === null ? "" : clockTime(now)}</span>;
}

export function TopBar() {
  const { status, accounts, activeAccount, balances, setActiveAccountId } = usePlatform();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const live = activeAccount?.type === "LIVE";
  const feed = FEED_LABEL[status];

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);

  return (
    <header
      className={`col-span-full row-start-1 flex min-w-0 items-center gap-5 border-b border-rule bg-ground pl-3.5 pr-4 max-md:gap-2 max-md:px-2.5 ${
        live ? "shadow-[inset_0_-2px_0_0_var(--color-brand)]" : ""
      }`}
    >
      <Link href="/trade" aria-label="ASM Trade" className="flex flex-none items-center gap-2.5">
        <span aria-hidden className="font-brand text-[22px] font-black tracking-[0.02em] text-brand [text-shadow:0_0_10px_rgba(255,176,0,.35)]">
          ASM
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-2 max-md:hidden">Trade</span>
      </Link>

      <div className="ml-1 flex flex-none items-center gap-2.5 text-ink-3 max-md:hidden">
        <span aria-hidden className={`size-1.5 rounded-full ${feed.dot}`} />
        <span className="legend">{feed.text}</span>
        <FeedClock />
      </div>

      <div className="mx-auto hidden xl:block">
        <PromoBanner />
      </div>

      <div ref={menuRef} className="relative ml-auto flex min-w-0 items-center gap-2.5 max-md:gap-1.5">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={`grid h-11 grid-cols-[auto_auto_18px] items-center gap-2.5 rounded border bg-panel pl-1.5 pr-2.5 text-left ${
            live ? "border-brand" : "border-rule hover:border-tile-hi"
          }`}
        >
          {activeAccount ? <AccountPlate type={activeAccount.type} /> : null}
          <span className="grid min-w-0 gap-0.5">
            <span className="legend text-[10px]! max-md:hidden">{live ? "Live account" : "Demo account"}</span>
            <span className="led led-lit text-[20px] leading-none">{totalBalance(activeAccount, balances)}</span>
          </span>
          <Icon name="caret" />
        </button>

        <Link
          href="/deposit"
          className="inline-flex h-11 flex-none items-center gap-2 rounded border border-brand px-4 text-xs font-bold uppercase tracking-[0.06em] text-brand transition-colors hover:bg-brand/10 max-md:w-11 max-md:justify-center max-md:px-0"
        >
          <Icon name="plus" />
          <span className="max-md:sr-only">Deposit</span>
        </Link>
        <Link
          href="/withdrawal"
          className="inline-flex h-11 flex-none items-center rounded border border-rule px-4 text-xs font-bold uppercase tracking-[0.06em] text-ink-2 transition-colors hover:border-tile-hi hover:text-ink max-md:hidden"
        >
          Withdraw
        </Link>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-[54px] z-20 w-[340px] max-w-[calc(100vw-20px)] rounded border border-rule bg-[#0f0f10] p-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)]"
          >
            {[...accounts]
              .sort((a, b) => (a.type === b.type ? 0 : a.type === "LIVE" ? -1 : 1))
              .map((account) => {
                const active = account.id === activeAccount?.id;
                return (
                  <button
                    key={account.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setActiveAccountId(account.id);
                      setMenuOpen(false);
                    }}
                    className={`grid w-full grid-cols-[58px_1fr_auto] items-center gap-3 rounded-[2px] px-2.5 py-3 text-left hover:bg-tile ${
                      active ? "bg-tile shadow-[inset_0_0_0_1px_var(--color-tile-hi)]" : ""
                    }`}
                  >
                    <AccountPlate type={account.type} small />
                    <span>
                      <strong className="block font-semibold">
                        {account.type === "LIVE" ? "Live account" : "Demo account"}
                      </strong>
                      <small className="text-ink-3">{totalBalance(account, balances)}</small>
                    </span>
                    <span
                      aria-hidden
                      className={`size-[18px] rounded-full ${active ? "border-[5px] border-brand" : "border-[1.5px] border-[#4a4f55]"}`}
                    />
                  </button>
                );
              })}
            <div className="mt-1.5 flex items-center justify-between border-t border-rule px-2.5 pb-1 pt-2.5">
              <Link href="/account" className="text-[13px] font-semibold text-brand hover:underline">
                My account
              </Link>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="text-[13px] font-semibold text-ink-3 hover:text-ink">
                  Log out
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
