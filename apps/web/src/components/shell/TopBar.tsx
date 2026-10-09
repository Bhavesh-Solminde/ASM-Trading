"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { BalancesDto } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";
import { isMuted, setMuted } from "@/lib/sound";
import { useDismiss } from "@/lib/use-dismiss";
import { LogoWordmark } from "@/components/brand/Logo";
import { Icon } from "./Icon";
import { MobileNav } from "./MobileNav";
import { PromoBanner } from "./PromoBanner";
import { usePlatform, type AccountView } from "./PlatformProvider";

// Live account is open to every signed-in user: no env flag, no per-user
// liveAccess check. The gating that used to live here was removed when live
// trading launched for all; keep the per-user column in the schema for history.

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
        small ? "h-[26px] text-[10px]" : "h-[30px] text-[11px] phone:h-[21px] phone:gap-1 phone:px-1.5 phone:text-[10px]"
      } ${live ? "bg-up text-up-ink" : "border border-dotted border-[#555] text-ink-2"}`}
    >
      <span
        aria-hidden
        className={`size-[6px] rounded-full ${
          live ? "bg-down shadow-[0_0_6px_var(--color-down)] live-pulse" : "bg-ink-3"
        }`}
      />
      {live ? "LIVE" : "DEMO"}
    </span>
  );
}

export function TopBar() {
  const { status, accounts, activeAccount, balances, setActiveAccountId } = usePlatform();
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMutedState] = useState(() => isMuted());
  const [curBusy, setCurBusy] = useState(false);
  const [curError, setCurError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const live = activeAccount?.type === "LIVE";
  const feed = FEED_LABEL[status];

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);

  // Sign out, then a full document load of /login so every client cache (React
  // state, RSC cache, the engine socket) drops with the session. The form's
  // native post stays as the no-JS fallback; the route redirects that to /login.
  const logOut = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }, []);

  const toggleMuted = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev;
      setMuted(next);
      return next;
    });
  }, []);

  const changeCurrency = useCallback(
    async (currency: string) => {
      if (!activeAccount || curBusy || activeAccount.currency === currency) return;
      setCurBusy(true);
      setCurError(null);
      try {
        const res = await fetch("/api/account/currency", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: activeAccount.id, currency }),
        });
        if (res.ok) {
          window.location.reload();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setCurError(data.error ?? "Could not change currency.");
      } catch {
        setCurError("Could not reach the server.");
      }
      setCurBusy(false);
    },
    [activeAccount, curBusy],
  );

  const handleSelectAccount = useCallback(
    (account: AccountView) => {
      setActiveAccountId(account.id);
      setMenuOpen(false);
    },
    [setActiveAccountId],
  );

  return (
    <header
      className={`col-span-full row-start-1 flex min-w-0 items-center gap-5 border-b border-rule bg-ground pl-3.5 pr-4 phone:gap-1.5 phone:px-2 ${
        live ? "shadow-[inset_0_-2px_0_0_var(--color-up)]" : ""
      }`}
    >
      <MobileNav />
      <Link href="/trade" aria-label="IndianxTrade" className="flex h-11 flex-none items-center phone:mx-auto phone:h-10">
        <LogoWordmark className="h-8 flex-none phone:h-[22px]" />
      </Link>

      <div className="ml-1 flex flex-none items-center gap-2.5 text-ink-3 phone:hidden">
        <span aria-hidden className={`size-1.5 rounded-full ${feed.dot}`} />
        <span className="legend">{feed.text}</span>
        <button
          type="button"
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          aria-pressed={muted}
          onClick={toggleMuted}
          className="text-ink-3 hover:text-ink"
        >
          <Icon name={muted ? "muted" : "sound"} />
        </button>
      </div>

      <div className="mx-auto hidden xl:block">
        <PromoBanner variant="bar" />
      </div>

      <div ref={menuRef} className="relative ml-auto flex min-w-0 items-center gap-2.5 phone:ml-0 phone:gap-1.5">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={`grid h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_18px] items-center gap-2.5 rounded border bg-panel pl-1.5 pr-2.5 text-left phone:h-10 phone:grid-cols-[minmax(0,1fr)_16px] phone:gap-1 phone:rounded-lg phone:pl-2 phone:pr-1.5 ${
            live ? "border-up" : "border-rule hover:border-tile-hi"
          }`}
        >
          {activeAccount ? (
            <span className="contents phone:hidden">
              <AccountPlate type={activeAccount.type} />
            </span>
          ) : null}
          <span className="grid min-w-0 gap-0.5 phone:gap-[3px]">
            <span className="legend text-[10px]! phone:hidden">{live ? "Live account" : "Demo account"}</span>
            {/* Phone: the plate becomes a small dot + label above the amount. */}
            <span
              className={`hidden items-center gap-1 text-[9px] font-extrabold uppercase leading-none tracking-[0.14em] phone:flex ${
                live ? "text-up" : "text-ink-3"
              }`}
            >
              <span
                aria-hidden
                className={`size-[6px] rounded-full ${live ? "bg-down shadow-[0_0_6px_var(--color-down)] live-pulse" : "bg-ink-3"}`}
              />
              {live ? "Live" : "Demo"}
            </span>
            <span className="led led-lit truncate text-[20px] leading-none phone:text-[clamp(15px,4.4vw,18px)]">{totalBalance(activeAccount, balances)}</span>
          </span>
          <Icon name="caret" className="size-[18px] phone:size-4" />
        </button>

        <Link
          href="/deposit"
          className="inline-flex h-11 flex-none items-center gap-2 rounded border border-up bg-up px-4 text-xs font-bold uppercase tracking-[0.06em] text-up-ink transition-colors hover:bg-up/90 phone:h-10 phone:w-10 phone:justify-center phone:rounded-lg phone:px-0"
        >
          <Icon name="plus" className="size-[18px] phone:size-5" />
          <span className="phone:sr-only">Deposit</span>
        </Link>
        <Link
          href="/withdrawal"
          className="inline-flex h-11 flex-none items-center rounded border border-rule px-4 text-xs font-bold uppercase tracking-[0.06em] text-ink-2 transition-colors hover:border-tile-hi hover:text-ink phone:hidden"
        >
          Withdraw
        </Link>

        {menuOpen ? (
          <>
            <div aria-hidden onClick={closeMenu} className="fixed inset-0 z-30 hidden bg-black/60 phone:block" />
            <div
              role="menu"
              className="absolute right-0 top-[54px] z-40 w-[340px] max-w-[calc(100vw-20px)] rounded border border-rule bg-[#2c3036] p-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)] phone:fixed phone:inset-x-0 phone:bottom-0 phone:top-auto phone:w-auto phone:max-w-none phone:rounded-b-none phone:border-x-0 phone:border-b-0 phone:pb-[max(12px,env(safe-area-inset-bottom))]"
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
                      className={`size-[18px] rounded-full ${active ? "border-[5px] border-up" : "border-[1.5px] border-[#4a4f55]"}`}
                    />
                  </button>
                );
              })}
            {activeAccount ? (
              <div className="mt-1.5 grid gap-1.5 border-t border-rule px-2.5 pb-1 pt-2.5">
                <div className="flex items-center justify-between">
                  <span className="legend text-[10px]!">Currency</span>
                  <div className="flex gap-0.5 rounded-[3px] border border-rule p-0.5">
                    {["INR", "USD"].map((cur) => (
                      <button
                        key={cur}
                        type="button"
                        disabled={curBusy}
                        aria-pressed={activeAccount.currency === cur}
                        onClick={() => void changeCurrency(cur)}
                        className={`rounded-[2px] px-2.5 py-0.5 text-[11px] font-bold tracking-[0.06em] disabled:opacity-60 ${
                          activeAccount.currency === cur ? "bg-brand text-brand-ink" : "text-ink-3 hover:text-ink"
                        }`}
                      >
                        {cur}
                      </button>
                    ))}
                  </div>
                </div>
                {curError ? <p className="text-[11px] text-down">{curError}</p> : null}
              </div>
            ) : null}
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
              <form action="/api/auth/logout" method="post" onSubmit={(e) => void logOut(e)}>
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
