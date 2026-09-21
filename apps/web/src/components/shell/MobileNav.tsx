"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RAIL_ITEMS, isRailItemActive } from "@/lib/nav";
import { useDismiss } from "@/lib/use-dismiss";
import { Icon } from "./Icon";

/**
 * Phone-only navigation. Replaces the fixed bottom rail with a hamburger button
 * that opens a slide-in drawer of the same destinations, freeing the bottom of
 * the screen for the trade ticket.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
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
        className="grid size-9 place-items-center rounded border border-rule bg-panel text-ink-2 hover:border-tile-hi hover:text-ink"
      >
        <Icon name="menu" className="size-[22px]" />
      </button>

      {open ? (
        <div ref={drawerRef} className="fixed inset-0 z-50">
          <div aria-hidden onClick={close} className="absolute inset-0 bg-black/60" />
          <nav
            aria-label="Platform sections"
            className="absolute inset-y-0 left-0 flex w-[260px] max-w-[80vw] flex-col gap-1 border-r border-rule bg-ground p-3 pt-[max(12px,env(safe-area-inset-top))] shadow-[24px_0_48px_-12px_rgba(0,0,0,.8)]"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-3">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={close}
                className="grid size-8 place-items-center rounded text-ink-2 hover:bg-panel hover:text-ink"
              >
                <Icon name="close" className="size-[18px]" />
              </button>
            </div>

            {RAIL_ITEMS.filter((item) => !item.pinBottom).map((item) => {
              const active = item.available && isRailItemActive(item, pathname);
              const base =
                "grid grid-cols-[24px_1fr_auto] items-center gap-3 rounded px-2.5 py-3 text-sm font-semibold";
              if (!item.available) {
                return (
                  <span
                    key={item.id}
                    aria-disabled="true"
                    className={`${base} cursor-not-allowed text-ink-3 opacity-50`}
                  >
                    <Icon name={item.icon} className="size-[22px]" />
                    {item.label}
                    <span className="text-[9px] uppercase tracking-[0.1em] text-ink-3">Soon</span>
                  </span>
                );
              }
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={`${base} ${
                    active ? "bg-tile text-ink shadow-[inset_3px_0_0_var(--color-brand)]" : "text-ink-2 hover:bg-panel hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} className="size-[22px]" />
                  {item.label}
                  <span />
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
