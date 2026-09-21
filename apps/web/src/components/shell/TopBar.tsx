"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { BalancesDto } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";
import { clockTime } from "@/lib/format-time";
import { useDismiss } from "@/lib/use-dismiss";
import { useNowSec } from "@/lib/use-now";
import { LogoEmblem } from "@/components/brand/Logo";
import { Icon } from "./Icon";
import { MobileNav } from "./MobileNav";
import { PromoBanner } from "./PromoBanner";
import { usePlatform, type AccountView } from "./PlatformProvider";

// Gate the live account behind an env flag. Flip
// NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED=true when we're ready to expose it.
const LIVE_ACCOUNT_ENABLED = process.env.NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED === "true";

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
  const [liveComingSoon, setLiveComingSoon] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const live = activeAccount?.type === "LIVE";
  const feed = FEED_LABEL[status];

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);

  const handleSelectAccount = useCallback(
    (account: AccountView) => {
      if (account.type === "LIVE" && !LIVE_ACCOUNT_ENABLED) {
        setLiveComingSoon(true);
        setMenuOpen(false);
        const demo = accounts.find((a) => a.type === "DEMO");
        if (demo && demo.id !== activeAccount?.id) setActiveAccountId(demo.id);
        return;
      }
      setActiveAccountId(account.id);
      setMenuOpen(false);
    },
    [accounts, activeAccount, setActiveAccountId],
  );

  return (
    <header
      className={`col-span-full row-start-1 flex min-w-0 items-center gap-5 border-b border-rule bg-ground pl-3.5 pr-4 phone:gap-2 phone:px-2.5 ${
        live ? "shadow-[inset_0_-2px_0_0_var(--color-brand)]" : ""
      }`}
    >
      <MobileNav />
      <Link href="/trade" aria-label="ASM Trade" className="flex h-11 flex-none items-center gap-2">
        <LogoEmblem className="h-8 w-8 flex-none [filter:drop-shadow(0_0_8px_rgba(255,176,0,.3))]" />
        <span aria-hidden className="font-brand text-[22px] font-black tracking-[0.02em] text-brand [text-shadow:0_0_10px_rgba(255,176,0,.35)]">
          ASM
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-2 phone:hidden">Trade</span>
      </Link>

      <div className="ml-1 flex flex-none items-center gap-2.5 text-ink-3 phone:hidden">
        <span aria-hidden className={`size-1.5 rounded-full ${feed.dot}`} />
        <span className="legend">{feed.text}</span>
        <FeedClock />
      </div>

      <div className="mx-auto hidden xl:block">
        <PromoBanner />
      </div>

      <div ref={menuRef} className="relative ml-auto flex min-w-0 items-center gap-2.5 phone:gap-1.5">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={`grid h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_18px] items-center gap-2.5 rounded border bg-panel pl-1.5 pr-2.5 text-left phone:gap-1.5 phone:pr-1.5 ${
            live ? "border-brand" : "border-rule hover:border-tile-hi"
          }`}
        >
          {activeAccount ? <AccountPlate type={activeAccount.type} /> : null}
          <span className="grid min-w-0 gap-0.5">
            <span className="legend text-[10px]! phone:hidden">{live ? "Live account" : "Demo account"}</span>
            <span className="led led-lit truncate text-[20px] leading-none phone:text-[17px]">{totalBalance(activeAccount, balances)}</span>
          </span>
          <Icon name="caret" />
        </button>

        <Link
          href="/deposit"
          className="inline-flex h-11 flex-none items-center gap-2 rounded border border-brand px-4 text-xs font-bold uppercase tracking-[0.06em] text-brand transition-colors hover:bg-brand/10 phone:w-11 phone:justify-center phone:px-0"
        >
          <Icon name="plus" />
          <span className="phone:sr-only">Deposit</span>
        </Link>
        <Link
          href="/withdrawal"
          className="inline-flex h-11 flex-none items-center rounded border border-rule px-4 text-xs font-bold uppercase tracking-[0.06em] text-ink-2 transition-colors hover:border-tile-hi hover:text-ink phone:hidden"
        >
          Withdraw
        </Link>

        {liveComingSoon ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-coming-soon-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setLiveComingSoon(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[380px] rounded border border-rule bg-[#0f0f10] p-5 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)]"
            >
              <h2 id="live-coming-soon-title" className="text-base font-bold tracking-tight text-ink">
                Live account — coming soon
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                The live account isn&apos;t available yet. You&apos;re still on the demo account —
                keep exploring with virtual funds, and we&apos;ll let you know as soon as live
                trading opens up.
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setLiveComingSoon(false)}
                  className="inline-flex h-9 items-center rounded border border-brand bg-brand px-4 text-xs font-bold uppercase tracking-[0.06em] text-brand-ink hover:bg-brand/90"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {menuOpen ? (
          <>
            <div aria-hidden onClick={closeMenu} className="fixed inset-0 z-30 hidden bg-black/60 phone:block" />
            <div
              role="menu"
              className="absolute right-0 top-[54px] z-40 w-[340px] max-w-[calc(100vw-20px)] rounded border border-rule bg-[#0f0f10] p-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)] phone:fixed phone:inset-x-0 phone:bottom-0 phone:top-auto phone:w-auto phone:max-w-none phone:rounded-b-none phone:border-x-0 phone:border-b-0 phone:pb-[max(12px,env(safe-area-inset-bottom))]"
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
                    onClick={() => handleSelectAccount(account)}
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
            <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-rule px-2.5 pb-1 pt-2.5">
              <Link href="/account" onClick={closeMenu} className="py-2 text-[13px] font-semibold text-brand hover:underline">
                My account
              </Link>
              <Link
                href="/withdrawal"
                onClick={closeMenu}
                className="hidden py-2 text-[13px] font-semibold text-ink-2 hover:text-ink phone:inline"
              >
                Withdraw
              </Link>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="py-2 text-[13px] font-semibold text-ink-3 hover:text-ink">
                  Log out
                </button>
              </form>
            </div>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
