"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoWordmark } from "@/components/brand/Logo";
import { formatMinor } from "@/lib/format-money";
import { DRAWER_ITEMS, isRailItemActive } from "@/lib/nav";
import { useDismiss } from "@/lib/use-dismiss";
import { Icon } from "./Icon";
import { usePlatform } from "./PlatformProvider";

const NAV_ITEM = "grid h-12 grid-cols-[24px_1fr] items-center gap-3 rounded-xl px-3 text-sm font-semibold";

/**
 * Phone-only navigation. Replaces the fixed bottom rail with a hamburger button
 * that opens a slide-in drawer of the same destinations, freeing the bottom of
 * the screen for the trade ticket.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const { activeAccount, balances } = usePlatform();
  const live = activeAccount?.type === "LIVE";
  const bal = activeAccount ? balances[activeAccount.id] : undefined;
  const total = activeAccount && bal ? formatMinor(bal.realBalance + bal.bonusBalance, activeAccount.currency) : "—";
  const items = DRAWER_ITEMS.filter((item) => !item.pinBottom);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(drawerRef, open, close);

  return (
    <div className="hidden flex-none phone:block">
      <button
        type="button"
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-lg border border-rule bg-panel text-ink hover:border-tile-hi"
      >
        <Icon name="menu" className="size-6" />
      </button>

      {open ? (
        <div ref={drawerRef} className="fixed inset-0 z-50">
          <div aria-hidden onClick={close} className="absolute inset-0 bg-black/60" />
          <nav
            aria-label="Platform sections"
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[84vw] flex-col gap-1 overflow-y-auto overscroll-contain border-r border-rule bg-ground px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] shadow-[24px_0_48px_-12px_rgba(0,0,0,.8)]"
          >
            <div className="mb-2 flex items-center justify-between pl-1">
              <LogoWordmark className="h-6 flex-none" />
              <button
                type="button"
                aria-label="Close menu"
                onClick={close}
                className="grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-panel hover:text-ink"
              >
                <Icon name="close" className="size-[18px]" />
              </button>
            </div>

            {items
              .filter((item) => item.available)
              .map((item) => {
                const active = isRailItemActive(item, pathname);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`${NAV_ITEM} ${active ? "bg-tile text-ink" : "text-ink-2 hover:bg-panel hover:text-ink"}`}
                  >
                    <Icon name={item.icon} className={`size-[22px] ${active ? "text-brand" : ""}`} />
                    {item.label}
                  </Link>
                );
              })}

            {items.some((item) => !item.available) ? (
              <>
                <p className="mt-3 border-t border-rule px-3 pb-1 pt-3 text-xs text-ink-3">Coming soon</p>
                {items
                  .filter((item) => !item.available)
                  .map((item) => (
                    <span
                      key={item.id}
                      aria-disabled="true"
                      className={`${NAV_ITEM} cursor-not-allowed text-ink-3 opacity-50`}
                    >
                      <Icon name={item.icon} className="size-[22px]" />
                      {item.label}
                    </span>
                  ))}
              </>
            ) : null}

            <div className="mt-auto grid gap-3 border-t border-rule pt-3">
              <div className="flex items-center justify-between gap-3 px-1">
                <span
                  className={`inline-flex h-[21px] items-center gap-1 rounded-[2px] px-1.5 text-[10px] font-extrabold tracking-[0.12em] ${
                    live ? "bg-up text-up-ink" : "border border-dotted border-ink-3 text-ink-2"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-[6px] rounded-full ${
                      live ? "bg-down shadow-[0_0_6px_var(--color-down)] live-pulse" : "bg-ink-3"
                    }`}
                  />
                  {live ? "LIVE" : "DEMO"}
                </span>
                <span className="led led-lit truncate text-[18px] leading-none">{total}</span>
              </div>
              <Link
                href="/deposit"
                onClick={close}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-up text-sm font-bold text-up-ink transition-colors hover:bg-up/90"
              >
                <Icon name="plus" className="size-5" />
                Deposit
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
